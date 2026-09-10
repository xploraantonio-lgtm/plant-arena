import { useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'

/**
 * Hook para monitorear usuarios en línea en tiempo real usando Supabase Realtime Presence.
 *
 * Eficiencia y costos en Supabase:
 * - NO consume lecturas ni escrituras de base de datos PostgreSQL (0 queries, 0 locks).
 * - Se maneja en memoria a través de WebSocket (Phoenix Presence).
 * - Si hay menos de 30 usuarios conectados o hay desconexión, muestra 25 como fallback visual.
 * - Si hay más de 30 usuarios, muestra el valor real en tiempo real.
 */
function getSessionPresenceId(): string {
  try {
    const stored = sessionStorage.getItem('pa_presence_id')
    if (stored) return stored
    const newId = 'user_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36)
    sessionStorage.setItem('pa_presence_id', newId)
    return newId
  } catch {
    return 'user_' + Math.random().toString(36).substring(2, 9)
  }
}

export function useOnlineUsers(userId?: string): number {
  const [onlineCount, setOnlineCount] = useState<number>(25)

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      return
    }

    const presenceKey = userId || getSessionPresenceId()

    const channel = supabase.channel('online-players-presence', {
      config: {
        presence: {
          key: presenceKey,
        },
      },
    })

    const updateCount = () => {
      try {
        const state = channel.presenceState()
        const uniqueKeys = Object.keys(state)
        const realCount = uniqueKeys.length

        // Regla: si hay menos de 30 muestra 25 como fallback; si hay más de 30 muestra el valor real
        if (realCount > 30) {
          setOnlineCount(realCount)
        } else {
          setOnlineCount(25)
        }
      } catch (err) {
        console.warn('[useOnlineUsers] Error calculating presence state:', err)
        setOnlineCount(25)
      }
    }

    channel
      .on('presence', { event: 'sync' }, updateCount)
      .on('presence', { event: 'join' }, updateCount)
      .on('presence', { event: 'leave' }, updateCount)
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          try {
            await channel.track({
              online_at: Date.now(),
            })
          } catch (err) {
            console.warn('[useOnlineUsers] Error tracking presence:', err)
          }
        }
      })

    return () => {
      void channel.unsubscribe()
    }
  }, [userId])

  return onlineCount
}
