import { useState } from 'react'
import logo from '../../assets/images/logo.png'
import plant1 from '../../assets/images/plant1.png'
import plant2 from '../../assets/images/plant2.png'
import bgImage from '../../assets/images/background.png'
import arena1Bg from '../../assets/images/battlefield-bg.png'
import arena2Bg from '../../assets/images/battlefield-bg2.jpg'
import arena3Bg from '../../assets/images/battlefield-bg3.jpg'
import arena4Bg from '../../assets/images/battlefield-bg4.jpg'
import arena5Bg from '../../assets/images/battlefield-bg5.jpg'
import rankingIco from '../../assets/ico/Ranking.png'
import { soundManager } from '../../utils/audioManager'
import './LandingPage.css'

interface LandingPageProps {
  onPlayGame: () => void
}

interface PlantCardData {
  id: string
  nameEs: string
  nameEn: string
  roleEs: string
  roleEn: string
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'
  rarityLabelEs: string
  rarityLabelEn: string
  rarityColor: string
  rarityInitial: string
  cost: number
  img: string
  hp?: number
  damage?: number | string
  speed?: number | string
  cooldown?: string
  fireRate?: string
  freeze?: string
  healing?: string
  range?: string
  descEs: string
  descEn: string
}

const PLANTS_DATA: PlantCardData[] = [
  {
    id: 'sunflower',
    nameEs: 'Sunflower',
    nameEn: 'Sunflower',
    roleEs: 'Productora',
    roleEn: 'Producer',
    rarity: 'common',
    rarityLabelEs: 'COMÚN',
    rarityLabelEn: 'COMMON',
    rarityColor: '#4ade80',
    rarityInitial: 'C',
    cost: 50,
    img: '/game-assets/greenfoot/transparentsunflower.png',
    hp: 300,
    cooldown: '5 s',
    descEs: 'Genera 25 soles de forma periódica para desplegar más tropas en tus carriles.',
    descEn: 'Periodically generates 25 sun to help you deploy more troops across your lanes.',
  },
  {
    id: 'peashooter',
    nameEs: 'Peashooter',
    nameEn: 'Peashooter',
    roleEs: 'A distancia',
    roleEn: 'Ranged',
    rarity: 'common',
    rarityLabelEs: 'COMÚN',
    rarityLabelEn: 'COMMON',
    rarityColor: '#4ade80',
    rarityInitial: 'C',
    cost: 100,
    img: '/game-assets/greenfoot/transparentpeashooter.png',
    hp: 300,
    damage: 25,
    fireRate: '1.4 s',
    descEs: 'Dispara guisantes directos a los enemigos que avanzan por su carril.',
    descEn: 'Fires straight peas at approaching enemies along its lane.',
  },
  {
    id: 'wallnut',
    nameEs: 'Wall-nut',
    nameEn: 'Wall-nut',
    roleEs: 'Defensiva',
    roleEn: 'Defensive',
    rarity: 'common',
    rarityLabelEs: 'COMÚN',
    rarityLabelEn: 'COMMON',
    rarityColor: '#4ade80',
    rarityInitial: 'C',
    cost: 50,
    img: '/game-assets/greenfoot/transparentwalnut.png',
    hp: 1200,
    cooldown: '15 s',
    descEs: 'Cáscara blindada ultra resistente que retiene el avance enemigo y absorbe daño masivo.',
    descEn: 'Ultra-tough armored shell that holds the line and absorbs massive damage.',
  },
  {
    id: 'cactus',
    nameEs: 'Cactus',
    nameEn: 'Cactus',
    roleEs: 'Cuerpo a cuerpo',
    roleEn: 'Melee',
    rarity: 'common',
    rarityLabelEs: 'COMÚN',
    rarityLabelEn: 'COMMON',
    rarityColor: '#4ade80',
    rarityInitial: 'C',
    cost: 150,
    img: '/game-assets/greenfoot/cactus1.png',
    hp: 500,
    damage: 35,
    speed: 4.5,
    descEs: 'Camina hacia la base enemiga disparando espinas filosas continuamente.',
    descEn: 'Marches toward the enemy base firing sharp thorns continuously.',
  },
  {
    id: 'squash',
    nameEs: 'Squash',
    nameEn: 'Squash',
    roleEs: 'Cuerpo a cuerpo',
    roleEn: 'Melee',
    rarity: 'uncommon',
    rarityLabelEs: 'POCO COMÚN',
    rarityLabelEn: 'UNCOMMON',
    rarityColor: '#22d3ee',
    rarityInitial: 'PC',
    cost: 50,
    img: '/game-assets/greenfoot/garlic1.png',
    hp: 300,
    damage: 600,
    speed: 6.0,
    descEs: 'Salta sobre el primer enemigo y lo aplasta en el acto con daño demoledor.',
    descEn: 'Leaps onto the first enemy in sight and crushes it instantly with massive impact.',
  },
  {
    id: 'bonkchoy',
    nameEs: 'Bonk Choy',
    nameEn: 'Bonk Choy',
    roleEs: 'Cuerpo a cuerpo',
    roleEn: 'Melee',
    rarity: 'uncommon',
    rarityLabelEs: 'POCO COMÚN',
    rarityLabelEn: 'UNCOMMON',
    rarityColor: '#22d3ee',
    rarityInitial: 'PC',
    cost: 150,
    img: '/game-assets/greenfoot/bonkchoy1.png',
    hp: 600,
    damage: 65,
    speed: 5.0,
    descEs: 'Boxeador veloz que reparte ráfagas de puñetazos letales a corta distancia.',
    descEn: 'Fast boxer throwing rapid-fire punches at close range.',
  },
  {
    id: 'repeater',
    nameEs: 'Repeater',
    nameEn: 'Repeater',
    roleEs: 'A distancia',
    roleEn: 'Ranged',
    rarity: 'uncommon',
    rarityLabelEs: 'POCO COMÚN',
    rarityLabelEn: 'UNCOMMON',
    rarityColor: '#22d3ee',
    rarityInitial: 'PC',
    cost: 200,
    img: '/game-assets/greenfoot/transparentrepeater.png',
    hp: 300,
    damage: '25 × 2',
    fireRate: '1.2 s',
    descEs: 'Dispara dos guisantes continuos duplicando el poder de fuego por carril.',
    descEn: 'Fires two consecutive peas, doubling firepower on its lane.',
  },
  {
    id: 'melonpult',
    nameEs: 'Melon-pult',
    nameEn: 'Melon-pult',
    roleEs: 'A distancia',
    roleEn: 'Ranged',
    rarity: 'uncommon',
    rarityLabelEs: 'POCO COMÚN',
    rarityLabelEn: 'UNCOMMON',
    rarityColor: '#22d3ee',
    rarityInitial: 'PC',
    cost: 375,
    img: '/game-assets/images/Plants/melon_pult.png',
    hp: 350,
    damage: '80 (Área)',
    fireRate: '2.4 s',
    descEs: 'Catapulta melones gigantescos que causan daño de área masivo al impactar.',
    descEn: 'Lobs giant melons dealing massive splash damage across the impact zone.',
  },
  {
    id: 'potatomine',
    nameEs: 'Potato Mine',
    nameEn: 'Potato Mine',
    roleEs: 'Defensiva',
    roleEn: 'Defensive',
    rarity: 'uncommon',
    rarityLabelEs: 'POCO COMÚN',
    rarityLabelEn: 'UNCOMMON',
    rarityColor: '#22d3ee',
    rarityInitial: 'PC',
    cost: 25,
    img: '/game-assets/greenfoot/potato1.png',
    damage: 1800,
    cooldown: '20 s',
    descEs: 'Tarda unos segundos en armarse. Al ser pisada, detona con daño fulminante de 1,800.',
    descEn: 'Takes a few seconds to arm. When stepped on, explodes for an immense 1,800 damage.',
  },
  {
    id: 'twinsunflower',
    nameEs: 'Twin Sunflower',
    nameEn: 'Twin Sunflower',
    roleEs: 'Productora',
    roleEn: 'Producer',
    rarity: 'rare',
    rarityLabelEs: 'RARA',
    rarityLabelEn: 'RARE',
    rarityColor: '#60a5fa',
    rarityInitial: 'R',
    cost: 125,
    img: '/game-assets/greenfoot/twinsunflower1.png',
    hp: 300,
    cooldown: '10 s',
    descEs: 'Girasol doble que produce el doble de soles para una economía acelerada.',
    descEn: 'Twin sunflower that produces double the sun for rapid economy acceleration.',
  },
  {
    id: 'jalapeno',
    nameEs: 'Jalapeño',
    nameEn: 'Jalapeño',
    roleEs: 'Defensiva',
    roleEn: 'Defensive',
    rarity: 'rare',
    rarityLabelEs: 'RARA',
    rarityLabelEn: 'RARE',
    rarityColor: '#60a5fa',
    rarityInitial: 'R',
    cost: 125,
    img: '/game-assets/plants/jalapeno_hd.png',
    damage: 1000,
    range: 'Carril Entero',
    descEs: 'Detona en llamas consumiendo el carril completo y aniquilando a las tropas enemigas.',
    descEn: 'Explodes in a row of fire, burning the whole lane and annihilating enemies.',
  },
  {
    id: 'aloe',
    nameEs: 'Aloe Curandera',
    nameEn: 'Healer Aloe',
    roleEs: 'Productora',
    roleEn: 'Producer',
    rarity: 'epic',
    rarityLabelEs: 'ÉPICA',
    rarityLabelEn: 'EPIC',
    rarityColor: '#c084fc',
    rarityInitial: 'E',
    cost: 75,
    img: '/game-assets/plants/aloe_hd.png',
    hp: 300,
    healing: '+150 HP',
    descEs: 'Cura a tus plantas adyacentes heridas manteniendo a tus tropas vivas en batalla.',
    descEn: 'Heals damaged adjacent plants, keeping your frontline alive longer.',
  },
  {
    id: 'tallnut',
    nameEs: 'Tall-nut',
    nameEn: 'Tall-nut',
    roleEs: 'Defensiva',
    roleEn: 'Defensive',
    rarity: 'epic',
    rarityLabelEs: 'ÉPICA',
    rarityLabelEn: 'EPIC',
    rarityColor: '#c084fc',
    rarityInitial: 'E',
    cost: 125,
    img: '/game-assets/greenfoot/transparenttallnut.png',
    hp: 2400,
    cooldown: '20 s',
    descEs: 'Nuez gigante colosal: muro infranqueable con un colosal escudo de 2,400 HP.',
    descEn: 'Colossal wall: an impassable barrier boasting an enormous 2,400 HP.',
  },
  {
    id: 'iceberg',
    nameEs: 'Lechuga Helada',
    nameEn: 'Iceberg Lettuce',
    roleEs: 'Defensiva',
    roleEn: 'Defensive',
    rarity: 'legendary',
    rarityLabelEs: 'LEGENDARIA',
    rarityLabelEn: 'LEGENDARY',
    rarityColor: '#fbbf24',
    rarityInitial: 'L',
    cost: 0,
    img: '/game-assets/plants/iceberglettuce_hd.png',
    freeze: '7 s',
    cooldown: '12 s',
    descEs: '¡Coste cero soles! Congela a todas las tropas enemigas en su carril durante 7 segundos completos.',
    descEn: 'Zero sun cost! Freezes all lane enemies solid for 7 full seconds.',
  },
  {
    id: 'threepeater',
    nameEs: 'Threepeater',
    nameEn: 'Threepeater',
    roleEs: 'A distancia',
    roleEn: 'Ranged',
    rarity: 'legendary',
    rarityLabelEs: 'LEGENDARIA',
    rarityLabelEn: 'LEGENDARY',
    rarityColor: '#fbbf24',
    rarityInitial: 'L',
    cost: 325,
    img: '/game-assets/greenfoot/threepeater1.png',
    hp: 300,
    damage: '75 (3 Carriles)',
    fireRate: '1.4 s',
    descEs: 'Dispara guisantes a los 3 carriles simultáneamente, dominando el tablero completo.',
    descEn: 'Fires peas into all 3 lanes simultaneously, controlling the whole board.',
  },
]

type RarityFilter = 'all' | 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'

const RARITY_FILTERS: { key: RarityFilter; labelEs: string; labelEn: string; color?: string }[] = [
  { key: 'all', labelEs: 'Todos', labelEn: 'All' },
  { key: 'common', labelEs: 'Común', labelEn: 'Common', color: '#4ade80' },
  { key: 'uncommon', labelEs: 'Poco Común', labelEn: 'Uncommon', color: '#22d3ee' },
  { key: 'rare', labelEs: 'Rara', labelEn: 'Rare', color: '#60a5fa' },
  { key: 'epic', labelEs: 'Épica', labelEn: 'Epic', color: '#c084fc' },
  { key: 'legendary', labelEs: 'Legendaria', labelEn: 'Legendary', color: '#fbbf24' },
]

export default function LandingPage({ onPlayGame }: LandingPageProps) {
  const [lang, setLang] = useState<'es' | 'en'>('es')
  const [flippedCards, setFlippedCards] = useState<Record<string, boolean>>({})
  const [selectedRarity, setSelectedRarity] = useState<RarityFilter>('all')

  const toggleLang = () => {
    soundManager.playSound('click', 0.4)
    setLang((prev) => (prev === 'es' ? 'en' : 'es'))
  }

  const handleCardFlip = (plantId: string) => {
    soundManager.playSound('click', 0.3)
    setFlippedCards((prev) => ({
      ...prev,
      [plantId]: !prev[plantId],
    }))
  }

  const handlePlayClick = () => {
    soundManager.playSound('click', 0.6)
    onPlayGame()
  }

  return (
    <div className="landing-app">
      {/* NAVBAR */}
      <header className="landing-navbar">
        <a href="#hero" className="landing-navbar__logo">
          <img src={logo} alt="Plant Arena" />
        </a>
        <nav className="landing-navbar__menu">
          <a href="#como-jugar" className="landing-navbar__link">
            {lang === 'es' ? 'Cómo se Juega' : 'How to Play'}
          </a>
          <a href="#plantas" className="landing-navbar__link">
            {lang === 'es' ? 'Plantas' : 'Plants'}
          </a>
          <a href="#arenas" className="landing-navbar__link">
            {lang === 'es' ? 'Arenas' : 'Arenas'}
          </a>
        </nav>
        <div className="landing-navbar__actions">
          <button
            type="button"
            className="landing-lang-btn"
            onClick={toggleLang}
            title={lang === 'es' ? 'Cambiar a inglés' : 'Switch to Spanish'}
          >
            🌐 {lang === 'es' ? 'ES · EN' : 'EN · ES'}
          </button>
          <button
            type="button"
            className="landing-navbar__play-btn"
            onClick={handlePlayClick}
          >
            🎮 {lang === 'es' ? 'JUGAR' : 'PLAY'}
          </button>
        </div>
      </header>

      {/* HERO SECTION */}
      <section
        id="hero"
        className="landing-hero"
        style={{ backgroundImage: `url(${bgImage})` }}
      >
        <div className="landing-hero__scrim"></div>
        <img src={plant1} alt="" className="landing-hero__plant-l" />
        <img src={plant2} alt="" className="landing-hero__plant-r" />

        <div className="landing-hero__content">
          <img src={logo} alt="Plant Arena" className="landing-hero__logo" />
          <h1 className="landing-hero__headline">
            {lang === 'es' ? (
              <>
                PLANTA. ATACA.<br />
                <span className="landing-highlight">DOMINA LA ARENA.</span>
              </>
            ) : (
              <>
                PLANT. ATTACK.<br />
                <span className="landing-highlight">CLIMB THE ARENA.</span>
              </>
            )}
          </h1>
          <p className="landing-hero__desc">
            {lang === 'es'
              ? 'Estrategia PvP en tiempo real: recolecta soles, despliega tu mazo de 6 cartas en 3 carriles y derriba el Árbol Madre rival antes de que derribe el tuyo.'
              : 'Real-time PvP strategy: collect sun, deploy your 6-plant deck across 3 lanes, and bring down the rival Mother Tree before it takes down yours.'}
          </p>

          <div className="landing-hero__ctas">
            <button
              type="button"
              className="landing-btn-primary"
              onClick={handlePlayClick}
            >
              ⚔️ {lang === 'es' ? '¡JUGAR AHORA!' : 'PLAY NOW!'}
            </button>
            <a
              href="/roadmap.html"
              target="_blank"
              rel="noreferrer"
              className="landing-btn-secondary"
            >
              🗺️ Road Map
            </a>
            <a
              href="https://t.me/"
              target="_blank"
              rel="noreferrer"
              className="landing-btn-secondary"
            >
              💬 Telegram
            </a>
          </div>

          <div className="landing-hero__release-banner">
            <div className="landing-beta-badge">
              <span className="landing-beta-pulse"></span>
              <span className="landing-beta-tag">BETA</span>
            </div>
            <div className="landing-release-content">
              <span className="landing-release-subtitle">
                {lang === 'es' ? '🚀 FECHA DE LANZAMIENTO' : '🚀 LAUNCH DATE'}
              </span>
              <span className="landing-release-date">
                {lang === 'es' ? 'Viernes 21 de Agosto' : 'Friday, August 21'}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* HOW TO PLAY */}
      <section id="como-jugar" className="landing-section">
        <div className="landing-container">
          <div className="landing-title-wrap">
            <span className="landing-pill landing-pill--red">
              {lang === 'es' ? 'MECÁNICAS DE JUEGO' : 'HOW TO PLAY'}
            </span>
            <h2 className="landing-arcade-title">
              {lang === 'es'
                ? 'TRES MINUTOS PARA APRENDER. MESES PARA DOMINAR.'
                : 'THREE MINUTES TO LEARN. MONTHS TO MASTER.'}
            </h2>
          </div>

          <div className="landing-steps-grid">
            <div className="landing-step-card">
              <div className="landing-step-card__bar" style={{ background: '#fbbf24' }}></div>
              <div className="landing-step-card__body">
                <div className="landing-step-card__header">
                  <span className="landing-step-num" style={{ background: '#fbbf24', color: '#451a03' }}>01</span>
                  <img src="/game-assets/greenfoot/sun1.png" alt="Soles" className="landing-step-icon landing-spin" />
                </div>
                <h3 className="landing-step-title">
                  {lang === 'es' ? 'Recolecta Soles' : 'Collect Sun'}
                </h3>
                <p className="landing-step-text">
                  {lang === 'es'
                    ? 'Los girasoles generan soles de 25 en 25. Cada planta tiene un coste: 25 una Patata Mina, 375 un Melón-pult. Comienzas desde cero, ¡toda la energía se gana en el campo!'
                    : 'Sunflowers produce sun in 25-point units. Every card has a cost: 25 for Potato Mine, 375 for Melon-pult. You start from zero — earn it on the field!'}
                </p>
              </div>
            </div>

            <div className="landing-step-card">
              <div className="landing-step-card__bar" style={{ background: '#22c55e' }}></div>
              <div className="landing-step-card__body">
                <div className="landing-step-card__header">
                  <span className="landing-step-num" style={{ background: '#22c55e', color: '#052e16' }}>02</span>
                  <img src="/game-assets/greenfoot/peashooterpacket1.png" alt="Mazo" className="landing-step-icon" />
                </div>
                <h3 className="landing-step-title">
                  {lang === 'es' ? 'Despliega tu Mazo' : 'Deploy Your Deck'}
                </h3>
                <p className="landing-step-text">
                  {lang === 'es'
                    ? 'Elige 6 cartas antes de cada batalla: productoras, atacantes a distancia, tanques defensivos y tropas cuerpo a cuerpo. Tu sinergia y tiempos de enfriamiento definirán la partida.'
                    : 'Equip 6 cards per match: resource producers, ranged snipers, defensive tanks, and frontline melee warriors. Your deck synergy decides the battle.'}
                </p>
              </div>
            </div>

            <div className="landing-step-card">
              <div className="landing-step-card__bar" style={{ background: '#ef4444' }}></div>
              <div className="landing-step-card__body">
                <div className="landing-step-card__header">
                  <span className="landing-step-num" style={{ background: '#ef4444', color: '#ffffff' }}>03</span>
                  <img src="/game-assets/greenfoot/bonkchoy1.png" alt="Derribar Base" className="landing-step-icon" />
                </div>
                <h3 className="landing-step-title">
                  {lang === 'es' ? 'Derriba la Base Rival' : 'Destroy the Rival Base'}
                </h3>
                <p className="landing-step-text">
                  {lang === 'es'
                    ? 'Las tropas cuerpo a cuerpo avanzan por su carril hasta impactar el Árbol Madre rival de 600 HP. ¡Quien destruya la base contraria gana copas Elo y sobres de cartas gratis!'
                    : 'Melee plants march down their lanes to hit the 600 HP enemy Mother Tree. The first to topple the enemy base wins trophies and free reward card packs!'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* LIVE BATTLEFIELD PREVIEW */}
      <section className="landing-demo-wrap">
        <div className="landing-container">
          <div className="landing-demo-card">
            <div className="landing-demo-stage">
              <img src={arena1Bg} alt="" className="landing-demo-bg" />
              <div className="landing-demo-overlay"></div>

              {/* Sun count tag */}
              <div className="landing-demo-sun-tag">
                <img src="/game-assets/greenfoot/sun1.png" alt="" /> 225 ☀
              </div>

              {/* Enemy Base HP Bar */}
              <div className="landing-demo-gauge">
                <span className="landing-demo-gauge__lbl">
                  {lang === 'es' ? 'ÁRBOL MADRE ENEMIGO' : 'ENEMY MOTHER TREE'}
                </span>
                <div className="landing-demo-gauge__bar">
                  <div className="landing-demo-gauge__fill"></div>
                </div>
              </div>

              {/* Player Mother Tree (Left) */}
              <div className="landing-demo-player-tree">
                <img src="/game-assets/greenfoot/mothertree_whitebg.png" alt="" />
                <span className="landing-demo-tree-badge" style={{ color: '#86efac' }}>600 / 600 HP</span>
              </div>

              {/* Enemy Mother Tree (Right) */}
              <div className="landing-demo-enemy-tree">
                <img src="/game-assets/greenfoot/mothertree_whitebg.png" alt="" />
                <span className="landing-demo-tree-badge" style={{ color: '#fca5a5' }}>215 / 600 HP</span>
                {/* Floating Damage Numbers */}
                <div className="landing-dmg-float-1">-65</div>
                <div className="landing-dmg-float-2">-25</div>
                <div className="landing-dmg-float-3">-80</div>
              </div>

              {/* Lane dashed lines */}
              <div className="landing-demo-lane-line" style={{ top: '22%' }}></div>
              <div className="landing-demo-lane-line" style={{ top: '56%' }}></div>

              {/* Lane 1 (Top): Sunflower producing sun + Cactus marching */}
              <img src="/game-assets/greenfoot/transparentsunflower.png" alt="" className="landing-demo-unit landing-bounce" style={{ left: '16%', top: '23%', height: '15%' }} />
              <div className="landing-sun-produce">☀</div>
              <img src="/game-assets/greenfoot/cactus1.png" alt="" className="landing-demo-unit landing-cactus-march" style={{ top: '22%', height: '15%' }} />

              {/* Lane 2 (Mid): Peashooter shooting rapid peas -> Enemy Wallnut */}
              <img src="/game-assets/greenfoot/transparentpeashooter.png" alt="" className="landing-demo-unit landing-peashooter-recoil" style={{ left: '18%', top: '42%', height: '15%' }} />
              <div className="landing-pea-1"></div>
              <div className="landing-pea-2"></div>
              <div className="landing-pea-3"></div>
              <img src="/game-assets/greenfoot/transparentwalnut.png" alt="" className="landing-demo-unit landing-enemy-unit" style={{ right: '18%', top: '42%', height: '14%', transform: 'scaleX(-1)', filter: 'hue-rotate(300deg)' }} />
              <div className="landing-hit-spark">💥</div>

              {/* Lane 3 (Bot): Wall-nut defense + Bonk Choy marching & punching */}
              <img src="/game-assets/greenfoot/transparentwalnut.png" alt="" className="landing-demo-unit" style={{ left: '26%', top: '61%', height: '14%' }} />
              <img src="/game-assets/greenfoot/bonkchoy1.png" alt="" className="landing-demo-unit landing-bonk-march" style={{ top: '60%', height: '15%' }} />
              <div className="landing-punch-fx">🥊</div>

              {/* Falling Sun Drops */}
              <img src="/game-assets/greenfoot/sun1.png" alt="" className="landing-demo-sunfall-1" />
              <img src="/game-assets/greenfoot/sun1.png" alt="" className="landing-demo-sunfall-2" />

              {/* Deck Dock at bottom */}
              <div className="landing-demo-dock">
                <img src="/game-assets/greenfoot/transparentsunflower.png" alt="" title="Sunflower" />
                <img src="/game-assets/greenfoot/transparentpeashooter.png" alt="" title="Peashooter" />
                <img src="/game-assets/greenfoot/transparentwalnut.png" alt="" title="Wall-nut" />
                <img src="/game-assets/greenfoot/bonkchoy1.png" alt="" style={{ opacity: 0.5 }} title="Bonk Choy (Recarga)" />
                <img src="/game-assets/greenfoot/potato1.png" alt="" title="Potato Mine" />
                <img src="/game-assets/greenfoot/threepeater1.png" alt="" style={{ opacity: 0.5 }} title="Threepeater (Recarga)" />
              </div>
            </div>

            {/* Clean Info Footer without redundant play button */}
            <div className="landing-demo-footer">
              <span className="landing-demo-status">
                <span className="landing-demo-dot"></span>
                {lang === 'es' ? 'Simulación en Vivo · Combate 3 Carriles' : 'Live Simulation · 3-Lane Battle'}
              </span>
              <span className="landing-demo-extra-info">
                {lang === 'es' ? '⚔️ Tiempo Real · Estrategia PvP' : '⚔️ Real-Time · PvP Strategy'}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* PLANT COLLECTION */}
      <section id="plantas" className="landing-section landing-section--dark">
        <div className="landing-container">
          <div className="landing-title-wrap">
            <span className="landing-pill landing-pill--green">
              {lang === 'es' ? 'COLECCIÓN DE CARTAS' : 'CARD COLLECTION'}
            </span>
            <h2 className="landing-arcade-title">
              {lang === 'es' ? '15 PLANTAS, 4 ROLES ESTRATÉGICOS' : '15 PLANTS, 4 TACTICAL ROLES'}
            </h2>
            <p style={{ color: '#e2e8f0', fontSize: '16px', maxWidth: '600px' }}>
              {lang === 'es'
                ? 'Haz clic o toca cualquier carta para voltearla y ver sus estadísticas oficiales del juego.'
                : 'Click or tap any card to flip it and inspect its official in-game stats.'}
            </p>
          </div>

          <div className="landing-rarity-legend">
            {RARITY_FILTERS.map((filter) => {
              const isActive = selectedRarity === filter.key
              const count =
                filter.key === 'all'
                  ? PLANTS_DATA.length
                  : PLANTS_DATA.filter((p) => p.rarity === filter.key).length

              return (
                <button
                  key={filter.key}
                  type="button"
                  className={`landing-rarity-pill ${isActive ? 'is-active' : ''}`}
                  style={
                    isActive && filter.color
                      ? {
                          borderColor: filter.color,
                          boxShadow: `0 0 16px ${filter.color}55`,
                          color: '#ffffff',
                        }
                      : undefined
                  }
                  onClick={() => {
                    soundManager.playSound('click', 0.3)
                    setSelectedRarity(filter.key)
                  }}
                >
                  {filter.color ? (
                    <span style={{ background: filter.color }} />
                  ) : (
                    <span
                      style={{
                        background:
                          'linear-gradient(135deg, #4ade80 0%, #22d3ee 25%, #60a5fa 50%, #c084fc 75%, #fbbf24 100%)',
                      }}
                    />
                  )}
                  {lang === 'es' ? filter.labelEs : filter.labelEn}
                  <span className="landing-rarity-count">({count})</span>
                </button>
              )
            })}
          </div>

          <div className="landing-plants-grid">
            {(selectedRarity === 'all'
              ? PLANTS_DATA
              : PLANTS_DATA.filter((plant) => plant.rarity === selectedRarity)
            ).map((plant) => {
              const isFlipped = !!flippedCards[plant.id]
              return (
                <div
                  key={plant.id}
                  className="landing-plant-card"
                  onClick={() => handleCardFlip(plant.id)}
                >
                  <div className={`landing-plant-card__inner ${isFlipped ? 'is-flipped' : ''}`}>
                    {/* Front */}
                    <div
                      className="landing-plant-card__front"
                      style={{
                        background: `linear-gradient(180deg, ${plant.rarityColor}28, #0b1612)`,
                        borderColor: plant.rarityColor,
                      }}
                    >
                      <div className="landing-plant-topbar">
                        <span
                          className="landing-plant-rarity-tag"
                          style={{ color: plant.rarityColor, borderColor: plant.rarityColor, background: `${plant.rarityColor}22` }}
                        >
                          {lang === 'es' ? plant.rarityLabelEs : plant.rarityLabelEn}
                        </span>
                        <span className="landing-plant-rarity-letter" style={{ background: plant.rarityColor }}>
                          {plant.rarityInitial}
                        </span>
                      </div>

                      <img src={plant.img} alt={plant.nameEs} className="landing-plant-img" />

                      <div className="landing-plant-meta">
                        <span className="landing-plant-name">
                          {lang === 'es' ? plant.nameEs : plant.nameEn}
                        </span>
                        <span className="landing-plant-role" style={{ color: plant.rarityColor }}>
                          {lang === 'es' ? plant.roleEs : plant.roleEn}
                        </span>
                        <span className="landing-plant-cost">
                          <img src="/game-assets/greenfoot/sun1.png" alt="" />
                          {plant.cost} ☀
                        </span>
                        <span className="landing-plant-hint">
                          🔄 {lang === 'es' ? 'Toca para ver stats' : 'Tap for stats'}
                        </span>
                      </div>
                    </div>

                    {/* Back */}
                    <div
                      className="landing-plant-card__back"
                      style={{ borderColor: plant.rarityColor }}
                    >
                      <span className="landing-plant-back-title" style={{ color: plant.rarityColor }}>
                        {lang === 'es' ? plant.nameEs : plant.nameEn}
                      </span>
                      {plant.hp && (
                        <div className="landing-stat-row">
                          <span>HP</span>
                          <span className="landing-stat-val">{plant.hp}</span>
                        </div>
                      )}
                      {plant.damage && (
                        <div className="landing-stat-row">
                          <span>{lang === 'es' ? 'Daño' : 'Damage'}</span>
                          <span className="landing-stat-val">{plant.damage}</span>
                        </div>
                      )}
                      {plant.fireRate && (
                        <div className="landing-stat-row">
                          <span>{lang === 'es' ? 'Cadencia' : 'Fire rate'}</span>
                          <span className="landing-stat-val">{plant.fireRate}</span>
                        </div>
                      )}
                      {plant.speed && (
                        <div className="landing-stat-row">
                          <span>{lang === 'es' ? 'Velocidad' : 'Speed'}</span>
                          <span className="landing-stat-val">{plant.speed}</span>
                        </div>
                      )}
                      {plant.freeze && (
                        <div className="landing-stat-row">
                          <span>{lang === 'es' ? 'Congelación' : 'Freeze'}</span>
                          <span className="landing-stat-val">{plant.freeze}</span>
                        </div>
                      )}
                      {plant.healing && (
                        <div className="landing-stat-row">
                          <span>{lang === 'es' ? 'Curación' : 'Healing'}</span>
                          <span className="landing-stat-val">{plant.healing}</span>
                        </div>
                      )}
                      {plant.range && (
                        <div className="landing-stat-row">
                          <span>{lang === 'es' ? 'Alcance' : 'Range'}</span>
                          <span className="landing-stat-val">{plant.range}</span>
                        </div>
                      )}
                      <div className="landing-stat-row">
                        <span>{lang === 'es' ? 'Coste' : 'Cost'}</span>
                        <span className="landing-stat-val">{plant.cost} ☀</span>
                      </div>
                      {plant.cooldown && (
                        <div className="landing-stat-row">
                          <span>{lang === 'es' ? 'Enfriamiento' : 'Cooldown'}</span>
                          <span className="landing-stat-val">{plant.cooldown}</span>
                        </div>
                      )}
                      <p className="landing-plant-back-desc">
                        {lang === 'es' ? plant.descEs : plant.descEn}
                      </p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* 5 ARENAS & RANKING */}
      <section id="arenas" className="landing-section">
        <div className="landing-container">
          <div className="landing-title-wrap">
            <span className="landing-pill landing-pill--gold">
              {lang === 'es' ? 'CAMINO DE ARENAS' : 'ARENAS ROAD'}
            </span>
            <h2 className="landing-arcade-title">
              {lang === 'es' ? '5 ARENAS. UN SOLO CAMINO A LA GLORIA.' : '5 ARENAS. ONE ROAD TO GLORY.'}
            </h2>
            <p style={{ color: '#e2e8f0', fontSize: '16px', maxWidth: '680px' }}>
              {lang === 'es'
                ? 'Empiezas con 1000 de Elo en el Jardín Clásico. Cada victoria te otorga copas para ascender y desbloquear nuevas cartas y campos.'
                : 'Start at 1000 Elo in the Classic Garden. Every victory earns trophies to climb and unlock new cards and battlegrounds.'}
            </p>
          </div>

          <div className="landing-ladder-bar"></div>

          <div className="landing-arenas-grid">
            {/* Arena 1 */}
            <div className="landing-arena-card" style={{ borderColor: '#4ade80' }}>
              <div className="landing-arena-img-wrap">
                <img src={arena1Bg} alt="Arena 1" />
                <div className="landing-arena-scrim"></div>
                <span className="landing-arena-tag" style={{ background: '#4ade80', color: '#052e16' }}>ARENA 1</span>
                <span className="landing-arena-num" style={{ color: '#4ade80' }}>1</span>
              </div>
              <div className="landing-arena-body">
                <h3 className="landing-arena-name">{lang === 'es' ? 'Jardín Clásico' : 'Classic Garden'}</h3>
                <span className="landing-arena-elo" style={{ color: '#4ade80' }}>
                  <img src={rankingIco} alt="" /> 0 – 1600 ELO
                </span>
                <p className="landing-arena-desc">
                  {lang === 'es' ? 'Campo de césped tradicional bajo un sol resplandeciente.' : 'Traditional grass field under a bright sun.'}
                </p>
                <div className="landing-arena-pills">
                  <span className="landing-payout" style={{ background: '#4ade80', color: '#052e16' }}>🏆 +15 Elo</span>
                  <span className="landing-payout" style={{ background: 'rgba(239,68,68,0.85)', color: '#fff' }}>−8 Elo</span>
                </div>
              </div>
            </div>

            {/* Arena 2 */}
            <div className="landing-arena-card" style={{ borderColor: '#60a5fa' }}>
              <div className="landing-arena-img-wrap">
                <img src={arena2Bg} alt="Arena 2" />
                <div className="landing-arena-scrim"></div>
                <span className="landing-arena-tag" style={{ background: '#60a5fa', color: '#082f49' }}>ARENA 2</span>
                <span className="landing-arena-num" style={{ color: '#60a5fa' }}>2</span>
              </div>
              <div className="landing-arena-body">
                <h3 className="landing-arena-name">{lang === 'es' ? 'Desierto Nocturno' : 'Night Desert'}</h3>
                <span className="landing-arena-elo" style={{ color: '#60a5fa' }}>
                  <img src={rankingIco} alt="" /> 1601 – 2000 ELO
                </span>
                <p className="landing-arena-desc">
                  {lang === 'es' ? 'Dunas arenosas con cactus bioluminiscentes bajo la luna llena.' : 'Sandy dunes with glowing bioluminescent cacti under the full moon.'}
                </p>
                <div className="landing-arena-pills">
                  <span className="landing-payout" style={{ background: '#60a5fa', color: '#082f49' }}>🏆 +12 Elo</span>
                  <span className="landing-payout" style={{ background: 'rgba(239,68,68,0.85)', color: '#fff' }}>−8 Elo</span>
                </div>
              </div>
            </div>

            {/* Arena 3 */}
            <div className="landing-arena-card" style={{ borderColor: '#c084fc' }}>
              <div className="landing-arena-img-wrap">
                <img src={arena3Bg} alt="Arena 3" />
                <div className="landing-arena-scrim"></div>
                <span className="landing-arena-tag" style={{ background: '#c084fc', color: '#3b0764' }}>ARENA 3</span>
                <span className="landing-arena-num" style={{ color: '#c084fc' }}>3</span>
              </div>
              <div className="landing-arena-body">
                <h3 className="landing-arena-name">{lang === 'es' ? 'Rascacielos Cyberpunk' : 'Cyberpunk Skyline'}</h3>
                <span className="landing-arena-elo" style={{ color: '#c084fc' }}>
                  <img src={rankingIco} alt="" /> 2001 – 3000 ELO
                </span>
                <p className="landing-arena-desc">
                  {lang === 'es' ? 'Azotea futurista iluminada por neones sobre una gran metrópolis.' : 'Futuristic neon-lit rooftop towering high above the metropolis.'}
                </p>
                <div className="landing-arena-pills">
                  <span className="landing-payout" style={{ background: '#c084fc', color: '#3b0764' }}>🏆 +10 Elo</span>
                  <span className="landing-payout" style={{ background: 'rgba(239,68,68,0.85)', color: '#fff' }}>−8 Elo</span>
                </div>
              </div>
            </div>

            {/* Arena 4 */}
            <div className="landing-arena-card" style={{ borderColor: '#fde047' }}>
              <div className="landing-arena-img-wrap">
                <img src={arena4Bg} alt="Arena 4" />
                <div className="landing-arena-scrim"></div>
                <span className="landing-arena-tag" style={{ background: '#fde047', color: '#451a03' }}>ARENA 4</span>
                <span className="landing-arena-num" style={{ color: '#fde047' }}>4</span>
              </div>
              <div className="landing-arena-body">
                <h3 className="landing-arena-name">{lang === 'es' ? 'Coliseo Galáctico' : 'Galactic Colosseum'}</h3>
                <span className="landing-arena-elo" style={{ color: '#fde047' }}>
                  <img src={rankingIco} alt="" /> 3001 – 4000 ELO
                </span>
                <p className="landing-arena-desc">
                  {lang === 'es' ? 'Plataforma orbital suspendida entre nebulosas y meteoritos.' : 'Orbital platform suspended between nebulas and meteor showers.'}
                </p>
                <div className="landing-arena-pills">
                  <span className="landing-payout" style={{ background: '#fde047', color: '#451a03' }}>🏆 +8 Elo</span>
                  <span className="landing-payout" style={{ background: 'rgba(239,68,68,0.85)', color: '#fff' }}>−7 Elo</span>
                </div>
              </div>
            </div>

            {/* Arena 5 */}
            <div className="landing-arena-card" style={{ borderColor: '#f43f5e' }}>
              <div className="landing-arena-img-wrap">
                <img src={arena5Bg} alt="Arena 5" />
                <div className="landing-arena-scrim"></div>
                <span className="landing-arena-tag" style={{ background: '#f43f5e', color: '#ffffff' }}>ARENA 5</span>
                <span className="landing-arena-num" style={{ color: '#f43f5e' }}>5</span>
              </div>
              <div className="landing-arena-body">
                <h3 className="landing-arena-name">{lang === 'es' ? 'Olimpo de Leyendas' : 'Olympus of Legends'}</h3>
                <span className="landing-arena-elo" style={{ color: '#f43f5e' }}>
                  <img src={rankingIco} alt="" /> 4001+ ELO
                </span>
                <p className="landing-arena-desc">
                  {lang === 'es' ? 'Templo dorado supremo reservado solo para los campeones mundiales.' : 'Supreme golden temple reserved only for world champions.'}
                </p>
                <div className="landing-arena-pills">
                  <span className="landing-payout" style={{ background: '#f43f5e', color: '#ffffff' }}>🏆 +6 Elo</span>
                  <span className="landing-payout" style={{ background: 'rgba(239,68,68,0.85)', color: '#fff' }}>−6 Elo</span>
                </div>
              </div>
            </div>
          </div>

          <div className="landing-features-trio">
            <div className="landing-feature-box">
              <img src="/game-assets/greenfoot/seed_pack_common_whitebg.png" alt="Sobres" />
              <div>
                <h4>{lang === 'es' ? 'Sobres por Victoria' : 'Packs on Win'}</h4>
                <p>{lang === 'es' ? 'Cada partida ganada en la arena te otorga un sobre de semillas gratuito.' : 'Every victory earned awards a free seed reward pack.'}</p>
              </div>
            </div>
            <div className="landing-feature-box">
              <img src="/game-assets/greenfoot/seed_pack_epic_whitebg.png" alt="Ranuras" />
              <div>
                <h4>{lang === 'es' ? '4 Ranuras de Sobres' : '4 Free Pack Slots'}</h4>
                <p>{lang === 'es' ? 'Sistema estilo Clash Royale: desbloquea sobres por tiempo de forma 100% gratuita.' : 'Clash Royale style system: time-unlock packs completely free.'}</p>
              </div>
            </div>
            <div className="landing-feature-box">
              <img src="/game-assets/greenfoot/seed_pack_legendary_whitebg.png" alt="Mejoras" />
              <div>
                <h4>{lang === 'es' ? 'Fusión & Mejoras' : 'Fusion & Upgrades'}</h4>
                <p>{lang === 'es' ? 'Acumula copias repetidas para fusionar y otorgar +15% de HP y daño por nivel.' : 'Collect duplicate cards to fuse: +15% HP & damage per level.'}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA BANNER */}
      <section className="landing-cta-banner">
        <div className="landing-container">
          <div className="landing-cta-box">
            <h2 className="landing-arcade-title" style={{ fontSize: 'clamp(34px, 5vw, 54px)' }}>
              {lang === 'es' ? '¡TU MAZO TE ESPERA EN LA ARENA!' : 'YOUR DECK AWAITS IN THE ARENA!'}
            </h2>
            <p style={{ fontSize: '18px', maxWidth: '600px', color: '#fef2f2' }}>
              {lang === 'es'
                ? 'Empieza tu primera partida en menos de 10 segundos directamente desde tu navegador, en PC o móvil.'
                : 'Launch your first match in under 10 seconds directly in your browser on PC or mobile.'}
            </p>
            <button
              type="button"
              className="landing-btn-primary"
              style={{ fontSize: '22px', padding: '18px 44px' }}
              onClick={handlePlayClick}
            >
              🎮 {lang === 'es' ? '¡ENTRAR AL JUEGO AHORA!' : 'PLAY THE GAME NOW!'}
            </button>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="landing-footer">
        <div className="landing-container">
          <div className="landing-footer__grid">
            <div className="landing-footer__brand">
              <img src={logo} alt="Plant Arena" />
              <p>
                {lang === 'es'
                  ? 'Plant Arena es un juego de estrategia en tiempo real 100% web, jugable sin descargas en cualquier dispositivo.'
                  : 'Plant Arena is a real-time PvP strategy game, instantly playable in your browser without downloads.'}
              </p>
            </div>
            <div className="landing-footer__col">
              <h4>{lang === 'es' ? 'Navegación' : 'Navigation'}</h4>
              <a href="#como-jugar">{lang === 'es' ? 'Cómo se Juega' : 'How to Play'}</a>
              <a href="#plantas">{lang === 'es' ? '15 Plantas' : '15 Plants'}</a>
              <a href="#arenas">{lang === 'es' ? '5 Arenas & Elo' : '5 Arenas & Elo'}</a>
            </div>
            <div className="landing-footer__col">
              <h4>{lang === 'es' ? 'Comunidad' : 'Community'}</h4>
              <a href="https://t.me/" target="_blank" rel="noreferrer">Telegram</a>
              <a href="#hero" onClick={handlePlayClick}>{lang === 'es' ? 'Jugar en Navegador' : 'Play in Browser'}</a>
            </div>
            <div className="landing-footer__col">
              <h4>{lang === 'es' ? 'Proyecto' : 'Project'}</h4>
              <span>Fanmade PvZ PvP</span>
              <span style={{ color: '#64748b' }}>Vite + TypeScript + React</span>
            </div>
          </div>
          <div className="landing-footer__bottom">
            <span>© 2026 Plant Arena. Todos los derechos reservados.</span>
            <span>{lang === 'es' ? 'Optimizado para PC y dispositivos móviles.' : 'Optimized for desktop and mobile devices.'}</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
