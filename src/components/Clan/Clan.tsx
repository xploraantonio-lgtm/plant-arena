import React, { useState, useEffect } from 'react'
import { soundManager } from '../../utils/audioManager'
import {
  ClanManager,
  type ClanData,
  type ClanMember,
  type ClanDonationRequest,
  type ClanWarLog,
  type ClanDepositLog,
  type KickValidationResult,
} from '../../utils/clanManager'
import type { PlantId } from '../../types/game'
import { PLANT_CONFIGS } from '../../utils/gameConstants'
import { SeasonManager } from '../../utils/seasonManager'
import './Clan.css'

interface ClanProps {
  userElo: number
  userTokens: number
  hasVipPass?: boolean
  plantCopies: Record<PlantId, number>
  onDeductTokens: (amountUsd: number) => boolean
  onAddTokens: (amountUsd: number) => void
  onDonatePlant: (plantId: PlantId) => boolean
  onAddPacks: (packId: 'basic', qty: number) => void
  onBackToMenu: () => void
}

const BADGES = ['👑', '⚡', '🛡️', '🔥', '🌿', '❄️', '💚', '🥊', '🎯', '💀', '💎', '🌸']

interface ClanModalDialog {
  title: string
  message: string
  icon: string
  type: 'info' | 'success' | 'warning' | 'error' | 'confirm'
  confirmText?: string
  cancelText?: string
  onConfirm?: () => void
}

export default function Clan({
  userElo,
  userTokens,
  hasVipPass = false,
  plantCopies,
  onDeductTokens,
  onAddTokens,
  onDonatePlant,
  onAddPacks,
  onBackToMenu,
}: ClanProps) {
  const [userClan, setUserClan] = useState<ClanData | null>(() => ClanManager.getUserClan())
  const [allClans, setAllClans] = useState<ClanData[]>(() => ClanManager.getClans())
  const [activeTab, setActiveTab] = useState<'members' | 'wars' | 'donations' | 'rewards'>('members')
  const [noClanTab, setNoClanTab] = useState<'browse' | 'create'>('browse')
  const [selectedBrowseClanId, setSelectedBrowseClanId] = useState<string>(() => allClans[0]?.id || '')

  // Mini Sub-tabs state
  const [warSubTab, setWarSubTab] = useState<'attack' | 'reports' | 'participants' | 'history'>('attack')
  const [donationSubTab, setDonationSubTab] = useState<'seeds' | 'deposits'>('seeds')
  const [rivalSearch, setRivalSearch] = useState('')
  const [rivalFilter, setRivalFilter] = useState<'all' | 'vulnerable' | 'topVault'>('all')

  // Modals
  const [showDepositModal, setShowDepositModal] = useState(false)
  const [showRequestSeedModal, setShowRequestSeedModal] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [depositAmount, setDepositAmount] = useState<number>(1.0)
  const [activeDialog, setActiveDialog] = useState<ClanModalDialog | null>(null)

  // Kick Member Modal State
  const [selectedMemberToKick, setSelectedMemberToKick] = useState<ClanMember | null>(null)
  const [kickValidation, setKickValidation] = useState<KickValidationResult | null>(null)
  const [showKickModal, setShowKickModal] = useState(false)

  // Clan Settings State
  const [clanPrivacy, setClanPrivacy] = useState<'public' | 'request' | 'closed'>('public')
  const [clanMinElo, setClanMinElo] = useState<number>(1000)
  const [clanWarPermission, setClanWarPermission] = useState<'leaders' | 'all'>('leaders')
  const [clanAutoAccept, setClanAutoAccept] = useState<boolean>(true)

  // Creation form state
  const [newClanName, setNewClanName] = useState('')
  const [newClanTag, setNewClanTag] = useState('')
  const [newClanBadge, setNewClanBadge] = useState('👑')
  const [newClanDesc, setNewClanDesc] = useState('')

  // Selected plant for seed request
  const [selectedRequestPlant, setSelectedRequestPlant] = useState<PlantId>('peashooter')

  // Active donations, vault logs & war logs
  const [donationRequests, setDonationRequests] = useState<ClanDonationRequest[]>([])
  const [vaultDeposits, setVaultDeposits] = useState<ClanDepositLog[]>([])
  const [warLogs, setWarLogs] = useState<ClanWarLog[]>([])

  // Floating Clan Chat State
  const [isChatOpen, setIsChatOpen] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [chatMessages, setChatMessages] = useState<
    Array<{ id: string; sender: string; role: string; text: string; time: string }>
  >([])

  const handleSendChatMessage = (e: React.FormEvent) => {
    e.preventDefault()
    if (!chatInput.trim()) return
    const now = new Date()
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
    const newMsg = {
      id: `chat-${Date.now()}`,
      sender: playerName,
      role: userClan?.leader === playerName ? 'Líder' : 'Miembro',
      text: chatInput.trim(),
      time: timeStr,
    }
    setChatMessages((prev) => [...prev, newMsg])
    setChatInput('')
    soundManager.playSound('click', 0.5)
  }

  const playerName = 'DRAGONMASTER'

  const showModalAlert = (
    title: string,
    message: string,
    icon = 'ℹ️',
    type: 'info' | 'success' | 'warning' | 'error' = 'info'
  ) => {
    setActiveDialog({ title, message, icon, type, confirmText: 'ENTENDIDO' })
  }

  const showModalConfirm = (
    title: string,
    message: string,
    icon: string,
    onConfirm: () => void,
    confirmText = 'CONFIRMAR',
    cancelText = 'CANCELAR'
  ) => {
    setActiveDialog({
      title,
      message,
      icon,
      type: 'confirm',
      confirmText,
      cancelText,
      onConfirm,
    })
  }

  const renderCustomDialog = () => {
    if (!activeDialog) return null
    return (
      <div className="clan-dialog-backdrop" onClick={() => activeDialog.type !== 'confirm' && setActiveDialog(null)}>
        <div
          className={`clan-dialog-card clan-dialog-card--${activeDialog.type}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="clan-dialog-icon-ring">
            <span className="clan-dialog-icon">{activeDialog.icon}</span>
          </div>
          <h3 className="clan-dialog-title">{activeDialog.title}</h3>
          <p className="clan-dialog-msg">{activeDialog.message}</p>

          <div className="clan-dialog-actions">
            {activeDialog.type === 'confirm' && (
              <button
                type="button"
                className="clan-dialog-btn clan-dialog-btn--cancel"
                onClick={() => setActiveDialog(null)}
              >
                {activeDialog.cancelText || 'CANCELAR'}
              </button>
            )}
            <button
              type="button"
              className="clan-dialog-btn clan-dialog-btn--confirm"
              onClick={() => {
                const confirmCb = activeDialog.onConfirm
                setActiveDialog(null)
                if (confirmCb) {
                  confirmCb()
                }
              }}
            >
              {activeDialog.confirmText || 'ENTENDIDO'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  const refreshClanData = () => {
    const updated = ClanManager.getUserClan()
    setUserClan(updated)
    setAllClans(ClanManager.getClans())
    if (updated) {
      setDonationRequests(ClanManager.getDonationRequests(updated.id))
      setVaultDeposits(ClanManager.getVaultDeposits(updated.id))
      setWarLogs(ClanManager.getWarLogs())
      if (updated.settings) {
        setClanPrivacy(updated.settings.privacy)
        setClanMinElo(updated.settings.minElo)
        setClanWarPermission(updated.settings.warPermission)
        setClanAutoAccept(updated.settings.autoAccept)
      }
    }
  }

  useEffect(() => {
    refreshClanData()
  }, [])

  // Open Settings Modal & Load Saved Settings
  const handleOpenSettings = () => {
    soundManager.playSound('click', 0.4)
    if (userClan?.settings) {
      setClanPrivacy(userClan.settings.privacy)
      setClanMinElo(userClan.settings.minElo)
      setClanWarPermission(userClan.settings.warPermission)
      setClanAutoAccept(userClan.settings.autoAccept)
    }
    setShowSettingsModal(true)
  }

  // Save Settings
  const handleSaveClanSettings = () => {
    if (!userClan) return
    soundManager.playSound('plantation', 0.8)
    const newSettings = {
      privacy: clanPrivacy,
      minElo: clanMinElo,
      warPermission: clanWarPermission,
      autoAccept: clanAutoAccept,
    }
    ClanManager.updateClanSettings(userClan.id, newSettings)
    refreshClanData()
    setShowSettingsModal(false)
    showModalAlert(
      'AJUSTES ACTUALIZADOS',
      'Las reglas de privacidad, copas mínimas y permisos de guerra del clan se han guardado con éxito.',
      '⚙️',
      'success'
    )
  }

  // Open Kick Member Dialog
  const handleOpenKickDialog = (member: ClanMember) => {
    if (!userClan) return
    soundManager.playSound('click', 0.5)
    const result = ClanManager.validateKickMember(userClan, member)
    setSelectedMemberToKick(member)
    setKickValidation(result)
    setShowKickModal(true)
  }

  // Execute Kick Action
  const handleExecuteKick = () => {
    if (!userClan || !selectedMemberToKick || !kickValidation?.canKick) return
    soundManager.playSound('surrender', 0.6)
    const res = ClanManager.kickMember(userClan.id, selectedMemberToKick.id)
    if (res.success) {
      refreshClanData()
      setShowKickModal(false)
      showModalAlert(
        'MIEMBRO EXPULSADO',
        `El jugador "${selectedMemberToKick.name}" ha sido expulsado del clan por infringir el reglamento de guerra.\nLa vacante ha quedado liberada.`,
        '👢',
        'success'
      )
      setSelectedMemberToKick(null)
      setKickValidation(null)
    } else {
      showModalAlert('ERROR AL EXPULSAR', res.error || 'No se pudo expulsar al miembro.', '❌', 'error')
    }
  }

  // CREATE CLAN ($5 USD)
  const handleCreateClan = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newClanName.trim() || !newClanTag.trim()) {
      showModalAlert('DATOS INCOMPLETOS', 'Ingresa un nombre y etiqueta válidos para el clan.', '⚠️', 'warning')
      return
    }
    if (userTokens < 5.0) {
      showModalAlert('SALDO INSUFICIENTE', 'Saldo insuficiente ($5.00 USD requeridos). Recarga saldo en la Tienda.', '⚠️', 'warning')
      return
    }

    const deducted = onDeductTokens(5.0)
    if (!deducted) return

    soundManager.playSound('victory', 0.8)
    const created = ClanManager.createClan(
      newClanName,
      newClanTag,
      newClanBadge,
      newClanDesc,
      playerName,
      userElo
    )
    showModalAlert('¡CLAN CREADO!', `¡El clan "${created.name}" ha sido fundado con éxito!\nSe inyectaron $5.00 USD al Tesoro del Clan.`, '🎉', 'success')
    refreshClanData()
  }

  // JOIN CLAN ($2 USD)
  const handleJoinClan = (clan: ClanData) => {
    if (clan.members.length >= 15) {
      showModalAlert('CLAN LLENO', 'Este clan ya ha alcanzado el límite máximo de 15/15 miembros.', '⚠️', 'warning')
      return
    }
    if (userTokens < 2.0) {
      showModalAlert(
        'SALDO INSUFICIENTE',
        `Saldo insuficiente ($2.00 USD requeridos para ingresar al clan).\nTu saldo actual es de $${userTokens.toFixed(2)} USD.\nPor favor recarga saldo en la Tienda.`,
        '⚠️',
        'warning'
      )
      return
    }

    showModalConfirm(
      'UNIRSE AL CLAN',
      `¿Deseas pagar $2.00 USD de entrada para unirte a "${clan.name}"?\n\nEl monto se descontará de tu saldo disponible ($${userTokens.toFixed(2)} USD) y se inyectará directamente al Tesoro del Clan.`,
      '⚡',
      () => {
        const deducted = onDeductTokens(2.0)
        if (!deducted) return

        soundManager.playSound('plantation', 0.8)
        const success = ClanManager.joinClan(clan.id, playerName, userElo)
        if (success) {
          showModalAlert(
            '¡BIENVENIDO AL CLAN!',
            `Te has unido exitosamente a "${clan.name}".\nTu aporte de $2.00 USD fue sumado al Tesoro del Clan.`,
            '🎉',
            'success'
          )
          refreshClanData()
        }
      },
      'UNIRSE ($2.00 USD)',
      'CANCELAR'
    )
  }

  // LEAVE CLAN
  const handleLeaveClan = () => {
    if (!userClan) return
    showModalConfirm(
      'SALIR DEL CLAN',
      `¿Estás seguro de que deseas salir del clan "${userClan.name}"?\nPerderás acceso al Tesoro, recompensas y guerras.`,
      '🚪',
      () => {
        ClanManager.leaveClan(userClan.id, playerName)
        showModalAlert('HAS SALIDO DEL CLAN', `Has dejado el clan "${userClan.name}".`, 'ℹ️', 'info')
        refreshClanData()
      },
      'SÍ, SALIR',
      'PERMANECER'
    )
  }

  // DEPOSIT TO VAULT
  const handleDeposit = () => {
    if (!userClan) return
    if (depositAmount <= 0) return
    if (userTokens < depositAmount) {
      showModalAlert('GEMAS INSUFICIENTES', `Gemas insuficientes (${depositAmount} Gemas 💎 requeridas).`, '⚠️', 'warning')
      return
    }

    const deducted = onDeductTokens(depositAmount)
    if (!deducted) return

    ClanManager.depositToVault(userClan.id, depositAmount, playerName)
    soundManager.playSound('plantation', 0.9)

    // Bonus: +1 Ticket de Coliseo y +1 Tiro Gratis en Ruleta por cada 1 Gema aportada
    const ticketsEarned = Math.floor(depositAmount)
    if (ticketsEarned > 0) {
      try {
        const curTickets = Number(localStorage.getItem('plant_arena_colosseum_tickets') || '0')
        localStorage.setItem('plant_arena_colosseum_tickets', (curTickets + ticketsEarned).toString())
        // Reset last free spin timestamp so they get a free spin immediately in Ruleta
        localStorage.removeItem('plant_arena_lottery_last_free_spin')
      } catch {}
    }

    showModalAlert(
      '¡DEPÓSITO EXITOSO + BONOS!',
      `¡Has aportado ${depositAmount} Gemas 💎 al Tesoro del Clan!\n\n🎁 ¡Has recibido de regalo:\n• +${ticketsEarned} Ticket(s) de Coliseo 🎟️\n• +1 Tiro Gratis en la Ruleta de la Suerte 🎡!`,
      '🎉',
      'success'
    )
    setShowDepositModal(false)
    refreshClanData()
  }

  // REPAIR BASE ($5 USD)
  const handleRepairBase = () => {
    if (!userClan) return
    if (userTokens < 5.0) {
      showModalAlert('SALDO INSUFICIENTE', 'Saldo insuficiente ($5.00 USD requeridos para Reparar la Base).', '⚠️', 'warning')
      return
    }

    showModalConfirm(
      'REPARAR BASE',
      '¿Deseas pagar $5.00 USD para REPARAR LA BASE y reactivar las funciones del clan?',
      '🛠️',
      () => {
        const deducted = onDeductTokens(5.0)
        if (!deducted) return

        ClanManager.repairBase(userClan.id, playerName)
        soundManager.playSound('victory', 0.8)
        showModalAlert('¡BASE REPARADA!', '¡Base reparada con éxito! El clan vuelve a estar activo y listo para la guerra.', '🛠️', 'success')
        refreshClanData()
      },
      'REPARAR ($5.00)',
      'CANCELAR'
    )
  }

  // CREATE DONATION REQUEST (1 COPY / DAY)
  const handleCreateRequest = () => {
    if (!userClan) return
    if (userClan.status === 'defeated') {
      showModalAlert('BASE EN DERROTA', 'La base está en Estado de Derrota. Repara la base para pedir semillas.', '🛑', 'error')
      return
    }

    const plantInfo = PLANT_CONFIGS[selectedRequestPlant]
    const created = ClanManager.createDonationRequest(
      userClan.id,
      'user-me',
      playerName,
      selectedRequestPlant,
      plantInfo.name,
      plantInfo.packetActive || plantInfo.icon
    )

    if (!created) {
      showModalAlert('SOLICITUD EN CURSO', 'Ya tienes una solicitud activa hoy. Solo puedes pedir 1 vez cada 24 horas.', '⏳', 'warning')
      return
    }

    soundManager.playSound('plantation', 0.8)
    showModalAlert('¡SOLICITUD PUBLICADA!', `¡Solicitud de ${plantInfo.name} publicada en el Clan!\nLos miembros pueden donarte hasta 3 copias.`, '🌱', 'success')
    setShowRequestSeedModal(false)
    refreshClanData()
  }

  // DONATE TO REQUEST (Deduct 1 copy from donor, add 1 to requester)
  const handleDonate = (req: ClanDonationRequest) => {
    if (!userClan) return
    if (userClan.status === 'defeated') {
      showModalAlert('BASE EN DERROTA', 'La base está en Estado de Derrota.', '🛑', 'error')
      return
    }
    if (req.requesterName === playerName) {
      showModalAlert('DONACIÓN NO VÁLIDA', 'No puedes donarte cartas a ti mismo.', '⚠️', 'warning')
      return
    }
    if (req.donors.some((d) => d.donorName === playerName)) {
      showModalAlert('YA DONASTE', 'Ya donaste a esta solicitud de semillas.', '⚠️', 'warning')
      return
    }
    if ((plantCopies[req.plantId] || 0) <= 0) {
      showModalAlert('SIN COPIAS', `No tienes copias disponibles de "${req.plantName}" para donar.`, '⚠️', 'warning')
      return
    }

    const donated = onDonatePlant(req.plantId)
    if (!donated) return

    const result = ClanManager.donateToRequest(userClan.id, req.id, 'user-me', playerName)
    if (result && result.success) {
      soundManager.playSound('plantation', 0.9)
      showModalAlert('¡DONACIÓN EXITOSA!', `¡Has donado 1 copia de ${req.plantName} a ${req.requesterName}!`, '🎁', 'success')
      refreshClanData()
    }
  }

  // EXECUTE CLAN WAR RAID ($5 USD)
  const handleExecuteRaid = (defenderClan: ClanData) => {
    if (!userClan) return
    if (userClan.status === 'defeated') {
      showModalAlert('BASE EN DERROTA', 'Tu clan está en Estado de Derrota. Debes Reparar la Base primero.', '🛑', 'error')
      return
    }

    showModalConfirm(
      'ASALTO DE GUERRA ($5.00 USD)',
      `¿Deseas asaltar a "${defenderClan.name}" por $5.00 USD del Tesoro?\n¡Si ganas, tu clan suma +$5.00 USD! Si pierdes, ellos se llevan $5.00 USD.`,
      '⚔️',
      () => {
        const result = ClanManager.executeClanRaid(userClan.id, defenderClan.id)
        if (!result.success) {
          showModalAlert('ASALTO DENEGADO', result.error || 'No se pudo iniciar el asalto.', '⚠️', 'warning')
          return
        }

        if (result.winnerClan.id === userClan.id) {
          soundManager.playSound('victory', 1)
          showModalAlert('¡VICTORIA GLORIOSA!', `¡Tu clan ha derrotado a "${defenderClan.name}" y saqueado +$${result.stolenAmount.toFixed(2)} USD para el Tesoro!`, '🏆', 'success')
        } else {
          soundManager.playSound('defeat', 0.9)
          showModalAlert('DERROTA EN ASALTO', `"${defenderClan.name}" defendió su base. Tu clan perdió -$${result.stolenAmount.toFixed(2)} USD y recibe un Escudo de Protección de 4 Horas.`, '💀', 'error')
        }

        refreshClanData()
      },
      '¡INICIAR ASALTO!',
      'CANCELAR'
    )
  }

  // CLAIM 15/15 FULL CLAN BONUS (2 GREEN PACKS)
  const handleClaimFullBonus = () => {
    if (!userClan) return
    if (userClan.members.length < 15) {
      showModalAlert('CLAN INCOMPLETO', `El clan aún tiene ${userClan.members.length}/15 miembros. Invita a más compañeros para llenarlo.`, '⚠️', 'warning')
      return
    }
    if (ClanManager.hasClaimedFullClanBonus(playerName)) {
      showModalAlert('YA RECLAMADO', 'Ya has reclamado tu Bono de Clan Lleno en esta cuenta. Solo se otorga 1 vez por jugador para evitar trampas.', '⚠️', 'warning')
      return
    }

    const success = ClanManager.claimFullClanBonus(userClan.id, playerName)
    if (success) {
      onAddPacks('basic', 2)
      soundManager.playSound('victory', 1)
      showModalAlert('¡BONO RECLAMADO!', '¡Se han añadido 2 Sobres Pack Verde Básico a tu inventario!', '🎁', 'success')
      refreshClanData()
    }
  }

  // CLAIM SEASON VAULT PAYOUT
  const handleClaimSeasonPayout = () => {
    if (!userClan) return
    const seasonStatus = SeasonManager.getSeasonStatus()
    if (!seasonStatus.isEnded) {
      showModalAlert(
        'TEMPORADA EN CURSO',
        `El reparto y retiro del Tesoro se habilitará al finalizar los 30 días de la temporada actual (${seasonStatus.formattedCountdown} restantes).`,
        '⏳',
        'warning'
      )
      return
    }
    if (userClan.vaultUsd <= 0) {
      showModalAlert('TESORO EN $0.00', 'El Tesoro del Clan está en $0.00 USD.', '⚠️', 'warning')
      return
    }
    if (userClan.seasonPayoutClaimedMembers.includes(playerName)) {
      showModalAlert('YA COBRADO', 'Ya cobraste tu parte del Tesoro de Temporada.', '⚠️', 'warning')
      return
    }

    const share = ClanManager.claimSeasonVaultPayout(userClan.id, playerName)
    if (share > 0) {
      onAddTokens(share)
      soundManager.playSound('victory', 1)
      showModalAlert('¡TESORO RETIRADO!', `¡+$${share.toFixed(2)} USD transferidos exitosamente a tu saldo de tokens!`, '💰', 'success')
      refreshClanData()
    }
  }

  // NON-CLAN VIEW (BROWSE OR CREATE)
  if (!userClan) {
    return (
      <div className="clan-container">
        {/* Top Header */}
        <div className="clan-header">
          <button className="clan-back-btn" type="button" onClick={onBackToMenu}>
            ⬅ VOLVER AL MENÚ
          </button>
          <h2 className="clan-header__title">🏰 SISTEMA DE CLANES COMPETITIVOS</h2>
          <div className="clan-header__tokens">
            <span>💵 Saldo: ${userTokens.toFixed(2)} USD</span>
          </div>
        </div>

        {/* Banner Info */}
        <div className="clan-promo-banner">
          <div className="clan-promo-banner__badge">⚔️ ALTO RENDIMIENTO & SAQUEOS REALES</div>
          <h3 className="clan-promo-banner__title">Únete a un Clan ($2 USD) o Funda el tuyo ($5 USD)</h3>
          <p className="clan-promo-banner__desc">
            Colabora con 15 jugadores, pide semillas diarias gratis, asalta el tesoro de clanes rivales por $5.00 USD
            y reparte las ganancias de la temporada entre todos los miembros.
          </p>
        </div>

        {/* Tab Toggle */}
        <div className="clan-nav-tabs">
          <button
            type="button"
            className={`clan-tab-btn ${noClanTab === 'browse' ? 'clan-tab-btn--active' : ''}`}
            onClick={() => setNoClanTab('browse')}
          >
            🔍 BUSCAR Y UNIRSE ($2.00 USD)
          </button>
          <button
            type="button"
            className={`clan-tab-btn ${noClanTab === 'create' ? 'clan-tab-btn--active' : ''}`}
            onClick={() => setNoClanTab('create')}
          >
            ➕ FUNDAR NUEVO CLAN ($5.00 USD)
          </button>
        </div>

        {/* BROWSE CLANS - DUAL PANEL SHOWCASE */}
        {noClanTab === 'browse' && (() => {
          const selectedClan = allClans.find((c) => c.id === selectedBrowseClanId) || allClans[0]
          const isSelectedFull = selectedClan ? selectedClan.members.length >= 15 : false
          const isSelectedDefeated = selectedClan ? selectedClan.status === 'defeated' || selectedClan.vaultUsd <= 0 : false
          const avgElo = selectedClan
            ? Math.round(selectedClan.members.reduce((acc, m) => acc + m.elo, 0) / Math.max(1, selectedClan.members.length))
            : 0

          return (
            <div className="clan-browse-dual-pane">
              {/* Left Column: Clan List */}
              <div className="clan-browse-sidebar">
                <div className="clan-browse-sidebar__header">
                  <span>🏆 CLANES DESTACADOS</span>
                  <small>{allClans.length} Disponibles</small>
                </div>

                <div className="clan-browse-sidebar__list">
                  {allClans.map((clan, index) => {
                    const isFull = clan.members.length >= 15
                    const isSelected = selectedClan?.id === clan.id

                    return (
                      <button
                        key={clan.id}
                        type="button"
                        className={`clan-sidebar-item ${isSelected ? 'clan-sidebar-item--active' : ''} ${
                          isFull ? 'clan-sidebar-item--full' : ''
                        }`}
                        onClick={() => setSelectedBrowseClanId(clan.id)}
                      >
                        <div className="clan-sidebar-item__rank">#{index + 1}</div>
                        <div className="clan-sidebar-item__badge">{clan.badge}</div>
                        <div className="clan-sidebar-item__info">
                          <div className="clan-sidebar-item__title">
                            <strong>{clan.name}</strong>
                            <span className="clan-sidebar-item__tag">{clan.tag}</span>
                          </div>
                          <div className="clan-sidebar-item__meta">
                            <span>👥 {clan.members.length}/15</span>
                            <span className="clan-sidebar-item__vault">💰 ${clan.vaultUsd.toFixed(0)}</span>
                          </div>
                        </div>
                        <div className="clan-sidebar-item__status">
                          {isFull ? (
                            <span className="clan-pill--full">LLENO</span>
                          ) : (
                            <span className="clan-pill--open">ABIERTO</span>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Right Column: Selected Clan Detail Showcase */}
              <div className="clan-browse-showcase">
                {selectedClan ? (
                  <div className="clan-showcase-content">
                    {/* Header Card */}
                    <div className="clan-showcase-header">
                      <div className="clan-showcase-badge-wrap">
                        <span className="clan-showcase-badge">{selectedClan.badge}</span>
                      </div>
                      <div className="clan-showcase-title-area">
                        <div className="clan-showcase-title-row">
                          <h3>{selectedClan.name}</h3>
                          <span className="clan-showcase-tag">{selectedClan.tag}</span>
                          {isSelectedFull ? (
                            <span className="clan-pill--full">🔒 LLENO (15/15)</span>
                          ) : isSelectedDefeated ? (
                            <span className="clan-defeat-pill">🛑 EN DERROTA</span>
                          ) : (
                            <span className="clan-pill--open">🟢 ABIERTO ($2.00 USD)</span>
                          )}
                        </div>
                        <p className="clan-showcase-desc">{selectedClan.description || 'Clan competitivo enfocado en guerras y donaciones de semillas.'}</p>
                        <span className="clan-showcase-leader">👑 Líder: <strong>{selectedClan.leader}</strong></span>
                      </div>
                    </div>

                    {/* 4 Stats Tiles */}
                    <div className="clan-showcase-metrics-grid">
                      <div className="clan-metric-card clan-metric-card--vault">
                        <span className="clan-metric-card__label">💰 TESORO ACUMULADO</span>
                        <span className="clan-metric-card__value">${selectedClan.vaultUsd.toFixed(2)} USD</span>
                        <small className="clan-metric-card__sub">Bóveda a repartir a fin de temporada</small>
                      </div>

                      <div className="clan-metric-card">
                        <span className="clan-metric-card__label">👥 MIEMBROS</span>
                        <span className="clan-metric-card__value">{selectedClan.members.length} / 15</span>
                        <small className="clan-metric-card__sub">
                          {15 - selectedClan.members.length > 0
                            ? `${15 - selectedClan.members.length} cupos libres`
                            : 'Cupo completo'}
                        </small>
                      </div>

                      <div className="clan-metric-card">
                        <span className="clan-metric-card__label">🏆 ELO PROMEDIO</span>
                        <span className="clan-metric-card__value">{avgElo} Copas</span>
                        <small className="clan-metric-card__sub">Nivel competitivo</small>
                      </div>

                      <div className="clan-metric-card">
                        <span className="clan-metric-card__label">⚔️ RÉCORD GUERRAS</span>
                        <span className="clan-metric-card__value">
                          {selectedClan.wins}V - {selectedClan.losses}D
                        </span>
                        <small className="clan-metric-card__sub">
                          {selectedClan.wins + selectedClan.losses > 0
                            ? `${Math.round(
                                (selectedClan.wins /
                                  Math.max(1, selectedClan.wins + selectedClan.losses)) *
                                  100
                              )}% Victorias`
                            : 'Sin guerras aún'}
                        </small>
                      </div>
                    </div>

                    {/* Members Preview */}
                    <div className="clan-showcase-members-box">
                      <div className="clan-showcase-members-title">
                        <span>👥 ROSTER DE JUGADORES ({selectedClan.members.length}/15)</span>
                        <small>Top miembros destacados</small>
                      </div>
                      <div className="clan-showcase-members-list">
                        {selectedClan.members.slice(0, 5).map((m, idx) => (
                          <div key={m.id} className="clan-showcase-member-row">
                            <span className="clan-member-row-rank">#{idx + 1}</span>
                            <span className="clan-member-row-name">{m.name}</span>
                            <span className={`clan-role-badge clan-role--${m.role.toLowerCase()}`}>{m.role}</span>
                            <span className="clan-member-row-elo">🏆 {m.elo}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Bottom Action Area */}
                    <div className="clan-showcase-action-bar">
                      {isSelectedFull ? (
                        <button type="button" disabled className="clan-showcase-btn clan-showcase-btn--full">
                          🔒 CLAN COMPLETO (15/15 MIEMBROS)
                        </button>
                      ) : isSelectedDefeated ? (
                        <button type="button" disabled className="clan-showcase-btn clan-showcase-btn--defeated">
                          🛑 CLAN EN ESTADO DE DERROTA ($0.00 USD)
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="clan-showcase-btn clan-showcase-btn--join"
                          onClick={() => handleJoinClan(selectedClan)}
                        >
                          ⚡ UNIRSE A {selectedClan.name.toUpperCase()} ($2.00 USD)
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="clan-showcase-empty">Selecciona un clan de la lista para ver su información.</div>
                )}
              </div>
            </div>
          )
        })()}

        {/* CREATE CLAN */}
        {noClanTab === 'create' && (
          <form className="clan-create-form" onSubmit={handleCreateClan}>
            <div className="clan-form-grid">
              <div className="clan-form-group">
                <label>Nombre del Clan (Máx 18 caracteres)</label>
                <input
                  type="text"
                  maxLength={18}
                  placeholder="Ej. DRAGON MASTERS"
                  value={newClanName}
                  onChange={(e) => setNewClanName(e.target.value)}
                  required
                />
              </div>

              <div className="clan-form-group">
                <label>Etiqueta / Tag (Ej. #DRG01)</label>
                <input
                  type="text"
                  maxLength={6}
                  placeholder="#DRG01"
                  value={newClanTag}
                  onChange={(e) => setNewClanTag(e.target.value)}
                  required
                />
              </div>

              <div className="clan-form-group">
                <label>Insignia / Escudo</label>
                <div className="clan-badge-picker">
                  {BADGES.map((b) => (
                    <button
                      key={b}
                      type="button"
                      className={`clan-badge-opt ${newClanBadge === b ? 'clan-badge-opt--active' : ''}`}
                      onClick={() => setNewClanBadge(b)}
                    >
                      {b}
                    </button>
                  ))}
                </div>
              </div>

              <div className="clan-form-group">
                <label>Descripción del Clan</label>
                <textarea
                  rows={2}
                  placeholder="Reglas, metas competitivas y mensaje de bienvenida..."
                  value={newClanDesc}
                  onChange={(e) => setNewClanDesc(e.target.value)}
                />
              </div>
            </div>

            <div className="clan-create-summary">
              <div className="clan-create-summary__item">
                <span>Costo de Creación:</span>
                <strong>$5.00 USD</strong>
              </div>
              <div className="clan-create-summary__item">
                <span>Tesoro Inicial del Clan:</span>
                <strong style={{ color: '#4ade80' }}>$5.00 USD</strong>
              </div>
              <div className="clan-create-summary__item">
                <span>Capacidad de Miembros:</span>
                <strong>15 Jugadores</strong>
              </div>
            </div>

            <button type="submit" className="clan-submit-create-btn">
              👑 FUNDAR CLAN POR $5.00 USD
            </button>
          </form>
        )}

        {/* CUSTOM IN-GAME POPUP DIALOG */}
        {renderCustomDialog()}
      </div>
    )
  }

  // ACTIVE CLAN VIEW
  const isDefeated = userClan.status === 'defeated' || userClan.vaultUsd <= 0
  const isShielded = userClan.shieldUntil && userClan.shieldUntil > Date.now()
  const shieldHours = isShielded ? Math.ceil((userClan.shieldUntil! - Date.now()) / 3600000) : 0

  return (
    <div className="clan-container">
      {/* Clan Topbar */}
      <div className="clan-active-topbar">
        <div className="clan-topbar-left">
          <button className="clan-back-btn" type="button" onClick={onBackToMenu}>
            ⬅ MENÚ
          </button>
          <div className="clan-main-identity">
            <span className="clan-main-badge">{userClan.badge}</span>
            <div>
              <div className="clan-title-tag">
                <h3>{userClan.name}</h3>
                <span className="clan-tag-pill">{userClan.tag}</span>
                {isDefeated && <span className="clan-defeat-pill">🛑 ESTADO DE DERROTA</span>}
                {isShielded && !isDefeated && (
                  <span className="clan-shield-pill">🛡️ ESCUDO {shieldHours}H</span>
                )}
              </div>
              <span className="clan-leader-txt">Líder: {userClan.leader} | {userClan.members.length}/15 Miembros</span>
            </div>
          </div>
        </div>

        {/* Settings Gear Button (Only Icon, No Text) */}
        <button
          type="button"
          className="clan-settings-gear-btn"
          onClick={handleOpenSettings}
          title="Ajustes y Configuración del Clan"
        >
          ⚙️
        </button>

        {/* Vault & Actions */}
        <div className="clan-topbar-right">
          <div className={`clan-vault-display ${isDefeated ? 'clan-vault-display--defeated' : ''}`}>
            <span className="clan-vault-title">💰 FONDO ACUMULADO DEL CLAN</span>
            <span className="clan-vault-amount">${userClan.vaultUsd.toFixed(2)} USD</span>
          </div>

          <div className="clan-topbar-btns">
            {isDefeated && (
              <button
                type="button"
                className="clan-repair-btn"
                onClick={handleRepairBase}
                title="Pagar $5 USD para reactivar la base"
              >
                🛠️ REPARAR BASE ($5.00)
              </button>
            )}

            <button type="button" className="clan-leave-btn" onClick={handleLeaveClan}>
              SALIR
            </button>
          </div>
        </div>
      </div>

      {/* TABS NAVIGATION */}
      <div className="clan-nav-tabs">
        <button
          type="button"
          className={`clan-tab-btn ${activeTab === 'members' ? 'clan-tab-btn--active' : ''}`}
          onClick={() => setActiveTab('members')}
        >
          👥 MIEMBROS ({userClan.members.length}/15)
        </button>
        <button
          type="button"
          className={`clan-tab-btn ${activeTab === 'wars' ? 'clan-tab-btn--active' : ''}`}
          onClick={() => setActiveTab('wars')}
        >
          ⚔️ GUERRA & ASALTOS ({userClan.wins}V - {userClan.losses}D)
        </button>
        <button
          type="button"
          className={`clan-tab-btn ${activeTab === 'donations' ? 'clan-tab-btn--active' : ''}`}
          onClick={() => setActiveTab('donations')}
        >
          🔄 DONACIONES ({donationRequests.length})
        </button>
        <button
          type="button"
          className={`clan-tab-btn ${activeTab === 'rewards' ? 'clan-tab-btn--active' : ''}`}
          onClick={() => setActiveTab('rewards')}
        >
          🎁 RECOMPENSAS
        </button>
      </div>

      {/* TAB 1: MEMBERS */}
      {activeTab === 'members' && (
        <div className="clan-members-pane">
          <div className="clan-members-table-wrap">
            <table className="clan-members-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>JUGADOR</th>
                  <th>ROL</th>
                  <th>COPAS ELO</th>
                  <th>DONACIONES</th>
                  <th>ASISTENCIA A GUERRA</th>
                  <th>ESTADO</th>
                  <th>GESTIÓN</th>
                </tr>
              </thead>
              <tbody>
                {userClan.members.map((member, idx) => {
                  const isMe = member.name === playerName
                  const isUserLeader = userClan.leader === playerName || userClan.members.find((m) => m.name === playerName)?.role === 'Líder'
                  const isUserColeader = userClan.members.find((m) => m.name === playerName)?.role === 'Colíder'
                  const canKickMembers = isUserLeader || isUserColeader
                  const validation = ClanManager.validateKickMember(userClan, member)
                  const roundsPart = member.roundsParticipated || 0
                  const missed = member.consecutiveRoundsMissed || 0
                  const wo = member.walkoverLosses || 0

                  return (
                    <tr key={member.id} className={isMe ? 'clan-row--me' : ''}>
                      <td>{idx + 1}</td>
                      <td className="clan-member-name-cell">
                        <strong className={isMe && hasVipPass ? 'vip-gold-text' : ''}>
                          {isMe && hasVipPass && '👑 '}
                          {member.name}
                        </strong>
                        {isMe && <span className="clan-me-tag">TÚ</span>}
                      </td>
                      <td>
                        <span className={`clan-role-badge clan-role--${member.role.toLowerCase()}`}>
                          {member.role}
                        </span>
                      </td>
                      <td>🏆 {member.elo}</td>
                      <td>🎁 {member.donatedCount} cartas</td>
                      <td>
                        {member.role === 'Líder' ? (
                          <span className="clan-war-badge clan-war-badge--leader" title="Líder Supremo del Clan">
                            👑 Líder
                          </span>
                        ) : validation.isProtected ? (
                          <span
                            className="clan-war-badge clan-war-badge--protected"
                            title={`Participó en ${roundsPart} rondas de guerra esta temporada. Blindado contra expulsión hasta fin de temporada.`}
                          >
                            🛡️ Blindado ({roundsPart} Rondas)
                          </span>
                        ) : validation.reasonCode === 'ELIGIBLE_INACTIVE' ? (
                          <span
                            className="clan-war-badge clan-war-badge--warning"
                            title={`No ha participado en ${missed} rondas consecutivas (2 semanas). Expulsión habilitada por inactividad.`}
                          >
                            ⚠️ Inactivo ({missed} Semanas)
                          </span>
                        ) : validation.reasonCode === 'ELIGIBLE_WALKOVER' ? (
                          <span
                            className="clan-war-badge clan-war-badge--danger"
                            title={`Registra ${wo} derrota(s) por W.O. por no presentarse. Expulsión habilitada por abandono.`}
                          >
                            🚨 {wo} Falta W.O.
                          </span>
                        ) : (
                          <span
                            className="clan-war-badge clan-war-badge--active"
                            title="Al día con la asistencia de guerra"
                          >
                            ✓ Activo ({roundsPart} Rondas)
                          </span>
                        )}
                      </td>
                      <td>
                        <span className="clan-status-dot" /> En línea
                      </td>
                      <td>
                        {!isMe && member.role !== 'Líder' && canKickMembers ? (
                          <button
                            type="button"
                            className={`clan-kick-action-btn ${
                              validation.canKick
                                ? 'clan-kick-action-btn--eligible'
                                : 'clan-kick-action-btn--protected'
                            }`}
                            onClick={() => handleOpenKickDialog(member)}
                            title={
                              validation.canKick
                                ? 'Expulsar por faltas comprobadas al reglamento'
                                : 'Ver motivo de protección o faltas acumuladas'
                            }
                          >
                            {validation.canKick ? '👢 EXPULSAR' : '🛡️ DETALLES'}
                          </button>
                        ) : (
                          <span className="clan-member-na-dash">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: WARS & RAIDS */}
      {activeTab === 'wars' && (() => {
        // Filtered rivals for attack sub-tab
        const rivals = allClans.filter((c) => c.id !== userClan.id)
        const filteredRivals = rivals.filter((rival) => {
          const matchesSearch =
            rival.name.toLowerCase().includes(rivalSearch.toLowerCase()) ||
            rival.tag.toLowerCase().includes(rivalSearch.toLowerCase())
          if (!matchesSearch) return false

          if (rivalFilter === 'vulnerable') {
            const isShielded = rival.shieldUntil && rival.shieldUntil > Date.now()
            const isDefeatedRival = rival.status === 'defeated' || rival.vaultUsd <= 0
            return !isShielded && !isDefeatedRival
          }
          if (rivalFilter === 'topVault') {
            return rival.vaultUsd >= 50
          }
          return true
        })

        // Challenges / raids received
        const receivedWarLogs = warLogs.filter(
          (log) => log.defenderClanName === userClan.name || log.challengerClanName === userClan.name
        )

        return (
          <div className="clan-wars-pane">
            {/* Header Banner & Summary */}
            <div className="clan-wars-banner">
              <div className="clan-wars-banner__info">
                <h4>🔥 DÍAS DE SAQUEO (JUEVES Y VIERNES — 48H DE GUERRA TOTAL)</h4>
                <p>
                  Asalta bases rivales por <strong>$5.00 USD por victoria</strong>. Al sufrir un saqueo, se activa un <strong>Escudo de 4 Horas</strong> para planear la revancha.
                </p>
              </div>
              <div className="clan-wars-record">
                <span className="clan-record-val">{userClan.wins}V - {userClan.losses}D</span>
                <span className="clan-record-lbl">RÉCORD DE GUERRA</span>
              </div>
            </div>

            {/* Mini Tabs for Wars */}
            <div className="clan-mini-tabs">
              <button
                type="button"
                className={`clan-mini-tab-btn ${warSubTab === 'attack' ? 'clan-mini-tab-btn--active' : ''}`}
                onClick={() => {
                  soundManager.playSound('click', 0.4)
                  setWarSubTab('attack')
                }}
              >
                🎯 ATACAR CLANES ({rivals.length})
              </button>
              <button
                type="button"
                className={`clan-mini-tab-btn ${warSubTab === 'reports' ? 'clan-mini-tab-btn--active' : ''}`}
                onClick={() => {
                  soundManager.playSound('click', 0.4)
                  setWarSubTab('reports')
                }}
              >
                🛡️ DESAFÍOS & REPORTES
              </button>
              <button
                type="button"
                className={`clan-mini-tab-btn ${warSubTab === 'participants' ? 'clan-mini-tab-btn--active' : ''}`}
                onClick={() => {
                  soundManager.playSound('click', 0.4)
                  setWarSubTab('participants')
                }}
              >
                👥 PARTICIPANTES & ESTATUS
              </button>
              <button
                type="button"
                className={`clan-mini-tab-btn ${warSubTab === 'history' ? 'clan-mini-tab-btn--active' : ''}`}
                onClick={() => {
                  soundManager.playSound('click', 0.4)
                  setWarSubTab('history')
                }}
              >
                📜 HISTORIAL ({warLogs.length})
              </button>
            </div>

            {/* SUBTAB 1: ATTACK CLANS */}
            {warSubTab === 'attack' && (
              <div className="clan-war-subpane">
                {/* Search & Filter Bar */}
                <div className="clan-war-filter-bar">
                  <div className="clan-search-input-wrap">
                    <span className="clan-search-icon">🔍</span>
                    <input
                      type="text"
                      placeholder="Buscar clan rival por nombre o #tag..."
                      value={rivalSearch}
                      onChange={(e) => setRivalSearch(e.target.value)}
                      className="clan-search-input"
                    />
                    {rivalSearch && (
                      <button type="button" className="clan-search-clear" onClick={() => setRivalSearch('')}>
                        ✕
                      </button>
                    )}
                  </div>

                  <div className="clan-war-filter-pills">
                    <button
                      type="button"
                      className={`clan-filter-pill ${rivalFilter === 'all' ? 'clan-filter-pill--active' : ''}`}
                      onClick={() => setRivalFilter('all')}
                    >
                      Todos ({rivals.length})
                    </button>
                    <button
                      type="button"
                      className={`clan-filter-pill ${rivalFilter === 'vulnerable' ? 'clan-filter-pill--active' : ''}`}
                      onClick={() => setRivalFilter('vulnerable')}
                    >
                      🔓 Sin Escudo
                    </button>
                    <button
                      type="button"
                      className={`clan-filter-pill ${rivalFilter === 'topVault' ? 'clan-filter-pill--active' : ''}`}
                      onClick={() => setRivalFilter('topVault')}
                    >
                      💰 Top Tesoros (+$50)
                    </button>
                  </div>
                </div>

                {/* Rivals Grid */}
                <div className="clan-rivals-grid">
                  {filteredRivals.length === 0 ? (
                    <div className="clan-empty-donations">
                      <span>No se encontraron clanes rivales con los filtros actuales.</span>
                    </div>
                  ) : (
                    filteredRivals.map((rival) => {
                      const rivalDefeated = rival.status === 'defeated' || rival.vaultUsd <= 0
                      const rivalShielded = rival.shieldUntil && rival.shieldUntil > Date.now()
                      const rivalShieldHours = rivalShielded ? Math.ceil((rival.shieldUntil! - Date.now()) / 3600000) : 0

                      return (
                        <div key={rival.id} className="clan-rival-card">
                          <div className="clan-rival-card__top">
                            <span className="clan-rival-badge">{rival.badge}</span>
                            <div>
                              <h5>{rival.name}</h5>
                              <span className="clan-rival-tag">{rival.tag}</span>
                            </div>
                          </div>

                          <div className="clan-rival-card__stats">
                            <span>💰 Tesoro: <strong>${rival.vaultUsd.toFixed(2)} USD</strong></span>
                            <span>👥 {rival.members.length}/15 Miembros</span>
                            <span>⚔️ {rival.wins}V - {rival.losses}D</span>
                          </div>

                          <div className="clan-rival-card__action">
                            {rivalDefeated ? (
                              <div className="clan-rival-status clan-rival-status--defeated">
                                🛑 EN ESTADO DE DERROTA ($0)
                              </div>
                            ) : rivalShielded ? (
                              <div className="clan-rival-status clan-rival-status--shield">
                                🛡️ ESCUDO ACTIVO ({rivalShieldHours}H)
                              </div>
                            ) : (
                              <button
                                type="button"
                                className="clan-raid-btn"
                                disabled={isDefeated}
                                onClick={() => handleExecuteRaid(rival)}
                              >
                                ⚔️ ASALTAR BOTÍN ($5.00)
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            )}

            {/* SUBTAB 2: REPORTS & CHALLENGES */}
            {warSubTab === 'reports' && (
              <div className="clan-war-subpane">
                <div className="clan-reports-header">
                  <h5>🛡️ REGISTRO DE DESAFÍOS Y ATAQUES RECIBIDOS</h5>
                  <p>Historial de clanes que han atacado a nuestro clan y reportes defensivos.</p>
                </div>
                <div className="clan-reports-list">
                  {receivedWarLogs.length === 0 ? (
                    <div className="clan-empty-donations">
                      <span>🛡️ Ningún clan rival nos ha desafiado recientemente. ¡Base defendida!</span>
                    </div>
                  ) : (
                    receivedWarLogs.map((log) => {
                      const wasOurDefeat = log.winnerClanName !== userClan.name
                      const enemyName = log.challengerClanName === userClan.name ? log.defenderClanName : log.challengerClanName
                      const enemyClan = allClans.find((c) => c.name === enemyName)

                      return (
                        <div key={log.id} className={`clan-report-card ${wasOurDefeat ? 'clan-report-card--lost' : 'clan-report-card--won'}`}>
                          <div className="clan-report-icon">
                            {wasOurDefeat ? '💥' : '🛡️'}
                          </div>
                          <div className="clan-report-info">
                            <div className="clan-report-title">
                              <strong>{log.challengerClanName}</strong> {wasOurDefeat ? 'asaltó nuestra base y saqueó' : 'desafió a nuestra base y fue repelido'}
                              <span className={wasOurDefeat ? 'clan-report-stolen-neg' : 'clan-report-stolen-pos'}>
                                {wasOurDefeat ? ` -$${log.stolenUsd.toFixed(2)} USD` : ' +$0.00 USD (Defendido)'}
                              </span>
                            </div>
                            <div className="clan-report-meta">
                              <span>Hace {Math.max(1, Math.round((Date.now() - log.timestamp) / 3600000))} horas</span>
                              {wasOurDefeat && <span className="clan-shield-tag-pill">🛡️ Escudo de 4h activado</span>}
                            </div>
                          </div>
                          {wasOurDefeat && enemyClan && (
                            <button
                              type="button"
                              className="clan-revenge-btn"
                              disabled={isDefeated || Boolean(enemyClan.shieldUntil && enemyClan.shieldUntil > Date.now())}
                              onClick={() => handleExecuteRaid(enemyClan)}
                            >
                              ⚔️ REVANCHA
                            </button>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            )}

            {/* SUBTAB 3: PARTICIPANTS & PERFORMANCE */}
            {warSubTab === 'participants' && (
              <div className="clan-war-subpane">
                <div className="clan-participants-stats-grid">
                  <div className="clan-pstat-card">
                    <span className="clan-pstat-val">{userClan.wins}</span>
                    <span className="clan-pstat-lbl">Victorias en Asaltos</span>
                  </div>
                  <div className="clan-pstat-card">
                    <span className="clan-pstat-val">{userClan.losses}</span>
                    <span className="clan-pstat-lbl">Derrotas / Saqueos</span>
                  </div>
                  <div className="clan-pstat-card">
                    <span className="clan-pstat-val">
                      {Math.round((userClan.wins / Math.max(1, userClan.wins + userClan.losses)) * 100)}%
                    </span>
                    <span className="clan-pstat-lbl">Tasa de Victoria</span>
                  </div>
                  <div className="clan-pstat-card">
                    <span className="clan-pstat-val" style={{ color: '#4ade80' }}>
                      +${(userClan.wins * 5).toFixed(0)} USD
                    </span>
                    <span className="clan-pstat-lbl">Botín Acumulado Ganado</span>
                  </div>
                </div>

                <div className="clan-participants-table-wrap">
                  <table className="clan-members-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Jugador</th>
                        <th>Rol</th>
                        <th>Copas ELO</th>
                        <th>Rondas Guerra</th>
                        <th>Donaciones</th>
                        <th>Estatus Competitivo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {userClan.members.map((m, idx) => {
                        const isProtected = (m.roundsParticipated || 0) >= 2
                        return (
                          <tr key={m.id}>
                            <td>#{idx + 1}</td>
                            <td><strong>{m.name}</strong></td>
                            <td><span className={`clan-role-badge clan-role--${m.role.toLowerCase()}`}>{m.role}</span></td>
                            <td>🏆 {m.elo}</td>
                            <td>⚔️ {m.roundsParticipated || 3} rondas</td>
                            <td>🌱 {m.donatedCount}</td>
                            <td>
                              <span className={isProtected ? 'clan-status-badge--protected' : 'clan-status-badge--active'}>
                                {isProtected ? '🛡️ Guerrero Protegido' : '⚔️ Activo'}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* SUBTAB 4: WAR HISTORY */}
            {warSubTab === 'history' && (
              <div className="clan-war-subpane">
                <div className="clan-war-logs-section">
                  <h5 className="clan-logs-title">📜 HISTORIAL GLOBAL DE ASALTOS & GUERRAS</h5>
                  <div className="clan-logs-list">
                    {warLogs.map((log) => {
                      const isOurClanWinner = log.winnerClanName === userClan.name
                      return (
                        <div key={log.id} className="clan-log-item">
                          <span className="clan-log-badge">{isOurClanWinner ? '🏆' : '⚔️'}</span>
                          <div className="clan-log-text">
                            <strong>{log.winnerClanName}</strong> derrotó a <strong>{log.defenderClanName}</strong> y saqueó{' '}
                            <span className="clan-log-amount">+${log.stolenUsd.toFixed(2)} USD</span>
                          </div>
                          <span className="clan-log-time">Hace {Math.max(1, Math.round((Date.now() - log.timestamp) / 3600000))}h</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {/* TAB 3: SEED DONATIONS & VAULT DEPOSITS */}
      {activeTab === 'donations' && (() => {
        const hasActiveRequestToday = donationRequests.some(
          (r) => r.requesterName === playerName && Date.now() - r.createdAt < 86400000
        )
        const totalDeposited = vaultDeposits.reduce((acc, d) => acc + d.amountUsd, 0)

        // Aggregate top depositors
        const depositorTotals: Record<string, number> = {}
        vaultDeposits.forEach((d) => {
          depositorTotals[d.depositorName] = (depositorTotals[d.depositorName] || 0) + d.amountUsd
        })
        const topDepositors = Object.entries(depositorTotals)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)

        return (
          <div className="clan-donations-pane">
            {/* Header & Mini Tabs */}
            <div className="clan-mini-tabs">
              <button
                type="button"
                className={`clan-mini-tab-btn ${donationSubTab === 'seeds' ? 'clan-mini-tab-btn--active' : ''}`}
                onClick={() => {
                  soundManager.playSound('click', 0.4)
                  setDonationSubTab('seeds')
                }}
              >
                🌱 PETICIONES DE SEMILLAS ({donationRequests.length})
              </button>
              <button
                type="button"
                className={`clan-mini-tab-btn ${donationSubTab === 'deposits' ? 'clan-mini-tab-btn--active' : ''}`}
                onClick={() => {
                  soundManager.playSound('click', 0.4)
                  setDonationSubTab('deposits')
                }}
              >
                💰 APORTES AL TESORO ({vaultDeposits.length})
              </button>
            </div>

            {/* SUBTAB 1: SEEDS */}
            {donationSubTab === 'seeds' && (
              <div className="clan-donation-subpane">
                <div className="clan-donations-header">
                  <div>
                    <h4>🔄 PETICIÓN & DONACIÓN DE SEMILLAS</h4>
                    <p>Pide 1 copia diaria de plantas comunes, raras o épicas. Cada petición puede recibir hasta 3 copias de tus compañeros.</p>
                  </div>
                  <button
                    type="button"
                    className={`clan-request-seed-btn ${hasActiveRequestToday ? 'clan-request-seed-btn--disabled' : ''}`}
                    disabled={isDefeated || hasActiveRequestToday}
                    onClick={() => {
                      if (hasActiveRequestToday) {
                        showModalAlert('SOLICITUD EN CURSO', 'Ya tienes una solicitud de semillas activa hoy. Podrás pedir otra en 24 horas.', '⏳', 'warning')
                        return
                      }
                      setShowRequestSeedModal(true)
                    }}
                  >
                    {hasActiveRequestToday ? '⏳ SOLICITUD EN CURSO (1/DÍA)' : '🌱 PEDIR SEMILLA (1 COPIA)'}
                  </button>
                </div>

                <div className="clan-donations-list">
                  {donationRequests.length === 0 ? (
                    <div className="clan-empty-donations">
                      <span>🌱 No hay solicitudes de semillas activas en este momento. ¡Sé el primero en pedir!</span>
                    </div>
                  ) : (
                    donationRequests.map((req) => {
                      const donorCount = req.donors.length
                      const isMax = donorCount >= 3
                      const hasDonated = req.donors.some((d) => d.donorName === playerName)
                      const isMe = req.requesterName === playerName
                      const plantConf = PLANT_CONFIGS[req.plantId]
                      const plantIconSrc = plantConf?.packetActive || plantConf?.icon || req.plantIcon

                      return (
                        <div key={req.id} className="clan-donation-card">
                          <img src={plantIconSrc} alt={req.plantName} className="clan-donation-img" />
                          <div className="clan-donation-info">
                            <div className="clan-donation-top">
                              <span className="clan-donation-requester">👤 {req.requesterName}</span>
                              <span className="clan-donation-plant">{req.plantName}</span>
                            </div>
                            <div className="clan-donation-bar-wrap">
                              <div
                                className="clan-donation-bar"
                                style={{ width: `${(donorCount / 3) * 100}%` }}
                              />
                            </div>
                            <span className="clan-donation-count">{donorCount}/3 Donaciones Recibidas</span>
                          </div>

                          <div className="clan-donation-actions">
                            {isMax ? (
                              <span className="clan-donation-status clan-donation-status--full">✅ COMPLETADO</span>
                            ) : isMe ? (
                              <span className="clan-donation-status">TU SOLICITUD</span>
                            ) : hasDonated ? (
                              <span className="clan-donation-status clan-donation-status--done">YA DONASTE</span>
                            ) : (
                              <button
                                type="button"
                                className="clan-donate-btn"
                                disabled={isDefeated || (plantCopies[req.plantId] || 0) <= 0}
                                onClick={() => handleDonate(req)}
                              >
                                🎁 DONAR 1 COPIA (Tienes {plantCopies[req.plantId] || 0})
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            )}

            {/* SUBTAB 2: DEPOSITS & VAULT CONTRIBUTIONS */}
            {donationSubTab === 'deposits' && (
              <div className="clan-donation-subpane">
                {/* Vault summary banner */}
                <div className="clan-deposits-summary-row">
                  <div className="clan-deposit-stat-card">
                    <span className="clan-deposit-stat-icon">💰</span>
                    <div>
                      <span className="clan-deposit-stat-val">${userClan.vaultUsd.toFixed(2)} USD</span>
                      <span className="clan-deposit-stat-lbl">Tesoro Actual del Clan</span>
                    </div>
                  </div>
                  <div className="clan-deposit-stat-card">
                    <span className="clan-deposit-stat-icon">📈</span>
                    <div>
                      <span className="clan-deposit-stat-val" style={{ color: '#4ade80' }}>
                        +${totalDeposited.toFixed(2)} USD
                      </span>
                      <span className="clan-deposit-stat-lbl">Total Aportado al Tesoro</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="clan-open-deposit-cta"
                    onClick={() => {
                      soundManager.playSound('click', 0.4)
                      setShowDepositModal(true)
                    }}
                  >
                    ➕ DEPOSITAR AL TESORO
                  </button>
                </div>

                {/* Dual pane: Top Contributors & Realtime Feed */}
                <div className="clan-deposits-dual-layout">
                  {/* Left: Top Donators Podium */}
                  <div className="clan-top-depositors-box">
                    <h5>🏆 MAYORES APORTANTES DEL TESORO</h5>
                    <div className="clan-top-depositors-list">
                      {topDepositors.map(([name, amount], index) => {
                        const rankMedal = index === 0 ? '👑' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`
                        const isMe = name === playerName
                        return (
                          <div key={name} className={`clan-depositor-rank-row ${isMe ? 'clan-depositor-rank-row--me' : ''}`}>
                            <span className="clan-dep-medal">{rankMedal}</span>
                            <span className="clan-dep-name">
                              {name} {isMe && <small>(Tú)</small>}
                            </span>
                            <span className="clan-dep-amount">${amount.toFixed(2)} USD</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* Right: Chronological Deposit Logs Feed */}
                  <div className="clan-deposits-feed-box">
                    <h5>📜 REGISTRO DE DEPÓSITOS & ACTIVIDAD</h5>
                    <div className="clan-deposits-feed-list">
                      {vaultDeposits.map((dep) => {
                        const reasonLabels = {
                          deposit: '💰 Aporte Voluntario',
                          fund: '👑 Fundación de Clan',
                          join: '⚡ Cuota de Ingreso',
                          repair: '🛠️ Reparación de Base',
                        }
                        const isMe = dep.depositorName === playerName
                        const timeAgoHours = Math.max(0, Math.round((Date.now() - dep.timestamp) / 3600000))
                        const timeText = timeAgoHours < 1 ? 'Hace unos instantes' : timeAgoHours < 24 ? `Hace ${timeAgoHours}h` : `Hace ${Math.round(timeAgoHours / 24)}d`

                        return (
                          <div key={dep.id} className="clan-deposit-feed-item">
                            <div className="clan-deposit-feed-icon">💵</div>
                            <div className="clan-deposit-feed-info">
                              <div className="clan-deposit-feed-top">
                                <strong>{dep.depositorName} {isMe && '(Tú)'}</strong>
                                <span className="clan-deposit-feed-tag">{reasonLabels[dep.reason] || 'Aporte'}</span>
                              </div>
                              <span className="clan-deposit-feed-time">{timeText}</span>
                            </div>
                            <div className="clan-deposit-feed-amount">
                              +${dep.amountUsd.toFixed(2)} USD
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {/* TAB 4: REWARDS */}
      {activeTab === 'rewards' && (
        <div className="clan-rewards-pane">
          {/* Card 1: 15/15 Full Clan Bonus */}
          <div className="clan-reward-card">
            <div className="clan-reward-card__icon">🎁</div>
            <div className="clan-reward-card__content">
              <h4>BONO DE CLAN LLENO (15/15 MIEMBROS)</h4>
              <p>
                Al alcanzar los 15 miembros, cada jugador recibe <strong>2 Sobres Pack Verde Básico</strong>.
                Solo se puede reclamar 1 vez por jugador para evitar abusos al cambiarse de clan.
              </p>
              <div className="clan-reward-status-row">
                <span>Progreso: <strong>{userClan.members.length}/15 Miembros</strong></span>
                {ClanManager.hasClaimedFullClanBonus(playerName) && (
                  <span className="clan-claimed-badge">✓ YA RECLAMADO EN ESTA CUENTA</span>
                )}
              </div>
            </div>
            <button
              type="button"
              className="clan-claim-reward-btn"
              disabled={userClan.members.length < 15 || ClanManager.hasClaimedFullClanBonus(playerName)}
              onClick={handleClaimFullBonus}
            >
              {ClanManager.hasClaimedFullClanBonus(playerName) ? '✅ YA COBRADO' : '✨ RECLAMAR 2 SOBRES'}
            </button>
          </div>

          {/* Card 2: Season Vault Payout */}
          {(() => {
            const seasonStatus = SeasonManager.getSeasonStatus()
            const isClaimed = userClan.seasonPayoutClaimedMembers.includes(playerName)
            const canWithdraw = seasonStatus.isEnded && userClan.vaultUsd > 0 && !isClaimed

            return (
              <div className="clan-reward-card clan-reward-card--payout">
                <div className="clan-reward-card__icon">💰</div>
                <div className="clan-reward-card__content">
                  <h4>REPARTO DEL TESORO DE TEMPORADA</h4>
                  <p>
                    Al finalizar los 30 días de temporada, el Tesoro acumulado ($<strong>{userClan.vaultUsd.toFixed(2)} USD</strong>) se divide en partes iguales entre los miembros del clan.
                  </p>
                  <div className="clan-reward-status-row">
                    <span>Tu porción estimada (1/{userClan.members.length}): <strong style={{ color: '#4ade80' }}>
                      ${(userClan.vaultUsd / Math.max(1, userClan.members.length)).toFixed(2)} USD
                    </strong></span>
                    {!seasonStatus.isEnded && (
                      <span className="clan-season-time-tag">⏳ Cierra en: {seasonStatus.formattedCountdown}</span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  className={`clan-claim-reward-btn clan-claim-reward-btn--gold ${!canWithdraw ? 'clan-claim-reward-btn--disabled' : ''}`}
                  disabled={!canWithdraw}
                  onClick={handleClaimSeasonPayout}
                  title={!seasonStatus.isEnded ? `Disponible en ${seasonStatus.formattedCountdown}` : 'Retirar fondos'}
                >
                  {isClaimed
                    ? '✅ RETIRADO'
                    : !seasonStatus.isEnded
                    ? `⏳ RETIRAR (${seasonStatus.formattedCountdown})`
                    : '💎 RETIRAR'}
                </button>
              </div>
            )
          })()}
        </div>
      )}

      {/* DEPOSIT MODAL */}
      {showDepositModal && (
        <div className="clan-modal-backdrop" onClick={() => setShowDepositModal(false)}>
          <div className="clan-modal-box" onClick={(e) => e.stopPropagation()}>
            <h3>💎 APORTAR GEMAS AL TESORO DEL CLAN</h3>
            <p>
              Aporta Gemas al Tesoro de tu Clan para blindar su economía.
              <br />
              <strong style={{ color: '#fbbf24' }}>
                🎁 ¡Por cada 1 Gema aportada recibes +1 Ticket de Coliseo 🎟️ y +1 Tiro Gratis en la Ruleta 🎡!
              </strong>
            </p>

            <div className="clan-deposit-opts">
              {[1.0, 2.0, 5.0, 10.0, 20.0].map((amt) => (
                <button
                  key={amt}
                  type="button"
                  className={`clan-deposit-opt ${depositAmount === amt ? 'clan-deposit-opt--active' : ''}`}
                  onClick={() => setDepositAmount(amt)}
                >
                  {amt} 💎 Gemas
                </button>
              ))}
            </div>

            <div className="clan-modal-actions">
              <button type="button" className="clan-cancel-btn" onClick={() => setShowDepositModal(false)}>
                CANCELAR
              </button>
              <button type="button" className="clan-confirm-btn" onClick={handleDeposit}>
                CONFIRMAR DEPÓSITO ({depositAmount} 💎)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SEED REQUEST MODAL */}
      {showRequestSeedModal && (
        <div className="clan-modal-backdrop" onClick={() => setShowRequestSeedModal(false)}>
          <div className="clan-modal-box" onClick={(e) => e.stopPropagation()}>
            <h3>🌱 SELECCIONA LA PLANTA A SOLICITAR</h3>
            <p>Recibirás hasta 3 copias donadas por tus compañeros de clan.</p>

            <div className="clan-plant-picker-grid">
              {(Object.keys(PLANT_CONFIGS) as PlantId[])
                .filter((p) => p !== 'melonpult') // No legendarias
                .map((plantId) => {
                  const p = PLANT_CONFIGS[plantId]
                  const isSelected = selectedRequestPlant === plantId
                  const packetImg = p.packetActive || p.icon
                  return (
                    <button
                      key={plantId}
                      type="button"
                      className={`clan-plant-picker-card ${isSelected ? 'clan-plant-picker-card--active' : ''}`}
                      onClick={() => setSelectedRequestPlant(plantId)}
                    >
                      <img src={packetImg} alt={p.name} />
                      <span>{p.name}</span>
                      <small>{plantCopies[plantId] || 0} copias</small>
                    </button>
                  )
                })}
            </div>

            <div className="clan-modal-actions">
              <button type="button" className="clan-cancel-btn" onClick={() => setShowRequestSeedModal(false)}>
                CANCELAR
              </button>
              <button type="button" className="clan-confirm-btn" onClick={handleCreateRequest}>
                PUBLICAR SOLICITUD
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REDESIGNED CLAN SETTINGS MODAL */}
      {showSettingsModal && (
        <div className="clan-modal-backdrop" onClick={() => setShowSettingsModal(false)}>
          <div className="clan-modal-box clan-settings-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="clan-modal-header-row">
              <div className="clan-modal-header-title">
                <span className="clan-modal-header-icon">⚙️</span>
                <div>
                  <h3>AJUSTES DEL CLAN</h3>
                  <p>Reglas de admisión, privacidad y gobernanza de guerra</p>
                </div>
              </div>
              <button
                type="button"
                className="clan-modal-close-btn"
                onClick={() => {
                  soundManager.playSound('click', 0.4)
                  setShowSettingsModal(false)
                }}
                title="Cerrar ajustes"
              >
                ✕
              </button>
            </div>

            <div className="clan-settings-grid">
              {/* Setting 1: Privacy Type */}
              <div className="clan-setting-card">
                <div className="clan-setting-card__header">
                  <span className="clan-setting-card__icon">🔒</span>
                  <div>
                    <span className="clan-setting-card__title">Privacidad y Admisión</span>
                    <span className="clan-setting-card__desc">Define cómo ingresan los nuevos miembros</span>
                  </div>
                </div>
                <div className="clan-setting-tiles-grid">
                  <button
                    type="button"
                    className={`clan-setting-tile ${clanPrivacy === 'public' ? 'clan-setting-tile--active' : ''}`}
                    onClick={() => {
                      soundManager.playSound('click', 0.4)
                      setClanPrivacy('public')
                    }}
                  >
                    <div className="clan-setting-tile__indicator" />
                    <span className="clan-setting-tile__emoji">🟢</span>
                    <div className="clan-setting-tile__info">
                      <strong>ABIERTO</strong>
                      <small>Ingreso directo ($2 USD)</small>
                    </div>
                  </button>

                  <button
                    type="button"
                    className={`clan-setting-tile ${clanPrivacy === 'request' ? 'clan-setting-tile--active' : ''}`}
                    onClick={() => {
                      soundManager.playSound('click', 0.4)
                      setClanPrivacy('request')
                    }}
                  >
                    <div className="clan-setting-tile__indicator" />
                    <span className="clan-setting-tile__emoji">🟡</span>
                    <div className="clan-setting-tile__info">
                      <strong>CON SOLICITUD</strong>
                      <small>Requiere aprobación de Líder</small>
                    </div>
                  </button>

                  <button
                    type="button"
                    className={`clan-setting-tile ${clanPrivacy === 'closed' ? 'clan-setting-tile--active' : ''}`}
                    onClick={() => {
                      soundManager.playSound('click', 0.4)
                      setClanPrivacy('closed')
                    }}
                  >
                    <div className="clan-setting-tile__indicator" />
                    <span className="clan-setting-tile__emoji">🔒</span>
                    <div className="clan-setting-tile__info">
                      <strong>CERRADO</strong>
                      <small>Solo invitación privada</small>
                    </div>
                  </button>
                </div>
              </div>

              {/* Setting 2: Minimum ELO Cups */}
              <div className="clan-setting-card">
                <div className="clan-setting-card__header">
                  <span className="clan-setting-card__icon">🏆</span>
                  <div>
                    <span className="clan-setting-card__title">Requisito ELO Mínimo</span>
                    <span className="clan-setting-card__desc">Copas necesarias en la Arena para solicitar ingreso</span>
                  </div>
                </div>
                <div className="clan-setting-elo-grid">
                  {[0, 1000, 1500, 2000].map((elo) => (
                    <button
                      key={elo}
                      type="button"
                      className={`clan-setting-elo-btn ${clanMinElo === elo ? 'clan-setting-elo-btn--active' : ''}`}
                      onClick={() => {
                        soundManager.playSound('click', 0.4)
                        setClanMinElo(elo)
                      }}
                    >
                      <span className="clan-setting-elo-val">{elo === 0 ? '0' : elo.toLocaleString()}</span>
                      <span className="clan-setting-elo-tag">{elo === 0 ? 'Sin Límite' : '🏆 Copas'}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Setting 3: War Permissions */}
              <div className="clan-setting-card">
                <div className="clan-setting-card__header">
                  <span className="clan-setting-card__icon">⚔️</span>
                  <div>
                    <span className="clan-setting-card__title">Permisos de Guerra de Clanes</span>
                    <span className="clan-setting-card__desc">Quién puede declarar asaltos y aceptar guerras</span>
                  </div>
                </div>
                <div className="clan-setting-tiles-grid clan-setting-tiles-grid--2col">
                  <button
                    type="button"
                    className={`clan-setting-tile ${clanWarPermission === 'leaders' ? 'clan-setting-tile--active' : ''}`}
                    onClick={() => {
                      soundManager.playSound('click', 0.4)
                      setClanWarPermission('leaders')
                    }}
                  >
                    <div className="clan-setting-tile__indicator" />
                    <span className="clan-setting-tile__emoji">👑</span>
                    <div className="clan-setting-tile__info">
                      <strong>LÍDER Y COLÍDERES</strong>
                      <small>Control estratégico exclusivo</small>
                    </div>
                  </button>

                  <button
                    type="button"
                    className={`clan-setting-tile ${clanWarPermission === 'all' ? 'clan-setting-tile--active' : ''}`}
                    onClick={() => {
                      soundManager.playSound('click', 0.4)
                      setClanWarPermission('all')
                    }}
                  >
                    <div className="clan-setting-tile__indicator" />
                    <span className="clan-setting-tile__emoji">⚔️</span>
                    <div className="clan-setting-tile__info">
                      <strong>TODOS LOS MIEMBROS</strong>
                      <small>Cualquiera puede iniciar asaltos</small>
                    </div>
                  </button>
                </div>
              </div>

              {/* Setting 4: Auto-Accept Toggle */}
              <div className="clan-setting-card clan-setting-card--toggle">
                <div className="clan-setting-card__header">
                  <span className="clan-setting-card__icon">⚡</span>
                  <div>
                    <span className="clan-setting-card__title">Aprobación Instantánea</span>
                    <span className="clan-setting-card__desc">Acepta automáticamente a jugadores que cumplan el ELO y paguen $2 USD</span>
                  </div>
                </div>
                <button
                  type="button"
                  className={`clan-setting-switch ${clanAutoAccept ? 'clan-setting-switch--active' : ''}`}
                  onClick={() => {
                    soundManager.playSound('click', 0.4)
                    setClanAutoAccept((v) => !v)
                  }}
                >
                  <span className="clan-setting-switch__thumb" />
                  <span className="clan-setting-switch__label">
                    {clanAutoAccept ? 'ACTIVADO' : 'DESACTIVADO'}
                  </span>
                </button>
              </div>
            </div>

            <div className="clan-modal-actions">
              <button
                type="button"
                className="clan-cancel-btn"
                onClick={() => {
                  soundManager.playSound('click', 0.4)
                  setShowSettingsModal(false)
                }}
              >
                CANCELAR
              </button>
              <button
                type="button"
                className="clan-confirm-btn"
                onClick={handleSaveClanSettings}
              >
                💾 GUARDAR AJUSTES
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MEMBER KICK VALIDATION & CONFIRMATION MODAL */}
      {showKickModal && selectedMemberToKick && kickValidation && (
        <div className="clan-modal-backdrop" onClick={() => setShowKickModal(false)}>
          <div className="clan-modal-box clan-kick-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="clan-modal-header-row">
              <div className="clan-modal-header-title">
                <span className="clan-modal-header-icon">
                  {kickValidation.canKick ? '⚠️' : '🛡️'}
                </span>
                <div>
                  <h3>
                    {kickValidation.canKick
                      ? 'EXPULSIÓN DE MIEMBRO'
                      : 'PROTECCIÓN DE JUGADOR'}
                  </h3>
                  <p>Reglamento competitivo de Guerra de Clanes</p>
                </div>
              </div>
              <button
                type="button"
                className="clan-modal-close-btn"
                onClick={() => {
                  soundManager.playSound('click', 0.4)
                  setShowKickModal(false)
                }}
              >
                ✕
              </button>
            </div>

            <div className="clan-kick-target-card">
              <div className="clan-kick-target-left">
                <span className="clan-kick-avatar-badge">👤</span>
                <div>
                  <h4>{selectedMemberToKick.name}</h4>
                  <span className={`clan-role-badge clan-role--${selectedMemberToKick.role.toLowerCase()}`}>
                    {selectedMemberToKick.role}
                  </span>
                </div>
              </div>
              <div className="clan-kick-target-elo">
                <span>COPAS ELO</span>
                <strong>🏆 {selectedMemberToKick.elo}</strong>
              </div>
            </div>

            {/* Attendance breakdown stats */}
            <div className="clan-kick-stats-grid">
              <div className="clan-kick-stat-item">
                <span className="clan-kick-stat-val" style={{ color: '#4ade80' }}>
                  {kickValidation.details.roundsParticipated}
                </span>
                <span className="clan-kick-stat-lbl">Rondas Jugadas</span>
                <small>(Temporada)</small>
              </div>
              <div className="clan-kick-stat-item">
                <span
                  className="clan-kick-stat-val"
                  style={{
                    color: kickValidation.details.consecutiveMissed >= 2 ? '#f87171' : '#fbbf24',
                  }}
                >
                  {kickValidation.details.consecutiveMissed} / 2
                </span>
                <span className="clan-kick-stat-lbl">Semanas Inactivo</span>
                <small>(Consecutivas)</small>
              </div>
              <div className="clan-kick-stat-item">
                <span
                  className="clan-kick-stat-val"
                  style={{
                    color: kickValidation.details.walkoverLosses >= 1 ? '#ef4444' : '#94a3b8',
                  }}
                >
                  {kickValidation.details.walkoverLosses}
                </span>
                <span className="clan-kick-stat-lbl">Faltas por W.O.</span>
                <small>(No presentado)</small>
              </div>
            </div>

            {/* Explanation box */}
            <div
              className={`clan-kick-notice-box ${
                kickValidation.canKick ? 'clan-kick-notice-box--eligible' : 'clan-kick-notice-box--protected'
              }`}
            >
              <div className="clan-kick-notice-icon">
                {kickValidation.isProtected
                  ? '🛡️'
                  : kickValidation.canKick
                  ? '⚠️'
                  : 'ℹ️'}
              </div>
              <div className="clan-kick-notice-text">
                <strong>
                  {kickValidation.isProtected
                    ? 'JUGADOR BLINDADO HASTA FIN DE TEMPORADA'
                    : kickValidation.canKick
                    ? 'MOTIVO VÁLIDO DE EXPULSIÓN DETECTADO'
                    : 'FALTAS INSUFICIENTES PARA EXPULSIÓN'}
                </strong>
                <p>{kickValidation.message}</p>
              </div>
            </div>

            <div className="clan-modal-actions">
              {kickValidation.canKick ? (
                <>
                  <button
                    type="button"
                    className="clan-cancel-btn"
                    onClick={() => {
                      soundManager.playSound('click', 0.4)
                      setShowKickModal(false)
                    }}
                  >
                    CANCELAR
                  </button>
                  <button
                    type="button"
                    className="clan-kick-confirm-btn"
                    onClick={handleExecuteKick}
                  >
                    👢 CONFIRMAR EXPULSIÓN
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="clan-confirm-btn"
                  style={{ width: '100%' }}
                  onClick={() => {
                    soundManager.playSound('click', 0.4)
                    setShowKickModal(false)
                  }}
                >
                  ENTENDIDO
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* CUSTOM IN-GAME POPUP DIALOG */}
      {renderCustomDialog()}

      {/* FLOATING MINIMIZABLE CLAN CHAT */}
      {userClan && (
        <div className={`clan-floating-chat ${isChatOpen ? 'clan-floating-chat--open' : ''}`}>
          {!isChatOpen ? (
            <button
              type="button"
              className="clan-chat-toggle-btn"
              onClick={() => setIsChatOpen(true)}
              title="Abrir Chat del Clan"
            >
              <span className="clan-chat-icon">💬</span>
              {chatMessages.length > 0 && (
                <span className="clan-chat-badge">{chatMessages.length}</span>
              )}
            </button>
          ) : (
            <div className="clan-chat-window">
              <div className="clan-chat-header" onClick={() => setIsChatOpen(false)}>
                <div className="clan-chat-header-info">
                  <span className="clan-chat-icon">💬</span>
                  <strong>CHAT: {userClan.name}</strong>
                </div>
                <button
                  type="button"
                  className="clan-chat-minimize-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    setIsChatOpen(false)
                  }}
                  title="Minimizar"
                >
                  ▼
                </button>
              </div>

              <div className="clan-chat-body">
                {chatMessages.map((msg) => {
                  const isMe = msg.sender === playerName
                  return (
                    <div key={msg.id} className={`clan-chat-msg ${isMe ? 'clan-chat-msg--me' : ''}`}>
                      <div className="clan-chat-msg-top">
                        <span className={`clan-chat-sender ${isMe && hasVipPass ? 'vip-gold-text' : ''}`}>
                          {isMe && hasVipPass && '👑 '}
                          {msg.sender}
                        </span>
                        <span className={`clan-chat-role-tag clan-chat-role-tag--${msg.role.toLowerCase()}`}>
                          {msg.role}
                        </span>
                        <span className="clan-chat-time">{msg.time}</span>
                      </div>
                      <div className="clan-chat-text">{msg.text}</div>
                    </div>
                  )
                })}
              </div>

              <form className="clan-chat-footer" onSubmit={handleSendChatMessage}>
                <input
                  type="text"
                  placeholder="Escribe a tus compañeros..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  maxLength={100}
                />
                <button type="submit" className="clan-chat-send-btn">
                  ➤
                </button>
              </form>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
