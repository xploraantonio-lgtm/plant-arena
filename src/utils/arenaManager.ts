import arena1Bg from '../assets/images/battlefield-bg.png'
import arena2Bg from '../assets/images/battlefield-bg2.jpg'
import arena3Bg from '../assets/images/battlefield-bg3.jpg'
import arena4Bg from '../assets/images/battlefield-bg4.jpg'
import arena5Bg from '../assets/images/battlefield-bg5.jpg'

export interface ArenaInfo {
  id: number
  name: string
  minElo: number
  maxElo: number
  bgImage: string
  tagline: string
  badgeColor: string
  borderColor: string
}

export const ARENAS: ArenaInfo[] = [
  {
    id: 1,
    name: 'Arena 1: Jardín Clásico',
    minElo: 0,
    maxElo: 1600,
    bgImage: arena1Bg,
    tagline: 'Campo de césped tradicional bajo el sol resplandeciente.',
    badgeColor: '#4ade80',
    borderColor: '#22c55e',
  },
  {
    id: 2,
    name: 'Arena 2: Desierto Nocturno',
    minElo: 1601,
    maxElo: 2000,
    bgImage: arena2Bg,
    tagline: 'Dunas desérticas con cactus bioluminiscentes y luna llena.',
    badgeColor: '#60a5fa',
    borderColor: '#3b82f6',
  },
  {
    id: 3,
    name: 'Arena 3: Rascacielos Cyberpunk',
    minElo: 2001,
    maxElo: 3000,
    bgImage: arena3Bg,
    tagline: 'Azotea futurista sobre la metrópolis con luces neón.',
    badgeColor: '#c084fc',
    borderColor: '#a855f7',
  },
  {
    id: 4,
    name: 'Arena 4: Coliseo Galáctico',
    minElo: 3001,
    maxElo: 4000,
    bgImage: arena4Bg,
    tagline: 'Plataforma espacial flotante entre nebulosas y meteoritos.',
    badgeColor: '#fde047',
    borderColor: '#eab308',
  },
  {
    id: 5,
    name: 'Arena 5: Olimpo de Leyendas',
    minElo: 4001,
    maxElo: 9999,
    bgImage: arena5Bg,
    tagline: 'Palacio sagrado de oro supremo para los reyes de Plant Arena.',
    badgeColor: '#f43f5e',
    borderColor: '#ef4444',
  },
]

export function getArenaForElo(elo: number): ArenaInfo {
  const found = ARENAS.find((a) => elo >= a.minElo && elo <= a.maxElo)
  return found || ARENAS[0]
}

export function getEloDeltasForElo(elo: number): { winElo: number; loseElo: number; surrenderElo: number } {
  if (elo <= 1600) {
    return { winElo: 15, loseElo: 8, surrenderElo: 8 }
  } else if (elo <= 2000) {
    return { winElo: 12, loseElo: 8, surrenderElo: 8 }
  } else if (elo <= 3000) {
    return { winElo: 10, loseElo: 8, surrenderElo: 8 }
  } else if (elo <= 4000) {
    return { winElo: 8, loseElo: 7, surrenderElo: 7 }
  } else {
    return { winElo: 6, loseElo: 6, surrenderElo: 6 }
  }
}
