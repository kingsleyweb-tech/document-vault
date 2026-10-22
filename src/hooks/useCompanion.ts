import { useCallback, useEffect, useRef, useState } from 'react'
import { companion, CompanionError, hasPairing, type CompanionStatus } from '../services/desktopCompanion'

export type CompanionConnection = 'checking' | 'offline' | 'unpaired' | 'ready'

const BUSY_POLL_MS = 1500
const IDLE_POLL_MS = 15000
const OFFLINE_POLL_MS = 5000

/**
 * Tracks whether the local companion is running and paired, and its index
 * status. Polls quickly only while indexing; otherwise rarely, and never while
 * the tab is hidden.
 */
export function useCompanion() {
  const [connection, setConnection] = useState<CompanionConnection>('checking')
  const [status, setStatus] = useState<CompanionStatus | null>(null)
  const [version, setVersion] = useState<string | null>(null)
  const generation = useRef(0)

  const refresh = useCallback(async () => {
    const run = ++generation.current
    try {
      const hello = await companion.hello()
      if (run !== generation.current) return
      setVersion(hello.version)
      if (!hasPairing() && !(await companion.autoPair().catch(() => false))) {
        if (run !== generation.current) return
        setConnection('unpaired')
        setStatus(null)
        return
      }
      const next = await companion.status()
      if (run !== generation.current) return
      setStatus(next)
      setConnection('ready')
    } catch (error) {
      if (run !== generation.current) return
      setStatus(null)
      setConnection(error instanceof CompanionError && error.problem === 'unpaired' ? 'unpaired' : 'offline')
    }
  }, [])

  const busy = Boolean(status && status.index.state !== 'idle')
  const delay = connection === 'ready' ? (busy ? BUSY_POLL_MS : IDLE_POLL_MS) : connection === 'checking' ? 0 : OFFLINE_POLL_MS

  useEffect(() => {
    let timer = 0
    const tick = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    timer = window.setTimeout(function loop() {
      tick()
      timer = window.setTimeout(loop, delay || IDLE_POLL_MS)
    }, delay)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [delay, refresh])

  return { connection, status, version, refresh }
}
