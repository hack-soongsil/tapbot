import { useCallback, useEffect, useRef, useState } from 'react'
import { macroEditorApi } from '../macro-editor/api'
import { applyRuntimeEvent, emptyRuntimeView, syncRuntimeSnapshot } from './runtime-store'
import type { MacroRuntimeEvent } from './types'
import { useMacroEvents } from './useMacroEvents'

export function useMacroRuntime(deviceId: string | null) {
  const [view, setView] = useState(emptyRuntimeView)
  const sequenceRef = useRef<number | null>(null)
  const runtimeIdRef = useRef<string | null>(null)
  const deviceRef = useRef(deviceId)
  useEffect(() => {
    deviceRef.current = deviceId
  }, [deviceId])

  const refresh = useCallback(async () => {
    if (!deviceId) return
    try {
      const response = await macroEditorApi.runtime(deviceId)
      if (deviceRef.current !== deviceId) return
      setView((current) => syncRuntimeSnapshot(current, response.runtime))
      sequenceRef.current = null
      runtimeIdRef.current = response.runtime.runtime_id
    } catch {
      // The SSE connection state communicates transport failure to the UI.
    }
  }, [deviceId])

  useEffect(() => {
    sequenceRef.current = null
    runtimeIdRef.current = null
    const timer = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(timer)
  }, [deviceId, refresh])

  const receive = useCallback((event: MacroRuntimeEvent) => {
    if (runtimeIdRef.current !== event.runtime_id) {
      runtimeIdRef.current = event.runtime_id
      sequenceRef.current = null
    }
    const previous = sequenceRef.current
    if (previous !== null && event.sequence !== previous + 1) void refresh()
    sequenceRef.current = event.sequence
    setView((current) => applyRuntimeEvent(current, event))
  }, [refresh])

  const reconnect = useCallback(() => { void refresh() }, [refresh])
  const connected = useMacroEvents(deviceId, receive, reconnect)
  return { ...view, connected, refresh }
}
