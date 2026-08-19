// ─────────────────────────────────────────────────────────────────────────────
// NADIE COMPARA UN TIC CON UN RELOJ DE PARED
//
// Este fichero no prueba lógica: revisa el código fuente. Es raro, y hay un
// motivo concreto.
//
// Al pasar el motor a tics, los plazos del juego (enfriamientos, congelaciones,
// cadencias) dejaron de ser instantes de Date.now() y pasaron a ser el número de
// tic en que expiran. Pero la interfaz seguía comparándolos con Date.now(), y
// Date.now() son unos 1,7 billones mientras un tic son unos cuantos miles. La
// comparación no falla: sale siempre verdadera o siempre falsa. Silenciosamente.
//
// Costó dos regresiones que nadie vio hasta jugar:
//   · el velo de enfriamiento de las cartas no se pintaba NUNCA, así que el
//     jugador pulsaba una carta, no pasaba nada, y no había ninguna señal de por
//     qué;
//   · la congelación del Iceberg Lettuce tampoco se veía.
//
// Los tipos no lo pillan: los dos lados son `number`. Los tests de lógica
// tampoco, porque el motor por dentro estaba bien. Sólo se ve mirando quién
// compara qué, y eso es lo que hace esto.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Campos del estado del juego cuyo valor es un TIC. */
const CAMPOS_EN_TICS = [
  'frozenUntil',
  'cooldowns',
  'slotCooldowns',
  'lastActionTime',
  'lastAttackTime',
  'smashStartTime',
  'armedAtTime',
  'createdAt',
  'atTick',
  'readyAtTick',
]

function ficherosDeCodigo(dir: string, acc: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre)
    if (statSync(ruta).isDirectory()) {
      ficherosDeCodigo(ruta, acc)
    } else if (/\.(ts|tsx)$/.test(nombre) && !/\.test\.tsx?$/.test(nombre)) {
      acc.push(ruta)
    }
  }
  return acc
}

/**
 * Quita comentarios de línea y de bloque.
 *
 * Hace falta porque los sitios donde se arregló el fallo lo EXPLICAN en un
 * comentario, y mencionan tanto Date.now() como el campo. Sin esto, el test
 * saltaría precisamente en el código ya corregido.
 */
function sinComentarios(fuente: string): string {
  return fuente
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/([^:])\/\/.*$/gm, '$1')
}

describe('los plazos del juego se comparan en tics, no con el reloj', () => {
  const ficheros = ficherosDeCodigo('src')

  it('encuentra código que revisar', () => {
    expect(ficheros.length).toBeGreaterThan(20)
  })

  it('ninguna línea mezcla Date.now() con un campo medido en tics', () => {
    const culpables: string[] = []

    /**
     * Sólo los ficheros que manejan estado del motor.
     *
     * Hace falta acotar porque algunos nombres están sobrecargados: `createdAt` es
     * un tic en SunEntity, pero en los datos del clan es un instante de reloj de
     * verdad. Revisar todo el árbol daba dos falsos positivos ahí.
     *
     * El criterio es "¿este fichero recibe estado del motor?": si importa del
     * motor o usa useGameEngine, sus plazos son tics.
     */
    const conEstadoDelMotor = ficheros.filter((f) => {
      const codigo = readFileSync(f, 'utf8')
      return (
        f.includes('engine') ||
        codigo.includes('useGameEngine') ||
        /from ['"][^'"]*engine\//.test(codigo)
      )
    })
    expect(conEstadoDelMotor.length).toBeGreaterThan(3)

    for (const fichero of conEstadoDelMotor) {
      const lineas = sinComentarios(readFileSync(fichero, 'utf8')).split(/\r?\n/)
      lineas.forEach((linea, i) => {
        if (!linea.includes('Date.now()') && !linea.includes('performance.now()')) return
        for (const campo of CAMPOS_EN_TICS) {
          if (linea.includes(campo)) {
            culpables.push(`${fichero}:${i + 1}  ${linea.trim()}`)
            break
          }
        }
      })
    }

    // El mensaje importa: quien rompa esto tiene que entender POR QUÉ está mal,
    // porque el síntoma (una comparación que nunca cambia) no se parece a un
    // error.
    expect(
      culpables,
      culpables.length
        ? 'Un plazo del juego se está comparando con el reloj de pared. Los dos lados\n' +
          'son `number`, así que compila y no avisa, pero Date.now() son ~1,7 billones\n' +
          'y un tic son unos miles: la comparación sale siempre igual y el efecto no\n' +
          'ocurre nunca. Usa el tic de la partida (useGameEngine devuelve `tick`).\n\n' +
          culpables.join('\n')
        : ''
    ).toEqual([])
  })

  it('el motor no lee el reloj en absoluto', () => {
    // engine/ es la simulación pura: si aquí entra una lectura de reloj, se pierde
    // la reproducibilidad y con ella la verificación en servidor y las
    // repeticiones.
    const delMotor = ficheros.filter((f) => f.includes('engine'))
    expect(delMotor.length).toBeGreaterThan(2)

    const culpables: string[] = []
    for (const fichero of delMotor) {
      const codigo = sinComentarios(readFileSync(fichero, 'utf8'))
      for (const prohibido of ['Date.now(', 'performance.now(', 'Math.random(', 'setTimeout(', 'localStorage']) {
        if (codigo.includes(prohibido)) culpables.push(`${fichero}: ${prohibido})`)
      }
    }
    expect(culpables).toEqual([])
  })
})
