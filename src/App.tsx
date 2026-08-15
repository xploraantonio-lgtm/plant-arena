import { useState, useEffect } from 'react'
import type { PlantId } from './types/game'
import GameFrame from './components/GameFrame/GameFrame'
import RotateOverlay from './components/RotateOverlay/RotateOverlay'
import MainMenu from './components/MainMenu/MainMenu'
import Battlefield from './components/Battlefield/Battlefield'
import Collection from './components/Collection/Collection'
import Jardin from './components/Jardin/Jardin'
import Shop from './components/Shop/Shop'
import Ranking from './components/Ranking/Ranking'
import LandingPage from './components/LandingPage/LandingPage'
import PackOpeningModal from './components/PackOpeningModal/PackOpeningModal'
import { useInventory } from './hooks/useInventory'
import type { PackDropResult, PackId } from './utils/packDropManager'

import { getEloDeltasForElo } from './utils/arenaManager'

const DEFAULT_DECK: PlantId[] = [
  'sunflower',
  'peashooter',
  'wallnut',
  'bonkchoy',
  'squash',
  'threepeater',
]

function App() {
  const [screen, setScreen] = useState<'landing' | 'menu' | 'battle' | 'collection' | 'jardin' | 'shop' | 'ranking'>(() => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname.toLowerCase()
      if (path.startsWith('/play') || window.location.hash === '#play') {
        return 'menu'
      }
    }
    return 'landing'
  })
  const [practicePlantId, setPracticePlantId] = useState<string | null>(null)
  const [activeDeck, setActiveDeck] = useState<PlantId[]>(DEFAULT_DECK)
  const [activeOpeningResult, setActiveOpeningResult] = useState<PackDropResult | PackDropResult[] | null>(null)
  const [lastOpenedPackType, setLastOpenedPackType] = useState<PackId | null>(null)

  const [userElo, setUserElo] = useState<number>(1000)
  const [customArenaBg, setCustomArenaBg] = useState<string | undefined>(undefined)

  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname.toLowerCase()
      if (path.startsWith('/play') || window.location.hash === '#play') {
        setScreen((prev) => (prev === 'landing' ? 'menu' : prev))
      } else {
        setScreen('landing')
      }
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const {
    userTokens,
    addTokens,
    inventoryPacks,
    unlockedPlants,
    plantCopies,
    plantLevels,
    hasVipPass,
    claimedVipLevels,
    freePackSlots,
    buyPack,
    openPackByInstanceId,
    openPackByType,
    openMultiplePacksByInstanceIds,
    fuseAndUpgradePlant,
    buyVipPass,
    claimPassReward,
    awardVictoryPack,
    startUnlockingSlot,
    fastUnlockSlot,
    openSlotPack,
  } = useInventory()

  const handleGoToGame = () => {
    setScreen('menu')
    try {
      if (typeof window !== 'undefined' && window.location.protocol !== 'file:' && !window.location.pathname.startsWith('/play')) {
        window.history.pushState(null, '', '/play')
      }
    } catch {
      // Safe fallback
    }
  }

  const handleGoToLanding = () => {
    setScreen('landing')
    try {
      if (typeof window !== 'undefined' && window.location.protocol !== 'file:' && window.location.pathname !== '/') {
        window.history.pushState(null, '', '/')
      }
    } catch {
      // Safe fallback
    }
  }

  const handlePlayNormal = () => {
    setPracticePlantId(null)
    setCustomArenaBg(undefined)
    setScreen('battle')
  }

  const handleOpenCollection = () => {
    setScreen('collection')
  }

  const handleOpenJardin = () => {
    setScreen('jardin')
  }

  const handleOpenShop = () => {
    setScreen('shop')
  }

  const handleOpenRanking = () => {
    setScreen('ranking')
  }

  const handlePracticePlant = (plantId: string) => {
    setPracticePlantId(plantId)
    setCustomArenaBg(undefined)
    setScreen('battle')
  }

  const handleTriggerPackOpenByInstanceId = (instanceId: string) => {
    const packObj = inventoryPacks.find((p) => p.instanceId === instanceId)
    if (packObj) {
      setLastOpenedPackType(packObj.packId)
    }
    const drop = openPackByInstanceId(instanceId)
    if (drop) {
      setActiveOpeningResult(drop)
    }
  }

  const handleOpenMultiplePacks = (instanceIds: string[]) => {
    if (instanceIds.length === 0) return
    const packObj = inventoryPacks.find((p) => p.instanceId === instanceIds[0])
    if (packObj) {
      setLastOpenedPackType(packObj.packId)
    }
    const drops = openMultiplePacksByInstanceIds(instanceIds)
    if (drops.length > 0) {
      setActiveOpeningResult(drops)
    }
  }

  const handleOpenAnotherPack = () => {
    if (!lastOpenedPackType) return
    const drop = openPackByType(lastOpenedPackType)
    if (drop) {
      setActiveOpeningResult(drop)
    } else {
      setActiveOpeningResult(null)
    }
  }

  const handleOpenSlotPack = (slotId: number) => {
    const drop = openSlotPack(slotId)
    if (drop) {
      setActiveOpeningResult(drop)
    }
  }

  const handleBattleComplete = (isVictory: boolean) => {
    const deltas = getEloDeltasForElo(userElo)
    if (isVictory) {
      const newElo = userElo + deltas.winElo
      setUserElo(newElo)
      const packResult = awardVictoryPack(newElo)
      return { winElo: deltas.winElo, newElo, packResult }
    } else {
      const newElo = Math.max(0, userElo - deltas.loseElo)
      setUserElo(newElo)
      return { loseElo: deltas.loseElo, newElo }
    }
  }

  const handleSurrender = () => {
    const deltas = getEloDeltasForElo(userElo)
    const newElo = Math.max(0, userElo - deltas.surrenderElo)
    setUserElo(newElo)
    return { surrenderElo: deltas.surrenderElo, newElo }
  }

  const hasMorePacksOfSameType = lastOpenedPackType
    ? inventoryPacks.some((p) => p.packId === lastOpenedPackType)
    : false

  if (screen === 'landing') {
    return <LandingPage onPlayGame={handleGoToGame} />
  }

  return (
    <>
      <GameFrame>
        {screen === 'menu' && (
          <MainMenu
            userElo={userElo}
            freePackSlots={freePackSlots}
            onPlay={handlePlayNormal}
            onOpenCollection={handleOpenCollection}
            onOpenJardin={handleOpenJardin}
            onOpenShop={handleOpenShop}
            onOpenRanking={handleOpenRanking}
            onOpenLanding={handleGoToLanding}
            onStartSlotUnlock={startUnlockingSlot}
            onFastUnlockSlot={fastUnlockSlot}
            onOpenSlotPack={handleOpenSlotPack}
          />
        )}
        {screen === 'battle' && (
          <Battlefield
            onBackToMenu={() => setScreen('menu')}
            onBackToCollection={() => setScreen('collection')}
            onBattleComplete={handleBattleComplete}
            onSurrender={handleSurrender}
            practicePlantId={practicePlantId}
            activeDeck={activeDeck}
            userElo={userElo}
            customBgImage={customArenaBg}
          />
        )}
        {screen === 'collection' && (
          <Collection
            onBack={() => setScreen('menu')}
            onPracticePlant={handlePracticePlant}
          />
        )}
        {screen === 'jardin' && (
          <Jardin
            activeDeck={activeDeck}
            unlockedPlants={unlockedPlants}
            inventoryPacks={inventoryPacks}
            userTokens={userTokens}
            plantCopies={plantCopies}
            plantLevels={plantLevels}
            onUpdateDeck={setActiveDeck}
            onBack={() => setScreen('menu')}
            onPlay={handlePlayNormal}
            onOpenCollection={handleOpenCollection}
            onOpenShop={handleOpenShop}
            onOpenPack={handleTriggerPackOpenByInstanceId}
            onOpenMultiplePacks={handleOpenMultiplePacks}
            onFusePlant={fuseAndUpgradePlant}
          />
        )}
        {screen === 'shop' && (
          <Shop
            userTokens={userTokens}
            userElo={userElo}
            hasVipPass={hasVipPass}
            claimedVipLevels={claimedVipLevels}
            inventoryPacks={inventoryPacks}
            onBack={() => setScreen('menu')}
            onBuyPack={buyPack}
            onOpenJardin={handleOpenJardin}
            onAddTokens={addTokens}
            onOpenPackImmediately={handleTriggerPackOpenByInstanceId}
            onOpenMultiplePacks={handleOpenMultiplePacks}
            onBuyVipPass={buyVipPass}
            onClaimPassReward={claimPassReward}
          />
        )}
        {screen === 'ranking' && (
          <Ranking
            userElo={userElo}
            onBack={() => setScreen('menu')}
            onAddElo={(delta) => setUserElo((prev) => Math.max(0, prev + delta))}
          />
        )}

        {/* Global Pack Opening Reveal Modal */}
        {activeOpeningResult && (
          <PackOpeningModal
            result={activeOpeningResult}
            onClose={() => {
              setActiveOpeningResult(null)
              setScreen('jardin')
            }}
            onOpenAnother={handleOpenAnotherPack}
            hasMorePacks={hasMorePacksOfSameType}
          />
        )}
      </GameFrame>
      <RotateOverlay />
    </>
  )
}

export default App
