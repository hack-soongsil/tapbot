import { describe, expect, it } from 'vitest'
import type { MacroRuntime } from '../macro-editor/types'
import { applyRuntimeEvent, emptyRuntimeView, EVENT_LOG_LIMIT, syncRuntimeSnapshot } from './runtime-store'
import type { MacroRuntimeEvent } from './types'

const runtime: MacroRuntime = {
  device_id: 'phone',
  runtime_id: 'run-1',
  macro_definition_id: 'macro',
  definition_version: 3,
  current_node_id: 'one',
  current_edge_id: null,
  state: 'running',
  step_count: 0,
  variables: {},
  trace: [],
  started_at: '2026-09-27T00:00:00Z',
  error: null,
}

function event(
  sequence: number,
  type: string,
  extra: Partial<MacroRuntimeEvent> = {},
): MacroRuntimeEvent {
  return {
    event_id: `event-${sequence}`,
    device_id: 'phone',
    runtime_id: 'run-1',
    macro_id: 'macro',
    type,
    sequence,
    timestamp: '2026-09-27T00:00:00Z',
    node_id: null,
    edge_id: null,
    payload: {},
    ...extra,
  }
}

describe('macro runtime store', () => {
  it('retains structured nested traces after failure and stop, then clears on reset', () => {
    const payload = {
      step: 3, graph_path: ['main', 'reserve', 'slot'], status: 'failure',
      node_type: 'delay', input_summary: { duration_ms: 1 }, output_summary: {},
      error: 'failed', error_payload: { type: 'RuntimeError', message: 'failed' },
    }
    let view = syncRuntimeSnapshot(emptyRuntimeView(), runtime)
    const failed = event(1, 'macro.node.failed', { node_id: 'one', payload })
    view = applyRuntimeEvent(view, failed)
    view = applyRuntimeEvent(view, failed)
    expect(view.runtime?.trace).toHaveLength(1)
    expect(view.graphOverlay.nodeStates.one).toBe('running')
    expect(view.graphOverlay.nodeStates[JSON.stringify(['reserve', 'slot', 'one'])]).toBe('failure')
    expect(view.graphOverlay.graphPath).toEqual(['reserve', 'slot'])
    expect(view.graphOverlay.error?.node_id).toBe('one')
    view = applyRuntimeEvent(view, event(2, 'macro.runtime.failed', { payload: { error: 'failed' } }))
    expect(view.runtime?.error).toBe('failed')
    view = applyRuntimeEvent(view, event(3, 'macro.runtime.stopped'))
    expect(view.runtime?.trace[0]).toMatchObject(payload)
    view = applyRuntimeEvent(view, event(4, 'macro.runtime.reset'))
    expect(view.runtime?.trace).toEqual([])
    expect(view.graphOverlay).toMatchObject({ currentNodeId: null, traces: [], nodeStates: {} })
  })
  it('creates a live runtime before the reconnect snapshot arrives', () => {
    const view = applyRuntimeEvent(emptyRuntimeView(), event(1, 'macro.runtime.started', {
      payload: { definition_version: 3, entry_node_id: 'one' },
    }))

    expect(view.runtime?.runtime_id).toBe('run-1')
    expect(view.runtime?.state).toBe('running')
    expect(view.runtime?.definition_version).toBe(3)
  })

  it('decorates node and edge transitions from ordered events', () => {
    let view = syncRuntimeSnapshot(emptyRuntimeView(), runtime)
    view = applyRuntimeEvent(view, event(1, 'macro.node.started', {
      node_id: 'one', payload: { graph_path: ['main', 'reserve'] },
    }))
    expect(view.graphOverlay.nodeStates[JSON.stringify(['reserve', 'one'])]).toBe('running')
    expect(view.graphOverlay.graphPath).toEqual(['reserve'])
    view = applyRuntimeEvent(view, event(2, 'android.tap.planned', {
      node_id: 'one',
      payload: { bounds: [10, 20, 80, 60], tap_point: [44, 39] },
    }))
    view = applyRuntimeEvent(view, event(3, 'macro.node.completed', {
      node_id: 'one', payload: { graph_path: ['main', 'reserve'] },
    }))
    view = applyRuntimeEvent(view, event(4, 'macro.edge.traversed', {
      edge_id: 'next', payload: { graph_path: ['main', 'reserve'] },
    }))

    expect(view.graphOverlay.nodeStates[JSON.stringify(['reserve', 'one'])]).toBe('success')
    expect(view.graphOverlay.currentEdgeId).toBe('next')
    expect(view.overlay.bounds).toEqual([10, 20, 80, 60])
    expect(view.overlay.tapPoint).toEqual([44, 39])
  })

  it('marks failed nodes and caps the visible event log', () => {
    let view = syncRuntimeSnapshot(emptyRuntimeView(), runtime)
    for (let sequence = 1; sequence <= EVENT_LOG_LIMIT + 20; sequence += 1) {
      view = applyRuntimeEvent(view, event(sequence, 'macro.node.completed', { node_id: 'one' }))
    }
    view = applyRuntimeEvent(view, event(EVENT_LOG_LIMIT + 21, 'macro.node.failed', { node_id: 'two' }))

    expect(view.graphOverlay.nodeStates.two).toBe('failure')
    expect(view.events).toHaveLength(EVENT_LOG_LIMIT)
    expect(view.events.at(-1)?.sequence).toBe(EVENT_LOG_LIMIT + 21)
  })

  it('keeps the current node while paused and restores truth from a reconnect snapshot', () => {
    let view = syncRuntimeSnapshot(emptyRuntimeView(), runtime)
    view = applyRuntimeEvent(view, event(1, 'macro.node.started', { node_id: 'one' }))
    view = applyRuntimeEvent(view, event(2, 'macro.runtime.paused', { node_id: 'one' }))
    expect(view.runtime?.state).toBe('paused')
    expect(view.graphOverlay.currentNodeId).toBe('one')
    expect(view.graphOverlay.nodeStates.one).toBe('running')

    view = applyRuntimeEvent(view, event(3, 'macro.node.failed', { node_id: 'one' }))
    const restored = syncRuntimeSnapshot(view, {
      ...runtime,
      state: 'completed',
      current_node_id: null,
      trace: [{ node_id: 'one', status: 'success' }],
    })
    expect(restored.runtime?.state).toBe('completed')
    expect(restored.graphOverlay.nodeStates.one).toBe('success')
  })
})
