import { useCallback, useEffect, useState, useMemo, useRef } from 'react'
import { referralService, type MisReferidos } from '../../services/referralService'
import { soundManager } from '../../utils/audioManager'
import { enlaceDeReferido } from '../../utils/direccionPublica'
import { getPlayerAvatarUrl } from '../../utils/userManager'
import './PanelDeReferidos.css'

/**
 * PANEL DE REFERIDOS ACTUALIZADO
 *
 * 1. Recompensas Permanentes:
 *    - 100 de oro por única vez por cada amigo que alcance 1,100 copas por primera vez.
 *    - 5% en gemas de cada depósito que realicen tus amigos referidos (acumulable y retirable).
 * 2. Metas de Temporada (se renuevan cada 15 días):
 *    - 10 amigos válidos en la temporada: 1 Sobre Básico de cartas.
 *    - 35 amigos válidos en la temporada: 500 Gemas.
 * 3. Ranking de Temporada (Top 1 al 5 con liquidación automática por backend al vencer):
 *    - 🥇 Top 1: 1,000 Gemas + 1 Sobre Legendario
 *    - 🥈 Top 2: 500 Gemas + 1 Sobre Épico
 *    - 🥉 Top 3: 200 Gemas + 2 Sobres Comunes
 *    - 🎖️ Top 4: 2,500 Oro + 1 Sobre Común
 *    - 🎖️ Top 5: 2,000 Oro
 */

/** Formatea los segundos restantes de la temporada en formato legible */
function cuentaAtras(segundos: number): string {
  if (segundos <= 0) return 'Terminada'
  const d = Math.floor(segundos / 86400)
  const h = Math.floor((segundos % 86400) / 3600)
  const m = Math.floor((segundos % 3600) / 60)
  const s = segundos % 60
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m ${s}s`
  return `${m}m ${s}s`
}

const POR_QUE_NO: Record<string, string> = {
  cuenta_demasiado_antigua:
    'Tu cuenta tiene más de 7 días. El código de un amigo solo se puede usar al empezar.',
  ya_pasaste_las_copas:
    'Ya pasaste las 1,100 copas a las que un invitado empieza a contar, por lo que este código ya no aplica.',
  ya_tienes_referidor: 'Ya estás vinculado con quien te invitó.',
  sin_perfil: 'No se encontró tu perfil.',
}

const FALLO_AL_ENVIAR: Record<string, string> = {
  codigo_no_existe: 'Ese código no existe. Revisa que esté bien escrito.',
  es_tu_propio_codigo: 'Ese es tu propio código.',
  sin_codigo: 'Escribe un código.',
}

// Premios oficiales del Ranking de Temporada (Top 1 al 5)
export const PREMIOS_OFICIALES = [
  { puesto: 1, titulo: '1.º Puesto', gemas: 1000, oro: 0, sobres: 1, tipoSobre: 'Legendario 🌟', icono: '🥇' },
  { puesto: 2, titulo: '2.º Puesto', gemas: 500, oro: 0, sobres: 1, tipoSobre: 'Épico 🟣', icono: '🥈' },
  { puesto: 3, titulo: '3.º Puesto', gemas: 200, oro: 0, sobres: 2, tipoSobre: 'Comunes 🟢', icono: '🥉' },
  { puesto: 4, titulo: '4.º Puesto', gemas: 0, oro: 2500, sobres: 1, tipoSobre: 'Común 🟢', icono: '🎖️' },
  { puesto: 5, titulo: '5.º Puesto', gemas: 0, oro: 2000, sobres: 0, tipoSobre: 'Ninguno', icono: '🎖️' },
]

export default function PanelDeReferidos() {
  const [datos, setDatos] = useState<MisReferidos | null>(null)
  const [cargando, setCargando] = useState(true)
  const [aviso, setAviso] = useState<{ texto: string; bien: boolean } | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [restante, setRestante] = useState(0)
  const [codigoEscrito, setCodigoEscrito] = useState('')

  // Paginación y búsqueda de amigos invitados
  const [amigosBusqueda, setAmigosBusqueda] = useState('')
  const [amigosPagina, setAmigosPagina] = useState(1)
  const amigosTamanoPagina = 10
  const amigosListaRef = useRef<HTMLUListElement>(null)

  // Paginación del ranking
  const [rankingPagina, setRankingPagina] = useState(1)
  const rankingTamanoPagina = 10
  const rankingListaRef = useRef<HTMLOListElement>(null)

  const cargar = useCallback(async () => {
    const d = await referralService.myReferrals()
    setDatos(d)
    setRestante(d?.temporada?.segundos ?? 0)
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  // Temporizador en vivo sincronizado con el backend
  const corriendo = restante > 0
  useEffect(() => {
    if (!corriendo) return
    const id = setInterval(() => setRestante((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(id)
  }, [corriendo])

  // Amigos filtrados y paginados
  const amigosFiltrados = useMemo(() => {
    const q = amigosBusqueda.trim().toLowerCase()
    if (!datos?.amigos) return []
    if (!q) return datos.amigos
    return datos.amigos.filter((a) => (a.nombre || '').toLowerCase().includes(q))
  }, [datos?.amigos, amigosBusqueda])

  const totalAmigos = amigosFiltrados.length
  const totalPaginasAmigos = Math.max(1, Math.ceil(totalAmigos / amigosTamanoPagina))
  const paginaAmigosActual = Math.min(amigosPagina, totalPaginasAmigos)

  const amigosPaginados = useMemo(() => {
    const start = (paginaAmigosActual - 1) * amigosTamanoPagina
    return amigosFiltrados.slice(start, start + amigosTamanoPagina)
  }, [amigosFiltrados, paginaAmigosActual, amigosTamanoPagina])

  const inicioAmigos = totalAmigos === 0 ? 0 : (paginaAmigosActual - 1) * amigosTamanoPagina + 1
  const finAmigos = Math.min(paginaAmigosActual * amigosTamanoPagina, totalAmigos)

  const handleAmigosPagina = (nueva: number) => {
    soundManager.playSound('click', 0.2)
    setAmigosPagina(nueva)
    amigosListaRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Ranking paginado
  const totalRanking = datos?.ranking?.length ?? 0
  const totalPaginasRanking = Math.max(1, Math.ceil(totalRanking / rankingTamanoPagina))
  const paginaRankingActual = Math.min(rankingPagina, totalPaginasRanking)

  const rankingPaginado = useMemo(() => {
    if (!datos?.ranking) return []
    const start = (paginaRankingActual - 1) * rankingTamanoPagina
    return datos.ranking.slice(start, start + rankingTamanoPagina)
  }, [datos?.ranking, paginaRankingActual, rankingTamanoPagina])

  const handleRankingPagina = (nueva: number) => {
    soundManager.playSound('click', 0.2)
    setRankingPagina(nueva)
    rankingListaRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const decir = (texto: string, bien = true) => {
    setAviso({ texto, bien })
    setTimeout(() => setAviso(null), 4000)
  }

  if (cargando) {
    return (
      <div className="ref-panel">
        <p className="ref-cargando">⏳ Cargando panel de referidos…</p>
      </div>
    )
  }

  if (!datos) {
    return (
      <div className="ref-panel">
        <p className="ref-cargando">
          No se pudieron cargar los datos de referidos. Por favor, vuelve a abrir esta pestaña.
        </p>
      </div>
    )
  }

  const enlace = enlaceDeReferido(datos.codigo)

  const copiar = async () => {
    soundManager.playSound('click', 0.4)
    try {
      await navigator.clipboard.writeText(enlace)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2500)
    } catch {
      decir('No se pudo copiar automáticamente. Selecciona el enlace de arriba para copiarlo a mano.', false)
    }
  }

  const usarCodigo = async () => {
    const limpio = codigoEscrito.trim()
    if (!limpio) return
    setOcupado('codigo')
    const r = await referralService.referralBind(limpio)
    setOcupado(null)

    if (r.ok) {
      soundManager.playSound('victory', 0.8)
      setCodigoEscrito('')
      decir('¡Excelente! Ya estás vinculado con tu amigo.')
      void cargar()
      return
    }
    decir(
      FALLO_AL_ENVIAR[r.motivo ?? ''] ??
        POR_QUE_NO[r.motivo ?? ''] ??
        `No se pudo vincular: ${r.motivo ?? 'error'}`,
      false
    )
  }

  // COBRAR ORO POR AMIGOS VÁLIDOS (100 ORO C/U)
  const cobrarOro = async () => {
    setOcupado('oro')
    const r = await referralService.claimReferralGold()
    setOcupado(null)
    if (r.ok) {
      soundManager.playSound('victory', 0.8)
      decir(`¡Cobro exitoso! +${r.oro} 🪙 de oro acreditados por ${r.amigos} amigo(s).`)
      window.dispatchEvent(new Event('refresh_user_balance'))
      void cargar()
    } else {
      decir(
        r.motivo === 'nada_que_cobrar'
          ? 'No tienes amigos nuevos que hayan alcanzado las 1,100 copas.'
          : `No se pudo cobrar el oro: ${r.motivo ?? 'error'}`,
        false
      )
    }
  }

  // RETIRAR 5% DE DEPÓSITOS DE REFERIDOS EN GEMAS
  const retirarGemasDeposito = async () => {
    setOcupado('gemas_deposito')
    const r = await referralService.claimReferralDepositGems()
    setOcupado(null)
    if (r.ok) {
      soundManager.playSound('victory', 0.9)
      decir(`¡Retiro completado! +${r.gemas} 💎 acreditadas directamente a tu balance de gemas.`)
      window.dispatchEvent(new Event('refresh_user_balance'))
      void cargar()
    } else {
      decir(
        r.motivo === 'nada_que_cobrar'
          ? 'Aún no tienes comisiones de depósitos acumuladas para retirar.'
          : `No se pudo retirar: ${r.motivo ?? 'error'}`,
        false
      )
    }
  }

  // COBRAR METAS DE TEMPORADA (10 AMIGOS -> SOBRE BÁSICO, 35 AMIGOS -> 500 GEMAS)
  const cobrarMeta = async (kind: 'sobre_10' | 'gemas_35') => {
    setOcupado(kind)
    const r = await referralService.claimReferralReward(kind)
    setOcupado(null)
    if (r.ok) {
      soundManager.playSound('victory', 0.9)
      decir(
        kind === 'sobre_10'
          ? '🎉 ¡Recompensa de temporada reclamada! 1 Sobre Básico añadido a tu inventario.'
          : '🎉 ¡Recompensa de temporada reclamada! +500 💎 gemas añadidas a tu saldo.'
      )
      window.dispatchEvent(new Event('refresh_user_balance'))
      window.dispatchEvent(new Event('refresh_user_inventory'))
      void cargar()
    } else if (r.motivo === 'faltan_amigos') {
      decir(`Te faltan amigos en esta temporada: tienes ${r.tienes} de ${r.necesitas}.`, false)
    } else if (r.motivo === 'ya_cobrada') {
      decir('Ya habías cobrado esta meta en la temporada actual.', false)
    } else {
      decir(`No se pudo cobrar la meta: ${r.motivo ?? 'error'}`, false)
    }
  }

  const validosTemporada = datos.validosTemporada ?? datos.validos
  const gemasDeposito = Number(datos.gemasDepositoPorCobrar ?? 0)

  return (
    <div className="ref-panel">
      {aviso && (
        <div className={`ref-aviso ${aviso.bien ? 'ref-aviso--bien' : 'ref-aviso--mal'}`}>
          {aviso.texto}
        </div>
      )}

      {/* ── SECCIÓN 1: ENLACE Y CÓDIGO DE INVITACIÓN ────────────────────── */}
      <div className="ref-bloque">
        <h3 className="ref-titulo">🔗 Tu Enlace de Invitación</h3>
        <p className="ref-sub">
          Comparte tu enlace con amigos. Quien se registre queda vinculado a tu cuenta y se considerará
          un amigo válido cuando alcance <strong>1,100 copas</strong> en la Arena por primera vez.
        </p>
        <div className="ref-enlace">
          <code>{enlace}</code>
          <button type="button" className="ref-btn ref-btn--principal" onClick={() => void copiar()}>
            {copiado ? '✓ Copiado' : '📋 Copiar Enlace'}
          </button>
        </div>
        <p className="ref-codigo">
          Tu código de referido: <strong>{datos.codigo ?? '—'}</strong>
        </p>
      </div>

      {/* ── SECCIÓN 2: ¿TE INVITÓ ALGUIEN? (VINCULACIÓN MANUAL) ─────────── */}
      {datos.miReferidor ? (
        <div className="ref-bloque ref-bloque--invitado">
          <span className="ref-invitado">
            🤝 Fuiste invitado por <strong>{datos.miReferidor}</strong>
          </span>
        </div>
      ) : datos.puedoUsarCodigo ? (
        <div className="ref-bloque">
          <h3 className="ref-titulo">🤝 ¿Te invitó alguien?</h3>
          <p className="ref-sub">
            Si te registraste sin el enlace de tu amigo, escribe su código aquí para vincularte.{' '}
            {datos.diasParaUsarCodigo > 0 && (
              <strong>
                Te quedan {datos.diasParaUsarCodigo} {datos.diasParaUsarCodigo === 1 ? 'día' : 'días'} para usarlo.
              </strong>
            )}
          </p>
          <form
            className="ref-enlace"
            onSubmit={(ev) => {
              ev.preventDefault()
              void usarCodigo()
            }}
          >
            <input
              className="ref-input"
              type="text"
              value={codigoEscrito}
              onChange={(ev) => setCodigoEscrito(ev.target.value.toUpperCase())}
              placeholder="CÓDIGO DE TU AMIGO"
              maxLength={16}
              autoComplete="off"
              spellCheck={false}
              aria-label="Código de referido de quien te invitó"
            />
            <button
              type="submit"
              className="ref-btn ref-btn--principal"
              disabled={!codigoEscrito.trim() || ocupado === 'codigo'}
            >
              {ocupado === 'codigo' ? '⏳ Vinculando...' : '✓ Vincular Código'}
            </button>
          </form>
        </div>
      ) : (
        datos.motivoNoPuedo && (
          <div className="ref-bloque">
            <h3 className="ref-titulo">🤝 ¿Te invitó alguien?</h3>
            <p className="ref-sub">
              {POR_QUE_NO[datos.motivoNoPuedo] ?? 'Ya no es posible vincular un código de invitación.'}
            </p>
          </div>
        )
      )}

      {/* ── SECCIÓN 3: ESTADÍSTICAS DEL JUGADOR ─────────────────────────── */}
      <div className="ref-cifras">
        <div className="ref-cifra">
          <span className="ref-cifra__num">{datos.validos}</span>
          <span className="ref-cifra__lbl">Amigos Válidos (1,100+ Copas)</span>
        </div>
        <div className="ref-cifra">
          <span className="ref-cifra__num ref-cifra__num--gris">
            {Math.max(0, datos.total - datos.validos)}
          </span>
          <span className="ref-cifra__lbl">En Progreso (&lt; 1,100 Copas)</span>
        </div>
        <div className="ref-cifra">
          <span className="ref-cifra__num ref-cifra__num--oro">
            {datos.miPuesto ? `#${datos.miPuesto}` : '—'}
          </span>
          <span className="ref-cifra__lbl">Tu Puesto en Temporada</span>
        </div>
      </div>

      {/* ── SECCIÓN 4: RECOMPENSAS PERMANENTES (SIEMPRE ACTIVAS) ────────── */}
      <div className="ref-bloque">
        <h3 className="ref-titulo">💰 Recompensas Permanentes</h3>
        <p className="ref-sub">
          Estas recompensas siempre están activas y no vencen. Retira tus ganancias en cualquier momento.
        </p>

        {/* 1. Oro por amigos válidos */}
        <div className="ref-premio">
          <div className="ref-premio__txt">
            <strong>🪙 100 de Oro por cada amigo válido</strong>
            <small>
              {datos.amigosSinCobrar > 0
                ? `${datos.amigosSinCobrar} amigo(s) en 1,100+ copas listos para cobrar (+${datos.oroPorCobrar} 🪙)`
                : 'Todo el oro acumulado ha sido cobrado.'}
            </small>
          </div>
          <button
            type="button"
            className="ref-btn ref-btn--principal"
            disabled={datos.oroPorCobrar <= 0 || ocupado === 'oro'}
            onClick={() => void cobrarOro()}
          >
            {ocupado === 'oro' ? '⏳ Cobrando...' : `Cobrar ${datos.oroPorCobrar} 🪙 Oro`}
          </button>
        </div>

        {/* 2. 5% en gemas por depósitos de referidos */}
        <div className="ref-premio">
          <div className="ref-premio__txt">
            <strong>💎 5% de Comisión por Depósitos de tus Referidos</strong>
            <small>
              Recibes el 5% en gemas de cada depósito que realicen tus amigos. Se acredita directamente a tu balance de gemas.
              {gemasDeposito > 0 ? ` (Disponible: +${gemasDeposito.toFixed(2)} 💎)` : ' (Sin depósitos pendientes)'}
            </small>
          </div>
          <button
            type="button"
            className="ref-btn ref-btn--principal"
            style={{ background: gemasDeposito > 0 ? 'linear-gradient(180deg, #c084fc, #9333ea)' : undefined, borderColor: '#a855f7', color: '#fff' }}
            disabled={gemasDeposito <= 0 || ocupado === 'gemas_deposito'}
            onClick={() => void retirarGemasDeposito()}
          >
            {ocupado === 'gemas_deposito' ? '⏳ Retirando...' : `Retirar ${gemasDeposito.toFixed(2)} 💎`}
          </button>
        </div>
      </div>

      {/* ── SECCIÓN 5: METAS DE LA TEMPORADA ACTIVA ─────────────────────── */}
      <div className="ref-bloque">
        <h3 className="ref-titulo">🎯 Metas de la Temporada Activa</h3>
        <p className="ref-sub">
          Disponibles durante los 15 días de la temporada actual. Al finalizar la temporada estas metas se reinician.
        </p>

        {/* Meta 1: 10 amigos -> 1 Sobre Básico */}
        <div className="ref-premio">
          <div className="ref-premio__txt">
            <strong>📦 1 Sobre Básico al alcanzar 10 amigos</strong>
            <small>
              Progreso en temporada: <strong>{validosTemporada}</strong> / 10 amigos válidos.
            </small>
          </div>
          <button
            type="button"
            className="ref-btn ref-btn--principal"
            disabled={!datos.metaSobre.alcanzada || datos.metaSobre.cobrada || ocupado === 'sobre_10'}
            onClick={() => void cobrarMeta('sobre_10')}
          >
            {datos.metaSobre.cobrada
              ? '✓ Cobrado'
              : ocupado === 'sobre_10'
              ? '⏳'
              : datos.metaSobre.alcanzada
              ? 'Cobrar 1 Sobre 📦'
              : `${validosTemporada}/10 amigos`}
          </button>
        </div>

        {/* Meta 2: 35 amigos -> 500 Gemas */}
        <div className="ref-premio">
          <div className="ref-premio__txt">
            <strong>💎 500 Gemas al alcanzar 35 amigos</strong>
            <small>
              Progreso en temporada: <strong>{validosTemporada}</strong> / 35 amigos válidos.
            </small>
          </div>
          <button
            type="button"
            className="ref-btn ref-btn--principal"
            disabled={!datos.metaGemas.alcanzada || datos.metaGemas.cobrada || ocupado === 'gemas_35'}
            onClick={() => void cobrarMeta('gemas_35')}
          >
            {datos.metaGemas.cobrada
              ? '✓ Cobrado'
              : ocupado === 'gemas_35'
              ? '⏳'
              : datos.metaGemas.alcanzada
              ? 'Cobrar 500 💎'
              : `${validosTemporada}/35 amigos`}
          </button>
        </div>
      </div>

      {/* ── SECCIÓN 6: RANKING Y PREMIOS DE TEMPORADA ────────────────────── */}
      <div className="ref-bloque">
        <h3 className="ref-titulo">🏆 Premios del Ranking de Temporada</h3>
        <p className="ref-sub">
          La temporada concluye en la fecha indicada. Al llegar al término, el backend liquida y entrega los premios automáticamente a los mejores 5 participantes.
        </p>

        <div className="ref-reloj">
          <span className="ref-reloj__num">{cuentaAtras(restante)}</span>
          <span className="ref-reloj__lbl">para la liquidación automática</span>
        </div>

        {/* Tabla de Premios Oficiales Top 1 al 5 */}
        <table className="ref-tabla">
          <thead>
            <tr>
              <th>Puesto</th>
              <th>Gemas</th>
              <th>Oro</th>
              <th>Sobres</th>
            </tr>
          </thead>
          <tbody>
            {PREMIOS_OFICIALES.map((p) => (
              <tr key={p.puesto} style={datos.miPuesto === p.puesto ? { background: 'rgba(251, 191, 36, 0.15)', fontWeight: 'bold' } : undefined}>
                <td>{p.icono} {p.titulo}</td>
                <td style={{ color: p.gemas > 0 ? '#c084fc' : '#94a3b8' }}>
                  {p.gemas > 0 ? `${p.gemas.toLocaleString()} 💎` : '—'}
                </td>
                <td style={{ color: p.oro > 0 ? '#facc15' : '#94a3b8' }}>
                  {p.oro > 0 ? `${p.oro.toLocaleString()} 🪙` : '—'}
                </td>
                <td style={{ color: p.sobres > 0 ? '#4ade80' : '#94a3b8' }}>
                  {p.sobres > 0 ? `${p.sobres}x ${p.tipoSobre}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Tabla de los que más invitan (Ranking en vivo) */}
        <h4 style={{ margin: '1.2rem 0 0.5rem', fontSize: '0.88rem', color: '#fde047' }}>
          👑 Los que más invitan en esta Temporada
        </h4>

        {totalRanking === 0 ? (
          <p className="ref-sub">Aún no hay invitaciones válidas registradas en esta temporada. ¡Sé el primero en liderar!</p>
        ) : (
          <>
            <ol className="ref-ranking" ref={rankingListaRef}>
              {rankingPaginado.map((r) => (
                <li
                  key={r.puesto}
                  className={`ref-ranking__item ${r.puesto === datos.miPuesto ? 'ref-ranking__item--yo' : ''}`}
                >
                  <span className="ref-ranking__puesto">#{r.puesto}</span>
                  <img
                    src={getPlayerAvatarUrl(r.avatar || 'peashooter')}
                    alt={r.nombre || 'Jugador'}
                    className="ref-ranking__avatar"
                  />
                  <span className="ref-ranking__nombre">
                    {r.nombre || 'Jugador'}
                    {r.puesto === datos.miPuesto && ' (Tú)'}
                  </span>
                  <span className="ref-ranking__validos">{r.validos} amigos</span>
                </li>
              ))}
            </ol>

            {totalPaginasRanking > 1 && (
              <div className="ref-paginacion">
                <button
                  type="button"
                  className="ref-btn"
                  disabled={paginaRankingActual <= 1}
                  onClick={() => handleRankingPagina(paginaRankingActual - 1)}
                >
                  ◀ Anterior
                </button>
                <span className="ref-paginacion__info">
                  Página {paginaRankingActual} de {totalPaginasRanking}
                </span>
                <button
                  type="button"
                  className="ref-btn"
                  disabled={paginaRankingActual >= totalPaginasRanking}
                  onClick={() => handleRankingPagina(paginaRankingActual + 1)}
                >
                  Siguiente ▶
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── SECCIÓN 7: TUS INVITADOS (LISTA COMPLETA) ───────────────────── */}
      <div className="ref-bloque">
        <h3 className="ref-titulo">👥 Tus Amigos Invitados ({datos.total})</h3>
        <p className="ref-sub">
          Lista de jugadores que se registraron con tu código. Cada uno cuenta como válido al llegar a 1,100 copas.
        </p>

        {datos.total > 0 && (
          <div className="ref-busqueda-wrap" style={{ marginBottom: '0.6rem' }}>
            <input
              type="text"
              className="ref-input"
              style={{ width: '100%' }}
              placeholder="🔍 Buscar por nombre..."
              value={amigosBusqueda}
              onChange={(e) => {
                setAmigosBusqueda(e.target.value)
                setAmigosPagina(1)
              }}
            />
          </div>
        )}

        {totalAmigos === 0 ? (
          <p className="ref-sub">
            {datos.total === 0
              ? 'Aún no has invitado a ningún amigo. ¡Comparte tu enlace para empezar a ganar recompensas!'
              : 'No se encontraron amigos con ese nombre.'}
          </p>
        ) : (
          <>
            <ul className="ref-amigos" ref={amigosListaRef}>
              {amigosPaginados.map((a, i) => {
                const falta = Math.max(0, 1100 - (a.copas ?? 1000))
                return (
                  <li key={i} className="ref-amigo">
                    <img
                      src={getPlayerAvatarUrl(a.avatar || 'peashooter')}
                      alt={a.nombre || 'Amigo'}
                      className="ref-amigo__avatar"
                    />
                    <div className="ref-amigo__info">
                      <strong className="ref-amigo__nombre">{a.nombre || 'Jugador'}</strong>
                      <span className="ref-amigo__copas">
                        🏆 {a.copas ?? 1000} Copas {a.valido ? '· ¡Meta de 1,100 superada!' : `· (faltan ${falta} copas)`}
                      </span>
                    </div>
                    <div className="ref-amigo__badges" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.2rem' }}>
                      {a.valido ? (
                        <span className="ref-tag ref-tag--valido">✓ Amigo Válido</span>
                      ) : (
                        <span className="ref-tag ref-tag--pendiente">⏳ En progreso</span>
                      )}
                      <span style={{ fontSize: '0.68rem', color: a.oroCobrado ? '#4ade80' : a.valido ? '#facc15' : '#94a3b8' }}>
                        {a.oroCobrado ? '✓ 100 Oro cobrado' : a.valido ? '🪙 100 Oro listo' : '🪙 100 Oro a las 1,100'}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>

            {totalPaginasAmigos > 1 && (
              <div className="ref-paginacion">
                <button
                  type="button"
                  className="ref-btn"
                  disabled={paginaAmigosActual <= 1}
                  onClick={() => handleAmigosPagina(paginaAmigosActual - 1)}
                >
                  ◀ Anterior
                </button>
                <span className="ref-paginacion__info">
                  {inicioAmigos}-{finAmigos} de {totalAmigos}
                </span>
                <button
                  type="button"
                  className="ref-btn"
                  disabled={paginaAmigosActual >= totalPaginasAmigos}
                  onClick={() => handleAmigosPagina(paginaAmigosActual + 1)}
                >
                  Siguiente ▶
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
