import { useEffect } from 'react'
import type { PlantId } from '../../types/game'
import { useGameEngine } from '../../hooks/useGameEngine'
import {
  PLANT_CONFIGS,
  ENEMY_PLANT_CONFIGS,
  LANES_CONFIG,
  BASE_LEFT_END_X,
  FIELD_WIDTH_PCT,
  TOTAL_COLUMNS,
  P1_COLUMNS,
} from '../../utils/gameConstants'
import battlefieldBg from '../../assets/images/battlefield-bg.png'
const sunIcon = '/game-assets/greenfoot/sun1.png'
const peaImg = '/game-assets/images/Plants/PB00.png'
const melonImg = '/game-assets/images/Plants/melon_pult.png'
const needleImg = '/game-assets/greenfoot/needle1.png'
import PlantHand from './PlantHand'
import { soundManager } from '../../utils/audioManager'
import './Battlefield.css'

const motherTreeImg = '/game-assets/greenfoot/mothertree_whitebg.png'

interface BaseTowerProps {
  team: 'p1' | 'p2'
  hp: number
  maxHp: number
  sunBank?: number
}

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

export default function Battlefield({
  onBackToMenu,
  onBackToCollection,
  practicePlantId,
  activeDeck,
}: {
  onBackToMenu?: () => void
  onBackToCollection?: () => void
  practicePlantId?: string | null
  activeDeck?: PlantId[]
}) {
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
    setSelectedCard,
    cooldowns,
    waveBanner,
    stats,
    startGame,
    startPracticeGame,
    collectSun,
    placePlant,
    digPlant,
  } = useGameEngine()

  useEffect(() => {
    if (practicePlantId) {
      startPracticeGame(practicePlantId)
    } else if (gameStatus === 'ready') {
      startGame()
    }
  }, [practicePlantId])

  return (
    <div
      className="battlefield"
      style={{ backgroundImage: `url(${battlefieldBg})` }}
    >
      {/* Sound Toggle Button */}
      <button
        type="button"
        className="sound-toggle-btn"
        onClick={toggleMute}
        title={isMuted ? 'Activar sonido' : 'Silenciar sonido'}
      >
        {isMuted ? '🔇' : '🔊'}
      </button>

      {/* Practice / Sandbox Mode Bar */}
      {isPracticeMode && (
        <div className="practice-bar">
          <span className="practice-bar__title">🎯 MODO PRUEBA DE DISPARO</span>
          <button
            type="button"
            className="practice-bar__btn"
            onClick={() => startPracticeGame(practicePlantId || undefined)}
          >
            🔄 REINICIAR BLANCOS
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
      <BaseTower team="p1" hp={p1BaseHp} maxHp={1000} />
      <BaseTower team="p2" hp={p2BaseHp} maxHp={1000} sunBank={p2SunBank} />

      {/* Start Overlay */}
      {gameStatus === 'ready' && !practicePlantId && (
        <div className="game-overlay">
          <div className="game-card">
            <h2 className="game-card__title">¡BATALLA PVE DE PLANTAS!</h2>
            <p className="game-card__text">
              Defiende tu base (P1) de las hordas de <strong>Plantas Enemigas</strong> de la PC (P2).
              <br />
              Recolecta soles haciendo click en ellos y despliega tu ejército de plantas.
            </p>
            <button className="game-button" type="button" onClick={startGame}>
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
                  style={{ width: `${100 / TOTAL_COLUMNS}%` }}
                  onClick={() => {
                    if (selectedCard && selectedCard !== 'shovel' && isP1Side) {
                      placePlant(lane.id, col)
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

        return (
          <div
            key={plant.id}
            className={`entity plant-unit ${
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
            }}
            onClick={() => {
              if (selectedCard === 'shovel') {
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
            <img
              className={`plant-unit__sprite ${
                plant.plantId === 'melonpult' ? 'plant-unit__sprite--melon' : ''
              }`}
              src={config.sprite}
              alt={config.name}
            />
            {plant.plantId === 'garlic' && plant.isSmashing && (
              <div className="squash-smash-fx">💥 BAM!</div>
            )}
            {plant.plantId === 'squash' && !plant.isArmed && (
              <div className="potato-arming-badge">🌱 ARMÁNDOSE</div>
            )}
            {plant.plantId === 'squash' && plant.isArmed && (
              <div className="potato-armed-badge">🚨 ¡ARMADA!</div>
            )}
          </div>
        )
      })}

      {/* Player 2 PC Enemy Plants */}
      {enemyPlants.map((enemy) => {
        const config = ENEMY_PLANT_CONFIGS[enemy.type]
        const laneConfig = LANES_CONFIG[enemy.lane]
        const hpPct = Math.max(0, (enemy.hp / enemy.maxHp) * 100)

        return (
          <div
            key={enemy.id}
            className={`entity enemy-unit ${
              enemy.state === 'attacking' ? 'enemy-unit--attacking' : ''
            }`}
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
              }`}
              src={config.sprite}
              alt={config.name}
            />
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
        <div className="game-overlay">
          <div
            className={`game-card ${
              gameStatus === 'victory'
                ? 'game-card--victory'
                : 'game-card--defeat'
            }`}
          >
            <h2 className="game-card__title">
              {gameStatus === 'victory' ? '¡VICTORIA!' : '¡DERROTA!'}
            </h2>
            <div className="game-card__stats">
              <p>☀️ Soles Recolectados: {stats.sunsCollected}</p>
              <p>🌱 Plantas Enemigas Eliminadas: {stats.enemyPlantsDefeated}</p>
              <p>🌻 Plantas Colocadas: {stats.plantsPlaced}</p>
              <p>🏆 Puntuación Final: {stats.score}</p>
            </div>
            <div className="game-card__actions">
              <button className="game-button" type="button" onClick={startGame}>
                JUGAR DE NUEVO
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
                  MENÚ PRINCIPAL
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Plant Hand */}
      <PlantHand
        sunBank={sunBank}
        selectedCard={selectedCard}
        onSelectCard={setSelectedCard}
        cooldowns={cooldowns}
        activeDeck={activeDeck}
      />
    </div>
  )
}
