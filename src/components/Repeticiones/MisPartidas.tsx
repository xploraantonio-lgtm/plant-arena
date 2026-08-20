import { useEffect, useState } from 'react'
import { SupabaseService } from '../../services/supabaseService'
import './MisPartidas.css'

/**
 * LA LISTA DE MIS PARTIDAS
 *
 * Cada fila es una partida que se puede volver a ver o compartir.
 *
 * Lo que se enseña está elegido para responder "¿cuál era ésta?" de un vistazo:
 * contra quién, si se ganó, cuándo y cuánto duró. Nada más — una lista con quince
 * columnas no se lee.
 */

interface Partida {
  roomId: string
  mode: string
  jugadaEn: string
  duracionSegundos: number
  rival: string | null
  rivalAvatar: string | null
  gane: boolean | null
  estado: string
  jugadas: number
  shareToken: string | null
}

interface Props {
  onVolver: () => void
  onVerRepeticion: (roomId: string) => void
}

const NOMBRE_DEL_MODO: Record<string, string> = {
  ranked: 'Clasificatoria',
  friendly: 'Amistosa',
  colosseum: 'Coliseo',
  tournament: 'Torneo',
}

function cuandoFue(iso: string): string {
  const cuando = new Date(iso)
  const minutos = Math.floor((Date.now() - cuando.getTime()) / 60000)
  if (minutos < 1) return 'ahora mismo'
  if (minutos < 60) return `hace ${minutos} min`
  const horas = Math.floor(minutos / 60)
  if (horas < 24) return `hace ${horas} h`
  const dias = Math.floor(horas / 24)
  if (dias === 1) return 'ayer'
  if (dias < 30) return `hace ${dias} días`
  return cuando.toLocaleDateString()
}

function duracion(segundos: number): string {
  if (segundos < 60) return `${segundos}s`
  return `${Math.floor(segundos / 60)}m ${segundos % 60}s`
}

export default function MisPartidas({ onVolver, onVerRepeticion }: Props) {
  const [partidas, setPartidas] = useState<Partida[] | null>(null)
  const [enlaceCopiado, setEnlaceCopiado] = useState<string | null>(null)
  const [compartiendo, setCompartiendo] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    void SupabaseService.myMatches(30).then((lista) => {
      if (!cancelado) setPartidas(lista)
    })
    return () => { cancelado = true }
  }, [])

  const enlaceDe = (token: string) => `${window.location.origin}/r/${token}`

  const compartir = async (p: Partida) => {
    setCompartiendo(p.roomId)
    const token = p.shareToken ?? (await SupabaseService.shareMatch(p.roomId)).token
    setCompartiendo(null)
    if (!token) return

    // Se guarda en la lista para no volver a pedirlo.
    setPartidas((antes) =>
      antes?.map((x) => (x.roomId === p.roomId ? { ...x, shareToken: token } : x)) ?? antes
    )

    // El portapapeles puede fallar (permisos, contexto no seguro). Si falla, el
    // enlace se queda visible debajo para copiarlo a mano: peor no poder copiarlo
    // que no poder verlo.
    try {
      await navigator.clipboard.writeText(enlaceDe(token))
      setEnlaceCopiado(p.roomId)
      setTimeout(() => setEnlaceCopiado(null), 2500)
    } catch {
      setEnlaceCopiado(null)
    }
  }

  const dejarDeCompartir = async (p: Partida) => {
    if (!(await SupabaseService.unshareMatch(p.roomId))) return
    setPartidas((antes) =>
      antes?.map((x) => (x.roomId === p.roomId ? { ...x, shareToken: null } : x)) ?? antes
    )
  }

  return (
    <div className="partidas">
      <div className="partidas__cabecera">
        <button type="button" className="partidas__volver" onClick={onVolver}>
          ← Volver
        </button>
        <h1 className="partidas__titulo">Mis partidas</h1>
      </div>

      {partidas === null && <p className="partidas__cargando">Cargando…</p>}

      {partidas !== null && partidas.length === 0 && (
        <div className="partidas__vacio">
          <p><strong>Todavía no hay partidas guardadas.</strong></p>
          <p>
            Se guardan las partidas contra otros jugadores. Las de entrenamiento
            contra la máquina no pasan por el servidor, así que no quedan
            registradas.
          </p>
        </div>
      )}

      {partidas?.map((p) => (
        <div
          key={p.roomId}
          className={`partida ${
            p.gane === true ? 'partida--ganada' : p.gane === false ? 'partida--perdida' : ''
          }`}
        >
          <div className="partida__datos">
            <div className="partida__linea1">
              <span className="partida__resultado">
                {p.gane === true ? 'VICTORIA' : p.gane === false ? 'DERROTA' : 'SIN RESULTADO'}
              </span>
              <span className="partida__rival">vs {p.rival ?? 'Rival'}</span>
            </div>
            <div className="partida__linea2">
              {NOMBRE_DEL_MODO[p.mode] ?? p.mode} · {duracion(p.duracionSegundos)} ·{' '}
              {cuandoFue(p.jugadaEn)}
            </div>
          </div>

          <div className="partida__acciones">
            {/* Sin jugadas registradas no hay nada que reproducir: son partidas
                anteriores a que existiera el registro de acciones. Mejor decirlo
                que ofrecer un botón que abre una pantalla vacía. */}
            {p.jugadas > 0 ? (
              <button
                type="button"
                className="partida__boton partida__boton--ver"
                onClick={() => onVerRepeticion(p.roomId)}
              >
                ▶ Ver
              </button>
            ) : (
              <span className="partida__sin-registro">sin registro</span>
            )}

            <button
              type="button"
              className="partida__boton"
              disabled={compartiendo === p.roomId || p.jugadas === 0}
              onClick={() => void compartir(p)}
            >
              {compartiendo === p.roomId
                ? '…'
                : enlaceCopiado === p.roomId
                ? '✓ Copiado'
                : p.shareToken
                ? '🔗 Enlace'
                : '🔗 Compartir'}
            </button>
          </div>

          {p.shareToken && (
            <div className="partida__enlace">
              <code>{enlaceDe(p.shareToken)}</code>
              <button
                type="button"
                className="partida__revocar"
                onClick={() => void dejarDeCompartir(p)}
              >
                Dejar de compartir
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
