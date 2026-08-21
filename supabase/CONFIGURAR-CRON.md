# CONFIGURAR EL WORKER AUTOMÁTICO DE VERIFICACIÓN

La Edge Function `verify-pending` es el respaldo para cuando:
- los dos jugadores cierran la página;
- el cliente no logra invocar `verify-match`;
- una sala queda `verification_requested_at != null` sin nadie que la procese.

No sustituye `verify-match`: la llama internamente con `service_role`.

## 1. Ejecutar Migración 34

En Supabase > SQL Editor:

`supabase/34-outbox-y-cola-verificacion.sql`

Al final debe salir:

- `authenticated_puede = false`
- `service_role_puede = true`

para:
- begin_match_verification
- schedule_match_verification_retry
- claim_pending_match_verifications
- mark_stuck_match_verifications
- settle_abandoned_rooms

## 2. Reemplazar y desplegar `verify-match`

Copiar el nuevo:

`supabase/functions/verify-match/index.ts`

Desplegar manteniendo verificación JWT:

```bash
npx supabase@latest functions deploy verify-match --use-api
```

NO usar `--no-verify-jwt` en `verify-match`.

## 3. Crear secret del cron

Generar una clave aleatoria FUERA del repositorio:

```bash
openssl rand -hex 32
```

Guardar el resultado como secret de Edge Functions:

```bash
npx supabase@latest secrets set VERIFY_CRON_SECRET=PEGA_AQUI_EL_VALOR
```

No subir ese valor a GitHub.

## 4. Desplegar `verify-pending`

Copiar:

`supabase/functions/verify-pending/index.ts`

Esta función NO usa JWT de usuario porque la invoca Cron. Su seguridad es
`x-cron-secret`.

Desplegar:

```bash
npx supabase@latest functions deploy verify-pending --use-api --no-verify-jwt
```

## 5. Crear el Cron

Supabase soporta Cron + pg_net para llamar Edge Functions. Hay dos caminos.

### Opción recomendada: Dashboard

1. Supabase Dashboard.
2. Integrations / Cron (Jobs).
3. Create job.
4. Frecuencia: `* * * * *` (cada minuto).
5. Tipo: HTTP / Edge Function.
6. Función: `verify-pending`.
7. Método: POST.
8. Header:
   - `x-cron-secret: <EL MISMO VERIFY_CRON_SECRET>`
9. Body: `{}`.
10. Guardar y activar.

Si el formulario exige API key, usar la **publishable/anon key**, nunca la
service_role. La autorización real del worker la hace `x-cron-secret`.

### Opción SQL/Vault

Usar el archivo:

`CONFIGURAR-CRON-SQL-TEMPLATE.sql`

Antes de ejecutarlo hay que sustituir los tres placeholders y NO committear el
archivo con valores reales.

## 6. Prueba manual

Invocar `verify-pending` desde un cliente HTTP con:

```text
POST /functions/v1/verify-pending
x-cron-secret: <tu secreto>
Content-Type: application/json

{}
```

Respuesta esperada:

```json
{
  "ok": true,
  "claimed": 0,
  "processed": []
}
```

Si hay salas pendientes, `claimed` será > 0 y aparecerán en `processed`.

## 7. Monitoreo

Revisar:

```sql
select
  id,
  mode,
  status,
  verification_status,
  verification_attempts,
  verification_requested_at,
  verification_next_at,
  verification_last_error,
  verification_note,
  settled_at
from public.game_rooms
where engine_version = 'auth-v1'
order by created_at desc
limit 50;
```

Una sala sana termina:
- verification_status = `verified`
- settled_at != null

Una inconsistencia real:
- verification_status = `failed`
- settled_at = null
- escrow sigue held en Coliseo
- requiere revisión

Eso es fail-closed a propósito.
