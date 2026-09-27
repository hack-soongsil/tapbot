import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PropsWithChildren } from 'react'
import { ApiError } from '../lib/api-client'
import type { BackendConnectionState, BackendSystemStatus } from '../types/system'
import { systemApi } from '../features/system/system-api'
import { SystemStatusContext } from './system-status'

const STATUS_INTERVAL_MS = 2_000

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Status request failed.'
}

export function SystemStatusProvider({ children }: PropsWithChildren) {
  const [backend, setBackend] = useState<BackendSystemStatus | null>(null)
  const [backendState, setBackendState] =
    useState<BackendConnectionState>('connecting')
  const [backendError, setBackendError] = useState<string | null>(null)
  const requestInFlight = useRef(false)

  const refresh = useCallback(async () => {
    if (requestInFlight.current) return
    requestInFlight.current = true
    try {
      setBackend(await systemApi.status())
      setBackendState('online')
      setBackendError(null)
    } catch (error) {
      setBackendState('offline')
      setBackendError(errorMessage(error))
    } finally {
      requestInFlight.current = false
    }
  }, [])

  useEffect(() => {
    const firstRequest = window.setTimeout(() => void refresh(), 0)
    const interval = window.setInterval(() => void refresh(), STATUS_INTERVAL_MS)
    return () => {
      window.clearTimeout(firstRequest)
      window.clearInterval(interval)
    }
  }, [refresh])

  const value = useMemo(
    () => ({
      backend,
      backendState,
      backendError,
      refresh: () => void refresh(),
    }),
    [backend, backendError, backendState, refresh],
  )

  return (
    <SystemStatusContext.Provider value={value}>
      {children}
    </SystemStatusContext.Provider>
  )
}
