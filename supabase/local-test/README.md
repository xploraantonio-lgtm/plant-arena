# Probar las migraciones antes de tocar producción

Reproduce la cadena `schema.sql` → `01` → … → `17` sobre un Postgres limpio y
después ejecuta 38 comprobaciones del emparejamiento con dos jugadores
simulados.

Existe porque las migraciones se estaban escribiendo sin poder ejecutarlas, y
cada equivocación se descubría en producción. El 2026-08-19, dos errores en la
misma migración —una columna que se había borrado en la `04` y un
`TEXT[] || texto` que Postgres interpreta como literal de array— costaron dos
viajes de ida y vuelta. Ninguno de los dos se ve leyendo el SQL: sólo
ejecutándolo.

## Qué hace falta

Un Postgres cualquiera, en un puerto que no moleste. No necesita Docker, ni
instalarse, ni permisos de administrador: basta el ZIP de binarios oficial de
[EnterpriseDB](https://www.enterprisedb.com/download-postgresql-binaries)
descomprimido en cualquier carpeta.

```bash
# arrancar (una vez)
PG=/ruta/a/pgsql/bin
"$PG/initdb.exe" -D ./pgdata -U postgres --pwfile=<(echo postgres) -E UTF8 --locale=C
"$PG/pg_ctl.exe" -D ./pgdata -o "-p 54399 -c listen_addresses=127.0.0.1" -l pg.log start
```

## Cómo se usa

```bash
PG_BIN=/ruta/a/pgsql/bin PGPORT=54399 bash supabase/local-test/probar-migraciones.sh
```

Crea la base `plant_arena_test` desde cero, monta el andamio y aplica todo en
orden. Para en la primera migración que falle y enseña el error con su línea.
Se le puede pasar un número para llegar sólo hasta ahí: `... probar-migraciones.sh 15`.

Luego, las comprobaciones del emparejamiento:

```bash
PGPASSWORD=postgres "$PG_BIN/psql.exe" -h 127.0.0.1 -p 54399 -U postgres \
  -d plant_arena_test -f supabase/local-test/probar-emparejamiento.sql
```

Cada línea sale como `OK` o como `FALLA` con lo esperado y lo obtenido. No usa
marco de pruebas a propósito: el mismo fichero se puede pegar en el editor SQL de
Supabase para comprobar lo mismo contra producción.

## Los dos ficheros

**`00-simular-supabase.sql`** — el andamio. Supabase añade sobre Postgres cosas
que las migraciones dan por hechas: el esquema `auth` con su tabla de usuarios,
la función `auth.uid()` y los roles `anon` / `authenticated` / `service_role`.
Sin esto no se aplica ni la primera migración. La `auth.uid()` de aquí lee una
variable de sesión, así que en las pruebas se puede decir «ahora soy este
jugador»:

```sql
SELECT set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
```

**`probar-emparejamiento.sql`** — 38 comprobaciones: que el registro crea el
perfil y reparte mazo, que dos jugadores acaban en la misma sala con la misma
semilla, que el mazo lo pone el servidor, que el amistoso no da ELO, que hacen
falta los dos reportes y que en desacuerdo no cobra nadie, que el coliseo cobra y
devuelve, y que las funciones internas no son llamables desde el cliente.

## Qué NO prueba

Nada de PostgREST: los 401 al revocar una columna, el comportamiento de RLS con
un JWT de verdad, ni cómo el cliente resuelve una sobrecarga de función. Eso
necesita Supabase local completo, que necesita Docker. Aquí se validan sintaxis,
tipos, nombres de columna y lógica de plpgsql, que es donde estaban los fallos.

`schema.sql` está desactualizado respecto a producción a propósito: sigue
declarando las columnas `*_mult` que la `04` borra y le falta `profiles.is_admin`.
Eso no estorba, al contrario — si la cadena `01`→`17` lo lleva desde ahí hasta el
estado real, la cadena es coherente. **No te fíes de `schema.sql` para saber qué
columnas existen; míralo en `src/types/database.types.ts` o pregúntale a la
base.**
