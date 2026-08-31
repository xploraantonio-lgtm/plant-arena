import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { SECRET_CODE_LENGTH } from '../components/Lottery/LotteryModal'

/**
 * Emulación exacta de la lógica PL/pgSQL de `_score_secret_guess` en TypeScript
 * para validar matemáticamente todos los escenarios de puntuación Mastermind.
 */
function scoreSecretGuess(secret: string[], guess: string[]) {
  const v_len = secret.length
  let exact = 0
  let wrong = 0
  const v_sec = [...secret] as (string | null)[]
  const v_gue = [...guess] as (string | null)[]

  // Paso 1: Exactos
  for (let i = 0; i < v_len; i++) {
    if (v_gue[i] !== null && v_sec[i] !== null && v_gue[i] === v_sec[i]) {
      exact++
      v_sec[i] = null
      v_gue[i] = null
    }
  }

  // Paso 2: Mal ubicados
  for (let i = 0; i < v_len; i++) {
    if (v_gue[i] === null) continue
    for (let j = 0; j < v_len; j++) {
      if (v_sec[j] !== null && v_sec[j] === v_gue[i]) {
        wrong++
        v_sec[j] = null
        v_gue[i] = null
        break
      }
    }
  }

  const score = exact * 2 + wrong
  const maxScore = v_len * 2
  const pct = Number(((score / maxScore) * 100).toFixed(2))

  return {
    exactCount: exact,
    wrongPosCount: wrong,
    pct,
    solved: pct >= 100,
  }
}

/**
 * Emulación de validación de entrada de `guess_secret_code`.
 */
function validateGuessInput(
  sequence: (string | null)[] | null | undefined,
  requiredLength: number,
  catalog: Set<string>
) {
  if (!sequence || sequence.length !== requiredLength) {
    return { ok: false, error: `La secuencia debe tener exactamente ${requiredLength} plantas` }
  }
  if (sequence.some((s) => s === null || s === undefined || s === '')) {
    return { ok: false, error: 'La secuencia no puede tener huecos vacíos' }
  }
  const invalidCount = sequence.filter((s) => !catalog.has(s as string)).length
  if (invalidCount > 0) {
    return { ok: false, error: `La secuencia contiene ${invalidCount} planta(s) que no existen` }
  }
  return { ok: true }
}

describe('Secret Code Lottery V2 — 5 Plantas (Pruebas Unitarias y de Seguridad)', () => {
  const CATALOG = new Set([
    'sunflower',
    'peashooter',
    'repeater',
    'wallnut',
    'melonpult',
    'chomper',
    'bonkchoy',
    'garlic',
    'squash',
    'twinsunflower',
    'threepeater',
    'tallnut',
    'jalapeno',
    'iceberglettuce',
    'aloe',
  ])

  it('0. Constante del frontend SECRET_CODE_LENGTH es igual a 5', () => {
    expect(SECRET_CODE_LENGTH).toBe(5)
  })

  it('1. Caso Correcto: 5 plantas idénticas en orden exacto -> exact=5, pct=100, solved=true', () => {
    const secret = ['sunflower', 'peashooter', 'wallnut', 'chomper', 'melonpult']
    const guess = ['sunflower', 'peashooter', 'wallnut', 'chomper', 'melonpult']

    const res = scoreSecretGuess(secret, guess)
    expect(res.exactCount).toBe(5)
    expect(res.wrongPosCount).toBe(0)
    expect(res.pct).toBe(100)
    expect(res.solved).toBe(true)
  })

  it('2. Caso Desorden Total: 5 plantas correctas pero todas en orden cambiado -> exact=0, wrong=5, pct=50, solved=false', () => {
    const secret = ['sunflower', 'peashooter', 'wallnut', 'chomper', 'melonpult']
    // Desplazamiento circular (ninguna coincide en su posición original)
    const guess = ['peashooter', 'wallnut', 'chomper', 'melonpult', 'sunflower']

    const res = scoreSecretGuess(secret, guess)
    expect(res.exactCount).toBe(0)
    expect(res.wrongPosCount).toBe(5)
    expect(res.pct).toBe(50)
    expect(res.solved).toBe(false)
  })

  it('3. Caso Parcial: 2 exactas + 2 mal ubicadas + 1 ausente -> exact=2, wrong=2, pct=60', () => {
    const secret = ['sunflower', 'peashooter', 'wallnut', 'chomper', 'melonpult']
    // Exactas: sunflower (0), peashooter (1)
    // Mal ubicadas: chomper en (2), wallnut en (3)
    // Ausente: jalapeno en (4)
    const guess = ['sunflower', 'peashooter', 'chomper', 'wallnut', 'jalapeno']

    const res = scoreSecretGuess(secret, guess)
    expect(res.exactCount).toBe(2)
    expect(res.wrongPosCount).toBe(2)
    expect(res.pct).toBe(60) // (2*2 + 2) / 10 * 100 = 60%
    expect(res.solved).toBe(false)
  })

  it('4. Caso Menos Plantas: Enviar 4 plantas cuando la ronda requiere 5 -> Rechazo', () => {
    const guess = ['sunflower', 'peashooter', 'wallnut', 'chomper']
    const validation = validateGuessInput(guess, 5, CATALOG)

    expect(validation.ok).toBe(false)
    expect(validation.error).toBe('La secuencia debe tener exactamente 5 plantas')
  })

  it('5. Caso Más Plantas: Enviar 6 plantas -> Rechazo', () => {
    const guess = ['sunflower', 'peashooter', 'wallnut', 'chomper', 'melonpult', 'aloe']
    const validation = validateGuessInput(guess, 5, CATALOG)

    expect(validation.ok).toBe(false)
    expect(validation.error).toBe('La secuencia debe tener exactamente 5 plantas')
  })

  it('6. Caso Manipulación con Huecos Vacíos o Nulos -> Rechazo', () => {
    const guess = ['sunflower', null, 'wallnut', 'chomper', 'melonpult']
    const validation = validateGuessInput(guess, 5, CATALOG)

    expect(validation.ok).toBe(false)
    expect(validation.error).toBe('La secuencia no puede tener huecos vacíos')
  })

  it('7. Caso Manipulación con Plantas Inexistentes -> Rechazo', () => {
    const guess = ['sunflower', 'planta_hacker_99', 'wallnut', 'chomper', 'melonpult']
    const validation = validateGuessInput(guess, 5, CATALOG)

    expect(validation.ok).toBe(false)
    expect(validation.error).toContain('planta(s) que no existen')
  })

  it('8. Compatibilidad v1 (4 plantas) vs v2 (5 plantas) en el algoritmo de scoring', () => {
    // Ronda v1 (4 plantas)
    const secretV1 = ['sunflower', 'peashooter', 'wallnut', 'chomper']
    const guessV1 = ['sunflower', 'peashooter', 'chomper', 'wallnut'] // 2 exactos + 2 mal = 6/8 = 75%
    const resV1 = scoreSecretGuess(secretV1, guessV1)
    expect(resV1.pct).toBe(75)

    // Ronda v2 (5 plantas)
    const secretV2 = ['sunflower', 'peashooter', 'wallnut', 'chomper', 'melonpult']
    const guessV2 = ['sunflower', 'peashooter', 'chomper', 'wallnut', 'melonpult'] // 3 exactos + 2 mal = 8/10 = 80%
    const resV2 = scoreSecretGuess(secretV2, guessV2)
    expect(resV2.pct).toBe(80)
  })

  describe('Auditoría estática de 52-secret-code-v2-5-plants.sql', () => {
    const sqlPath = path.resolve(__dirname, '../../supabase/52-secret-code-v2-5-plants.sql')
    const sqlContent = fs.readFileSync(sqlPath, 'utf-8')

    it('A. Añade columna code_version y actualiza constraints para soportar 4 y 5 plantas', () => {
      expect(sqlContent).toContain('code_version INTEGER NOT NULL DEFAULT 2')
      expect(sqlContent).toContain('CHECK (array_length(secret, 1) IN (4, 5))')
      expect(sqlContent).toContain('CHECK (array_length(sequence, 1) IN (4, 5))')
      expect(sqlContent).toContain('CHECK (exact_count BETWEEN 0 AND 5)')
    })

    it('B. _score_secret_guess adapta la longitud dinámica v_len y denominador (v_len * 2)', () => {
      expect(sqlContent).toContain('array_length(p_secret, 1)')
      expect(sqlContent).toContain('(v_len * 2)::NUMERIC')
    })

    it('C. guess_secret_code valida contra la longitud de la ronda activa y cierra al 100%', () => {
      expect(sqlContent).toContain('v_req_len := COALESCE(array_length(v_round.secret, 1), 5)')
      expect(sqlContent).toContain('array_length(p_sequence, 1) <> v_req_len')
      expect(sqlContent).toContain("status = 'finished'")
    })

    it('D. admin_open_secret_code_round genera 5 plantas por defecto y bote de 10 gemas', () => {
      expect(sqlContent).toContain('p_prize_pool    NUMERIC DEFAULT 10')
      expect(sqlContent).toContain('p_prize_1st     NUMERIC DEFAULT 10')
      expect(sqlContent).toContain('v_count := CASE WHEN v_version = 1 THEN 4 ELSE 5 END')
    })
  })
})
