# Plants Arena — AUTH-V1 — parches obligatorios del cliente

Estos cambios son parte del árbitro. NO actives Coliseo con valor económico si sólo corriste la migración 33.

La razón: auth-v1 registra la intención completa que el servidor necesita para probar que una jugada fue legal:

- `slot`: copia exacta de la carta y sus mejoras.
- `issuedTick`: tic del clic/cobro/cooldown.
- `tick`: tic en que plant/dig entra al lockstep (`issuedTick + 6`).
- `collect + targetId`: la recogida manual de un sol también cambia la economía y debe quedar auditada.

---

## 1) `src/engine/mazoDeLaSala.ts`

Conserva `leerMazo`. Reemplaza la función `mejorasDeLaCarta` del final por estas DOS funciones:

```ts
/**
 * Resuelve las mejoras del hueco exacto del mazo.
 *
 * auth-v1 manda `slot` con la jugada para que dos copias de la misma planta
 * puedan tener mejoras distintas sin que ninguna pantalla tenga que adivinar.
 */
export function mejorasDeLaCartaEnSlot(
  mazo: CartaDeMazo[] | null,
  plantId: PlantId,
  slot: number | null | undefined
): MejorasDeCarta {
  if (!mazo) return SIN_MEJORAS

  let carta: CartaDeMazo | undefined

  if (slot !== null && slot !== undefined && Number.isInteger(slot)) {
    carta = mazo.find((c) => c.slot === slot)

    // Compatibilidad con mazos anteriores que no guardaban `slot` pero sí el
    // orden del array.
    if (!carta && mazo[slot] && (mazo[slot].slot === null || mazo[slot].slot === undefined)) {
      carta = mazo[slot]
    }
  } else {
    carta = mazo.find((c) => c.plantId === plantId)
  }

  if (!carta || carta.plantId !== plantId) return SIN_MEJORAS

  const statRolls = (carta.statRolls ?? []) as PlantStatKey[]
  const level = statRolls.length > 0 ? statRolls.length : carta.level ?? 0
  return { statRolls, level }
}

/** Compatibilidad para código que todavía no conoce el slot. */
export function mejorasDeLaCarta(
  mazo: CartaDeMazo[] | null,
  plantId: PlantId
): MejorasDeCarta {
  return mejorasDeLaCartaEnSlot(mazo, plantId, null)
}
```

---

## 2) `src/hooks/useGameEngine.ts`

### 2.1 Import

Busca:

```ts
import { leerMazo, mejorasDeLaCarta, type CartaDeMazo } from '../engine/mazoDeLaSala'
```

Cámbialo por:

```ts
import {
  leerMazo,
  mejorasDeLaCarta,
  mejorasDeLaCartaEnSlot,
  type CartaDeMazo,
} from '../engine/mazoDeLaSala'
```

`mejorasDeLaCarta` se puede conservar porque otro código/legacy puede seguir usándola.

### 2.2 `collectSun` debe devolver el tic exacto

Reemplaza la función actual por:

```ts
// Collect sun handler
const collectSun = useCallback(
  (sunId: string): number | null => {
    const state = stateRef.current
    const sol = state.suns.find((s) => s.id === sunId)
    if (!sol) return null

    // Éste es el tic que el árbitro necesita para reconstruir la economía.
    const issuedTick = state.tick

    state.suns = state.suns.filter((s) => s.id !== sunId)
    state.sunBank += sol.value
    state.stats.sunsCollected += 1
    state.stats.score += 50
    soundManager.playSound('points', 0.6)
    forceRender()
    return issuedTick
  },
  [forceRender]
)
```

### 2.3 Plantación propia: mejoras por slot exacto

Dentro de `placePlant`, busca:

```ts
const mejoras = mejorasDeLaCarta(mazoMioRef.current, card)
```

Cámbialo por:

```ts
const mejoras = mejorasDeLaCartaEnSlot(mazoMioRef.current, card, slotIdx)
```

### 2.4 Acción remota: agrega `slot`

En el tipo que recibe `encolarAccionDelRival`, agrega:

```ts
slot?: number | null
```

Debe quedar aproximadamente así:

```ts
const encolarAccionDelRival = useCallback(
  (accion: {
    id?: number
    tick: number
    kind?: 'plant' | 'dig'
    plantId?: PlantId
    lane: number
    col?: number
    slot?: number | null
  }) => {
```

Luego busca:

```ts
const mejoras = accion.plantId
  ? mejorasDeLaCarta(mazoDelRivalRef.current, accion.plantId)
  : null
```

Y reemplázalo por:

```ts
const mejoras = accion.plantId
  ? mejorasDeLaCartaEnSlot(mazoDelRivalRef.current, accion.plantId, accion.slot)
  : null
```

No necesitas meter `collect` en `encolarAccionDelRival`: los soles son economía local. El servidor sí los registra para auditar, pero la otra pantalla no debe cobrarlos.

---

## 3) `src/services/supabaseService.ts`

### 3.1 Reemplaza `submitMatchAction`

Reemplaza la función completa actual por:

```ts
async submitMatchAction(
  roomId: string,
  accion: {
    seq: number
    tick: number
    issuedTick: number
    kind: 'plant' | 'dig' | 'collect'
    plantId?: string | null
    lane?: number | null
    col?: number | null
    slot?: number | null
    targetId?: string | null
  }
): Promise<{ ok?: boolean; duplicate?: boolean; serverTick?: number; error?: string }> {
  if (!isSupabaseConfigured()) return { error: 'sin_supabase' }

  const payload = {
    p_room_id: roomId,
    p_seq: accion.seq,
    p_tick: accion.tick,
    p_kind: accion.kind,
    p_plant: accion.plantId ?? null,
    p_lane: accion.lane ?? null,
    p_col: accion.col ?? null,
    p_slot: accion.slot ?? null,
    p_issued_tick: accion.issuedTick,
    p_target_id: accion.targetId ?? null,
  }

  // La RPC es idempotente por (room,user,seq), así que el MISMO payload puede
  // reintentarse si la respuesta se perdió sin duplicar la jugada.
  let ultimoError: any = null
  for (let intento = 0; intento < 3; intento += 1) {
    try {
      const { data, error } = await (supabase.rpc as any)('submit_match_action', payload)
      if (!error) return data
      ultimoError = error

      // P0001 normalmente es RAISE EXCEPTION de nuestras validaciones: repetirlo
      // no lo va a convertir en una jugada válida.
      if (error.code === 'P0001') break
    } catch (e) {
      ultimoError = e
    }

    if (intento < 2) {
      await new Promise((resolve) => setTimeout(resolve, 180 * (intento + 1)))
    }
  }

  logError('submitMatchAction', ultimoError)
  return { error: ultimoError?.message ?? 'No se pudo registrar la acción' }
},
```

### 3.2 Reemplaza `matchActionsSince`

```ts
async matchActionsSince(
  roomId: string,
  desdeId: number = 0
): Promise<Array<{
  id: number
  userId: string
  seq: number
  tick: number
  issuedTick: number
  kind: string
  plantId: string | null
  lane: number | null
  col: number | null
  slot: number | null
  targetId: string | null
}>> {
  if (!isSupabaseConfigured()) return []
  try {
    const { data, error } = await (supabase.rpc as any)('match_actions_since_v2', {
      p_room_id: roomId,
      p_desde_id: desdeId,
    })
    if (error) {
      logError('matchActionsSince', error)
      return []
    }
    return data ?? []
  } catch (e) {
    logError('matchActionsSince', e)
    return []
  }
},
```

### 3.3 Amplía el tipo de `subscribeToMatchActions`

El callback debe aceptar:

```ts
alRecibir: (accion: {
  id: number
  user_id: string
  seq: number
  tick: number
  issued_tick: number | null
  kind: string
  plant_id: string | null
  lane: number | null
  col: number | null
  slot: number | null
  target_id: string | null
}) => void,
```

El resto de la suscripción Realtime puede quedarse igual.

### 3.4 Amplía `roomResult`

Cambia el tipo de retorno para incluir:

```ts
verificationStatus?: string
verificationNote?: string | null
authoritative?: boolean
```

### 3.5 Agrega `verifyMatch`

Pon esta función cerca de `reportMatchResult`:

```ts
/**
 * Pide al árbitro servidor reconstruir la partida.
 * El navegador NO manda ganador: sólo roomId.
 */
async verifyMatch(roomId: string): Promise<{
  ok: boolean
  status?: 'pending' | 'verified' | 'verified_draw' | 'settled' | 'failed'
  winnerId?: string | null
  winnerSide?: 1 | 2
  reason?: string
  retryAfterMs?: number
  reviewRequired?: boolean
  settlement?: {
    success?: boolean
    status?: string
    eloGained?: number
    eloLost?: number
    payout?: number
    [k: string]: unknown
  }
  error?: string
}> {
  if (!isSupabaseConfigured()) return { ok: false, error: 'sin_supabase' }

  // La función puede responder pending si todavía falta alcanzar el tic final
  // + la pequeña ventana de gracia. Reintentamos unas veces desde el cliente.
  for (let intento = 0; intento < 8; intento += 1) {
    try {
      const { data, error } = await supabase.functions.invoke('verify-match', {
        body: { roomId },
      })

      if (error) {
        logError('verifyMatch', error)
        return { ok: false, error: error.message }
      }

      if (data?.status !== 'pending') return data

      const espera = Math.max(250, Math.min(Number(data.retryAfterMs) || 750, 5000))
      await new Promise((resolve) => setTimeout(resolve, espera))
    } catch (e: any) {
      logError('verifyMatch', e)
      return { ok: false, error: e?.message ?? 'verify-match falló' }
    }
  }

  return { ok: true, status: 'pending' }
},
```

`reportMatchResult` puede quedarse: en auth-v1 la migración 33 lo convierte en TELEMETRÍA y ya no paga nada.

---

## 4) `src/components/Battlefield/Battlefield.tsx`

### 4.1 Importa el margen de red

Si no lo tienes ya, agrega:

```ts
import { MARGEN_DE_RED_TICS } from '../../engine/pvp'
```

Ajusta `../../` si tu import actual de `engine/*` usa otra ruta; desde `components/Battlefield` ésta es la ruta esperada.

### 4.2 Plantación: manda slot + issuedTick

Reemplaza `registrarPlantacion` por:

```ts
const registrarPlantacion = (
  carta: PlantId,
  lane: number,
  col: number,
  enTic: number,
  slot: number
) => {
  if (!roomId) return
  ordenRef.current += 1
  void SupabaseService.submitMatchAction(roomId, {
    seq: ordenRef.current,
    tick: enTic,
    issuedTick: enTic - MARGEN_DE_RED_TICS,
    kind: 'plant',
    plantId: carta,
    lane,
    col,
    slot,
  }).then((r) => {
    if (r.error) descartarAccionPropia(enTic, lane, col)
    setDiag((d) => ({
      ...d,
      enviadas: d.enviadas + (r.error ? 0 : 1),
      ultimoEnvio: r.error ? `✗ ${r.error}` : `✓ ${carta} [slot ${slot}] @tic ${enTic}`,
    }))
  })
}
```

Ahora en el `onClick` de una casilla NO leas el slot después de `placePlant`, porque `placePlant` borra la selección. Debe ser:

```ts
const carta = selectedCard
const slot = selectedSlotIndex
const enTic = placePlant(lane.id, col)
if (enTic !== null && slot !== null) {
  registrarPlantacion(carta, lane.id, col, enTic, slot)
}
```

### 4.3 Pico: manda issuedTick

Dentro de `registrarExcavacion`, agrega:

```ts
issuedTick: enTic - MARGEN_DE_RED_TICS,
```

La llamada debe quedar:

```ts
void SupabaseService.submitMatchAction(roomId, {
  seq: ordenRef.current,
  tick: enTic,
  issuedTick: enTic - MARGEN_DE_RED_TICS,
  kind: 'dig',
  lane,
  col,
})
```

### 4.4 Sol manual: regístralo

Agrega junto a las funciones anteriores:

```ts
const recogerSolAutorizado = (sunId: string) => {
  // collectSun muta la economía y devuelve EL tic exacto usado por el motor.
  const issuedTick = collectSun(sunId)
  if (issuedTick === null || !roomId) return

  ordenRef.current += 1
  void SupabaseService.submitMatchAction(roomId, {
    seq: ordenRef.current,
    tick: issuedTick,
    issuedTick,
    kind: 'collect',
    targetId: sunId,
    lane: null,
    col: null,
    slot: null,
  }).then((r) => {
    setDiag((d) => ({
      ...d,
      enviadas: d.enviadas + (r.error ? 0 : 1),
      ultimoEnvio: r.error ? `✗ sol: ${r.error}` : `✓ sol @tic ${issuedTick}`,
    }))
  })
}
```

Luego en el botón de sol reemplaza las tres llamadas `collectSun(sun.id)` por:

```ts
recogerSolAutorizado(sun.id)
```

No se duplica: `onMouseDown`/`onTouchStart` recoge primero y, cuando llega `click`, el sol ya no existe, así que `collectSun` devuelve `null`.

IMPORTANTE para Coliseo: si el registro del sol falla después de los reintentos, no debes fingir que el servidor lo vio. El árbitro podría declarar ilegal una plantación que dependa de esos soles. Durante beta registra esos fallos en telemetría. Antes de dinero real, prueba específicamente redes móviles/pérdida de paquetes.

### 4.5 Realtime: ignora `collect` y pasa `slot` en plantas

Amplía el tipo local `a` con:

```ts
issued_tick: number | null
lane: number | null
slot: number | null
target_id: string | null
```

Justo después de deduplicar, agrega:

```ts
// Los soles son economía local del rival; se guardan para el árbitro, pero no
// modifican nuestra simulación remota.
if (a.kind === 'collect') return
```

En `dig`, donde envías `lane`, usa `a.lane ?? 0`.

En `plant`, exige lane no nulo y pasa slot:

```ts
if (a.kind !== 'plant' || !a.plant_id || a.lane === null) return
setDiag((d) => ({ ...d, recibidas: d.recibidas + 1 }))
encolarAccionDelRival({
  id: a.id,
  tick: a.tick,
  kind: 'plant',
  plantId: a.plant_id as PlantId,
  lane: a.lane,
  col: a.col ?? undefined,
  slot: a.slot,
})
```

En la recuperación (`matchActionsSince`) pasa también:

```ts
issued_tick: a.issuedTick,
slot: a.slot,
target_id: a.targetId,
```

y `lane: a.lane` ya puede ser null.

### 4.6 Final de partida: reporta sólo diagnóstico y luego pide verificación

Reemplaza este bloque:

```ts
if (roomId && opponentId && currentUserId) {
  const ganador = gameStatus === 'victory' ? currentUserId : opponentId
  void SupabaseService.reportMatchResult(roomId, ganador).then((r) => {
    setResultadoServidor(r)
  })
}
```

por:

```ts
if (roomId && opponentId && currentUserId) {
  const ganadorQueVioMiCliente = gameStatus === 'victory' ? currentUserId : opponentId

  setResultadoServidor({ success: true, status: 'verificando' })

  void (async () => {
    // Sólo telemetría en auth-v1. Si falla, el árbitro igualmente puede decidir.
    await SupabaseService.reportMatchResult(roomId, ganadorQueVioMiCliente)

    const verificacion = await SupabaseService.verifyMatch(roomId)

    if (verificacion.status === 'verified' || verificacion.status === 'settled') {
      const s = verificacion.settlement ?? {}
      setResultadoServidor({
        success: true,
        status: 'liquidada',
        eloGained: typeof s.eloGained === 'number' ? s.eloGained : undefined,
        eloLost: typeof s.eloLost === 'number' ? s.eloLost : undefined,
        payout: typeof s.payout === 'number' ? s.payout : undefined,
      })
      return
    }

    if (verificacion.status === 'verified_draw') {
      setResultadoServidor({ success: true, status: 'empate_verificado', payout: 0 })
      return
    }

    if (verificacion.status === 'failed') {
      setResultadoServidor({
        success: false,
        status: 'revision_servidor',
        error: 'La verificación automática encontró una inconsistencia. No se liquidó la partida.',
      })
      return
    }

    if (verificacion.status === 'pending') {
      setResultadoServidor({ success: true, status: 'verificacion_pendiente' })
      return
    }

    setResultadoServidor({
      success: false,
      status: 'revision_servidor',
      error: verificacion.error ?? 'No se pudo verificar la partida.',
    })
  })()
}
```

### 4.7 MUY IMPORTANTE: no ejecutes `onColosseumComplete` en una sala real

Busca:

```ts
if (matchMode === 'colosseum' && onColosseumComplete) {
```

Cámbialo por:

```ts
if (!roomId && matchMode === 'colosseum' && onColosseumComplete) {
```

En una sala auth-v1, el pago/racha/ELO sale únicamente de `_settle_room()` llamado por `settle_verified_match()` desde la Edge Function.

### 4.8 Texto de estado de la modal

Reemplaza los mensajes de `esperando_al_rival`/`resultado_en_disputa` por estos estados:

```tsx
{['verificando', 'verificacion_pendiente'].includes(resultadoServidor?.status ?? '') && (
  <p className="resultado-servidor__esperando">
    🔐 El servidor está reconstruyendo y verificando la partida…
  </p>
)}

{resultadoServidor?.status === 'revision_servidor' && (
  <p className="resultado-servidor__disputa">
    ⚠️ La partida quedó bloqueada para revisión. No se entregó ELO ni pago automático.
  </p>
)}

{resultadoServidor?.status === 'empate_verificado' && (
  <p className="resultado-servidor__esperando">
    🤝 Empate verificado por el servidor.
  </p>
)}
```

Mantén el bloque `liquidada` existente.

---

## 5) Orden de despliegue

NO despliegues las piezas separadas durante tráfico real porque la migración 33 elimina la firma vieja de `submit_match_action`.

Orden recomendado en una ventana de mantenimiento:

1. Guarda backup/snapshot de la base.
2. Sube el nuevo `replay.ts` y los parches de cliente a una rama.
3. Crea `supabase/functions/verify-match/index.ts`.
4. Ejecuta la Migración 33.
5. Despliega inmediatamente la Edge Function.
6. Despliega inmediatamente el frontend auth-v1.
7. Prueba Ranked con dos cuentas reales antes de abrir Coliseo.

Las salas que ya existían al correr la migración quedan `legacy-v1`; las salas nuevas nacen `auth-v1`.

---

## 6) Pruebas mínimas antes de Coliseo

Haz al menos estas pruebas con DOS cuentas/navegadores:

1. partida normal, gana P1;
2. partida normal, gana P2;
3. una carta mejorada;
4. dos copias de la misma planta con upgrades distintos;
5. plantar inmediatamente después de recoger manualmente un sol;
6. dejar que el sol se recoja solo;
7. pico sobre una planta;
8. una acción Realtime perdida y recuperada por polling;
9. pestaña en segundo plano y regreso;
10. rendición P1 y rendición P2;
11. modificar manualmente una RPC para intentar plantar sin soles: debe terminar en forfeit del atacante;
12. intentar reutilizar el mismo `seq` con otro payload: debe ser rechazado;
13. intentar llamar `settle_verified_match` desde el navegador: debe ser denegado;
14. apagar una conexión cerca del final: nunca debe pagar por lo que declaró el cliente.

Para un modo con valor económico real, además haz una etapa beta sin dinero/valor transferible y revisa `verification_payload` + logs antes de habilitar stakes.
