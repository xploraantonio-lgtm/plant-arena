import { useState } from 'react'
import type { PlantId } from './types/game'
import GameFrame from './components/GameFrame/GameFrame'
import RotateOverlay from './components/RotateOverlay/RotateOverlay'
import MainMenu from './components/MainMenu/MainMenu'
import Battlefield from './components/Battlefield/Battlefield'
import Collection from './components/Collection/Collection'
import Jardin from './components/Jardin/Jardin'
import Shop from './components/Shop/Shop'

const DEFAULT_DECK: PlantId[] = [
  'sunflower',
  'peashooter',
  'wallnut',
  'bonkchoy',
  'squash',
  'threepeater',
]

function App() {
  const [screen, setScreen] = useState<'menu' | 'battle' | 'collection' | 'jardin' | 'shop'>('menu')
  const [practicePlantId, setPracticePlantId] = useState<string | null>(null)
  const [activeDeck, setActiveDeck] = useState<PlantId[]>(DEFAULT_DECK)

  const handlePlayNormal = () => {
    setPracticePlantId(null)
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

  const handlePracticePlant = (plantId: string) => {
    setPracticePlantId(plantId)
    setScreen('battle')
  }

  return (
    <>
      <GameFrame>
        {screen === 'menu' && (
          <MainMenu
            onPlay={handlePlayNormal}
            onOpenCollection={handleOpenCollection}
            onOpenJardin={handleOpenJardin}
            onOpenShop={handleOpenShop}
          />
        )}
        {screen === 'battle' && (
          <Battlefield
            onBackToMenu={() => setScreen('menu')}
            onBackToCollection={() => setScreen('collection')}
            practicePlantId={practicePlantId}
            activeDeck={activeDeck}
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
            onUpdateDeck={setActiveDeck}
            onBack={() => setScreen('menu')}
            onPlay={handlePlayNormal}
            onOpenCollection={handleOpenCollection}
          />
        )}
        {screen === 'shop' && <Shop onBack={() => setScreen('menu')} />}
      </GameFrame>
      <RotateOverlay />
    </>
  )
}

export default App
