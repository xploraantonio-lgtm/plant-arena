import { useEffect, useRef } from 'react'
import type { EstadoCola, ModoPartida } from '../../hooks/useMatchmaking'
import './MatchmakingScreen.css'

/**
 * LA PANTALLA DE BUSCAR RIVAL
 *
 * Muestra el estado de la búsqueda en curso gestionada por useMatchmaking.
 *
 * En Ranked: busca rival humano y, tras 60 s sin encontrarlo, el servidor
 * genera automáticamente una sala contra un Rival Semilla.
 *
 * En Coliseo: enseña la cuenta atrás real hasta la devolución automática.
 */

interface Props {
  modo: ModoPartida
  estado: EstadoCola
  /** En coliseo, lo que se cobró, para poder decirlo por su nombre. */
  apuesta?: { gemas: number; conTicket: boolean } | null
  onCancelar: () => void
}

const TITULOS: Record<ModoPartida, string> = {
  ranked:     'Buscando rival',
  friendly:   'Buscando partida amistosa',
  colosseum:  'Buscando rival en el Coliseo',
  tournament: 'Buscando rival del torneo',
}

const SUBTITULOS: Record<ModoPartida, string> = {
  ranked:     'En juego: puntos de arena y un cofre si ganas.',
  friendly:   'Sin puntos ni recompensas. Sólo por jugar.',
  colosseum:  'Sólo contra jugadores reales.',
  tournament: 'Emparejando dentro de tu torneo.',
}

function reloj(segundos: number): string {
  const m = Math.floor(segundos / 60)
  const s = segundos % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function MatchmakingScreen({
  modo,
  estado,
  apuesta,
  onCancelar,
}: Props) {
  const cancelarRef = useRef(onCancelar)
  cancelarRef.current = onCancelar
  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelarRef.current()
    }
    window.addEventListener('keydown', alPulsar)
    return () => window.removeEventListener('keydown', alPulsar)
  }, [])

  const esColiseo = modo === 'colosseum'
  const quedan =
    esColiseo && estado.plazoSegundos !== null
      ? Math.max(0, estado.plazoSegundos - estado.segundos)
      : null

  const consumido =
    esColiseo && estado.plazoSegundos
      ? Math.min(100, (estado.segundos / estado.plazoSegundos) * 100)
      : null

  return (
    <div className="mm">
      <div className="mm__panel" role="status" aria-live="polite">
        <div className="mm__latido" aria-hidden="true">
          <span className="mm__hoja">🌿</span>
        </div>

        <h1 className="mm__titulo">{TITULOS[modo]}</h1>
        <p className="mm__subtitulo">{SUBTITULOS[modo]}</p>

        <div className="mm__tiempo">
          <span className="mm__tiempo-num">{reloj(estado.segundos)}</span>
          <span className="mm__tiempo-eti">esperando</span>
        </div>

        {esColiseo && apuesta && (
          <p className="mm__apuesta">
            {apuesta.conTicket
              ? <>Entraste con <strong>1 ticket</strong> (apuesta de {apuesta.gemas} 💎)</>
              : <>Apuesta retenida: <strong>{apuesta.gemas} 💎</strong></>}
          </p>
        )}

        {quedan !== null && (
          <div className="mm__plazo">
            <div className="mm__barra">
              <div className="mm__barra-relleno" style={{ width: `${consumido}%` }} />
            </div>
            <p className="mm__plazo-texto">
              Si no aparece rival en <strong>{reloj(quedan)}</strong>, se te devuelve{' '}
              {apuesta?.conTicket ? 'el ticket' : 'la apuesta'} automáticamente.
            </p>
          </div>
        )}

        {estado.error && (
          <p className="mm__error" role="alert">
            {estado.error}
          </p>
        )}

        <button type="button" className="mm__boton" onClick={onCancelar}>
          {esColiseo
            ? (apuesta?.conTicket ? 'Cancelar y recuperar el ticket' : 'Cancelar y recuperar la apuesta')
            : 'Cancelar búsqueda'}
        </button>

        <p className="mm__pista">Pulsa Esc para cancelar</p>
      </div>
    </div>
  )
}
