# Instalación — Árbitro autoritativo auth-v1

## Archivos

- `33-arbitro-autoritativo.sql` → ejecutar en Supabase SQL Editor una sola vez.
- `replay.ts` → reemplazar `src/engine/replay.ts`.
- `verify-match/index.ts` → crear como `supabase/functions/verify-match/index.ts`.
- `AUTH-V1-CLIENT-PATCHES.md` → aplicar los cambios obligatorios al cliente.

## Edge Function

Desde la raíz del repositorio:

```bash
npx supabase@latest login
npx supabase@latest projects list
npx supabase@latest link --project-ref TU_PROJECT_REF
```

Crea la carpeta:

```text
supabase/
  functions/
    verify-match/
      index.ts
```

Copia ahí el `index.ts` entregado.

La función importa el mismo motor de `src/engine/replay.ts`, por eso despliega desde la raíz con el modo API, que puede empaquetar imports fuera de `supabase/`:

```bash
npx supabase@latest functions deploy verify-match --use-api
```

No uses `--no-verify-jwt`. El endpoint debe requerir usuario autenticado y además vuelve a verificar que ese usuario sea P1 o P2 de la sala.

En Supabase alojado existen variables de entorno del proyecto. Este código usa `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` dentro de la función. La service role NO debe aparecer jamás en Vite, `.env` público, frontend ni GitHub.

## Comprobación rápida de permisos

Después de la migración intenta desde SQL, con tu rol normal de aplicación, que estas RPC NO sean ejecutables por `authenticated`:

- `begin_match_verification`
- `release_match_verification`
- `settle_verified_match`
- `settle_verified_draw`
- `mark_match_verification_failed`

La propia migración incluye consultas de post-check al final.

## Comportamiento esperado

- El navegador puede seguir reportando “yo vi P1/P2”, pero eso no paga nada en `auth-v1`.
- `verify-match` lee seed + mazos + acciones y recalcula.
- Acción ilegal unilateral → forfeit del atacante.
- Inconsistencia del motor / ambos ilegales → `verification_status='failed'`; no payout, no ELO y el escrow queda retenido para revisión manual.
- Empate perfecto verificado → refund seguro del escrow/ticket.
- Rendición autenticada → puede liquidar directamente porque el usuario sólo puede declararse perdedor a sí mismo.

## Antes de dinero real

Este paquete elimina la confianza en el ganador declarado por el navegador, pero no convierte una aplicación web en un sistema imposible de atacar. El `issued_tick` sigue naciendo en el cliente y la RPC sólo lo admite dentro de una ventana respecto al reloj del servidor. Prueba latencia, pérdida de paquetes, replay masivo y manipulación deliberada antes de habilitar valor económico.

Además, si AMBOS jugadores cierran la app y nadie invoca `verify-match`, auth-v1 falla cerrado: `settle_abandoned_rooms()` pide verificación, pero no ejecuta TypeScript por sí solo. Por eso antes de abrir Coliseo debes añadir un verificador programado/cola para partidas pendientes o un procedimiento de revisión manual. No vuelvas al criterio “el único reporte recibido gana”.
