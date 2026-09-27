import { useMemo, useState } from 'react'
import type { MacroRuntimeEvent } from './types'

type Filter = 'all' | 'node' | 'android' | 'error'

export function MacroEventLog({ events }: { events: MacroRuntimeEvent[] }) {
  const [filter, setFilter] = useState<Filter>('all')
  const shown = useMemo(() => events.filter((event) => {
    if (filter === 'node') return event.type.startsWith('macro.node')
    if (filter === 'android') return event.type.startsWith('android.')
    if (filter === 'error') return event.type.includes('failed') || Boolean(event.payload.error)
    return true
  }).slice(-500), [events, filter])
  return (
    <section className="macro-event-log" aria-label="Macro event log">
      <header>
        <strong>Runtime Events</strong>
        <select aria-label="Event filter" value={filter} onChange={(event) => setFilter(event.target.value as Filter)}>
          <option value="all">All</option>
          <option value="node">Node</option>
          <option value="android">Android</option>
          <option value="error">Error</option>
        </select>
      </header>
      <div className="macro-event-log__body">
        {shown.map((event) => (
          <details key={event.event_id} className={event.type.includes('failed') ? 'is-error' : ''}>
            <summary>
              <time>{new Date(event.timestamp).toLocaleTimeString()}</time>
              <code>{event.node_id ?? 'runtime'}</code>
              <span>{event.type}</span>
              {typeof event.payload.duration_ms === 'number' && <small>{event.payload.duration_ms.toFixed(1)} ms</small>}
            </summary>
            <pre>{JSON.stringify(event.payload, null, 2)}</pre>
          </details>
        ))}
      </div>
    </section>
  )
}
