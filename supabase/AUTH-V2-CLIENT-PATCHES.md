# AUTH-V2 — PARCHES OBLIGATORIOS DEL CLIENTE

Base revisada: commit `59cd0fc` (`arbitro`).

El objetivo de este parche no es hacer que un jugador siga jugando sin Internet.
En un modo competitivo con valor económico, el servidor no puede distinguir una
acción realmente hecha offline de una acción inventada y "retrodatada".

La regla segura es:

1. Una acción PvP se aplica localmente de forma optimista.
2. Se manda con `seq` fijo por el outbox.
3. Mientras no exista ACK, NO se permite encadenar otra acción.
4. Si el servidor ya la recibió pero se perdió la respuesta, reenviar el mismo
   `seq` devuelve `duplicate=true`.
5. Si jamás llegó y ya quedó fuera de ventana, el servidor la rechaza y sólo esa
   acción se revierte.
6. Los soles manuales NO se acreditan hasta recibir ACK, para que una caída de red
   no fabrique economía local que el árbitro no conoce.

---

## 1. Agregar archivo nuevo

Copiar:

`src/services/matchActionOutbox.ts`

No modificar su clave de idempotencia: usa el mismo `seq` durante todos los
reintentos.

---

## 2. `src/hooks/useGameEngine.ts`

### 2.1 Reemplazar el bloque actual de `collectSun`

Actualmente `collectSun` quita el sol y suma la economía inmediatamente.

Reemplazarlo por estas tres funciones:

```ts
const prepararRecogidaSol = useCallback((sunId: string): number | null => {
  const state = stateRef.current
  const sol = state.suns.find((s) => s.id === sunId)
  if (!sol) return null
  return state.tick
}, [])

const confirmarRecogidaSol = useCallback(
  (sunId: string): boolean => {
    const state = stateRef.current
    const sol = state.suns.find((s) => s.id === sunId)

    // Puede haberse auto-recogido mientras llegaba el ACK. En ese caso no se
    // suma dos veces: el estado ya contiene el valor.
    if (!sol) return false

    state.suns = state.suns.filter((s) => s.id !== sunId)
    state.sunBank += sol.value
    state.stats.sunsCollected += 1
    state.stats.score += 50
    soundManager.playSound('points', 0.6)
    forceRender()
    return true
  },
  [forceRender]
)

const collectSun = useCallback(
  (sunId: string): number | null => {
    const issuedTick = prepararRecogidaSol(sunId)
    if (issuedTick === null) return null
    confirmarRecogidaSol(sunId)
    return issuedTick
  },
  [prepararRecogidaSol, confirmarRecogidaSol]
)
```

`collectSun` se conserva para PvE/práctica.

### 2.2 En el objeto `return` del hook agregar:

```ts
prepararRecogidaSol,
confirmarRecogidaSol,
```

No eliminar `collectSun`.

---

## 3. `src/components/Battlefield/Battlefield.tsx`

### 3.1 Import

Agregar:

```ts
import {
  MatchActionOutbox,
  type MatchActionIntent,
} from '../../services/matchActionOutbox'
```

(Ajustar únicamente la ruta si la estructura real del archivo exige otro `../`.)

### 3.2 Sacar del hook

Además de `collectSun`, obtener:

```ts
prepararRecogidaSol,
confirmarRecogidaSol,
```

### 3.3 Estado/ref de bloqueo

Cerca de los refs PvP:

```ts
const redBloqueadaRef = useRef(false)
const [redBloqueada, setRedBloqueada] = useState(false)
const outboxAbortRef = useRef<AbortController | null>(null)

useEffect(() => {
  const controller = new AbortController()
  outboxAbortRef.current = controller
  return () => {
    controller.abort()
    outboxAbortRef.current = null
  }
}, [roomId])
```

### 3.4 Helper único para TODAS las acciones

Agregar dentro del componente:

```ts
const enviarAccionAutoritativa = async (
  action: MatchActionIntent,
  callbacks: {
    onAck?: () => void
    onRejected?: (error: string) => void
  } = {}
) => {
  if (!roomId) return

  redBloqueadaRef.current = true
  setRedBloqueada(true)

  const result = await MatchActionOutbox.deliver(
    roomId,
    action,
    outboxAbortRef.current?.signal
  )

  if (result.status === 'ack') {
    callbacks.onAck?.()
  } else if (result.status === 'rejected') {
    callbacks.onRejected?.(result.error)
  }

  // cancelled ocurre al desmontar; no hay que tocar un motor que ya no existe.
  if (result.status !== 'cancelled') {
    redBloqueadaRef.current = false
    setRedBloqueada(false)
  }
}
```

### 3.5 Plantar

Reemplazar la llamada directa a `SupabaseService.submitMatchAction` dentro de
`registrarPlantacion` por:

```ts
void enviarAccionAutoritativa(
  {
    seq: ordenRef.current,
    tick: enTic,
    issuedTick: enTic - MARGEN_DE_RED_TICS,
    kind: 'plant',
    plantId: carta,
    lane,
    col,
    slot,
  },
  {
    onRejected: (error) => {
      descartarAccionPropia(enTic, lane, col)
      setDiag((d) => ({
        ...d,
        ultimoEnvio: `✗ ${error}`,
      }))
    },
    onAck: () => {
      setDiag((d) => ({
        ...d,
        enviadas: d.enviadas + 1,
        ultimoEnvio: `✓ ${carta} [slot ${slot}] @tic ${enTic}`,
      }))
    },
  }
)
```

### 3.6 Pico

Mismo patrón:

```ts
void enviarAccionAutoritativa(
  {
    seq: ordenRef.current,
    tick: enTic,
    issuedTick: enTic - MARGEN_DE_RED_TICS,
    kind: 'dig',
    lane,
    col,
  },
  {
    onRejected: (error) => {
      descartarAccionPropia(enTic, lane, col)
      setDiag((d) => ({
        ...d,
        ultimoEnvio: `✗ ${error}`,
      }))
    },
    onAck: () => {
      setDiag((d) => ({
        ...d,
        enviadas: d.enviadas + 1,
        ultimoEnvio: `✓ pico @tic ${enTic}`,
      }))
    },
  }
)
```

### 3.7 Sol manual — IMPORTANTE

Reemplazar `recogerSolAutorizado` por:

```ts
const recogerSolAutorizado = (sunId: string) => {
  // PvE/práctica: no hay árbitro remoto.
  if (!roomId) {
    collectSun(sunId)
    return
  }

  if (redBloqueadaRef.current) return

  // Sólo observa el tic y confirma que el sol existe. NO suma economía todavía.
  const issuedTick = prepararRecogidaSol(sunId)
  if (issuedTick === null) return

  ordenRef.current += 1

  void enviarAccionAutoritativa(
    {
      seq: ordenRef.current,
      tick: issuedTick,
      issuedTick,
      kind: 'collect',
      targetId: sunId,
      lane: null,
      col: null,
      slot: null,
    },
    {
      onAck: () => {
        // Si mientras esperaba se auto-recogió, devuelve false y no suma dos veces.
        confirmarRecogidaSol(sunId)
        setDiag((d) => ({
          ...d,
          enviadas: d.enviadas + 1,
          ultimoEnvio: `✓ sol @tic ${issuedTick}`,
        }))
      },
      onRejected: (error) => {
        // No hay rollback: todavía NO habíamos sumado este sol.
        setDiag((d) => ({
          ...d,
          ultimoEnvio: `✗ sol: ${error}`,
        }))
      },
    }
  )
}
```

### 3.8 Bloquear nuevas acciones mientras falta ACK

Al principio del `onClick` de cada casilla:

```ts
if (roomId && redBloqueadaRef.current) return
```

Y al principio del handler del sol ya se hizo lo mismo.

Esto es deliberado. No se deben aceptar plantaciones que dependan de un `collect`
cuyo ACK todavía no existe.

### 3.9 Indicador opcional pero recomendado

Dentro del diagnóstico PvP:

```tsx
{redBloqueada && (
  <div className="pvp-diag__linea">
    ⏳ Sincronizando acción con el servidor…
  </div>
)}
```

No significa "lag = derrota"; sólo evita decisiones encadenadas mientras no se
sabe si el servidor recibió el input.

---

## 4. No borrar `SupabaseService.submitMatchAction` todavía

Después de migrar Battlefield al outbox quedará prácticamente como compatibilidad.
Se puede retirar en una limpieza posterior, pero NO es necesario para AUTH-V2.

---

## 5. Qué comportamiento probar

### Respuesta perdida
1. Interceptar/cortar la respuesta después del INSERT.
2. El outbox reenvía exactamente el mismo `seq`.
3. Debe recibir `duplicate=true`.
4. No debe haber una segunda fila en `match_actions`.

### Internet realmente caído
1. Cortar red antes de plantar.
2. La planta local aparece optimista.
3. La UI queda bloqueada para nuevas acciones.
4. Al volver la red:
   - si nunca llegó y ya venció la ventana: RPC rechaza y se revierte;
   - si sí había llegado: duplicate=true y se conserva.

### Sol
1. Cortar red antes de pulsar un sol.
2. El saldo NO debe subir hasta ACK.
3. No debe ser posible gastar ese sol mientras está pendiente.
4. Si se auto-recoge mientras se espera, el ACK tardío NO debe sumarlo dos veces.
