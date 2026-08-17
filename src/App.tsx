import { useState, useEffect } from 'react'
import GameFrame from './components/GameFrame/GameFrame'
import RotateOverlay from './components/RotateOverlay/RotateOverlay'
import MainMenu from './components/MainMenu/MainMenu'
import Battlefield from './components/Battlefield/Battlefield'
import Collection from './components/Collection/Collection'
import Jardin from './components/Jardin/Jardin'
import Shop from './components/Shop/Shop'
import Ranking from './components/Ranking/Ranking'
import BattlePass from './components/BattlePass/BattlePass'
import Clan from './components/Clan/Clan'
import Marketplace from './components/Marketplace/Marketplace'
import LandingPage from './components/LandingPage/LandingPage'
import PackOpeningModal from './components/PackOpeningModal/PackOpeningModal'
import { useInventory } from './hooks/useInventory'
import type { PackDropResult, PackId } from './utils/packDropManager'
import background from './assets/images/background.png'
import { soundManager } from './utils/audioManager'

import { getEloDeltasForElo } from './utils/arenaManager'

function App() {
  const [screen, setScreen] = useState<'landing' | 'menu' | 'battle' | 'collection' | 'jardin' | 'shop' | 'ranking' | 'pass' | 'clan' | 'market'>(() => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname.toLowerCase()
      const hash = window.location.hash.toLowerCase()
      if (path.startsWith('/play') || hash.includes('play')) {
        return 'menu'
      }
    }
    return 'landing'
  })
  const [practicePlantId, setPracticePlantId] = useState<string | null>(null)
  const [activeOpeningResult, setActiveOpeningResult] = useState<PackDropResult | PackDropResult[] | null>(null)
  const [lastOpenedPackType, setLastOpenedPackType] = useState<PackId | null>(null)
  const [activeAppAlert, setActiveAppAlert] = useState<{ title: string; message: string; icon: string } | null>(null)

  const [userElo, setUserElo] = useState<number>(1000)
  const [customArenaBg, setCustomArenaBg] = useState<string | undefined>(undefined)

  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname.toLowerCase()
      const hash = window.location.hash.toLowerCase()
      if (path.startsWith('/play') || hash.includes('play')) {
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
    userGold,
    addGold,
    buyGoldWithTokens,
    inventoryPacks,
    unlockedPlants,
    plantCopies,
    plantLevels,
    plantStatRolls,
    plantInstances,
    activeDeck,
    activeDeckInstances,
    updateActiveDeck,
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
    deductUserTokens,
    addUserTokens,
    donatePlantCopy,
    receivePlantInstance,
    removePlantInstance,
    addPacksToInventory,
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
            userTokens={userTokens}
            userGold={userGold}
            hasVipPass={hasVipPass}
            claimedVipLevels={claimedVipLevels}
            freePackSlots={freePackSlots}
            onPlay={handlePlayNormal}
            onOpenCollection={handleOpenCollection}
            onOpenJardin={handleOpenJardin}
            onOpenShop={handleOpenShop}
            onOpenRanking={handleOpenRanking}
            onOpenBattlePass={() => setScreen('pass')}
            onOpenClan={() => setScreen('clan')}
            onOpenMarketplace={() => setScreen('market')}
            onOpenLanding={handleGoToLanding}
            onStartSlotUnlock={startUnlockingSlot}
            onFastUnlockSlot={fastUnlockSlot}
            onOpenSlotPack={handleOpenSlotPack}
            onAddTokens={addTokens}
            onDeductTokens={deductUserTokens}
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
            plantStatRolls={plantStatRolls}
            plantInstances={plantInstances}
            onUpdateDeck={updateActiveDeck}
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
            userGold={userGold}
            hasVipPass={hasVipPass}
            inventoryPacks={inventoryPacks}
            plantCopies={plantCopies}
            plantLevels={plantLevels}
            plantStatRolls={plantStatRolls}
            plantInstances={plantInstances}
            onBack={() => setScreen('menu')}
            onBuyPack={buyPack}
            onBuyGold={buyGoldWithTokens}
            onAddGold={addGold}
            onOpenJardin={handleOpenJardin}
            onAddTokens={addTokens}
            onOpenPackImmediately={handleTriggerPackOpenByInstanceId}
            onOpenMultiplePacks={handleOpenMultiplePacks}
            onBuyVipPass={buyVipPass}
            onDeductTokens={deductUserTokens}
            onDonatePlant={donatePlantCopy}
            onReceivePlant={receivePlantInstance}
          />
        )}
        {screen === 'ranking' && (
          <Ranking
            userElo={userElo}
            onBack={() => setScreen('menu')}
            onAddElo={(delta) => setUserElo((prev) => Math.max(0, prev + delta))}
          />
        )}
        {screen === 'pass' && (
          <div
            className="ranking-screen"
            style={{ backgroundImage: `url(${background})` }}
          >
            <div className="ranking-header">
              <button
                type="button"
                className="ranking-back-btn"
                onClick={() => setScreen('menu')}
              >
                ⬅ VOLVER AL MENÚ
              </button>
              <div className="ranking-header__center">
                <h1 className="ranking-title">👑 PASE DE TEMPORADA VIP</h1>
                <span className="ranking-subtitle">
                  Sube copas ELO en la Arena para desbloquear recompensas exclusivas
                </span>
              </div>
              <div className="ranking-header__right">
                <button
                  type="button"
                  className="ranking-mute-btn"
                  onClick={() => soundManager.toggleMute()}
                >
                  🔊
                </button>
              </div>
            </div>

            <div style={{ flex: 1, minHeight: 0, padding: '6px 0' }}>
              <BattlePass
                userElo={userElo}
                hasVipPass={hasVipPass}
                claimedVipLevels={claimedVipLevels}
                onBuyVipPass={() => {
                  const ok = buyVipPass()
                  if (ok) {
                    setActiveAppAlert({
                      title: '¡PASE VIP ACTIVADO!',
                      message: '👑 ¡PASE VIP DE TEMPORADA ACTIVADO!\nAhora puedes reclamar todas las recompensas doradas.',
                      icon: '👑',
                    })
                  } else {
                    setActiveAppAlert({
                      title: 'SALDO INSUFICIENTE',
                      message: '⚠️ Saldo insuficiente ($10.00 USD requeridos).\nRecarga saldo en la Tienda.',
                      icon: '⚠️',
                    })
                  }
                }}
                onClaimReward={(lvl) => {
                  claimPassReward(lvl.reward, lvl.level)
                  setActiveAppAlert({
                    title: '¡RECOMPENSA RECLAMADA!',
                    message: `👑 ¡RECOMPENSA VIP DEL NIVEL ${lvl.level} RECLAMADA!\n${lvl.reward.label}\nSe ha añadido a tu inventario de Mi Jardín.`,
                    icon: '🎉',
                  })
                }}
                onClaimAllRewards={(levels) => {
                  levels.forEach((lvl) => claimPassReward(lvl.reward, lvl.level))
                  setActiveAppAlert({
                    title: '¡RECOMPENSAS RECLAMADAS!',
                    message: `👑 ¡${levels.length} RECOMPENSAS VIP RECLAMADAS CON ÉXITO!\nSe han guardado en tu inventario de Mi Jardín.`,
                    icon: '🎁',
                  })
                }}
              />
            </div>
          </div>
        )}

        {screen === 'clan' && (
          <div
            style={{
              width: '100%',
              height: '100%',
              backgroundImage: `url(${background})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              display: 'flex',
              flexDirection: 'column',
              padding: '10px 16px',
              boxSizing: 'border-box',
            }}
          >
            <Clan
              userElo={userElo}
              userTokens={userTokens}
              plantCopies={plantCopies}
              onDeductTokens={deductUserTokens}
              onAddTokens={addUserTokens}
              onDonatePlant={donatePlantCopy}
              onAddPacks={addPacksToInventory}
              onBackToMenu={() => setScreen('menu')}
            />
          </div>
        )}

        {screen === 'market' && (
          <div
            style={{
              width: '100%',
              height: '100%',
              backgroundImage: `url(${background})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              display: 'flex',
              flexDirection: 'column',
              padding: '10px 16px',
              boxSizing: 'border-box',
            }}
          >
            <Marketplace
              userTokens={userTokens}
              hasVipPass={hasVipPass}
              plantCopies={plantCopies}
              plantLevels={plantLevels}
              plantStatRolls={plantStatRolls}
              plantInstances={plantInstances}
              unlockedPlants={unlockedPlants}
              activeDeck={activeDeck}
              activeDeckInstances={activeDeckInstances}
              onDeductTokens={deductUserTokens}
              onDonatePlant={donatePlantCopy}
              onReceivePlant={receivePlantInstance}
              onRemovePlantInstance={removePlantInstance}
              onUpdateDeck={updateActiveDeck}
              onBuyVipPass={buyVipPass}
              onBackToMenu={() => setScreen('menu')}
            />
          </div>
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

        {/* Global Themed Modal Alert */}
        {activeAppAlert && (
          <div className="main-menu-dialog-backdrop" onClick={() => setActiveAppAlert(null)}>
            <div className="main-menu-dialog-card" onClick={(e) => e.stopPropagation()}>
              <div className="main-menu-dialog-icon">{activeAppAlert.icon}</div>
              <h3 className="main-menu-dialog-title">{activeAppAlert.title}</h3>
              <p className="main-menu-dialog-msg">{activeAppAlert.message}</p>
              <button
                type="button"
                className="main-menu-dialog-btn"
                onClick={() => setActiveAppAlert(null)}
              >
                ENTENDIDO
              </button>
            </div>
          </div>
        )}
      </GameFrame>
      <RotateOverlay />
    </>
  )
}

export default App
