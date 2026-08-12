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

export interface PlantEntity {
  id: string
  plantId: PlantId
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
