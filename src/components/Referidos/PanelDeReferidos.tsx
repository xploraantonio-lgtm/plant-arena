import { useCallback, useEffect, useState, useMemo, useRef } from 'react'
import { SupabaseService, type MisReferidos } from '../../services/supabaseService'
import { soundManager } from '../../utils/audioManager'
import { enlaceDeReferido } from '../../utils/direccionPublica'
import './PanelDeReferidos.css'

/**
 * EL PANEL DE REFERIDOS
 *
 * Lo que había antes en esta pestaña era un decorado: el enlace apuntaba a
 * «/?ref=<nombre>», nadie leía ese parámetro, y «Amigos Invitados» y «Bonos
 * Ganados» eran dos ceros guardados en el navegador. Un jugador podía repartir su
 * enlace a cien personas y no pasaba nada.
 *
 * Ahora todo lo que se ve aquí lo cuenta el servidor (my_referrals) y todo lo que
 * se pulsa lo cobra el servidor. El navegador no suma ni resta nada: si sumara,
 * bastaría con abrir las herramientas del navegador para regalarse premios.
 *
 * El orden de la pantalla es el orden de las preguntas del jugador: qué enlace
 * reparto, cuánto llevo, qué puedo cobrar YA, y qué se está repartiendo.
 */

/** Los segundos que faltan, en palabras. */
function cuentaAtras(segundos: number): string {
  if (segundos <= 0) return 'terminada'
  const d = Math.floor(segundos / 86400)
  const h = Math.floor((segundos % 86400) / 3600)
  const m = Math.floor((segundos % 3600) / 60)
  const s = segundos % 60
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m ${s}s`
  return `${m}m ${s}s`
}

/**
 * Por qué no se puede usar un código, dicho para una persona.
 *
 * Los motivos vienen del servidor en clave. Enseñarlos tal cual («
 * cuenta_demasiado_antigua») es peor que no decir nada; y esconder el cuadro sin
 * explicación parece un fallo del juego.
 */
const POR_QUE_NO: Record<string, string> = {
  cuenta_demasiado_antigua:
    'Tu cuenta tiene ya demasiados días. El código de un amigo sólo se puede usar al empezar.',
  ya_pasaste_las_copas:
    'Ya pasaste las copas a las que un invitado empieza a contar, así que este código ya no valdría.',
  ya_tienes_referidor: 'Ya tienes a quien te invitó.',
  sin_perfil: 'No se encontró tu perfil.',
}

/** Y lo mismo para lo que puede fallar al enviarlo. */
const FALLO_AL_ENVIAR: Record<string, string> = {
  codigo_no_existe: 'Ese código no existe. Revisa que esté bien escrito.',
  es_tu_propio_codigo: 'Ése es tu propio código.',
  sin_codigo: 'Escribe un código.',
}

export default function PanelDeReferidos() {
  const [datos, setDatos] = useState<MisReferidos | null>(null)
  const [cargando, setCargando] = useState(true)
  const [aviso, setAviso] = useState<{ texto: string; bien: boolean } | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [restante, setRestante] = useState(0)
  /** Lo que se escribe en el cuadro del código, cuando se llegó sin enlace. */
  const [codigoEscrito, setCodigoEscrito] = useState('')

  // Estados de paginación y búsqueda para "Tus invitados"
  const [amigosBusqueda, setAmigosBusqueda] = useState('')
  const [amigosPagina, setAmigosPagina] = useState(1)
  const [amigosTamanoPagina, setAmigosTamanoPagina] = useState<number | 'all'>(10)
  const amigosListaRef = useRef<HTMLUListElement>(null)

  // Estados de paginación para "Los que más invitan"
  const [rankingPagina, setRankingPagina] = useState(1)
  const [rankingTamanoPagina, setRankingTamanoPagina] = useState<number | 'all'>(10)
  const rankingListaRef = useRef<HTMLOListElement>(null)

  const cargar = useCallback(async () => {
    const d = await SupabaseService.myReferrals()
    setDatos(d)
    setRestante(d?.temporada?.segundos ?? 0)
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  // El contador baja en el navegador, pero el número de partida y el cierre los
  // pone el servidor: así nadie adelanta el reparto cambiando su reloj.
  //
  // La dependencia es el booleano y no el número: con `[restante]` se crearía y
  // se destruiría un temporizador por segundo.
  const corriendo = restante > 0
  useEffect(() => {
    if (!corriendo) return
    const id = setInterval(() => setRestante((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(id)
  }, [corriendo])

  const decir = (texto: string, bien = true) => {
    setAviso({ texto, bien })
    setTimeout(() => setAviso(null), 4000)
  }

  if (cargando) {
    return <div className="ref-panel"><p className="ref-cargando">Cargando tus referidos…</p></div>
  }

  if (!datos) {
    return (
      <div className="ref-panel">
        <p className="ref-cargando">
          No se pudieron cargar los referidos. Si acabas de entrar, vuelve a abrir
          esta pestaña.
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
      // El portapapeles puede negarse (permisos, contexto no seguro). El enlace
      // está a la vista justo encima para copiarlo a mano; decirlo es mejor que
      // dejar un botón que parece no hacer nada.
      decir('El navegador no dejó copiar. Selecciona el enlace de arriba a mano.', false)
    }
  }

  const usarCodigo = async () => {
    const limpio = codigoEscrito.trim()
    if (!limpio) return
    setOcupado('codigo')
    const r = await SupabaseService.referralBind(limpio)
    setOcupado(null)

    if (r.ok) {
      soundManager.playSound('victory', 0.8)
      setCodigoEscrito('')
      decir('¡Listo! Ya estás apuntado como invitado.')
      void cargar()
      return
    }
    decir(
      FALLO_AL_ENVIAR[r.motivo ?? ''] ??
        POR_QUE_NO[r.motivo ?? ''] ??
        `No se pudo: ${r.motivo ?? 'error'}`,
      false
    )
  }

  const cobrarOro = async () => {
    setOcupado('oro')
    const r = await SupabaseService.claimReferralGold()
    setOcupado(null)
    if (r.ok) {
      soundManager.playSound('victory', 0.7)
      decir(`+${r.oro} de oro por ${r.amigos} amigo(s).`)
      void cargar()
    } else {
      decir(r.motivo === 'nada_que_cobrar'
        ? 'Todavía no hay amigos nuevos que hayan llegado a las copas.'
        : `No se pudo cobrar: ${r.motivo ?? 'error'}`, false)
    }
  }

  const cobrarMeta = async (kind: 'sobre_10' | 'gemas_25') => {
    setOcupado(kind)
    const r = await SupabaseService.claimReferralReward(kind)
    setOcupado(null)
    if (r.ok) {
      soundManager.playSound('victory', 0.8)
      decir(kind === 'sobre_10'
        ? '¡Sobre básico añadido a tu jardín!'
        : `+${r.gemas} gemas. Quedan ${r.quedan} cupos.`)
      void cargar()
    } else if (r.motivo === 'faltan_amigos') {
      decir(`Te faltan amigos: tienes ${r.tienes} de ${r.necesitas}.`, false)
    } else if (r.motivo === 'cupo_agotado') {
      decir(`El cupo de ${r.cupo ?? 5} jugadores ya se agotó.`, false)
    } else if (r.motivo === 'ya_cobrada') {
      decir('Ya la habías cobrado.', false)
    } else {
      decir(`No se pudo cobrar: ${r.motivo ?? 'error'}`, false)
    }
  }

  // La meta colectiva que se está persiguiendo, para la barra de progreso.
  const meta = datos.metaSiguiente ?? datos.metaActual ?? 50
  const premiosDeLaMeta = datos.premios.filter(
    (p) => p.meta === (datos.metaActual ?? datos.metaSiguiente ?? 50)
  )

  // Amigos filtrados y paginados
  const amigosFiltrados = useMemo(() => {
    const q = amigosBusqueda.trim().toLowerCase()
    if (!datos?.amigos) return []
    if (!q) return datos.amigos
    return datos.amigos.filter((a) => (a.nombre || '').toLowerCase().includes(q))
  }, [datos?.amigos, amigosBusqueda])

  const totalAmigos = amigosFiltrados.length
  const tamanoRealAmigos = amigosTamanoPagina === 'all' ? (totalAmigos || 1) : amigosTamanoPagina
  const totalPaginasAmigos = Math.max(1, Math.ceil(totalAmigos / tamanoRealAmigos))
  const paginaAmigosActual = Math.min(amigosPagina, totalPaginasAmigos)

  const amigosPaginados = useMemo(() => {
    if (amigosTamanoPagina === 'all') return amigosFiltrados
    const start = (paginaAmigosActual - 1) * tamanoRealAmigos
    return amigosFiltrados.slice(start, start + tamanoRealAmigos)
  }, [amigosFiltrados, paginaAmigosActual, tamanoRealAmigos, amigosTamanoPagina])

  const inicioAmigos = totalAmigos === 0 ? 0 : (paginaAmigosActual - 1) * tamanoRealAmigos + 1
  const finAmigos = amigosTamanoPagina === 'all' ? totalAmigos : Math.min(paginaAmigosActual * tamanoRealAmigos, totalAmigos)

  const handleAmigosPagina = (nueva: number) => {
    soundManager.playSound('click', 0.2)
    setAmigosPagina(nueva)
    amigosListaRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Ranking de referidos paginado
  const totalRanking = datos?.ranking?.length ?? 0
  const tamanoRealRanking = rankingTamanoPagina === 'all' ? (totalRanking || 1) : rankingTamanoPagina
  const totalPaginasRanking = Math.max(1, Math.ceil(totalRanking / tamanoRealRanking))
  const paginaRankingActual = Math.min(rankingPagina, totalPaginasRanking)

  const rankingPaginado = useMemo(() => {
    if (!datos?.ranking) return []
    if (rankingTamanoPagina === 'all') return datos.ranking
    const start = (paginaRankingActual - 1) * tamanoRealRanking
    return datos.ranking.slice(start, start + tamanoRealRanking)
  }, [datos?.ranking, paginaRankingActual, tamanoRealRanking, rankingTamanoPagina])

  const handleRankingPagina = (nueva: number) => {
    soundManager.playSound('click', 0.2)
    setRankingPagina(nueva)
    rankingListaRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="ref-panel">
      {aviso && (
        <div className={`ref-aviso ${aviso.bien ? 'ref-aviso--bien' : 'ref-aviso--mal'}`}>
          {aviso.texto}
        </div>
      )}

      {/* ── EL ENLACE ────────────────────────────────────────────────────── */}
      <div className="ref-bloque">
        <h3 className="ref-titulo">🔗 Tu enlace de invitación</h3>
        <p className="ref-sub">
          Quien lo abra y se registre queda apuntado como tu invitado. Cuenta
          cuando llega a <strong>{datos.copasNecesarias} copas</strong>.
        </p>
        <div className="ref-enlace">
          <code>{enlace}</code>
          <button type="button" className="ref-btn ref-btn--principal" onClick={() => void copiar()}>
            {copiado ? '✓ Copiado' : 'Copiar'}
          </button>
        </div>
        <p className="ref-codigo">
          Tu código: <strong>{datos.codigo ?? '—'}</strong>
        </p>
      </div>

      {/* ── ¿TE INVITÓ ALGUIEN? ──────────────────────────────────────────
          El cuadro sólo aparece si de verdad se puede usar. Antes esto no
          existía y el enganche sólo ocurría al entrar con «?ref=» en la
          dirección: si te mandaban el enlace y lo abrías sin el parámetro, o te
          decían el código por voz, el amigo que te trajo no contaba y no había
          forma de arreglarlo desde el juego. */}
      {datos.miReferidor ? (
        <div className="ref-bloque ref-bloque--invitado">
          <span className="ref-invitado">
            🤝 Te invitó <strong>{datos.miReferidor}</strong>
          </span>
        </div>
      ) : datos.puedoUsarCodigo ? (
        <div className="ref-bloque">
          <h3 className="ref-titulo">🤝 ¿Te invitó alguien?</h3>
          <p className="ref-sub">
            Si llegaste sin su enlace, escribe su código aquí y cuenta igual.{' '}
            {datos.diasParaUsarCodigo > 0 && (
              <strong>
                Te quedan {datos.diasParaUsarCodigo}{' '}
                {datos.diasParaUsarCodigo === 1 ? 'día' : 'días'} para usarlo.
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
              // Se enseña en mayúsculas porque así se reparte, pero el servidor
              // acepta cualquier caja y quita los espacios: nadie debería perder
              // un referido por teclear en minúscula.
              onChange={(ev) => setCodigoEscrito(ev.target.value.toUpperCase())}
              placeholder="CÓDIGO"
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
              {ocupado === 'codigo' ? '…' : 'Usar código'}
            </button>
          </form>
        </div>
      ) : (
        datos.motivoNoPuedo && (
          <div className="ref-bloque">
            <h3 className="ref-titulo">🤝 ¿Te invitó alguien?</h3>
            <p className="ref-sub">
              {POR_QUE_NO[datos.motivoNoPuedo] ?? 'Ya no se puede usar un código.'}
            </p>
          </div>
        )
      )}

      {/* ── MIS NÚMEROS ──────────────────────────────────────────────────── */}
      <div className="ref-cifras">
        <div className="ref-cifra">
          <span className="ref-cifra__num">{datos.validos}</span>
          <span className="ref-cifra__lbl">Amigos que cuentan</span>
        </div>
        <div className="ref-cifra">
          <span className="ref-cifra__num ref-cifra__num--gris">{datos.total - datos.validos}</span>
          <span className="ref-cifra__lbl">Aún sin llegar a {datos.copasNecesarias}</span>
        </div>
        <div className="ref-cifra">
          <span className="ref-cifra__num ref-cifra__num--oro">
            {datos.miPuesto ? `#${datos.miPuesto}` : '—'}
          </span>
          <span className="ref-cifra__lbl">Tu puesto</span>
        </div>
      </div>

      {/* ── LO QUE SE PUEDE COBRAR AHORA ─────────────────────────────────── */}
      <div className="ref-bloque">
        <h3 className="ref-titulo">🎁 Para cobrar</h3>

        <div className="ref-premio">
          <div className="ref-premio__txt">
            <strong>{datos.oroPorAmigo} de oro por cada amigo</strong>
            <small>
              {datos.amigosSinCobrar > 0
                ? `${datos.amigosSinCobrar} amigo(s) sin cobrar`
                : 'Todo cobrado'}
            </small>
          </div>
          <button
            type="button"
            className="ref-btn ref-btn--principal"
            disabled={datos.oroPorCobrar <= 0 || ocupado === 'oro'}
            onClick={() => void cobrarOro()}
          >
            {ocupado === 'oro' ? '…' : `Cobrar ${datos.oroPorCobrar} 🪙`}
          </button>
        </div>

        <div className="ref-premio">
          <div className="ref-premio__txt">
            <strong>1 sobre básico al llegar a {datos.metaSobre.objetivo} amigos</strong>
            <small>{datos.validos} de {datos.metaSobre.objetivo}</small>
          </div>
          <button
            type="button"
            className="ref-btn ref-btn--principal"
            disabled={!datos.metaSobre.alcanzada || datos.metaSobre.cobrada || ocupado === 'sobre_10'}
            onClick={() => void cobrarMeta('sobre_10')}
          >
            {datos.metaSobre.cobrada ? '✓ Cobrado' : ocupado === 'sobre_10' ? '…' : 'Cobrar'}
          </button>
        </div>

        <div className="ref-premio">
          <div className="ref-premio__txt">
            <strong>
              {datos.metaGemas.gemas} gemas al llegar a {datos.metaGemas.objetivo} amigos
            </strong>
            {/* El cupo se enseña siempre, no sólo cuando se alcanza la meta: es
                una carrera contra otros jugadores y hay que saberlo antes. */}
            <small>
              {datos.validos} de {datos.metaGemas.objetivo} · sólo para los primeros{' '}
              {datos.metaGemas.cupo} jugadores ({datos.metaGemas.quedan} libres)
            </small>
          </div>
          <button
            type="button"
            className="ref-btn ref-btn--principal"
            disabled={
              !datos.metaGemas.alcanzada ||
              datos.metaGemas.cobrada ||
              datos.metaGemas.quedan <= 0 ||
              ocupado === 'gemas_25'
            }
            onClick={() => void cobrarMeta('gemas_25')}
          >
            {datos.metaGemas.cobrada
              ? '✓ Cobrado'
              : datos.metaGemas.quedan <= 0
              ? 'Cupo agotado'
              : ocupado === 'gemas_25'
              ? '…'
              : 'Cobrar'}
          </button>
        </div>
      </div>

      {/* ── LA TEMPORADA ─────────────────────────────────────────────────── */}
      <div className="ref-bloque">
        <h3 className="ref-titulo">🏆 Temporada de referidos</h3>
        <p className="ref-sub">
          Al terminar el contador se reparten los premios del ranking. Cuanto más
          alto llegue el <strong>total de todos los jugadores</strong>, más grandes
          son.
        </p>

        <div className="ref-reloj">
          <span className="ref-reloj__num">{cuentaAtras(restante)}</span>
          <span className="ref-reloj__lbl">para el reparto</span>
        </div>

        <div className="ref-meta">
          <div className="ref-meta__barra">
            <div style={{ width: `${Math.min(100, (datos.totalGlobal / meta) * 100)}%` }} />
          </div>
          <span className="ref-meta__txt">
            {datos.totalGlobal} referidos entre todos
            {datos.metaSiguiente
              ? ` · siguiente meta: ${datos.metaSiguiente}`
              : ' · meta máxima alcanzada'}
          </span>
        </div>

        {premiosDeLaMeta.length > 0 ? (
          <table className="ref-tabla">
            <thead>
              <tr>
                <th>Puesto</th><th>Gemas</th><th>Sobres</th><th>% del mercado</th>
              </tr>
            </thead>
            <tbody>
              {premiosDeLaMeta.map((p) => (
                <tr key={p.puesto}>
                  <td>{p.puesto}.º</td>
                  <td>{p.gemas > 0 ? `${p.gemas} 💎` : '—'}</td>
                  <td>{p.sobres > 0 ? `${p.sobres} 📦` : '—'}</td>
                  <td>{p.p2pPct > 0 ? `${p.p2pPct} %` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="ref-sub">
            Todavía no se ha alcanzado la primera meta ({datos.metaSiguiente ?? 50}{' '}
            referidos entre todos). Al llegar se premia a los tres primeros.
          </p>
        )}
      </div>

      {/* ── EL RANKING ───────────────────────────────────────────────────── */}
      {datos.ranking.length > 0 && (
        <div className="ref-bloque">
          <div className="ref-bloque-header">
            <h3 className="ref-titulo">📋 Los que más invitan ({datos.ranking.length})</h3>
            {datos.ranking.length > 5 && (
              <div className="ref-tamano-selector">
                <span className="ref-tamano-lbl">Ver:</span>
                {[10, 20].map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`ref-tamano-btn ${rankingTamanoPagina === s ? 'ref-tamano-btn--activo' : ''}`}
                    onClick={() => {
                      soundManager.playSound('click', 0.2)
                      setRankingTamanoPagina(s)
                      setRankingPagina(1)
                    }}
                  >
                    {s}
                  </button>
                ))}
                <button
                  type="button"
                  className={`ref-tamano-btn ${rankingTamanoPagina === 'all' ? 'ref-tamano-btn--activo' : ''}`}
                  onClick={() => {
                    soundManager.playSound('click', 0.2)
                    setRankingTamanoPagina('all')
                    setRankingPagina(1)
                  }}
                >
                  Todos
                </button>
              </div>
            )}
          </div>

          <ol className="ref-ranking" ref={rankingListaRef}>
            {rankingPaginado.map((r) => (
              <li key={r.puesto}>
                <span className="ref-ranking__pos">{r.puesto}</span>
                <span className="ref-ranking__nombre">{r.nombre ?? 'Jugador'}</span>
                <span className="ref-ranking__num">{r.validos} amigos</span>
              </li>
            ))}
          </ol>

          {totalPaginasRanking > 1 && (
            <div className="ref-paginacion">
              <span className="ref-paginacion-info">
                Pág. {paginaRankingActual} de {totalPaginasRanking}
              </span>
              <div className="ref-paginacion-btns">
                <button
                  type="button"
                  className="ref-pag-btn"
                  disabled={paginaRankingActual <= 1}
                  onClick={() => handleRankingPagina(paginaRankingActual - 1)}
                >
                  ‹ Ant
                </button>
                <button
                  type="button"
                  className="ref-pag-btn"
                  disabled={paginaRankingActual >= totalPaginasRanking}
                  onClick={() => handleRankingPagina(paginaRankingActual + 1)}
                >
                  Sig ›
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── MIS AMIGOS ───────────────────────────────────────────────────── */}
      <div className="ref-bloque">
        <div className="ref-bloque-header">
          <h3 className="ref-titulo">👥 Tus invitados ({datos.total})</h3>
          {datos.amigos.length > 5 && (
            <div className="ref-tamano-selector">
              <span className="ref-tamano-lbl">Ver:</span>
              {[10, 25].map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`ref-tamano-btn ${amigosTamanoPagina === s ? 'ref-tamano-btn--activo' : ''}`}
                  onClick={() => {
                    soundManager.playSound('click', 0.2)
                    setAmigosTamanoPagina(s)
                    setAmigosPagina(1)
                  }}
                >
                  {s}
                </button>
              ))}
              <button
                type="button"
                className={`ref-tamano-btn ${amigosTamanoPagina === 'all' ? 'ref-tamano-btn--activo' : ''}`}
                onClick={() => {
                  soundManager.playSound('click', 0.2)
                  setAmigosTamanoPagina('all')
                  setAmigosPagina(1)
                }}
              >
                Todos
              </button>
            </div>
          )}
        </div>

        {datos.amigos.length > 4 && (
          <div className="ref-search-box">
            <span className="ref-search-icon">🔍</span>
            <input
              type="text"
              className="ref-search-input"
              placeholder="Buscar amigo por nombre..."
              value={amigosBusqueda}
              onChange={(e) => {
                setAmigosBusqueda(e.target.value)
                setAmigosPagina(1)
              }}
            />
            {amigosBusqueda && (
              <button
                type="button"
                className="ref-search-clear"
                onClick={() => {
                  setAmigosBusqueda('')
                  setAmigosPagina(1)
                }}
              >
                ✕
              </button>
            )}
          </div>
        )}

        {datos.amigos.length === 0 ? (
          <p className="ref-sub">
            Nadie todavía. Comparte tu enlace por WhatsApp, Discord o Telegram.
          </p>
        ) : amigosPaginados.length === 0 ? (
          <p className="ref-sub">
            No se encontró ningún invitado que coincida con "{amigosBusqueda}".
          </p>
        ) : (
          <>
            <ul className="ref-amigos" ref={amigosListaRef}>
              {amigosPaginados.map((a, i) => (
                <li key={`${a.nombre}-${i}`} className={a.valido ? 'ref-amigo--ok' : ''}>
                  <span className="ref-amigo__nombre">{a.nombre ?? 'Jugador'}</span>
                  <span className="ref-amigo__copas">{a.copas} copas</span>
                  <span className="ref-amigo__estado">
                    {a.valido
                      ? a.oroCobrado ? '✓ cobrado' : '✓ cuenta'
                      : `faltan ${Math.max(0, datos.copasNecesarias - a.copas)}`}
                  </span>
                </li>
              ))}
            </ul>

            <div className="ref-paginacion">
              <span className="ref-paginacion-info">
                {totalAmigos === 0
                  ? '0 invitados'
                  : `Mostrando ${inicioAmigos} - ${finAmigos} de ${totalAmigos} invitados`}
              </span>

              {totalPaginasAmigos > 1 && (
                <div className="ref-paginacion-btns">
                  <button
                    type="button"
                    className="ref-pag-btn"
                    disabled={paginaAmigosActual <= 1}
                    onClick={() => handleAmigosPagina(paginaAmigosActual - 1)}
                  >
                    ‹ Ant
                  </button>
                  <span className="ref-pag-num">
                    {paginaAmigosActual} / {totalPaginasAmigos}
                  </span>
                  <button
                    type="button"
                    className="ref-pag-btn"
                    disabled={paginaAmigosActual >= totalPaginasAmigos}
                    onClick={() => handleAmigosPagina(paginaAmigosActual + 1)}
                  >
                    Sig ›
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
