# CHECKLIST AUTH-V2 ANTES DE ABRIR COLISEO

## A. Base de datos

- [ ] Ejecuté `34-outbox-y-cola-verificacion.sql`.
- [ ] En la consulta final, `authenticated_puede = false`.
- [ ] En la consulta final, `service_role_puede = true`.
- [ ] `verification_attempts` existe.
- [ ] `verification_next_at` existe.
- [ ] `verification_last_error` existe.

## B. Edge Functions

- [ ] Reemplacé `verify-match`.
- [ ] Desplegué `verify-match` SIN `--no-verify-jwt`.
- [ ] Creé `VERIFY_CRON_SECRET`.
- [ ] No subí el secreto a GitHub.
- [ ] Desplegué `verify-pending` CON `--no-verify-jwt`.
- [ ] Configuré Cron cada minuto.
- [ ] Una llamada sin `x-cron-secret` a verify-pending devuelve 401.
- [ ] Una llamada con el secret correcto devuelve `{ ok: true }`.

## C. Outbox

- [ ] Plantar normal: ACK y desbloqueo.
- [ ] Pico normal: ACK y desbloqueo.
- [ ] Sol normal: el saldo sube después del ACK.
- [ ] Doble click de sol durante pendiente: no genera dos collect.
- [ ] Respuesta perdida: mismo seq -> `duplicate=true`.
- [ ] Red caída antes del INSERT: al volver, rechazo fuera de ventana revierte
      sólo la acción pendiente.
- [ ] Mientras falta ACK no se puede plantar otra carta.
- [ ] Mientras falta ACK no se puede gastar un sol pendiente.

## D. Árbitro

- [ ] P1 reporta P1 / P2 reporta P1 -> servidor reconstruye y decide.
- [ ] P1 reporta P1 / P2 reporta P2 -> los reportes NO deciden nada.
- [ ] Acción imposible sin soles -> forfeit autoritativo del infractor.
- [ ] Cooldown imposible -> forfeit autoritativo del infractor.
- [ ] Slot incorrecto -> submit_match_action rechaza.
- [ ] Acción duplicada con mismo payload -> duplicate=true.
- [ ] Mismo seq con payload distinto -> rechazo.
- [ ] True draw -> settle_verified_draw.
- [ ] Inconsistencia del motor -> failed + escrow held.

## E. Abandono / Cron

- [ ] Creo una sala de prueba auth-v1.
- [ ] Cierro ambos navegadores.
- [ ] Tras el plazo de abandono aparece `verification_requested_at`.
- [ ] En el siguiente ciclo Cron, verify-pending la reclama.
- [ ] La sala termina verified/failed; no queda pending indefinidamente.
- [ ] Simulo `verifying` atascado >180 s.
- [ ] El worker lo marca failed y NO devuelve escrow.

## F. Coliseo

NO abrir hasta que A-E estén en verde.

- [ ] 20 partidas Ranked reales verificadas sin falsos forfeits.
- [ ] 5 pruebas deliberadas de red mala.
- [ ] 5 cierres de pestaña / abandono.
- [ ] 5 intentos de acción manipulada.
- [ ] 0 pagos desde cliente.
- [ ] 0 refunds automáticos por "disputa".
