import { useEffect, useState } from 'react'
import { apiUrl } from '../../lib/config'
import type { MacroRuntimeEvent } from './types'

export function useMacroEvents(
  deviceId: string | null,
  onEvent: (event: MacroRuntimeEvent) => void,
  onReconnect: () => void,
) {
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (!deviceId || typeof EventSource === 'undefined') return
    const source = new EventSource(
      apiUrl(`android/${encodeURIComponent(deviceId)}/macro/events`),
    )
    const eventTypes = [
      'macro.runtime.started',
      'macro.runtime.paused',
      'macro.runtime.resumed',
      'macro.runtime.stopped',
      'macro.runtime.completed',
      'macro.runtime.failed',
      'macro.runtime.reset',
      'macro.node.started',
      'macro.node.completed',
      'macro.node.failed',
      'macro.node.skipped',
      'macro.edge.traversed',
      'macro.variable.changed',
      'android.element.resolved',
      'android.tap.planned',
      'android.tap.completed',
    ]
    const receive = (raw: Event) => {
      if (!(raw instanceof MessageEvent) || typeof raw.data !== 'string') return
      try {
        const event = JSON.parse(raw.data) as MacroRuntimeEvent
        if (event.device_id === deviceId) onEvent(event)
      } catch {
        // A malformed event must not poison the remaining SSE subscription.
      }
    }
    for (const eventType of eventTypes) source.addEventListener(eventType, receive)
    source.onopen = () => {
      setConnected(true)
      onReconnect()
    }
    source.onerror = () => setConnected(false)
    return () => {
      for (const eventType of eventTypes) source.removeEventListener(eventType, receive)
      source.close()
      setConnected(false)
    }
  }, [deviceId, onEvent, onReconnect])

  return connected
}
