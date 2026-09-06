import { SupabaseService } from './supabaseService'

/**
 * Fachada de dominio para inventario, sobres y progresión de cartas.
 * Mantiene SupabaseService como implementación durante la migración incremental.
 */
export const inventoryService = {
  getUserPlants: SupabaseService.getUserPlants.bind(SupabaseService),
  insertPlantInstance: SupabaseService.insertPlantInstance.bind(SupabaseService),
  myInventory: SupabaseService.myInventory.bind(SupabaseService),
  myFarmingInventory: SupabaseService.myFarmingInventory.bind(SupabaseService),
  getUserPackSlots: SupabaseService.getUserPackSlots.bind(SupabaseService),
  syncPackSlots: SupabaseService.syncPackSlots.bind(SupabaseService),
  getMyRewardPacks: SupabaseService.getMyRewardPacks.bind(SupabaseService),
  buyPacks: SupabaseService.buyPacks.bind(SupabaseService),
  buyGold: SupabaseService.buyGold.bind(SupabaseService),
  buyVipPass: SupabaseService.buyVipPass.bind(SupabaseService),
  openPack: SupabaseService.openPack.bind(SupabaseService),
  fusePlant: SupabaseService.fusePlant.bind(SupabaseService),
  awardVictoryChest: SupabaseService.awardVictoryChest.bind(SupabaseService),
  claimPackSlot: SupabaseService.claimPackSlot.bind(SupabaseService),
  instantUnlockPackSlot: SupabaseService.instantUnlockPackSlot.bind(SupabaseService),
  startUnlockRewardPack: SupabaseService.startUnlockRewardPack.bind(SupabaseService),
  instantUnlockRewardPack: SupabaseService.instantUnlockRewardPack.bind(SupabaseService),
  claimRewardPack: SupabaseService.claimRewardPack.bind(SupabaseService),
  claimBattlePassLevel: SupabaseService.claimBattlePassLevel.bind(SupabaseService),
  claimAllBattlePassLevels: SupabaseService.claimAllBattlePassLevels.bind(SupabaseService),
} as const
