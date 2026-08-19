// =============================================================================
// PLANT ARENA · INICIO DE SESIÓN POR NOMBRE DE USUARIO, EN EL SERVIDOR
//
// POR QUÉ EXISTE ESTA FUNCIÓN
//   Para entrar con nombre de usuario hay que traducirlo al correo, porque es lo
//   que Supabase Auth necesita. Hacer esa traducción en el navegador obliga a
//   exponer un endpoint que, dado un nombre, devuelve el correo. Y los nombres
//   son públicos: salen en el ranking. Así que cualquiera podía recorrer el
//   ranking y quedarse con los correos de todos los jugadores.
//
//   Aquí la traducción ocurre dentro del servidor y el correo NO se devuelve
//   nunca. El navegador manda usuario + contraseña y recibe, si son correctos,
//   los tokens de sesión. Si son incorrectos, recibe un error idéntico tanto si
//   el usuario no existe como si la contraseña falla, para no confirmar qué
//   nombres están registrados.
//
// DESPLIEGUE
//   supabase functions deploy login --no-verify-jwt
//
//   --no-verify-jwt es necesario: quien llama todavía no tiene sesión.
//
//   Y el secreto (una sola vez):
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...
//
//   SUPABASE_URL y SUPABASE_ANON_KEY ya vienen inyectados por la plataforma.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** Respuesta de error uniforme. El mensaje es siempre el mismo para "no existe"
 *  y "contraseña incorrecta": distinguirlos permitiría averiguar qué nombres
 *  están registrados. */
function credencialesInvalidas() {
  return new Response(
    JSON.stringify({ error: 'Usuario o contraseña incorrectos.' }),
    { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } }
  )
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')

  if (!url || !serviceKey || !anonKey) {
    console.error('[login] faltan variables de entorno')
    return json({ error: 'Servicio de inicio de sesión no configurado.' }, 503)
  }

  let identifier = ''
  let password = ''
  try {
    const body = await req.json()
    identifier = String(body?.identifier ?? '').trim()
    password = String(body?.password ?? '')
  } catch {
    return json({ error: 'Petición mal formada.' }, 400)
  }

  if (!identifier || !password) return credencialesInvalidas()
  if (identifier.length > 254 || password.length > 200) return credencialesInvalidas()

  // La IP del solicitante, para limitar intentos. Detrás del proxy de Supabase
  // llega en x-forwarded-for.
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('cf-connecting-ip') ||
    'desconocida'

  // Cliente con permisos de servicio: sólo vive aquí, en el servidor. La clave
  // nunca sale de esta función.
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // ── Límite de intentos ────────────────────────────────────────────────────
  // Esto es lo que el navegador no podía hacer: contar intentos por IP. Sin
  // esto, un atacante puede probar contraseñas sin freno.
  const { data: permitido, error: rlError } = await admin.rpc('check_login_rate_limit', {
    p_key: ip,
  })
  if (rlError) {
    console.error('[login] fallo del limitador:', rlError.message)
    // Fallar cerrado: si el limitador no responde, no se intenta el login.
    return json({ error: 'Servicio temporalmente no disponible. Inténtalo en un momento.' }, 503)
  }
  if (permitido === false) {
    return json(
      { error: 'Demasiados intentos. Espera unos minutos antes de volver a probar.' },
      429
    )
  }

  // ── Resolver el correo, dentro del servidor ───────────────────────────────
  let email = identifier
  if (!identifier.includes('@')) {
    const { data, error } = await admin
      .from('profiles')
      .select('id')
      .ilike('username', identifier)   // seguro aquí: la entrada no es un patrón
      .maybeSingle()

    // Nota: se usa el listado de auth.users por id, no una consulta con el
    // nombre metido en un patrón.
    if (error || !data?.id) return credencialesInvalidas()

    const { data: userData, error: uErr } = await admin.auth.admin.getUserById(data.id)
    if (uErr || !userData?.user?.email) return credencialesInvalidas()
    email = userData.user.email
  }

  // ── Iniciar sesión ────────────────────────────────────────────────────────
  // Con la clave pública: así el intento pasa por las mismas comprobaciones que
  // un login normal (correo confirmado, cuenta activa, etc.).
  const publico = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: sesion, error: signInError } = await publico.auth.signInWithPassword({
    email,
    password,
  })

  if (signInError || !sesion?.session) {
    // Se consume el intento sólo cuando falla, para no penalizar al que acierta.
    await admin.rpc('register_failed_login', { p_key: ip })
    return credencialesInvalidas()
  }

  await admin.rpc('clear_login_attempts', { p_key: ip })

  // Sólo los tokens. El correo NO se devuelve: es todo el motivo de esta
  // función. El navegador los instala con supabase.auth.setSession().
  return json({
    access_token: sesion.session.access_token,
    refresh_token: sesion.session.refresh_token,
    expires_in: sesion.session.expires_in,
  })
})
