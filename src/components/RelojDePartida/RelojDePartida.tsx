import { TICK_MS } from '../../engine/time'
import { TIC_MUERTE_SUBITA, TIC_TOPE_DE_PARTIDA } from '../../engine/simulate'
import './RelojDePartida.css'

/**
 * EL RELOJ DE LA PARTIDA
 *
 * Va arriba en el centro del campo y dice tres cosas: cuánto se lleva jugado,
 * cuánto falta para la muerte súbita y, cuando llega, que ha llegado.
 *
 * POR QUÉ HACE FALTA
 *   Sin esto, la partida no tenía final visible. Dos jugadores podían plantar
 *   girasoles sin atacarse nunca y la partida se quedaba abierta hasta que el
 *   servidor la daba por abandonada a los 120 segundos sin jugadas: nadie se
 *   rindió, nadie atacó, y en la lista de partidas salía "SIN RESULTADO".
 *
 *   Que el plazo exista no basta — hay que verlo. Un jugador que no sabe que a
 *   los 2:30 empiezan a caer las dos bases no puede decidir si le conviene
 *   atacar ya o seguir plantando, que es justo la decisión que la muerte súbita
 *   viene a forzar.
 *
 * El aviso empieza 30 segundos antes: tiempo para reaccionar, no para lamentarlo.
 */

const AVISO_TICS = Math.round(30_000 / TICK_MS)

function mmss(tick: number): string {
  const s = Math.floor((tick * TICK_MS) / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

interface Props {
  tick: number
  /** En práctica no hay partida que cerrar, así que no hay reloj. */
  practica?: boolean
  /**
   * Segundos que faltan para el tic 1, si la partida aún no ha empezado.
   *
   * La sala nace con la hora de arranque unos segundos en el futuro y los DOS
   * clientes reciben la misma: es lo que hace que empiecen a la vez en lugar de
   * que el tic 0 sea «cuando entró el más rápido en cargar». Sin enseñarlo, esos
   * segundos parecen un campo congelado.
   */
  arrancaEn?: number
}

export default function RelojDePartida({ tick, practica, arrancaEn = 0 }: Props) {
  if (practica) return null

  if (arrancaEn > 0) {
    return (
      <div className="reloj-partida reloj-partida--arranque">
        <span className="reloj-partida__titulo">EMPIEZA EN {arrancaEn}</span>
        <span className="reloj-partida__nota">los dos a la vez · prepara tu mazo</span>
      </div>
    )
  }

  const enMuerteSubita = tick >= TIC_MUERTE_SUBITA
  const faltan = Math.max(0, Math.ceil(((TIC_MUERTE_SUBITA - tick) * TICK_MS) / 1000))
  const avisando = !enMuerteSubita && tick >= TIC_MUERTE_SUBITA - AVISO_TICS

  return (
    <div
      className={`reloj-partida ${
        enMuerteSubita ? 'reloj-partida--subita' : avisando ? 'reloj-partida--aviso' : ''
      }`}
    >
      {enMuerteSubita ? (
        <>
          <span className="reloj-partida__titulo">☠ MUERTE SÚBITA</span>
          <span className="reloj-partida__nota">
            las dos bases pierden vida · gana quien aguante · {mmss(tick)}
          </span>
        </>
      ) : (
        <>
          <span className="reloj-partida__titulo">⏱ {mmss(tick)}</span>
          <span className="reloj-partida__nota">
            {avisando
              ? `muerte súbita en ${faltan} s`
              : `muerte súbita a los ${mmss(TIC_MUERTE_SUBITA)}`}
          </span>
        </>
      )}
      {/* La barra hasta la muerte súbita, y luego hasta el tope. Se ve de un
          vistazo cuánto queda sin tener que leer los números. */}
      <div className="reloj-partida__barra">
        <div
          style={{
            width: `${Math.min(
              100,
              enMuerteSubita
                ? ((tick - TIC_MUERTE_SUBITA) / (TIC_TOPE_DE_PARTIDA - TIC_MUERTE_SUBITA)) * 100
                : (tick / TIC_MUERTE_SUBITA) * 100
            )}%`,
          }}
        />
      </div>
    </div>
  )
}
