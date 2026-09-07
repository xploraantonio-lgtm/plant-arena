import type { PlantId } from '../types/game'
import type { PackId } from './packDropManager'

export interface PassReward {
  type: 'pack' | 'copies' | 'plant' | 'badge'
  packId?: PackId
  packCount?: number
  plantId?: PlantId
  copiesCount?: number
  label: string
  icon: string
}

export interface PassLevel {
  level: number
  requiredElo: number
  arenaName: string
  reward: PassReward
}

export const BATTLE_PASS_LEVELS: PassLevel[] = [
  {
    level: 1,
    requiredElo: 1150,
    arenaName: 'Jardín Clásico',
    reward: { type: 'pack', packId: 'basic', packCount: 1, label: 'Sobre Gratis de Batalla', icon: '/game-assets/greenfoot/seed_pack_common_whitebg.webp' },
  },
  {
    level: 2,
    requiredElo: 1300,
    arenaName: 'Jardín Clásico',
    reward: { type: 'copies', plantId: 'sunflower', copiesCount: 1, label: 'x1 Girasol', icon: '/game-assets/greenfoot/transparentsunflower.webp' },
  },
  {
    level: 3,
    requiredElo: 1450,
    arenaName: 'Jardín Clásico',
    reward: { type: 'copies', plantId: 'bonkchoy', copiesCount: 1, label: 'x1 Bonk Choy', icon: '/game-assets/greenfoot/bonkchoy1.webp' },
  },
  {
    level: 4,
    requiredElo: 1600,
    arenaName: 'Jardín Clásico (Límite)',
    reward: { type: 'copies', plantId: 'twinsunflower', copiesCount: 2, label: 'x2 Girasol Doble', icon: '/game-assets/greenfoot/twinsunflower1.webp' },
  },
  {
    level: 5,
    requiredElo: 1750,
    arenaName: 'Desierto Nocturno',
    reward: { type: 'copies', plantId: 'jalapeno', copiesCount: 1, label: 'x1 Jalapeño Garantizado', icon: '/game-assets/plants/jalapeno_hd.webp' },
  },
  {
    level: 6,
    requiredElo: 1900,
    arenaName: 'Desierto Nocturno',
    reward: { type: 'copies', plantId: 'repeater', copiesCount: 1, label: 'x1 Repetidora', icon: '/game-assets/greenfoot/transparentrepeater.webp' },
  },
  {
    level: 7,
    requiredElo: 2050,
    arenaName: 'Rascacielos Cyberpunk',
    reward: { type: 'copies', plantId: 'aloe', copiesCount: 1, label: 'x1 Aloe Vera', icon: '/game-assets/plants/aloe_hd.webp' },
  },
  {
    level: 8,
    requiredElo: 2200,
    arenaName: 'Rascacielos Cyberpunk',
    reward: { type: 'copies', plantId: 'tallnut', copiesCount: 1, label: 'x1 Nuez Alta', icon: '/game-assets/greenfoot/transparenttallnut.webp' },
  },
  {
    level: 9,
    requiredElo: 2350,
    arenaName: 'Rascacielos Cyberpunk',
    reward: { type: 'pack', packId: 'basic', packCount: 1, label: '1x Sobre Básico', icon: '/game-assets/greenfoot/seed_pack_common_whitebg.webp' },
  },
  {
    level: 10,
    requiredElo: 2500,
    arenaName: 'Rascacielos Cyberpunk',
    reward: { type: 'pack', packId: 'basic', packCount: 1, label: '1x Sobre Básico', icon: '/game-assets/greenfoot/seed_pack_common_whitebg.webp' },
  },
  {
    level: 11,
    requiredElo: 2650,
    arenaName: 'Rascacielos Cyberpunk',
    reward: { type: 'copies', plantId: 'aloe', copiesCount: 1, label: 'x1 Aloe Vera', icon: '/game-assets/plants/aloe_hd.webp' },
  },
  {
    level: 12,
    requiredElo: 2800,
    arenaName: 'Rascacielos Cyberpunk',
    reward: { type: 'copies', plantId: 'tallnut', copiesCount: 1, label: 'x1 Nuez Alta', icon: '/game-assets/greenfoot/transparenttallnut.webp' },
  },
  {
    level: 13,
    requiredElo: 2950,
    arenaName: 'Rascacielos Cyberpunk',
    reward: { type: 'pack', packId: 'basic', packCount: 1, label: '1x Sobre Básico', icon: '/game-assets/greenfoot/seed_pack_common_whitebg.webp' },
  },
  {
    level: 14,
    requiredElo: 3100,
    arenaName: 'Coliseo Galáctico',
    reward: { type: 'copies', plantId: 'iceberglettuce', copiesCount: 1, label: 'x1 Lechuga Helada', icon: '/game-assets/plants/iceberglettuce_hd.webp' },
  },
  {
    level: 15,
    requiredElo: 3250,
    arenaName: 'Coliseo Galáctico',
    reward: { type: 'pack', packId: 'basic', packCount: 2, label: '2x Sobre Básico', icon: '/game-assets/greenfoot/seed_pack_common_whitebg.webp' },
  },
  {
    level: 16,
    requiredElo: 3400,
    arenaName: 'Coliseo Galáctico',
    reward: { type: 'pack', packId: 'basic', packCount: 2, label: '2x Sobre Básico', icon: '/game-assets/greenfoot/seed_pack_common_whitebg.webp' },
  },
  {
    level: 17,
    requiredElo: 3550,
    arenaName: 'Coliseo Galáctico',
    reward: { type: 'pack', packId: 'basic', packCount: 2, label: '2x Sobre Básico', icon: '/game-assets/greenfoot/seed_pack_common_whitebg.webp' },
  },
  {
    level: 18,
    requiredElo: 3700,
    arenaName: 'Coliseo Galáctico',
    reward: { type: 'copies', plantId: 'threepeater', copiesCount: 1, label: 'x1 Threepeater', icon: '/game-assets/greenfoot/threepeater1.webp' },
  },
  {
    level: 19,
    requiredElo: 3850,
    arenaName: 'Olimpo de Leyendas',
    reward: { type: 'pack', packId: 'basic', packCount: 2, label: '2x Sobres Básicos', icon: '/game-assets/greenfoot/seed_pack_common_whitebg.webp' },
  },
  {
    level: 20,
    requiredElo: 4000,
    arenaName: 'Olimpo de Leyendas (MÁX)',
    reward: { type: 'badge', label: '👑 Corona Dorada Leyenda ELO + Skin VIP', icon: '👑' },
  },
]
