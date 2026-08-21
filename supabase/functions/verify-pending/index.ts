import { createClient } from 'npm:@supabase/supabase-js@2'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const aa = enc.encode(a)
  const bb = enc.encode(b)
  if (aa.length !== bb.length) return false
  let diff = 0
  for (let i = 0; i < aa.length; i += 1) diff |= aa[i] ^ bb[i]
  return diff === 0
}

type VerifyResponse = {
  ok?: boolean
  status?: string
  retryAfterMs?: number
  error?: string
  reviewRequired?: boolean
  [key: string]: unknown
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'method_not_allowed' }, 405)
  }

  const url = Deno.env.get('SUPABASE_URL')
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const expectedSecret = Deno.env.get('VERIFY_CRON_SECRET')

  if (!url || !serviceRole || !expectedSecret) {
    console.error('Faltan SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY o VERIFY_CRON_SECRET')
    return json({ ok: false, error: 'server_misconfigured' }, 500)
  }

  const providedSecret = req.headers.get('x-cron-secret') ?? ''
  if (!providedSecret || !safeEqual(providedSecret, expectedSecret)) {
    return json({ ok: false, error: 'unauthorized' }, 401)
  }

  const admin = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    // 1) Convierte salas auth-v1 inactivas en solicitudes de verificación.
    const { data: abandoned, error: abandonedError } = await admin.rpc(
      'settle_abandoned_rooms',
    )
    if (abandonedError) {
      console.error('settle_abandoned_rooms:', abandonedError)
    }

    // 2) Un proceso que murió después del lock no puede dejar escrow congelado
    // silenciosamente para siempre. Se manda a revisión manual, fail closed.
    const { data: stuck, error: stuckError } = await admin.rpc(
      'mark_stuck_match_verifications',
      { p_age_seconds: 180 },
    )
    if (stuckError) {
      console.error('mark_stuck_match_verifications:', stuckError)
    }

    // 3) Claim con SKIP LOCKED + lease de 30 s.
    const { data: claimed, error: claimError } = await admin.rpc(
      'claim_pending_match_verifications',
      { p_limit: 8 },
    )
    if (claimError) {
      throw new Error(`claim_failed:${claimError.message}`)
    }

    const roomIds = Array.isArray(claimed)
      ? claimed.filter((x): x is string => typeof x === 'string')
      : []

    const processed: Array<{
      roomId: string
      status: string
      retryAfterMs?: number
      error?: string
    }> = []

    for (const roomId of roomIds) {
      try {
        // verify-match acepta service_role únicamente desde servidor.
        // El gateway sigue protegiendo verify-match con JWT; no se despliega con
        // --no-verify-jwt.
        const response = await fetch(`${url}/functions/v1/verify-match`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: serviceRole,
            Authorization: `Bearer ${serviceRole}`,
          },
          body: JSON.stringify({ roomId }),
        })

        let body: VerifyResponse = {}
        try {
          body = await response.json()
        } catch {
          body = { error: `invalid_json_${response.status}` }
        }

        if (
          body.status === 'pending' ||
          body.status === 'verificando' ||
          body.status === 'busy'
        ) {
          const retryAfterMs =
            typeof body.retryAfterMs === 'number'
              ? Math.max(250, Math.min(body.retryAfterMs, 60000))
              : 2000

          await admin.rpc('schedule_match_verification_retry', {
            p_room_id: roomId,
            p_delay_ms: retryAfterMs,
            p_error: body.error ?? null,
          })

          processed.push({
            roomId,
            status: 'pending',
            retryAfterMs,
          })
          continue
        }

        if (
          body.status === 'verified' ||
          body.status === 'verified_draw' ||
          body.status === 'settled'
        ) {
          processed.push({ roomId, status: body.status })
          continue
        }

        if (body.status === 'failed' || body.reviewRequired) {
          // verify-match ya dejó escrow held y la sala en failed.
          processed.push({
            roomId,
            status: 'failed',
            error: body.error,
          })
          continue
        }

        // Error HTTP o respuesta inesperada ANTES de un lock definitivo:
        // reintento corto. Si verify-match alcanzó el lock y falló, ella misma
        // marca `failed`, y schedule_match_verification_retry no reabre failed.
        const errorText =
          body.error ?? `verify_match_http_${response.status}`

        await admin.rpc('schedule_match_verification_retry', {
          p_room_id: roomId,
          p_delay_ms: 5000,
          p_error: errorText,
        })

        processed.push({
          roomId,
          status: 'retry',
          retryAfterMs: 5000,
          error: errorText,
        })
      } catch (error) {
        const message =
          error instanceof Error ? error.message.slice(0, 500) : 'worker_error'

        await admin.rpc('schedule_match_verification_retry', {
          p_room_id: roomId,
          p_delay_ms: 5000,
          p_error: message,
        })

        processed.push({
          roomId,
          status: 'retry',
          retryAfterMs: 5000,
          error: message,
        })
      }
    }

    return json({
      ok: true,
      markedAbandoned: abandoned ?? null,
      recoveredStuck: stuck ?? null,
      claimed: roomIds.length,
      processed,
    })
  } catch (error) {
    console.error(error)
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'worker_internal_error',
      },
      500,
    )
  }
})
