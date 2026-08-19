#!/usr/bin/env bash
# =============================================================================
# REPRODUCE LA CADENA DE MIGRACIONES SOBRE UN POSTGRES LIMPIO
#
# Crea una base nueva, monta el andamio que simula Supabase, y aplica el esquema
# y las migraciones en orden. Para en la primera que falle y dice cuál y por qué.
#
# Es lo que faltaba: hasta ahora las migraciones se escribían sin poder
# ejecutarlas, y cada error de columna o de tipo costaba un viaje de ida y vuelta
# con el dueño del juego.
#
# USO
#   PG_BIN=/ruta/a/pgsql/bin PGPORT=54399 ./probar-migraciones.sh
#   ./probar-migraciones.sh 17        ← sólo hasta la 17 (por defecto: todas)
#
# NO toca la base de producción: se conecta al Postgres local del puerto que se
# le indique y crea una base con nombre propio, que borra y vuelve a crear en
# cada ejecución.
# =============================================================================
set -uo pipefail

PG_BIN="${PG_BIN:?falta PG_BIN, la carpeta bin de Postgres}"
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-54399}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
BASE="plant_arena_test"

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIG="$(cd "$AQUI/.." && pwd)"

HASTA="${1:-99}"

psql() { "$PG_BIN/psql.exe" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -v ON_ERROR_STOP=1 "$@"; }

echo "── Base limpia ────────────────────────────────────────────────────────────"
psql -d postgres -q -c "DROP DATABASE IF EXISTS $BASE WITH (FORCE);" \
                 -c "CREATE DATABASE $BASE;" || exit 1
echo "   $BASE creada"

# El andamio va primero: sin auth.uid() ni los roles no se aplica nada.
echo ""
echo "── Andamio (esquema auth, roles, auth.uid falsa) ──────────────────────────"
if ! salida=$(psql -d "$BASE" -q -f "$AQUI/00-simular-supabase.sql" 2>&1); then
  echo "   ✗ el andamio falló:"; echo "$salida" | sed 's/^/     /'; exit 1
fi
echo "   ✓ listo"

echo ""
echo "── Esquema y migraciones ──────────────────────────────────────────────────"

fallos=0
aplicar() {
  local f="$1" nombre
  nombre="$(basename "$f")"
  local salida
  # 2>&1 junto: los avisos (NOTICE) también interesan.
  if salida=$(psql -d "$BASE" -q -f "$f" 2>&1); then
    # Aunque salga bien, un aviso puede delatar algo.
    local avisos
    avisos=$(echo "$salida" | grep -ciE "^(WARNING|AVISO)" || true)
    if [ "$avisos" -gt 0 ]; then
      printf "   ✓ %-44s (%s avisos)\n" "$nombre" "$avisos"
    else
      printf "   ✓ %-44s\n" "$nombre"
    fi
  else
    printf "   ✗ %-44s FALLA\n" "$nombre"
    echo "$salida" | grep -iE "ERROR|LINE|CONTEXT|DETAIL|HINT" | head -12 | sed 's/^/       /'
    fallos=$((fallos + 1))
    return 1
  fi
}

# schema.sql primero: es el punto de partida del que salen las migraciones.
# Está DESACTUALIZADO respecto a producción (p. ej. sigue declarando las columnas
# *_mult de plant_instances que la 04 borra, y le falta profiles.is_admin), pero
# es exactamente lo que necesita esta prueba: si la cadena 01→17 lo lleva al
# estado real, la cadena es coherente.
aplicar "$MIG/schema.sql" || exit 1

for f in "$MIG"/[0-9][0-9]-*.sql; do
  n="$(basename "$f" | cut -c1-2)"
  # La 00 es un diagnóstico de sólo lectura, no una migración.
  [ "$n" = "00" ] && continue
  # 10#$n fuerza base 10: si no, "08" se lee como octal y revienta.
  [ "$((10#$n))" -gt "$((10#$HASTA))" ] && continue
  aplicar "$f" || break
done

echo ""
if [ "$fallos" -eq 0 ]; then
  echo "── Todas aplicadas ───────────────────────────────────────────────────────"
  echo ""
  echo "Fases registradas en la auditoría:"
  psql -d "$BASE" -tA -c \
    "SELECT '   ' || fase FROM public._migration_audit ORDER BY id;" 2>/dev/null
  echo ""
  echo "Conéctate con:"
  echo "   \"$PG_BIN/psql.exe\" -h $PGHOST -p $PGPORT -U $PGUSER -d $BASE"
else
  echo "── Se paró en la primera que falla ───────────────────────────────────────"
  exit 1
fi
