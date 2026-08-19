import { useEffect, useMemo, useRef, useState } from 'react'
import type { PlantId, ColosseumMatchConfig } from '../../types/game'
import { TournamentManager, type ActiveTournamentSession } from '../../utils/tournamentManager'
import { useGameEngine } from '../../hooks/useGameEngine'
import {
  PLANT_CONFIGS,
  ENEMY_PLANT_CONFIGS,
  LANES_CONFIG,
  BASE_LEFT_END_X,
  FIELD_WIDTH_PCT,
  TOTAL_COLUMNS,
  P1_COLUMNS,
  INITIAL_BASE_HP,
} from '../../utils/gameConstants'
import { getArenaForElo } from '../../utils/arenaManager'
const sunIcon = '/game-assets/greenfoot/sun1.png'
const peaImg = '/game-assets/images/Plants/PB00.png'
const melonImg = '/game-assets/images/Plants/melon_pult.png'
const needleImg = '/game-assets/greenfoot/needle1.png'
import PlantHand from './PlantHand'
import { soundManager } from '../../utils/audioManager'
import { toggleFullscreen } from '../../utils/fullscreen'
import './Battlefield.css'

function getBattlefieldPlantLevel(plantId: string): number {
  try {
    const saved = localStorage.getItem('plant_arena_plant_levels')
    if (saved) {
      const parsed = JSON.parse(saved)
      return parsed[plantId] || 0
    }
  } catch {}
  return 0
}

interface BaseTowerProps {
  team: 'p1' | 'p2'
  hp: number
  maxHp: number
  sunBank?: number
}

const motherTreeImg = '/game-assets/greenfoot/mothertree_whitebg.png'

function BaseTower({ team, hp, maxHp, sunBank }: BaseTowerProps) {
  const hpPct = Math.max(0, Math.min(100, (hp / maxHp) * 100))

  return (
    <div className={`base base--${team}`}>
      <div className="base__top">
        <div className="base__hp">
          <div
            className="base__hp-fill"
            style={{
              width: `${hpPct}%`,
              backgroundColor: team === 'p1' ? '#52e061' : '#ff4d4d',
            }}
          />
        </div>
        <span className="base__label">
          🌳 {team === 'p1' ? 'ÁRBOL MADRE (P1)' : 'ÁRBOL MADRE (P2)'} ({Math.round(hp)})
        </span>
        {team === 'p2' && sunBank !== undefined && (
          <div className="base__pc-sun">
            <img src={sunIcon} alt="Sol" className="base__pc-sun-icon" />
            <span>{sunBank}</span>
          </div>
        )}
      </div>
      <div className="base__tree-wrap">
        <img
          src={motherTreeImg}
          alt={team === 'p1' ? 'Árbol Madre P1' : 'Árbol Madre P2'}
          className={`base__mothertree-img ${team === 'p2' ? 'base__mothertree-img--p2' : ''}`}
        />
      </div>
    </div>
  )
}

interface BattlefieldProps {
  onBackToMenu?: () => void
  onBackToCollection?: () => void
  onBattleComplete?: (isVictory: boolean) => any
  onSurrender?: () => any
  practicePlantId?: string | null
  activeDeck?: PlantId[]
  userElo?: number
  customBgImage?: string
  matchMode?: 'ranked' | 'colosseum' | 'tournament'
  colosseumConfig?: ColosseumMatchConfig | null
  tournamentOpponent?: { name: string; tournamentId: string } | null
  onColosseumComplete?: (won: boolean) => { payoutGems: number; newStreak: number; newMaxStreak: number; isNewRecord: boolean }
}

export default function Battlefield({
  onBackToMenu,
  onBackToCollection,
  onBattleComplete,
  onSurrender,
  practicePlantId,
  activeDeck,
  userElo = 1000,
  customBgImage,
  matchMode = 'ranked',
  colosseumConfig,
  tournamentOpponent,
  onColosseumComplete,
}: BattlefieldProps) {
  const {
    gameStatus,
    isPracticeMode,
    isMuted,
    toggleMute,
    p1BaseHp,
    p2BaseHp,
    sunBank,
    p2SunBank,
    plants,
    enemyPlants,
    projectiles,
    suns,
    selectedCard,
    selectedSlotIndex,
    setSelectedCard,
    cooldowns,
    slotCooldowns,
    waveBanner,
    stats,
    startGame,
    startPracticeGame,
    surrenderGame,
    collectSun,
    placePlant,
    digPlant,
  } = useGameEngine()

  const [battleSummaryResult, setBattleSummaryResult] = useState<{
    eloChange?: number
    newElo?: number
    packResult?: { awarded: boolean; durationHours?: 2 | 4 | 8 | 12; arenaLevel?: number; isSlotsFull?: boolean }
    isSurrendered?: boolean
  } | null>(null)

  const [colosseumResult, setColosseumResult] = useState<{
    payoutGems: number
    newStreak: number
    newMaxStreak: number
    isNewRecord: boolean
  } | null>(null)

  const [tournamentResult, setTournamentResult] = useState<ActiveTournamentSession | null>(null)

  const activeArena = useMemo(() => getArenaForElo(userElo), [userElo])
  const activeBgImage = customBgImage || activeArena.bgImage

  const allCatalogCards = useMemo(() => Object.keys(PLANT_CONFIGS) as PlantId[], [])
  const effectiveDeck = useMemo(() => {
    if (activeDeck && activeDeck.length > 0) {
      return activeDeck
    }
    return allCatalogCards.slice(0, 6)
  }, [activeDeck, allCatalogCards])

  const hasHandledEndRef = useRef<boolean>(false)

  useEffect(() => {
    if (hasHandledEndRef.current) return

    if (gameStatus === 'victory' || gameStatus === 'defeat') {
      hasHandledEndRef.current = true

      // Handle Colosseum match resolution
      if (matchMode === 'colosseum' && onColosseumComplete) {
        const coloRes = onColosseumComplete(gameStatus === 'victory')
        setColosseumResult(coloRes)
      }

      // Handle Tournament match resolution
      if (matchMode === 'tournament') {
        const tourneyId = tournamentOpponent?.tournamentId || 'tourney_free_1'
        const resolved = TournamentManager.resolveMatch(tourneyId, gameStatus === 'victory')
        setTournamentResult(resolved)
      }

      if (gameStatus === 'victory') {
        if (onBattleComplete) {
          const res = onBattleComplete(true)
          if (res) {
            setBattleSummaryResult({
              eloChange: res.winElo,
              newElo: res.newElo,
              packResult: res.packResult,
            })
          }
        }
      } else if (gameStatus === 'defeat') {
        if (onBattleComplete) {
          const res = onBattleComplete(false)
          if (res) {
            setBattleSummaryResult({
              eloChange: -(res.loseElo || 8),
              newElo: res.newElo,
            })
          }
        }
      }
    }
  }, [gameStatus, onBattleComplete, matchMode, onColosseumComplete])

  useEffect(() => {
    if (practicePlantId) {
      startPracticeGame(practicePlantId)
      if (practicePlantId in PLANT_CONFIGS) {
        setSelectedCard(practicePlantId as PlantId)
      }
    } else if (gameStatus === 'ready') {
      hasHandledEndRef.current = false
      startGame()
    }
  }, [practicePlantId])

  const [showSurrenderModal, setShowSurrenderModal] = useState<boolean>(false)

  const handleSurrenderClick = () => {
    soundManager.playSound('click', 0.5)
    setShowSurrenderModal(true)
  }

  const handleConfirmSurrender = () => {
    setShowSurrenderModal(false)
    hasHandledEndRef.current = true
    surrenderGame()
    if (onSurrender) {
      const res = onSurrender()
      if (res) {
        setBattleSummaryResult({
          eloChange: -(res.surrenderElo || 8),
          newElo: res.newElo,
          isSurrendered: true,
        })
      }
    }
  }

  const handlePlayAgain = () => {
    hasHandledEndRef.current = false
    setBattleSummaryResult(null)
    startGame()
  }

  return (
    <div
      className={`battlefield ${selectedCard === 'shovel' ? 'battlefield--shovel-mode' : ''}`}
      style={{ backgroundImage: `url(${activeBgImage})` }}
    >
      {/* Top Controls Bar */}
      <div className="battlefield-top-controls">
        {matchMode === 'colosseum' && (
          <div className="battlefield-colosseum-header-pill">
            <span className="battlefield-colosseum-icon">🏛️</span>
            <span>COLISEO</span>
            <span>•</span>
            <span style={{ color: '#38bdf8' }}>Sala: {colosseumConfig?.betGems || 0.5} 💎</span>
            <span>•</span>
            <span style={{ color: '#fbbf24' }}>Pozo: {((colosseumConfig?.betGems || 0.5) * 2).toFixed(1)} 💎</span>
          </div>
        )}
        {matchMode === 'tournament' && (
          <div className="battlefield-colosseum-header-pill" style={{ borderColor: '#a855f7', boxShadow: '0 0 15px rgba(168, 85, 247, 0.4)' }}>
            <span className="battlefield-colosseum-icon">🎪</span>
            <span>TORNEO EN VIVO</span>
            <span>•</span>
            <span style={{ color: '#d8b4fe' }}>vs {tournamentOpponent?.name || 'Rival'}</span>
          </div>
        )}
        <button
          type="button"
          className="fullscreen-toggle-btn"
          onClick={toggleFullscreen}
          title="Pantalla Completa (Ocultar navegador)"
        >
          ⛶
        </button>
        <button
          type="button"
          className="sound-toggle-btn"
          onClick={toggleMute}
          title={isMuted ? 'Activar sonido' : 'Silenciar sonido'}
        >
          {isMuted ? '🔇' : '🔊'}
        </button>
      </div>

      {/* Practice / Sandbox Mode Bar */}
      {isPracticeMode && (
        <div className="practice-bar">
          <span className="practice-bar__title">🎯 ENTRENAMIENTO</span>
          <button
            type="button"
            className="practice-bar__btn"
            onClick={() => startPracticeGame(practicePlantId || undefined)}
          >
            🔄 REINICIAR BLANCOS (3 CARRILES)
          </button>
          <button
            type="button"
            className="practice-bar__btn"
            onClick={() => {
              soundManager.playBgm('menu')
              if (onBackToCollection) onBackToCollection()
              else if (onBackToMenu) onBackToMenu()
            }}
          >
            ⬅️ ALMANAQUE
          </button>
        </div>
      )}

      {/* Base Towers */}
      <BaseTower team="p1" hp={p1BaseHp} maxHp={INITIAL_BASE_HP} />
      <BaseTower team="p2" hp={p2BaseHp} maxHp={INITIAL_BASE_HP} sunBank={p2SunBank} />

      {/* Start Overlay */}
      {gameStatus === 'ready' && !practicePlantId && (
        <div
          className="game-overlay"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="game-card" onClick={(e) => e.stopPropagation()}>
            <h2 className="game-card__title">¡BATALLA PVE DE PLANTAS!</h2>
            <p className="game-card__text">
              Defiende tu base (P1) de las hordas de <strong>Plantas Enemigas</strong> de la PC (P2).
              <br />
              Recolecta soles haciendo click en ellos y despliega tu ejército de plantas.
            </p>
            <button className="game-button" type="button" onClick={() => startGame()}>
              ¡EMPEZAR COMBATE!
            </button>
          </div>
        </div>
      )}

      {/* Grid Lanes */}
      <div className="lanes">
        {LANES_CONFIG.map((lane) => (
          <div
            key={lane.id}
            className="lane"
            style={{
              top: `${lane.topPct}%`,
              height: `${lane.heightPct}%`,
              left: `${BASE_LEFT_END_X}%`,
              width: `${FIELD_WIDTH_PCT}%`,
            }}
          >
            {Array.from({ length: TOTAL_COLUMNS }).map((_, col) => {
              const isP1Side = col < P1_COLUMNS
              const isCellSelected = selectedCard && isP1Side

              return (
                <div
                  key={col}
                  className={`lane__cell ${
                    isP1Side ? 'lane__cell--p1' : 'lane__cell--p2'
                  } ${isCellSelected ? 'lane__cell--selectable' : ''}`}
                  style={{
                    width: `${100 / TOTAL_COLUMNS}%`,
                    zIndex: isCellSelected ? (selectedCard === 'shovel' ? 10 : 40) : 1,
                    pointerEvents: isP1Side ? 'auto' : 'none',
                  }}
                  onClick={() => {
                    if (selectedCard && isP1Side) {
                      if (selectedCard === 'shovel') {
                        digPlant({ lane: lane.id, col })
                      } else {
                        placePlant(lane.id, col)
                      }
                    }
                  }}
                />
              )
            })}
          </div>
        ))}
      </div>

      {/* Center Dividing Line */}
      <div className="front-line" />

      {/* Player 1 Plants */}
      {plants.map((plant) => {
        const config = PLANT_CONFIGS[plant.plantId]
        const laneConfig = LANES_CONFIG[plant.lane]
        const hpPct = (plant.hp / plant.maxHp) * 100
        const isShovelActive = selectedCard === 'shovel'

        return (
          <div
            key={plant.id}
            className={`entity plant-unit ${
              isShovelActive ? 'plant-unit--shovel-target' : ''
            } ${
              plant.isWalking ? 'plant-unit--walking' : ''
            } ${
              plant.plantId === 'garlic'
                ? plant.isSmashing
                  ? 'plant-unit--squash-smashing'
                  : 'plant-unit--squash-hopping'
                : ''
            } ${
              plant.plantId === 'squash'
                ? plant.isArmed
                  ? 'plant-unit--potato-armed'
                  : 'plant-unit--potato-unarmed'
                : ''
            } ${
              plant.plantId === 'bonkchoy' ? 'plant-unit--bonkchoy' : ''
            } ${plant.state === 'attacking' ? 'plant-unit--attacking' : ''}`}
            style={{
              left: `${plant.x}%`,
              top: `${laneConfig.topPct + laneConfig.heightPct / 2}%`,
              pointerEvents: isShovelActive ? 'auto' : 'none',
            }}
            onClick={(e) => {
              if (isShovelActive) {
                e.stopPropagation()
                digPlant(plant.id)
              }
            }}
          >
            {hpPct < 100 && (
              <div className="entity__hp">
                <div
                  className="entity__hp-fill"
                  style={{ width: `${hpPct}%` }}
                />
              </div>
            )}
            {plant.spriteOverride?.includes('jalapeno_flame_fx') ? (
              <div className="jalapeno-lane-flame">
                <img src="/game-assets/plants/jalapeno_flame_fx.png" alt="Fuego" />
              </div>
            ) : (
              <>
                {/* Subtle Base Ground Aura for Leveled Plants */}
                {getBattlefieldPlantLevel(plant.plantId) > 0 && (
                  <div
                    className={`plant-base-halo ${
                      getBattlefieldPlantLevel(plant.plantId) >= 3
                        ? 'plant-base-halo--gold'
                        : 'plant-base-halo--emerald'
                    }`}
                  />
                )}
                <img
                  className={`plant-unit__sprite ${
                    plant.plantId === 'melonpult' ? 'plant-unit__sprite--melon' : ''
                  } ${plant.spriteOverride?.includes('burst') ? 'plant-unit__sprite--burst' : ''}`}
                  src={plant.spriteOverride || config.sprite}
                  alt={config.name}
                />
              </>
            )}
            {plant.isHealingFx && (
              <div className="aloe-heal-cloud">
                <img src="/game-assets/plants/aloe_heal_fx.gif" alt="Cura" />
                <span className="heal-text">+60 HP</span>
              </div>
            )}
            {plant.plantId === 'garlic' && plant.isSmashing && (
              <div className="squash-smash-fx">💥 BAM!</div>
            )}
            {plant.plantId === 'squash' && !plant.isArmed && (
              <div className="potato-arming-badge">🌱 ARMÁNDOSE</div>
            )}
            {plant.plantId === 'squash' && plant.isArmed && (
              <div className="potato-armed-badge">🚨 ¡ARMADA!</div>
            )}
            {plant.plantId === 'iceberglettuce' && plant.spriteOverride?.includes('burst') && (
              <div className="iceberg-burst-fx">⚡ ❄️ ¡RÁFAGA HELADA!</div>
            )}
          </div>
        )
      })}

      {/* Player 2 PC Enemy Plants */}
      {enemyPlants.map((enemy) => {
        const config = ENEMY_PLANT_CONFIGS[enemy.type]
        const laneConfig = LANES_CONFIG[enemy.lane]
        const hpPct = Math.max(0, (enemy.hp / enemy.maxHp) * 100)
        const isFrozen = enemy.frozenUntil ? Date.now() < enemy.frozenUntil : false

        return (
          <div
            key={enemy.id}
            className={`entity enemy-unit ${
              enemy.state === 'attacking' ? 'enemy-unit--attacking' : ''
            } ${isFrozen ? 'enemy-unit--frozen' : ''}`}
            style={{
              left: `${enemy.x}%`,
              top: `${laneConfig.topPct + laneConfig.heightPct / 2}%`,
            }}
          >
            <div className="entity__hp">
              <div
                className="entity__hp-fill entity__hp-fill--enemy"
                style={{ width: `${hpPct}%` }}
              />
            </div>
            <img
              className={`enemy-unit__sprite ${
                enemy.type === 'enemy_melonpult' ? 'enemy-unit__sprite--melon' : ''
              } ${isFrozen ? 'enemy-unit__sprite--frozen' : ''}`}
              src={config.sprite}
              alt={config.name}
            />
            {isFrozen && <div className="frozen-ice-badge">🧊 CONGELADO</div>}
          </div>
        )
      })}

      {/* Flying Projectiles */}
      {projectiles.map((proj) => (
        <img
          key={proj.id}
          className={`projectile ${
            proj.type === 'melon'
              ? 'projectile--melon'
              : proj.type === 'needle'
              ? 'projectile--needle'
              : 'projectile--pea'
          } ${proj.targetTeam === 'p1' ? 'projectile--left' : ''}`}
          src={proj.type === 'melon' ? melonImg : proj.type === 'needle' ? needleImg : peaImg}
          alt=""
          style={{
            left: `${proj.x}%`,
            top: `${proj.y}%`,
          }}
        />
      ))}

      {/* Collectible Suns */}
      {suns.map((sun) => (
        <button
          key={sun.id}
          type="button"
          className="sun-item"
          style={{
            left: `${sun.x}%`,
            top: `${sun.y}%`,
          }}
          onMouseDown={(e) => {
            e.stopPropagation()
            collectSun(sun.id)
          }}
          onTouchStart={(e) => {
            e.stopPropagation()
            collectSun(sun.id)
          }}
          onClick={(e) => {
            e.stopPropagation()
            collectSun(sun.id)
          }}
        >
          <img src={sunIcon} alt="Sol" className="sun-item__icon" />
        </button>
      ))}

      {/* Wave Banner */}
      {waveBanner && (
        <div className="wave-banner">
          <span className="wave-banner__text">{waveBanner}</span>
        </div>
      )}

      {/* Victory / Defeat Modal */}
      {(gameStatus === 'victory' || gameStatus === 'defeat') && (
        <div
          className="game-overlay"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div
            className={`game-card ${
              gameStatus === 'victory'
                ? 'game-card--victory'
                : 'game-card--defeat'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="game-card__title">
              {gameStatus === 'victory'
                ? '¡VICTORIA!'
                : battleSummaryResult?.isSurrendered
                ? '🏳️ ¡TE HAS RENDIDO!'
                : '¡DERROTA!'}
            </h2>

            {/* ELO BADGE */}
            {battleSummaryResult?.eloChange !== undefined && (
              <div
                className={`elo-result-badge ${
                  battleSummaryResult.eloChange >= 0
                    ? 'elo-result-badge--win'
                    : 'elo-result-badge--loss'
                }`}
              >
                <span>
                  {battleSummaryResult.eloChange >= 0
                    ? `🏆 +${battleSummaryResult.eloChange} COPAS`
                    : `🏆 ${battleSummaryResult.eloChange} COPAS`}
                </span>
                <span className="elo-result-badge__total">
                  (Total: {battleSummaryResult.newElo || userElo} 🏆)
                </span>
              </div>
            )}

            <div className="game-card__stats">
              <p>☀️ Soles Recolectados: {stats.sunsCollected}</p>
              <p>🌱 Plantas Enemigas Eliminadas: {stats.enemyPlantsDefeated}</p>
              <p>🌻 Plantas Colocadas: {stats.plantsPlaced}</p>
            </div>

            {/* VICTORY FREE PACK REWARD DISPLAY */}
            {gameStatus === 'victory' && (
              <div className="victory-pack-reward">
                {battleSummaryResult?.packResult?.awarded ? (
                  <div className="victory-pack-reward__box">
                    <span className="victory-pack-reward__title">
                      🎁 ¡NUEVO SOBRE DE BATALLA OBTENIDO!
                    </span>
                    <div className="victory-pack-reward__card">
                      <img
                        src="/game-assets/greenfoot/seed_pack_pvp.png"
                        alt="Sobre de Batalla PvP"
                        className="victory-pack-reward__img"
                      />
                      <div className="victory-pack-reward__info">
                        <span className="victory-pack-reward__name">
                          SOBRE DE BATALLA (1 CARTA)
                        </span>
                        <span className="victory-pack-reward__timer">
                          ⏳ Tiempo de Espera: <strong>{battleSummaryResult.packResult.durationHours} hora(s)</strong>
                        </span>
                        <span className="victory-pack-reward__loc">
                          📍 Guardado en tu Slot de Sobres del Menú
                        </span>
                      </div>
                    </div>
                  </div>
                ) : battleSummaryResult?.packResult?.isSlotsFull ? (
                  <div className="victory-pack-reward__full">
                    ⚠️ <strong>SLOTS DE SOBRES LLENOS (4/4)</strong>
                    <br />
                    Abre un sobre en el Menú Principal para liberar espacio.
                  </div>
                ) : null}

                {/* COLOSSEUM MATCH REWARD CARD */}
                {matchMode === 'colosseum' && colosseumResult && (
                  <div className="colosseum-battle-payout-box">
                    {gameStatus === 'victory' ? (
                      <>
                        <div className="colosseum-payout-header">
                          <span>🏛️ ¡VICTORIA EN EL COLISEO!</span>
                        </div>
                        <div className="colosseum-payout-gems">
                          + {colosseumResult.payoutGems} GEMAS 💎
                        </div>
                        <div className="colosseum-payout-streak">
                          🔥 Racha Actual: <strong>{colosseumResult.newStreak} victorias seguidas</strong>
                        </div>
                        {colosseumResult.isNewRecord && (
                          <div className="colosseum-payout-record">
                            👑 ¡NUEVO RÉCORD DE TEMPORADA! ({colosseumResult.newMaxStreak} Victorias)
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="colosseum-payout-header colosseum-payout-header--defeat">
                          <span>💀 DERROTA EN EL COLISEO</span>
                        </div>
                        <div className="colosseum-payout-loss">
                          {colosseumConfig?.usedTicket
                            ? '🎟️ 1 Ticket de Coliseo consumido'
                            : `💎 -${colosseumConfig?.betGems || 0.5} Gemas`}
                        </div>
                        <div className="colosseum-payout-streak" style={{ color: '#ef4444' }}>
                          🔥 Racha actual reiniciada a 0 (Récord máximo preservado)
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* TOURNAMENT ROUND REWARD CARD */}
                {matchMode === 'tournament' && tournamentResult && (
                  <div
                    className="colosseum-battle-payout-box"
                    style={{ borderColor: '#a855f7', boxShadow: '0 0 20px rgba(168, 85, 247, 0.35)' }}
                  >
                    {gameStatus === 'victory' ? (
                      <>
                        <div className="colosseum-payout-header" style={{ color: '#d8b4fe' }}>
                          🏆 ¡VICTORIA EN EL TORNEO!
                        </div>
                        <div className="colosseum-payout-gems" style={{ color: '#4ade80' }}>
                          +1 VICTORIA (Total: 🔥 {tournamentResult.userWins})
                        </div>
                        <div className="colosseum-payout-streak">
                          📊 Posición Actual: <strong>#{TournamentManager.getUserRank(tournamentResult)}</strong> | Vidas: {Array.from({ length: 3 }).map((_, i) => (
                            <span key={i}>{i < 3 - tournamentResult.userLosses ? '❤️' : '💔'}</span>
                          ))}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="colosseum-payout-header colosseum-payout-header--defeat">
                          💔 DERROTA EN EL TORNEO
                        </div>
                        <div className="colosseum-payout-loss">
                          Perdiste 1 vida ({Math.max(0, 3 - tournamentResult.userLosses)}/3 restantes)
                        </div>
                        <div className="colosseum-payout-streak" style={{ color: tournamentResult.isEliminated ? '#ef4444' : '#fdba74' }}>
                          {tournamentResult.isEliminated
                            ? '💀 ¡HAS SIDO ELIMINADO DEL TORNEO! (3/3 derrotas)'
                            : `⚠️ Aún tienes ${3 - tournamentResult.userLosses} vida(s) para seguir buscando partidas.`}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="game-card__prompt">
              ¿Deseas seguir jugando o regresar al menú?
            </div>

            <div className="game-card__actions">
              <button
                className="game-button"
                type="button"
                onClick={handlePlayAgain}
              >
                🎮 SEGUIR JUGANDO
              </button>
              {onBackToMenu && (
                <button
                  className="game-button game-button--secondary"
                  type="button"
                  onClick={() => {
                    soundManager.playBgm('menu')
                    onBackToMenu()
                  }}
                >
                  🏠 MENÚ PRINCIPAL
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Bottom Surrender Action Button */}
      {gameStatus === 'playing' && !isPracticeMode && (
        <div className="battlefield-bottom-actions">
          <button
            type="button"
            className="surrender-btn"
            onClick={handleSurrenderClick}
            title="Rendirse y perder ELO"
          >
            🏳️ RENDIRSE
          </button>
        </div>
      )}

      {/* Surrender Confirmation In-Game Modal */}
      {showSurrenderModal && (
        <div className="battle-surrender-modal-overlay">
          <div className="battle-surrender-modal">
            <div className="battle-surrender-modal__icon">🏳️</div>
            <h3 className="battle-surrender-modal__title">¿RENDIRTE DE LA BATALLA?</h3>
            <p className="battle-surrender-modal__desc">
              Si te rindes ahora, se declarará derrota inmediata y perderás copas de ELO en el ranking.
            </p>
            <div className="battle-surrender-modal__actions">
              <button
                type="button"
                className="battle-surrender-modal__btn battle-surrender-modal__btn--cancel"
                onClick={() => {
                  soundManager.playSound('click', 0.4)
                  setShowSurrenderModal(false)
                }}
              >
                ⚔️ SEGUIR LUCHANDO
              </button>
              <button
                type="button"
                className="battle-surrender-modal__btn battle-surrender-modal__btn--confirm"
                onClick={handleConfirmSurrender}
              >
                🏳️ SÍ, RENDIRME
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Plant Hand */}
      <PlantHand
        sunBank={sunBank}
        selectedCard={selectedCard}
        selectedSlotIndex={selectedSlotIndex}
        onSelectCard={setSelectedCard}
        cooldowns={cooldowns}
        slotCooldowns={slotCooldowns}
        activeDeck={effectiveDeck}
      />
    </div>
  )
}
