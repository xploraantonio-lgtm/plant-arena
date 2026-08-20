// ─────────────────────────────────────────────────────────────────────────────
// LOS ENLACES QUE SE REPARTEN LLEVAN EL DOMINIO DE VERDAD
//
// Esto se prueba porque el fallo es invisible: el enlace se copia, se manda por
// WhatsApp y funciona... para quien lo mandó. El que lo recibe acaba en la
// dirección de Vercel, o en el localhost de otro. Nadie se da cuenta hasta que
// alguien pregunta por qué el enlace no le lleva al juego.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * El módulo lee la variable de entorno AL CARGARSE, así que hay que recargarlo
 * después de cambiarla. Por eso la importación va dentro de cada test.
 */
async function cargar() {
  vi.resetModules()
  return await import('./direccionPublica')
}

beforeEach(() => vi.resetModules())
afterEach(() => vi.unstubAllEnvs())

describe('el enlace de invitación', () => {
  it('lleva el dominio configurado, no el que se esté navegando', async () => {
    vi.stubEnv('VITE_PUBLIC_URL', 'https://www.plants-arena.online')
    const { enlaceDeReferido } = await cargar()
    expect(enlaceDeReferido('7HGEKKM')).toBe(
      'https://www.plants-arena.online/?ref=7HGEKKM'
    )
  })

  it('no sale con doble barra si el dominio trae barra final', async () => {
    // Es el error de configuración más fácil de cometer, y produce enlaces
    // «https://dominio//?ref=...» que en algunos sitios ni se reconocen.
    vi.stubEnv('VITE_PUBLIC_URL', 'https://www.plants-arena.online/')
    const { enlaceDeReferido } = await cargar()
    expect(enlaceDeReferido('ABC2346')).toBe(
      'https://www.plants-arena.online/?ref=ABC2346'
    )
  })

  it('aguanta espacios de más alrededor', async () => {
    vi.stubEnv('VITE_PUBLIC_URL', '  https://www.plants-arena.online  ')
    const { enlaceDeReferido } = await cargar()
    expect(enlaceDeReferido('X')).toBe('https://www.plants-arena.online/?ref=X')
  })

  it('sin código no inventa nada', async () => {
    vi.stubEnv('VITE_PUBLIC_URL', 'https://www.plants-arena.online')
    const { enlaceDeReferido } = await cargar()
    expect(enlaceDeReferido(null)).toBe('https://www.plants-arena.online/?ref=')
  })
})

describe('el enlace de una repetición compartida', () => {
  it('usa el mismo dominio', async () => {
    vi.stubEnv('VITE_PUBLIC_URL', 'https://www.plants-arena.online')
    const { enlaceDeRepeticion } = await cargar()
    expect(enlaceDeRepeticion('deadbeef')).toBe(
      'https://www.plants-arena.online/r/deadbeef'
    )
  })
})

describe('sin la variable configurada', () => {
  it('no se rompe: se cae a la dirección actual', async () => {
    // En este entorno no hay navegador, así que la base queda vacía. Lo que se
    // comprueba es que NO lanza: un despliegue sin la variable tiene que seguir
    // funcionando, aunque reparta el dominio por el que se navegue (que es
    // exactamente lo que hacía antes).
    vi.stubEnv('VITE_PUBLIC_URL', '')
    const { enlaceDeReferido } = await cargar()
    expect(enlaceDeReferido('ABC')).toContain('/?ref=ABC')
  })
})
