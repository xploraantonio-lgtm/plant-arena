export type PlantId =
  | 'sunflower'
  | 'peashooter'
  | 'repeater'
  | 'wallnut'
  | 'melonpult'
  | 'chomper'
  | 'bonkchoy'
  | 'garlic'
  | 'squash'
  | 'twinsunflower'
  | 'threepeater'
  | 'tallnut'
  | 'jalapeno'
  | 'iceberglettuce'
  | 'aloe'

export type PlantCategory = 'producer' | 'ranged' | 'defensive' | 'melee'

export interface PlantConfig {
  id: PlantId
  name: string
  cost: number
  cooldownMs: number
  maxHp: number
  category: PlantCategory
  icon: string
  packetActive: string
  packetDisabled: string
  sprite: string
  damage?: number
  attackSpeedMs?: number
  moveSpeed?: number // For walking melee plants (% field width per sec)
  description: string
}

/**
 * Las mejoras que un jugador ha tirado para una carta. Vive aquí y no en
 * gameConstants porque PlantEntity la necesita, y gameConstants ya importa de
 * este fichero: al revés habría un ciclo.
 */
export type PlantStatKey = 'hp' | 'damage' | 'attackSpeed' | 'moveSpeed' | 'cooldown'

export interface PlantEntity {
  id: string
  plantId: PlantId
  instanceId?: string
  level?: number
  /**
   * Las mejoras de esta planta, fijadas al plantarla.
   *
   * Antes el bucle las volvía a leer de localStorage en CADA tic y para CADA
   * planta. Eso las hacía depender del navegador y no de la partida: si el
   * jugador cambiaba de mazo a mitad de batalla, las plantas ya plantadas
   * cambiaban de estadísticas, y una repetición en servidor —que no tiene
   * localStorage— las habría calculado todas a cero.
   *
   * Al vivir en la entidad quedan congeladas desde que se planta, que es lo que
   * el jugador ve, y viajan con la partida cuando se serializa.
   */
  statRolls?: PlantStatKey[]
  damage?: number
  attackSpeedMs?: number
  moveSpeed?: number
  lane: number // 0, 1, 2
  col?: number // 0..3 for P1 static plants
  x: number // percentage across field (15% to 85%)
  hp: number
  maxHp: number
  lastActionTime: number
  isWalking: boolean
  state: 'idle' | 'walking' | 'attacking'
  isSmashing?: boolean
  smashStartTime?: number
  isArmed?: boolean
  armedAtTime?: number
  spriteOverride?: string
  frozenUntil?: number
  isHealingFx?: boolean
}

export type EnemyPlantType =
  | 'enemy_sunflower'
  | 'enemy_peashooter'
  | 'enemy_wallnut'
  | 'enemy_chomper'
  | 'enemy_melonpult'

export interface EnemyPlantConfig {
  type: EnemyPlantType
  name: string
  cost: number
  maxHp: number
  speed: number // % per second moving left
  damage: number // damage per second to plants/base
  sprite: string
  rewardSun: number
  category: 'producer' | 'ranged' | 'defensive' | 'melee'
}

export interface EnemyPlantEntity {
  id: string
  type: EnemyPlantType
  lane: number
  col?: number // 4..7 for static P2 plants
  x: number // percentage across field
  hp: number
  maxHp: number
  speed: number
  damage: number
  isWalking: boolean
  state: 'idle' | 'walking' | 'attacking'
  lastAttackTime: number
  frozenUntil?: number
}

export interface ProjectileEntity {
  id: string
  type: 'pea' | 'melon' | 'needle'
  targetTeam: 'p1' | 'p2'
  lane: number
  x: number // current % x position
  y: number // % y position of lane
  speed: number // % width per sec (positive moves right, negative moves left)
  damage: number
  isSplash?: boolean
}

export interface SunEntity {
  id: string
  x: number // percentage
  y: number // percentage
  targetY: number // percentage to fall to
  value: number
  createdAt: number
}

export type GameStatus = 'ready' | 'playing' | 'victory' | 'defeat' | 'paused'

export interface BaseTowerState {
  hp: number
  maxHp: number
}

export interface GameStats {
  sunsCollected: number
  enemyPlantsDefeated: number
  plantsPlaced: number
  score: number
}

export interface PlantCardInstance {
  instanceId: string
  plantId: PlantId
  level: number
  statRolls: import('../utils/gameConstants').PlantStatKey[]
  isBase?: boolean
  obtainedAt?: number
}

export type ColosseumBetAmount = 0.5 | 1.0 | 2.0

export interface ColosseumMatchConfig {
  betGems: ColosseumBetAmount
  usedTicket: boolean
  payoutGems: number
  rakeGems: number
}

export interface ColosseumLeaderboardEntry {
  rank: number
  username: string
  avatarPlant: PlantId
  maxStreak: number
  prizeGems: number
  isUser?: boolean
}


