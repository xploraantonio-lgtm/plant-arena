import { useEffect, useRef, useState } from 'react'
import { SupabaseService } from '../../services/supabaseService'
import { construirRepeticion, type DatosDeRepeticion, type Repeticion } from '../../engine/replay'
import { TICK_MS } from '../../engine/time'
import { PLANT_CONFIGS, LANES_CONFIG, INITIAL_BASE_HP } from '../../utils/gameConstants'
import { getArenaForElo } from '../../utils/arenaManager'
import './VerRepeticion.css'

/**
 * EL REPRODUCTOR DE REPETICIONES
 *
 * No pinta un vídeo: EJECUTA la partida otra vez. La semilla y las jugadas vienen
 * del servidor y el motor hace el resto, así que se puede pausar, rebobinar, ir a
 * un momento concreto y cambiar de lado — cosas que un vídeo no permite.
 *
 * Y por eso una repetición ocupa unas decenas de filas en lugar de megas.
 *
 * Tiene su propio pintado, más sencillo que el de la batalla: aquí no hay nada que
 * pulsar, así que no hacen falta la mano de cartas, los enfriamientos ni los
 * recolectores de sol. Reutilizar Battlefield habría significado desactivar la
 * mitad de sus controles.
 */

interface Props {
  /** La sala, si la partida es propia. */
  roomId?: string | null
  /** El código del enlace, si se llegó por uno compartido. */
  token?: string | null
  onVolver: () => void
}

/** Velocidades disponibles. La de 1× es la de la partida real. */
const VELOCIDADES = [0.5, 1, 2, 4] as const

export default function VerRepeticion({ roomId, token, onVolver }: Props) {
  const [datos, setDatos] = useState<DatosDeRepeticion | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [desde, setDesde] = useState<1 | 2>(1)
  const [reproduciendo, setReproduciendo] = useState(true)
  const [velocidad, setVelocidad] = useState<number>(1)
  /** Sólo para forzar el repintado: el estado de verdad vive en la repetición. */
  const [, setPintar] = useState(0)

  const repRef = useRef<Repeticion | null>(null)

  // ── Cargar ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelado = false
    void SupabaseService.matchReplay({
      roomId: roomId ?? undefined,
      token: token ?? undefined,
    }).then((d) => {
      if (cancelado) return
      if (!d) {
        setError('No se encontró la repetición. El enlace puede haber sido revocado.')
        return
      }
      setDatos(d)
      // Se mira desde tu lado si participaste; si no, desde el jugador 1.
      setDesde(d.yoSoy ?? 1)
    })
    return () => { cancelado = true }
  }, [roomId, token])

  // ── Montar la repetición cuando cambian los datos o el lado ───────────────
  useEffect(() => {
    if (!datos) return
    repRef.current = construirRepeticion(datos, desde)
    setPintar((n) => n + 1)
  }, [datos, desde])

  // ── El reloj ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!reproduciendo || !datos) return

    let cancelado = false
    let ultimoMs = performance.now()
    let sobrante = 0
    let id = 0

    const latido = (ahora: number) => {
      if (cancelado) return
      const rep = repRef.current
      if (!rep) return

      // Mismo acumulador de paso fijo que la partida real, con la velocidad como
      // multiplicador. Así una repetición a 1× dura lo que duró la partida.
      sobrante += (ahora - ultimoMs) * velocidad
      ultimoMs = ahora
      let tics = Math.floor(sobrante / TICK_MS)
      sobrante -= tics * TICK_MS
      // Tope por fotograma: a 4× hay que correr más tics, pero no tantos como para
      // trabar la pantalla.
      tics = Math.min(tics, 40)

      let sigue = true
      while (tics-- > 0 && sigue) sigue = rep.avanzar()

      setPintar((n) => n + 1)

      // Se para al acabar la partida, o unos segundos después de la última jugada
      // si la partida no llegó a terminar (una disputa o un abandono).
      if (!sigue || rep.estado.tick > rep.ultimoTic + 300) {
        setReproduciendo(false)
        return
      }
      id = requestAnimationFrame(latido)
    }

    id = requestAnimationFrame(latido)
    return () => { cancelado = true; cancelAnimationFrame(id) }
  }, [reproduciendo, velocidad, datos])

  if (error) {
    return (
      <div className="rep">
        <div className="rep__aviso">
          <p>{error}</p>
          <button type="button" className="rep__boton" onClick={onVolver}>Volver</button>
        </div>
      </div>
    )
  }

  if (!datos || !repRef.current) {
    return <div className="rep"><p className="rep__aviso">Cargando la repetición…</p></div>
  }

  const rep = repRef.current
  const estado = rep.estado
  const arena = getArenaForElo(1000)
  const miNombre = desde === 1 ? datos.jugador1.nombre : datos.jugador2.nombre
  const suNombre = desde === 1 ? datos.jugador2.nombre : datos.jugador1.nombre
  const segundo = Math.floor((estado.tick * TICK_MS) / 1000)
  const total = Math.max(1, Math.floor(((rep.ultimoTic + 300) * TICK_MS) / 1000))

  return (
    <div className="rep">
      <div className="rep__campo" style={{ backgroundImage: `url(${arena.bgImage})` }}>
        {/* Las bases */}
        <div className="rep__base rep__base--p1">
          <div className="rep__vida"><div style={{ width: `${(estado.p1BaseHp / INITIAL_BASE_HP) * 100}%` }} /></div>
          <span>🌳 {miNombre ?? 'Jugador 1'} ({Math.round(estado.p1BaseHp)})</span>
        </div>
        <div className="rep__base rep__base--p2">
          <div className="rep__vida"><div style={{ width: `${(estado.p2BaseHp / INITIAL_BASE_HP) * 100}%` }} /></div>
          <span>🌳 {suNombre ?? 'Jugador 2'} ({Math.round(estado.p2BaseHp)})</span>
        </div>

        {/* Las plantas de los dos lados. Es el mismo dato y el mismo sprite: lo
            único que cambia es el espejado, igual que en la partida. */}
        {estado.plants.map((p) => (
          <img
            key={p.id}
            className="rep__planta"
            src={p.spriteOverride ?? PLANT_CONFIGS[p.plantId]?.sprite}
            alt=""
            style={{
              left: `${p.x}%`,
              top: `${LANES_CONFIG[p.lane].topPct + LANES_CONFIG[p.lane].heightPct / 2}%`,
            }}
          />
        ))}
        {estado.enemyPlants.map((p) => (
          <img
            key={p.id}
            className="rep__planta rep__planta--rival"
            src={p.spriteOverride ?? PLANT_CONFIGS[p.plantId]?.sprite}
            alt=""
            style={{
              left: `${p.x}%`,
              top: `${LANES_CONFIG[p.lane].topPct + LANES_CONFIG[p.lane].heightPct / 2}%`,
            }}
          />
        ))}
        {estado.projectiles.map((pr) => (
          <div key={pr.id} className="rep__proyectil" style={{ left: `${pr.x}%`, top: `${pr.y}%` }} />
        ))}
      </div>

      {/* ── Los mandos ─────────────────────────────────────────────────────── */}
      <div className="rep__mandos">
        <button type="button" className="rep__boton" onClick={onVolver}>← Volver</button>

        <button
          type="button"
          className="rep__boton rep__boton--principal"
          onClick={() => {
            // Si ya terminó, volver a pulsar reinicia: es lo que se espera de un
            // botón de reproducir al final de un vídeo.
            if (estado.status !== 'playing' || estado.tick > rep.ultimoTic + 299) {
              rep.irAlTic(0)
            }
            setReproduciendo((r) => !r)
          }}
        >
          {reproduciendo ? '❚❚ Pausa' : '▶ Reproducir'}
        </button>

        <input
          className="rep__barra"
          type="range"
          min={0}
          max={rep.ultimoTic + 300}
          value={estado.tick}
          onChange={(e) => {
            setReproduciendo(false)
            rep.irAlTic(Number(e.target.value))
            setPintar((n) => n + 1)
          }}
          aria-label="Momento de la partida"
        />

        <span className="rep__tiempo">{segundo}s / {total}s</span>

        <div className="rep__velocidades">
          {VELOCIDADES.map((v) => (
            <button
              key={v}
              type="button"
              className={`rep__vel ${velocidad === v ? 'rep__vel--activa' : ''}`}
              onClick={() => setVelocidad(v)}
            >
              {v}×
            </button>
          ))}
        </div>

        {/* Cambiar de lado es lo que hace útil una repetición para aprender: ver
            tu propia partida desde el sitio del rival. */}
        <button
          type="button"
          className="rep__boton"
          onClick={() => setDesde((d) => (d === 1 ? 2 : 1))}
        >
          ⇄ Ver desde {desde === 1 ? datos.jugador2.nombre ?? 'el rival' : datos.jugador1.nombre ?? 'el otro'}
        </button>
      </div>
    </div>
  )
}
