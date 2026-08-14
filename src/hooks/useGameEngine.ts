import { useState, useEffect, useRef, useCallback } from 'react'
import type {
  PlantEntity,
  EnemyPlantEntity,
  ProjectileEntity,
  SunEntity,
  GameStatus,
  GameStats,
  PlantId,
  EnemyPlantType,
} from '../types/game'
import {
  PLANT_CONFIGS,
  ENEMY_PLANT_CONFIGS,
  INITIAL_SUN,
  INITIAL_BASE_HP,
  SUN_VALUE,
  BASE_LEFT_END_X,
  BASE_RIGHT_START_X,
  FIELD_WIDTH_PCT,
  TOTAL_COLUMNS,
} from '../utils/gameConstants'
import { soundManager } from '../utils/audioManager'

const createInitialCooldowns = (): Record<PlantId, number> =>
  (Object.keys(PLANT_CONFIGS) as PlantId[]).reduce(
    (acc, id) => ({ ...acc, [id]: 0 }),
    {} as Record<PlantId, number>
  )

interface GameState {
  status: GameStatus
  p1BaseHp: number
  p2BaseHp: number
  sunBank: number
  p2SunBank: number
  plants: PlantEntity[]
  enemyPlants: EnemyPlantEntity[]
  projectiles: ProjectileEntity[]
  suns: SunEntity[]
  selectedCard: PlantId | 'shovel' | null
  cooldowns: Record<PlantId, number>
  wave: number
  waveBanner: string | null
  stats: GameStats
  isPracticeMode?: boolean
}

export function useGameEngine() {
  const [isMuted, setIsMuted] = useState<boolean>(soundManager.isMuted())
  const [, setRenderTick] = useState<number>(0)

  // Single mutable reference holding all game state
  const stateRef = useRef<GameState>({
    status: 'ready',
    p1BaseHp: INITIAL_BASE_HP,
    p2BaseHp: INITIAL_BASE_HP,
    sunBank: INITIAL_SUN,
    p2SunBank: INITIAL_SUN,
    plants: [],
    enemyPlants: [],
    projectiles: [],
    suns: [],
    selectedCard: null,
    cooldowns: createInitialCooldowns(),
    wave: 1,
    waveBanner: null,
    stats: {
      sunsCollected: 0,
      enemyPlantsDefeated: 0,
      plantsPlaced: 0,
      score: 0,
    },
  })

  // Timer refs
  const lastTickRef = useRef<number>(performance.now())
  const lastSkySunRef = useRef<number>(performance.now())
  const lastP1PassiveSunRef = useRef<number>(performance.now())
  const lastP2PassiveSunRef = useRef<number>(performance.now())
  const lastEnemySpawnRef = useRef<number>(performance.now())
  const waveTimerRef = useRef<number>(performance.now())

  // Force a single React re-render per frame
  const forceRender = useCallback(() => {
    setRenderTick((t) => (t + 1) % 100000)
  }, [])

  // Audio mute subscription
  useEffect(() => {
    const unsubscribe = soundManager.subscribe((muted) => setIsMuted(muted))
    return () => unsubscribe()
  }, [])

  const toggleMute = useCallback(() => {
    soundManager.toggleMute()
  }, [])

  // Select card handler
  const setSelectedCard = useCallback(
    (card: PlantId | 'shovel' | null) => {
      stateRef.current.selectedCard = card
      forceRender()
    },
    [forceRender]
  )

  // Start game
  const startGame = useCallback(() => {
    const now = performance.now()
    stateRef.current = {
      status: 'playing',
      p1BaseHp: INITIAL_BASE_HP,
      p2BaseHp: INITIAL_BASE_HP,
      sunBank: INITIAL_SUN,
      p2SunBank: INITIAL_SUN, // 100% Paridad Justa: Ambos jugadores inician con 150 soles
      plants: [],
      enemyPlants: [],
      projectiles: [],
      suns: [],
      selectedCard: null,
      cooldowns: createInitialCooldowns(),
      wave: 1,
      waveBanner: '¡Ola 1 de Plantas Enemigas!',
      stats: {
        sunsCollected: 0,
        enemyPlantsDefeated: 0,
        plantsPlaced: 0,
        score: 0,
      },
    }

    lastTickRef.current = now
    lastSkySunRef.current = now - 3500 // El primer sol del cielo cae a los 2.5s para la carrera del más rápido
    lastP1PassiveSunRef.current = now
    lastP2PassiveSunRef.current = now - 3500
    lastEnemySpawnRef.current = now - 1000
    waveTimerRef.current = now

    soundManager.playBgm('battle')
    forceRender()

    setTimeout(() => {
      stateRef.current.waveBanner = null
      forceRender()
    }, 3000)
  }, [forceRender])

  // Start practice / sandbox mode
  const startPracticeGame = useCallback((plantId?: string) => {
    const now = performance.now()
    const colWidth = FIELD_WIDTH_PCT / TOTAL_COLUMNS

    // Create 3 static target dummies in cols 7, 8, 9 across the 3 lanes
    const dummies: EnemyPlantEntity[] = [0, 1, 2].map((lane) => {
      const targetCol = 8
      const cellCenterX = BASE_LEFT_END_X + targetCol * colWidth + colWidth / 2
      return {
        id: `dummy-${lane}-${now}`,
        type: 'enemy_wallnut',
        lane,
        col: targetCol,
        x: cellCenterX,
        hp: 850,
        maxHp: 850,
        speed: 0,
        damage: 0,
        isWalking: false,
        state: 'idle',
        lastAttackTime: Date.now(),
      }
    })

    const initialCard = (plantId && plantId in PLANT_CONFIGS) ? (plantId as PlantId) : null

    // Auto-spawn 1 instance of the requested plant in center lane (lane 1, col 1) to test action immediately
    const initialPlants: PlantEntity[] = []
    if (initialCard) {
      const config = PLANT_CONFIGS[initialCard]
      if (config) {
        const isWalkingUnit = config.category === 'melee' || !!config.moveSpeed || initialCard === 'chomper'
        const targetLane = 1
        const targetCol = 1
        const cellCenterX = BASE_LEFT_END_X + targetCol * colWidth + colWidth / 2

        initialPlants.push({
          id: `practice-auto-plant-${now}`,
          plantId: initialCard,
          lane: targetLane,
          col: targetCol,
          x: cellCenterX,
          hp: config.maxHp,
          maxHp: config.maxHp,
          lastActionTime: Date.now(),
          isWalking: isWalkingUnit,
          state: isWalkingUnit ? 'walking' : 'idle',
        })
      }
    }

    stateRef.current = {
      status: 'playing',
      isPracticeMode: true,
      p1BaseHp: INITIAL_BASE_HP,
      p2BaseHp: 99999,
      sunBank: 9999,
      p2SunBank: 0,
      plants: initialPlants,
      enemyPlants: dummies,
      projectiles: [],
      suns: [],
      selectedCard: initialCard,
      cooldowns: createInitialCooldowns(),
      wave: 1,
      waveBanner: `🎯 MODO PRUEBA: ${initialCard ? PLANT_CONFIGS[initialCard].name.toUpperCase() : 'SANDBOX'}`,
      stats: {
        sunsCollected: 0,
        enemyPlantsDefeated: 0,
        plantsPlaced: initialPlants.length,
        score: 0,
      },
    }

    lastTickRef.current = now
    lastSkySunRef.current = now
    lastP1PassiveSunRef.current = now
    lastP2PassiveSunRef.current = now
    lastEnemySpawnRef.current = now
    waveTimerRef.current = now

    soundManager.playBgm('battle')
    forceRender()

    setTimeout(() => {
      if (stateRef.current.isPracticeMode) {
        stateRef.current.waveBanner = null
        forceRender()
      }
    }, 4000)
  }, [forceRender])

  // Collect sun handler
  const collectSun = useCallback(
    (sunId: string) => {
      const state = stateRef.current
      state.suns = state.suns.filter((s) => s.id !== sunId)
      state.sunBank += SUN_VALUE
      state.stats.sunsCollected += 1
      state.stats.score += 50

      soundManager.playSound('points', 0.6)
      forceRender()
    },
    [forceRender]
  )

  // Place plant handler
  const placePlant = useCallback(
    (lane: number, col: number) => {
      const state = stateRef.current
      const card = state.selectedCard

      if (!card || card === 'shovel' || state.status !== 'playing') return

      const config = PLANT_CONFIGS[card]
      if (!config) return

      if (state.sunBank < config.cost) return
      if (!state.isPracticeMode && state.cooldowns[card] > Date.now()) return

      const colWidth = FIELD_WIDTH_PCT / TOTAL_COLUMNS
      const cellCenterX = BASE_LEFT_END_X + col * colWidth + colWidth / 2

      // Check cell occupancy for static plants
      const isWalkingUnit = config.category === 'melee' || !!config.moveSpeed || card === 'chomper'
      if (!isWalkingUnit) {
        const existing = state.plants.find((p) => p.lane === lane && p.col === col && !p.isWalking)
        if (existing) return
      }

      // Jalapeño Instant Lane-Clearing Explosion!
      if (card === 'jalapeno') {
        state.sunBank -= config.cost
        state.cooldowns[card] = Date.now() + config.cooldownMs
        state.stats.plantsPlaced += 1
        state.selectedCard = null

        soundManager.playSound('pea_hit', 1.0)

        // Inflict 1000 damage to ALL enemies in this lane
        const laneEnemies = state.enemyPlants.filter((e) => e.lane === lane && e.hp > 0)
        laneEnemies.forEach((e) => {
          e.hp -= 1000
          if (e.hp <= 0) {
            state.stats.enemyPlantsDefeated += 1
            state.stats.score += 100
          }
        })

        // Temporary full-lane flame visual explosion wave that disappears after 1200ms
        const tempFlame: PlantEntity = {
          id: `jalapeno-flame-${Date.now()}`,
          plantId: 'jalapeno',
          lane,
          col,
          x: 50, // Center of lane for full-width flame wave
          hp: 1,
          maxHp: 1,
          lastActionTime: Date.now(),
          isWalking: false,
          state: 'attacking',
          spriteOverride: '/game-assets/plants/jalapeno_flame_fx.png'
        }
        state.plants.push(tempFlame)
        setTimeout(() => {
          stateRef.current.plants = stateRef.current.plants.filter((p) => p.id !== tempFlame.id)
          forceRender()
        }, 1200)

        forceRender()
        return
      }

      const newPlant: PlantEntity = {
        id: `plant-${Date.now()}-${Math.random()}`,
        plantId: card,
        lane,
        col,
        x: cellCenterX,
        hp: config.maxHp,
        maxHp: config.maxHp,
        lastActionTime: Date.now(),
        isWalking: isWalkingUnit,
        state: isWalkingUnit ? 'walking' : 'idle',
      }

      state.plants.push(newPlant)
      state.sunBank -= config.cost
      state.cooldowns[card] = Date.now() + config.cooldownMs
      state.stats.plantsPlaced += 1
      state.selectedCard = null

      soundManager.playSound('plantation', 0.6)
      forceRender()
    },
    [forceRender]
  )

  // Dig plant handler
  const digPlant = useCallback(
    (plantId: string) => {
      const state = stateRef.current
      state.plants = state.plants.filter((p) => p.id !== plantId)
      state.selectedCard = null
      soundManager.playSound('plantation', 0.5)
      forceRender()
    },
    [forceRender]
  )

  // High performance game loop (60 FPS + Real-time background tab execution)
  useEffect(() => {
    let animationFrameId: number
    let bgIntervalId: ReturnType<typeof setInterval> | null = null

    const tickEngine = (now: number) => {
      const state = stateRef.current
      if (state.status !== 'playing') return

      let remainingDt = Math.min((now - lastTickRef.current) / 1000, 5.0)
      lastTickRef.current = now

      const stepDt = 0.033
      while (remainingDt > 0) {
        const dt = Math.min(remainingDt, stepDt)
        remainingDt -= dt

        // Practice Mode: Instant Sun & Cooldown reset
        if (state.isPracticeMode) {
          state.sunBank = 9999
          for (const k in state.cooldowns) {
            state.cooldowns[k as PlantId] = 0
          }
        }

        // 1. PC AI SKY SUN RECOVERY (Synchronized with sky sun drop every 6.0s for 100% fair parity)
        if (!state.isPracticeMode && now - lastP2PassiveSunRef.current > 6000) {
          lastP2PassiveSunRef.current = now
          state.p2SunBank += 25
        }

        // 2. PC AI TACTICAL PURCHASING & PLANT SPAWNING (SUNFLOWER-FIRST RULE + THREAT ASSESSMENT)
        const spawnInterval = Math.max(1200, 2200 - state.wave * 200)
        if (!state.isPracticeMode && now - lastEnemySpawnRef.current > spawnInterval) {
          lastEnemySpawnRef.current = now

          // Count active P2 Sunflowers
          const p2Sunflowers = state.enemyPlants.filter(
            (e) => e.type === 'enemy_sunflower' && e.hp > 0
          ).length

          // Assess lane threats (P1 player plants advancing towards P2 base)
          const laneThreats = [0, 1, 2].map((l) => {
            const P1Advancing = state.plants.filter((pl) => pl.lane === l && pl.hp > 0 && pl.x > 25)
            return { lane: l, count: P1Advancing.length, threat: P1Advancing.length > 0 }
          })
          const activeThreatLanes = laneThreats.filter((t) => t.threat).map((t) => t.lane)
          const isEmergency = state.plants.some((pl) => pl.hp > 0 && pl.x > 60)

          let chosenType: EnemyPlantType | null = null

          // REGLA 1: GIRASOLES PRIMERO PARA ESTABLECER ECONOMÍA DE SOLES (Si no hay emergencia)
          if (p2Sunflowers === 0 && !isEmergency) {
            if (state.p2SunBank >= ENEMY_PLANT_CONFIGS.enemy_sunflower.cost) {
              chosenType = 'enemy_sunflower'
            }
          } else if (
            p2Sunflowers === 1 &&
            !isEmergency &&
            Math.random() < 0.60 &&
            state.p2SunBank >= ENEMY_PLANT_CONFIGS.enemy_sunflower.cost
          ) {
            chosenType = 'enemy_sunflower'
          } else {
            // REGLA 2: FILTRAR ÚNICAMENTE PLANTAS QUE EL BOT REALMENTE PUEDA PAGAR AHORA MISMO
            const affordableTypes: EnemyPlantType[] = ([
              'enemy_wallnut',
              'enemy_peashooter',
              'enemy_chomper',
              'enemy_melonpult',
              'enemy_sunflower',
            ] as EnemyPlantType[]).filter((t) => ENEMY_PLANT_CONFIGS[t].cost <= state.p2SunBank)

            if (affordableTypes.length > 0) {
              if (activeThreatLanes.length > 0) {
                // MODO DEFENSA: Si el jugador está atacando, priorizar Tanque (Wallnut) o Atacante de carril
                const wallnutCost = ENEMY_PLANT_CONFIGS.enemy_wallnut.cost
                if (state.p2SunBank >= wallnutCost && Math.random() < 0.5) {
                  chosenType = 'enemy_wallnut'
                } else {
                  const combatTypes = affordableTypes.filter((t) => t !== 'enemy_sunflower')
                  if (combatTypes.length > 0) {
                    chosenType = combatTypes[Math.floor(Math.random() * combatTypes.length)]
                  } else {
                    chosenType = affordableTypes[Math.floor(Math.random() * affordableTypes.length)]
                  }
                }
              } else {
                // MODO ATAQUE: Lanzar unidades ofensivas contra el jugador
                const attackTypes = affordableTypes.filter(
                  (t) => t !== 'enemy_sunflower' && t !== 'enemy_wallnut'
                )
                if (attackTypes.length > 0) {
                  chosenType = attackTypes[Math.floor(Math.random() * attackTypes.length)]
                } else {
                  chosenType = affordableTypes[Math.floor(Math.random() * affordableTypes.length)]
                }
              }
            }
          }

          // GUARDIA ESTRICTO: VERIFICAR QUE EL BOT REALMENTE TIENE SOLES SUFICIENTES AHORA MISMO
          if (chosenType) {
            const eConfig = ENEMY_PLANT_CONFIGS[chosenType]

            if (state.p2SunBank < eConfig.cost) {
              // NO TIENE SOLES SUFICIENTES -> CANCELAR COLOCACIÓN
              chosenType = null
            } else {
              const isWalking = eConfig.category === 'melee'

              const lane =
                activeThreatLanes.length > 0 && Math.random() < 0.85
                  ? activeThreatLanes[Math.floor(Math.random() * activeThreatLanes.length)]
                  : Math.floor(Math.random() * 3)

              if (isWalking) {
                state.enemyPlants.push({
                  id: `enemy-${now}-${Math.random()}`,
                  type: chosenType,
                  lane,
                  x: BASE_RIGHT_START_X - 1,
                  hp: eConfig.maxHp,
                  maxHp: eConfig.maxHp,
                  speed: eConfig.speed,
                  damage: eConfig.damage,
                  isWalking: true,
                  state: 'walking',
                  lastAttackTime: Date.now(),
                })
                // DEDUCIR SOLES RIGUROSAMENTE
                state.p2SunBank = Math.max(0, state.p2SunBank - eConfig.cost)
              } else {
                const preferredCols =
                  chosenType === 'enemy_sunflower'
                    ? [11, 10, 9, 8]
                    : eConfig.category === 'defensive'
                    ? [6, 7, 8]
                    : [8, 9, 10, 11, 7, 6]

                const availableCols = preferredCols.filter((col) => {
                  return !state.enemyPlants.some(
                    (e) => e.lane === lane && e.col === col && !e.isWalking
                  )
                })

                if (availableCols.length > 0) {
                  const targetCol = availableCols[0]
                  const colWidth = FIELD_WIDTH_PCT / TOTAL_COLUMNS
                  const cellCenterX = BASE_LEFT_END_X + targetCol * colWidth + colWidth / 2

                  state.enemyPlants.push({
                    id: `enemy-${now}-${Math.random()}`,
                    type: chosenType,
                    lane,
                    col: targetCol,
                    x: cellCenterX,
                    hp: eConfig.maxHp,
                    maxHp: eConfig.maxHp,
                    speed: 0,
                    damage: eConfig.damage,
                    isWalking: false,
                    state: 'idle',
                    lastAttackTime: Date.now(),
                  })
                  // DEDUCIR SOLES RIGUROSAMENTE
                  state.p2SunBank = Math.max(0, state.p2SunBank - eConfig.cost)
                }
              }
            }
          }
        }

        // Wave progression timer (Every 25s)
        if (now - waveTimerRef.current > 25000) {
          waveTimerRef.current = now
          state.wave += 1
          if (state.wave % 3 === 0) {
            state.waveBanner = '¡Gran Ola de Plantas Enemigas!'
            soundManager.playSound('zombie_groan', 0.5)
          } else {
            state.waveBanner = `¡Ola ${state.wave} de Plantas Enemigas!`
          }
          setTimeout(() => {
            state.waveBanner = null
          }, 3000)
        }

        // 3. SKY SUN GENERATION (Every 6s)
        if (now - lastSkySunRef.current > 6000) {
          lastSkySunRef.current = now
          state.suns.push({
            id: `sun-sky-${now}`,
            x: BASE_LEFT_END_X + Math.random() * FIELD_WIDTH_PCT,
            y: -5,
            targetY: 25 + Math.random() * 50,
            value: SUN_VALUE,
            createdAt: Date.now(),
          })
        }

        // Update Suns (suns float to target position and STAY until clicked)
        state.suns = state.suns.map((s) => {
          if (s.y < s.targetY) {
            return { ...s, y: Math.min(s.targetY, s.y + 20 * dt) }
          }
          return s
        })

        // 4. UPDATE PLAYER 1 PLANTS
        const nextPlants: PlantEntity[] = []
        for (const plant of state.plants) {
          const config = PLANT_CONFIGS[plant.plantId]

          // Sunflower producing suns every 6s
          if (plant.plantId === 'sunflower' || plant.plantId === 'twinsunflower') {
            if (Date.now() - plant.lastActionTime > 6000) {
              plant.lastActionTime = Date.now()
              const count = plant.plantId === 'twinsunflower' ? 2 : 1
              for (let i = 0; i < count; i++) {
                state.suns.push({
                  id: `sun-flower-${Date.now()}-${Math.random()}`,
                  x: plant.x + (Math.random() * 6 - 3),
                  y: 20 + plant.lane * 20 + 5,
                  targetY: 20 + plant.lane * 20 + 10,
                  value: SUN_VALUE,
                  createdAt: Date.now(),
                })
              }
            }
          }

          // Potato Mine (squash ID) arming & detonation logic
          if (plant.plantId === 'squash') {
            const armTime = state.isPracticeMode ? 4000 : 12000
            const elapsed = Date.now() - plant.lastActionTime

            if (!plant.isArmed) {
              if (elapsed >= armTime) {
                plant.isArmed = true
                soundManager.playSound('pea_hit', 0.8)
              }
            } else {
              // Armed Potato Mine explodes when stepped on!
              const triggerEnemy = state.enemyPlants.find(
                (e) =>
                  e.lane === plant.lane &&
                  Math.abs(e.x - plant.x) <= 4.5 &&
                  e.hp > 0
              )

              if (triggerEnemy) {
                const enemiesInTile = state.enemyPlants.filter(
                  (e) =>
                    e.lane === plant.lane &&
                    Math.abs(e.x - plant.x) <= 5.5 &&
                    e.hp > 0
                )
                enemiesInTile.forEach((e) => {
                  e.hp -= config.damage || 1800
                })
                soundManager.playSound('pea_hit', 1.0)
                plant.hp = 0 // Detonate Potato Mine
              }
            }
          }

          // Iceberg Lettuce instant placement detonation: Asset 1 -> Asset 2 for 2s -> Asset 1 brief -> disappear & freeze ALL enemy units for 7s
          if (plant.plantId === 'iceberglettuce' && !plant.isArmed) {
            plant.isArmed = true // Mark as triggered immediately upon placement
            plant.spriteOverride = '/game-assets/plants/iceberglettuce_burst.png'
            soundManager.playSound('pea_hit', 1.0)

            // Freeze ALL opponent plants/enemies across ALL lanes for 7 seconds!
            const freezeUntilTime = Date.now() + 7000
            state.enemyPlants.forEach((e) => {
              e.frozenUntil = freezeUntilTime
            })

            // After 2 seconds, return briefly to Asset 1, then disappear!
            setTimeout(() => {
              if (stateRef.current.plants.some((p) => p.id === plant.id)) {
                plant.spriteOverride = '/game-assets/plants/iceberglettuce_hd.png'
                setTimeout(() => {
                  stateRef.current.plants = stateRef.current.plants.filter((p) => p.id !== plant.id)
                  forceRender()
                }, 300)
              }
            }, 2000)
          }

          // Aloe Healer (scans lane & heals closest wounded friendly plant with cloud FX)
          if (plant.plantId === 'aloe') {
            if (Date.now() - plant.lastActionTime > 2500) {
              plant.lastActionTime = Date.now()
              const woundedAlly = state.plants.find(
                (p) => p.id !== plant.id && p.lane === plant.lane && p.hp < p.maxHp && p.hp > 0
              )
              if (woundedAlly) {
                woundedAlly.hp = Math.min(woundedAlly.maxHp, woundedAlly.hp + 60)
                woundedAlly.isHealingFx = true
                soundManager.playSound('plantation', 0.6)

                const targetId = woundedAlly.id
                setTimeout(() => {
                  const ally = stateRef.current.plants.find((p) => p.id === targetId)
                  if (ally) ally.isHealingFx = false
                }, 1500)
              }
            }
          }

          // Ranged Attackers shoot continuously
          if (config.category === 'ranged') {
            if (Date.now() - plant.lastActionTime > (config.attackSpeedMs || 1200)) {
              plant.lastActionTime = Date.now()

              const projType =
                plant.plantId === 'melonpult'
                  ? 'melon'
                  : plant.plantId === 'chomper'
                  ? 'needle'
                  : 'pea'

              if (plant.plantId === 'threepeater') {
                const targetLanes = [plant.lane - 1, plant.lane, plant.lane + 1].filter(
                  (l) => l >= 0 && l <= 2
                )
                for (const l of targetLanes) {
                  state.projectiles.push({
                    id: `proj-p1-3p-${now}-${l}-${Math.random()}`,
                    type: 'pea',
                    targetTeam: 'p2',
                    lane: l,
                    x: plant.x + 2,
                    y: 20 + l * 19.33 + 7,
                    speed: 32,
                    damage: config.damage || 25,
                  })
                }
              } else {
                state.projectiles.push({
                  id: `proj-p1-${now}-${Math.random()}`,
                  type: projType,
                  targetTeam: 'p2',
                  lane: plant.lane,
                  x: plant.x + 2,
                  y: 20 + plant.lane * 19.33 + 7,
                  speed: projType === 'melon' ? 22 : projType === 'needle' ? 34 : 32,
                  damage: config.damage || 25,
                  isSplash: projType === 'melon',
                })
              }
              soundManager.playSound('pea_shoot', 0.4)

              if (plant.plantId === 'repeater') {
                setTimeout(() => {
                  stateRef.current.projectiles.push({
                    id: `proj-p1-rep-${Date.now()}-${Math.random()}`,
                    type: 'pea',
                    targetTeam: 'p2',
                    lane: plant.lane,
                    x: plant.x + 2,
                    y: 20 + plant.lane * 19.33 + 7,
                    speed: 32,
                    damage: config.damage || 25,
                  })
                }, 180)
              }
            }
          }

          // Walking P1 Plant (Cactus / Squash P1 moving RIGHT towards P2 base)
          if (plant.isWalking) {
            if (plant.plantId === 'garlic') {
              // Squash hopping & high-leap crushing smash logic!
              if (plant.isSmashing) {
                plant.state = 'attacking'
                const elapsed = Date.now() - (plant.smashStartTime || 0)
                if (elapsed >= 600) {
                  // Smash impact moment! Inflict massive 600 damage to all enemies in quadrant & expire
                  const enemiesInQuadrant = state.enemyPlants.filter(
                    (e) =>
                      e.lane === plant.lane &&
                      Math.abs(e.x - plant.x) <= 5.5 &&
                      e.hp > 0
                  )
                  enemiesInQuadrant.forEach((e) => {
                    e.hp -= config.damage || 600
                  })
                  soundManager.playSound('pea_hit', 0.9)
                  plant.hp = 0 // Expire Squash after full slam animation completes
                }
              } else {
                const enemiesInQuadrant = state.enemyPlants.filter(
                  (e) =>
                    e.lane === plant.lane &&
                    Math.abs(e.x - plant.x) <= 4.8 &&
                    e.hp > 0
                )

                if (enemiesInQuadrant.length > 0) {
                  plant.isSmashing = true
                  plant.smashStartTime = Date.now()
                  plant.state = 'attacking'
                  soundManager.playSound('pea_hit', 0.7)
                } else {
                  plant.state = 'walking'
                  plant.x += (config.moveSpeed || 6.0) * dt

                  if (plant.x >= BASE_RIGHT_START_X - 1) {
                    state.p2BaseHp = Math.max(0, state.p2BaseHp - 150)
                    soundManager.playSound('pea_hit', 0.8)
                    plant.hp = 0
                  }
                }
              }
            } else {
              const enemyTarget = state.enemyPlants.find(
                (e) =>
                  e.lane === plant.lane &&
                  e.x >= plant.x &&
                  e.x - plant.x <= 3.8 &&
                  e.hp > 0
              )

              if (enemyTarget) {
                plant.state = 'attacking'
                const attackInterval = config.attackSpeedMs || 600
                if (Date.now() - plant.lastActionTime >= attackInterval) {
                  plant.lastActionTime = Date.now()
                  enemyTarget.hp -= config.damage || 90
                  soundManager.playSound('pea_hit', 0.5)
                }
              } else {
                plant.state = 'walking'
                plant.x += (config.moveSpeed || 4.5) * dt

                if (plant.x >= BASE_RIGHT_START_X - 1) {
                  state.p2BaseHp = Math.max(0, state.p2BaseHp - 40)
                  soundManager.playSound('pea_hit', 0.6)
                  plant.hp = 0
                }
              }
            }
          }

          if (plant.hp > 0) {
            nextPlants.push(plant)
          }
        }
        state.plants = nextPlants

        // 5. UPDATE PROJECTILES & HITS
        const nextProjectiles: ProjectileEntity[] = []
        for (const p of state.projectiles) {
          let hit = false

          if (p.targetTeam === 'p2') {
            p.x += p.speed * dt
            for (const e of state.enemyPlants) {
              if (e.lane === p.lane && Math.abs(e.x - p.x) <= 2.5 && e.hp > 0) {
                hit = true
                e.hp -= p.damage
                soundManager.playSound('pea_hit', 0.4)

                if (p.isSplash) {
                  for (const splashE of state.enemyPlants) {
                    if (
                      splashE.id !== e.id &&
                      splashE.lane === p.lane &&
                      Math.abs(splashE.x - p.x) <= 7.0 &&
                      splashE.hp > 0
                    ) {
                      splashE.hp -= Math.round(p.damage * 0.6)
                    }
                  }
                }
                break
              }
            }

            if (!hit && p.x >= BASE_RIGHT_START_X) {
              hit = true
              state.p2BaseHp = Math.max(0, state.p2BaseHp - p.damage)
              soundManager.playSound('pea_hit', 0.5)
            }
          } else {
            p.x -= p.speed * dt
            for (const pl of state.plants) {
              if (pl.lane === p.lane && Math.abs(pl.x - p.x) <= 2.5 && pl.hp > 0) {
                hit = true
                pl.hp -= p.damage
                soundManager.playSound('pea_hit', 0.4)
                break
              }
            }

            if (!hit && p.x <= BASE_LEFT_END_X) {
              hit = true
              state.p1BaseHp = Math.max(0, state.p1BaseHp - p.damage)
              soundManager.playSound('pea_hit', 0.5)
            }
          }

          if (!hit && p.x > 10 && p.x < 90) {
            nextProjectiles.push(p)
          }
        }
        state.projectiles = nextProjectiles

        // 6. UPDATE PLAYER 2 ENEMY PLANTS
        const nextEnemies: EnemyPlantEntity[] = []
        for (const e of state.enemyPlants) {
          if (e.hp <= 0) {
            soundManager.playSound('zombie_fall', 0.4)
            state.stats.enemyPlantsDefeated += 1
            state.stats.score += 100
            state.sunBank += ENEMY_PLANT_CONFIGS[e.type]?.rewardSun || 25
            continue
          }

          const config = ENEMY_PLANT_CONFIGS[e.type]

          // Frozen enemy check (Iceberg Lettuce freeze for exactly 7.0 seconds)
          if (e.frozenUntil) {
            if (Date.now() < e.frozenUntil) {
              nextEnemies.push(e)
              continue
            } else {
              // 7 seconds expired! Clear freeze & restore walking state
              e.frozenUntil = undefined
              if (config.category === 'melee') {
                e.isWalking = true
                e.speed = config.speed
              }
            }
          }

          // Enemy Sunflower (Girasol Enemigo P2) generates +25 Sun for PC AI every 6s
          if (e.type === 'enemy_sunflower') {
            if (Date.now() - e.lastAttackTime > 6000) {
              e.lastAttackTime = Date.now()
              state.p2SunBank += 25
            }
          }

          // Ranged Enemy Plants (Guisantera, Melón, Cactus) shoot left continuously
          if (config.category === 'ranged') {
            if (Date.now() - e.lastAttackTime > (e.type === 'enemy_chomper' ? 1100 : 1800)) {
              e.lastAttackTime = Date.now()
              const projType =
                e.type === 'enemy_melonpult'
                  ? 'melon'
                  : e.type === 'enemy_chomper'
                  ? 'needle'
                  : 'pea'
              state.projectiles.push({
                id: `proj-p2-${now}-${Math.random()}`,
                type: projType,
                targetTeam: 'p1',
                lane: e.lane,
                x: e.x - 2,
                y: 20 + e.lane * 19.33 + 7,
                speed: projType === 'melon' ? 22 : projType === 'needle' ? 34 : 32,
                damage: e.damage,
              })
              soundManager.playSound('pea_shoot', 0.4)
            }
          }

          // Walking Melee Enemy Plants (Cactus Enemigo walking LEFT)
          if (e.isWalking) {
            const blockingP1 = state.plants.find(
              (pl) =>
                pl.lane === e.lane &&
                pl.x <= e.x &&
                e.x - pl.x <= 3.8 &&
                pl.hp > 0
            )

            if (blockingP1) {
              e.state = 'attacking'
              if (Date.now() - e.lastAttackTime > 600) {
                e.lastAttackTime = Date.now()
                blockingP1.hp -= e.damage
                soundManager.playSound('pea_hit', 0.5)
              }
            } else {
              e.state = 'walking'
              e.x -= e.speed * dt

              if (e.x <= BASE_LEFT_END_X + 1) {
                state.p1BaseHp = Math.max(0, state.p1BaseHp - e.damage * dt)
              }
            }
          } else {
            // Static Enemy Plant
            const blockingP1 = state.plants.find(
              (pl) =>
                pl.lane === e.lane &&
                pl.x <= e.x &&
                e.x - pl.x <= 3.0 &&
                pl.hp > 0
            )
            if (blockingP1) {
              e.state = 'attacking'
              blockingP1.hp -= e.damage * dt
            } else {
              e.state = 'idle'
            }
          }

          nextEnemies.push(e)
        }
        state.enemyPlants = nextEnemies

        // 7. VICTORY / DEFEAT CHECKS
        if (state.p1BaseHp <= 0) {
          state.status = 'defeat'
          soundManager.playSound('zombieFinalKill', 0.7)
        } else if (state.p2BaseHp <= 0) {
          state.status = 'victory'
          soundManager.playSound('level_select', 0.7)
        }
      } // End while (remainingDt > 0) sub-step loop

      forceRender()
    } // End tickEngine

      const gameLoop = (now: number) => {
        tickEngine(now)
        if (!document.hidden) {
          animationFrameId = requestAnimationFrame(gameLoop)
        }
      }

      const handleVisibilityChange = () => {
        if (document.hidden) {
          if (animationFrameId) cancelAnimationFrame(animationFrameId)
          if (!bgIntervalId) {
            bgIntervalId = setInterval(() => {
              tickEngine(performance.now())
            }, 50)
          }
        } else {
          if (bgIntervalId) {
            clearInterval(bgIntervalId)
            bgIntervalId = null
          }
          lastTickRef.current = performance.now()
          animationFrameId = requestAnimationFrame(gameLoop)
        }
      }

      document.addEventListener('visibilitychange', handleVisibilityChange)

      lastTickRef.current = performance.now()
      animationFrameId = requestAnimationFrame(gameLoop)

      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange)
        if (animationFrameId) cancelAnimationFrame(animationFrameId)
        if (bgIntervalId) clearInterval(bgIntervalId)
      };
    }, [forceRender])

  const state = stateRef.current

  const surrenderGame = () => {
    stateRef.current.status = 'defeat'
    stateRef.current.p1BaseHp = 0
    soundManager.playSound('defeat', 0.7)
    forceRender()
  }

  return {
    gameStatus: state.status,
    isPracticeMode: !!state.isPracticeMode,
    isMuted,
    toggleMute,
    p1BaseHp: state.p1BaseHp,
    p2BaseHp: state.p2BaseHp,
    sunBank: state.sunBank,
    p2SunBank: state.p2SunBank,
    plants: state.plants,
    enemyPlants: state.enemyPlants,
    projectiles: state.projectiles,
    suns: state.suns,
    selectedCard: state.selectedCard,
    setSelectedCard,
    cooldowns: state.cooldowns,
    wave: state.wave,
    waveBanner: state.waveBanner,
    stats: state.stats,
    startGame,
    startPracticeGame,
    surrenderGame,
    collectSun,
    placePlant,
    digPlant,
  }
}
