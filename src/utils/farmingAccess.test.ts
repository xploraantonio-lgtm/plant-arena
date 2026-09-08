import { describe, it, expect } from 'vitest'
import { isXploraUsername, isXploraEmail } from './farmingAccess'

describe('farmingAccess - isXploraUsername', () => {
  it('identifica al usuario Xplora con diferentes mayúsculas/minúsculas y espacios', () => {
    expect(isXploraUsername('Xplora')).toBe(true)
    expect(isXploraUsername('xplora')).toBe(true)
    expect(isXploraUsername('XPLORA')).toBe(true)
    expect(isXploraUsername('  Xplora  ')).toBe(true)
  })

  it('rechaza a cualquier otro usuario', () => {
    expect(isXploraUsername('Guerrero')).toBe(false)
    expect(isXploraUsername('Novato')).toBe(false)
    expect(isXploraUsername('Leonel')).toBe(false)
    expect(isXploraUsername('xplorador')).toBe(false)
    expect(isXploraUsername('')).toBe(false)
    expect(isXploraUsername(null)).toBe(false)
    expect(isXploraUsername(undefined)).toBe(false)
  })
})

describe('farmingAccess - isXploraEmail', () => {
  it('reconoce el correo autorizado del desarrollador', () => {
    expect(isXploraEmail('xploraantonio@gmail.com')).toBe(true)
    expect(isXploraEmail('  xploraantonio@gmail.com  ')).toBe(true)
    expect(isXploraEmail('XPLORAANTONIO@GMAIL.COM')).toBe(true)
    expect(isXploraEmail('xplora@otherdomain.com')).toBe(true)
  })

  it('rechaza otros correos', () => {
    expect(isXploraEmail('jugador@gmail.com')).toBe(false)
    expect(isXploraEmail('antonio@gmail.com')).toBe(false)
    expect(isXploraEmail('')).toBe(false)
    expect(isXploraEmail(null)).toBe(false)
    expect(isXploraEmail(undefined)).toBe(false)
  })
})
