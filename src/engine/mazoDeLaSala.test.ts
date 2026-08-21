// ─────────────────────────────────────────────────────────────────────────────
// LAS DOS PANTALLAS TIENEN QUE DEDUCIR LAS MISMAS MEJORAS
//
// Si una planta tiene 345 de vida en una pantalla y 300 en la otra, las dos
// partidas ya no son la misma y al final cada uno reporta un ganador distinto. Y
// eso pasaba con cualquier carta mejorada, sin necesidad de que se perdiera nada
// por la red.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest'
import { leerMazo, mejorasDeLaCarta } from './mazoDeLaSala'
import { reconstruirHasta, type AccionRegistrada } from './reconstruir'
import { huellaDeLaPartida } from './huella'
import type { PlantId } from '../types/game'

/** Un mazo como el que devuelve game_room_info. */
const MAZO_BRUTO = [
  { instanceId: 'a', plantId: 'peashooter', slot: 0, rarity: 'common', level: 2, statRolls: ['hp', 'damage'], isBase: true },
  { instanceId: 'b', plantId: 'sunflower', slot: 1, rarity: 'common', level: 0, statRolls: [], isBase: true },
  { instanceId: 'c', plantId: 'wallnut', slot: 2, rarity: 'rare', level: 1, statRolls: ['hp'], isBase: false },
]

describe('leer el mazo de la sala', () => {
  it('saca la carta, el nivel y las mejoras', () => {
    const mazo = leerMazo(MAZO_BRUTO)
    expect(mazo).toHaveLength(3)
    expect(mejorasDeLaCarta(mazo, 'peashooter' as PlantId)).toEqual({
      statRolls: ['hp', 'damage'],
      level: 2,
    })
    expect(mejorasDeLaCarta(mazo, 'sunflower' as PlantId)).toEqual({ statRolls: [], level: 0 })
  })

  it('sin mazo no se inventa nada: ninguna mejora', () => {
    // Y esto importa: «no sé» tiene que dar lo MISMO que le sale al rival, no un
    // valor a medias. Coincidir vale más que acertar.
    expect(mejorasDeLaCarta(null, 'peashooter' as PlantId)).toEqual({ statRolls: [], level: 0 })
    expect(leerMazo(undefined)).toBeNull()
    expect(leerMazo('vaya')).toBeNull()
  })

  it('aguanta un mazo con basura dentro', () => {
    // Llega por JSON desde la base: puede venir con nulos o con campos que faltan,
    // y eso no puede tirar la partida.
    const mazo = leerMazo([null, { sinPlantId: 1 }, { plantId: 'aloe' }, 7])
    expect(mazo).toEqual([{ plantId: 'aloe', slot: null, level: null, statRolls: null }])
    expect(mejorasDeLaCarta(mazo, 'aloe' as PlantId)).toEqual({ statRolls: [], level: 0 })
  })

  it('una carta repetida da siempre la primera, en las dos pantallas', () => {
    // La jugada sólo dice qué carta se plantó, no de qué hueco salió. Si cada
    // pantalla eligiera una copia distinta, volvería la divergencia. La regla es
    // «la primera del mazo» porque las dos la calculan igual.
    const mazo = leerMazo([
      { plantId: 'peashooter', slot: 0, level: 0, statRolls: [] },
      { plantId: 'peashooter', slot: 1, level: 3, statRolls: ['hp', 'hp', 'damage'] },
    ])
    expect(mejorasDeLaCarta(mazo, 'peashooter' as PlantId)).toEqual({ statRolls: [], level: 0 })
  })

  it('si el nivel y las mejoras no cuadran, mandan las mejoras', () => {
    // Son las mejoras las que deciden las estadísticas, así que el nivel se ajusta
    // a ellas y no al revés. Un nivel inflado no puede dar una planta más fuerte.
    const mazo = leerMazo([{ plantId: 'wallnut', slot: 0, level: 9, statRolls: ['hp'] }])
    expect(mejorasDeLaCarta(mazo, 'wallnut' as PlantId)).toEqual({ statRolls: ['hp'], level: 1 })
  })
})

describe('con el mazo de la sala, las dos pantallas ven la misma planta', () => {
  const jugada = (mejoras: ReturnType<typeof mejorasDeLaCarta>): AccionRegistrada[] => [
    {
      id: 1, mia: true, tick: 100, kind: 'plant',
      plantId: 'peashooter' as PlantId, lane: 1, col: 2,
      statRolls: mejoras.statRolls, level: mejoras.level,
    },
  ]

  it('quien planta y quien lo recibe deducen lo mismo del mismo mazo', () => {
    const mazo = leerMazo(MAZO_BRUTO)

    // Las dos pantallas leen el MISMO mazo de la sala, así que las dos llegan a las
    // mismas mejoras y simulan la misma planta.
    const laMia = reconstruirHasta(1, jugada(mejorasDeLaCarta(mazo, 'peashooter' as PlantId)), 200)
    const laSuya = reconstruirHasta(1, jugada(mejorasDeLaCarta(mazo, 'peashooter' as PlantId)), 200)

    expect(huellaDeLaPartida(laSuya, true)).toBe(huellaDeLaPartida(laMia, true))
    // Y con las mejoras puestas: 300 de base más un 15% por la mejora de vida.
    expect(laMia.plants[0].maxHp).toBe(345)
  })

  it('y si una pantalla se quedara sin mazo, se vería: no se tapa', () => {
    // Este test existe para que quede constancia de que la simetría depende de que
    // las DOS tengan el mazo. Si un día una lo perdiera, la divergencia volvería —
    // y por eso el mazo se lee de la sala y no de cada navegador.
    const conMazo = reconstruirHasta(
      1, jugada(mejorasDeLaCarta(leerMazo(MAZO_BRUTO), 'peashooter' as PlantId)), 200
    )
    const sinMazo = reconstruirHasta(1, jugada(mejorasDeLaCarta(null, 'peashooter' as PlantId)), 200)

    expect(huellaDeLaPartida(sinMazo, true)).not.toBe(huellaDeLaPartida(conMazo, true))
  })
})
