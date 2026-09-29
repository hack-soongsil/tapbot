import { describe, expect, it } from 'vitest'
import {
  flowToMacroDefinition,
  flowToMacroFunction,
  macroDefinitionToFlow,
  macroFunctionToFlow,
} from './graph-converters'
import { getNodePorts } from './blocks'
import type { MacroDefinition, MacroFunctionDefinition } from './types'
import { validateMacroDefinition } from './validation'

const definition: MacroDefinition = {
  id: 'reservation',
  name: 'Reservation Flow',
  version: 2,
  entry_node_id: 'find',
  metadata: { owner: 'qa' },
  nodes: [
    {
      id: 'find',
      type: 'find_element',
      label: 'Find reservation',
      config: { selector: { text: 'Reserve' } },
      position: { x: 100, y: 120 },
    },
    {
      id: 'tap',
      type: 'tap_element',
      config: { source: 'previous', duration_ms: 70 },
      position: { x: 100, y: 280 },
    },
  ],
  edges: [
    {
      id: 'found',
      source: 'find',
      target: 'tap',
      source_handle: 'found',
      condition: 'success',
    },
  ],
}

describe('macro graph converters', () => {
  it('round-trips backend schema without leaking React Flow state', () => {
    const flow = macroDefinitionToFlow(definition)
    flow.nodes[0]!.selected = true
    flow.nodes[0]!.measured = { width: 180, height: 80 }
    flow.nodes[0]!.data.runtimeState = 'failure'
    flow.nodes[0]!.data.runtimeError = { code: 'TEST_FAILURE' }
    flow.edges[0]!.className = 'runtime-current-edge runtime-error-edge'
    flow.edges[0]!.animated = true

    const restored = flowToMacroDefinition(definition, flow.nodes, flow.edges)

    expect(restored.entry_node_id).toBeUndefined()
    expect(restored.event_entry_node_ids).toBeUndefined()
    expect(restored.screen_event_entry_node_ids).toEqual({
      reservation_home: {
        enter: 'event-home-enter', update: 'event-home-update', exit: 'event-home-exit',
      },
      reservation_detail: {
        enter: 'event-detail-enter', update: 'event-detail-update', exit: 'event-detail-exit',
      },
    })
    expect(restored.edges[0]).toMatchObject({ source: 'event-home-enter', target: 'find' })
    const restoredFind = restored.nodes.find((node) => node.id === 'find')!
    expect(restoredFind).not.toHaveProperty('selected')
    expect(restoredFind).not.toHaveProperty('measured')
    expect(restoredFind).not.toHaveProperty('runtimeState')
    expect(restoredFind).not.toHaveProperty('runtimeError')
    expect(restored.edges[0]).not.toHaveProperty('className')
    expect(restored.edges[0]).not.toHaveProperty('animated')
  })

  it('keeps position as editor metadata without changing config', () => {
    const flow = macroDefinitionToFlow(definition)
    const find = flow.nodes.find((node) => node.id === 'find')!
    find.position = { x: 900, y: 450 }

    const restored = flowToMacroDefinition(definition, flow.nodes, flow.edges)

    const restoredFind = restored.nodes.find((node) => node.id === 'find')!
    expect(restoredFind.position).toEqual({ x: 900, y: 450 })
    expect(restoredFind.config).toEqual(definition.nodes[0]!.config)
  })

  it('round-trips screen lifecycle entry nodes without legacy entry metadata', () => {
    const lifecycle: MacroDefinition = {
      id: 'home', name: 'Home', version: 1,
      screen: { id: 'reservation_home', match: { content_description: '예약 내역' } },
      event_entry_node_ids: { enter: 'enter', update: 'update', exit: 'exit' },
      metadata: {},
      nodes: [
        { id: 'enter', type: 'screen_enter', config: {}, position: { x: 80, y: 40 } },
        { id: 'update', type: 'screen_update', config: { interval_ms: 1_000, skip_if_running: true }, position: { x: 320, y: 40 } },
        { id: 'exit', type: 'screen_exit', config: {}, position: { x: 560, y: 40 } },
      ],
      edges: [],
    }

    const flow = macroDefinitionToFlow(lifecycle)
    const restored = flowToMacroDefinition(lifecycle, flow.nodes, flow.edges)

    expect(restored).not.toHaveProperty('event_entry_node_ids')
    expect(restored).not.toHaveProperty('screen')
    expect(restored.screen_event_entry_node_ids?.reservation_home).toEqual({
      enter: 'enter', update: 'update', exit: 'exit',
    })
    expect(restored.screen_event_entry_node_ids?.reservation_detail).toEqual({
      enter: 'event-detail-enter', update: 'event-detail-update', exit: 'event-detail-exit',
    })
    expect(restored.nodes).toHaveLength(6)
    expect(flow.nodes.every((node) => node.deletable === false)).toBe(true)
  })

  it('preserves extended config and migrates legacy screen clicks into find and click nodes', () => {
    const extended: MacroDefinition = {
      id: 'extended', name: 'Extended', version: 1,
      screen: { id: 'reservation_home', match: {} },
      event_entry_node_ids: { enter: 'enter', update: 'update', exit: 'exit' },
      metadata: {},
      nodes: [
        { id: 'enter', type: 'screen_enter', config: {} },
        { id: 'update', type: 'screen_update', config: { interval_ms: 1_000, skip_if_running: true } },
        { id: 'exit', type: 'screen_exit', config: {} },
        { id: 'sequence', type: 'sequence', config: { outputs: 3 } },
        { id: 'random', type: 'random_click_area', config: {
          area: { left: 0.1, top: 0.2, right: 0.8, bottom: 0.9 },
          coordinate_space: 'normalized',
          sampling: { type: 'normal', center_x: 0.4, center_y: 0.6, sigma_x: 0.1, sigma_y: 0.2, clip: true },
          duration_ms: 70,
        } },
        { id: 'semantic', type: 'click_screen_element', config: {
          screen_id: 'reservation_home', element_id: 'quick_date', params: { index: 2 }, click: { duration_ms: 70 },
        } },
      ],
      edges: [
        { id: 'start', source: 'enter', target: 'sequence', source_handle: 'exec_out' },
        { id: 'first', source: 'sequence', target: 'random', source_handle: 'then_0' },
        { id: 'third', source: 'sequence', target: 'semantic', source_handle: 'then_2' },
      ],
    }

    const flow = macroDefinitionToFlow(extended)
    const restored = flowToMacroDefinition(extended, flow.nodes, flow.edges)

    expect(restored.nodes.find((node) => node.id === 'random')?.config)
      .toEqual(extended.nodes.find((node) => node.id === 'random')?.config)
    expect(restored.nodes.find((node) => node.id === 'semantic')).toMatchObject({
      type: 'find_screen_element',
      config: {
        screen_id: 'reservation_home', element_id: 'quick_date', params: { index: 2 },
      },
    })
    expect(restored.nodes.find((node) => node.id === 'semantic-click')).toMatchObject({
      type: 'click_element',
      config: { sampling_mode: 'center', click: { duration_ms: 70 } },
    })
    expect(restored.edges.find((edge) => edge.id === 'third')?.target).toBe('semantic')
    expect(restored.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'semantic', target: 'semantic-click',
        source_handle: 'element', target_handle: 'element', kind: 'data',
      }),
      expect.objectContaining({
        source: 'semantic', target: 'semantic-click',
        source_handle: 'exec_out', target_handle: 'exec_in', kind: 'exec',
      }),
    ]))
    expect(restored.nodes.some((node) => node.type === 'click_screen_element')).toBe(false)
  })

  it('round-trips typed data edge handles and kind', () => {
    const typed: MacroDefinition = {
      id: 'typed', name: 'Typed', version: 1, entry_node_id: 'find', metadata: {},
      nodes: [
        { id: 'find', type: 'find_element', config: { selector: { text: 'Reserve' } } },
        { id: 'click', type: 'click_element', config: { click: { duration_ms: 70 } } },
      ],
      edges: [
        { id: 'exec', source: 'find', target: 'click', source_handle: 'exec_out', target_handle: 'exec_in', kind: 'exec' },
        { id: 'data', source: 'find', target: 'click', source_handle: 'element', target_handle: 'element', kind: 'data' },
      ],
    }

    const flow = macroDefinitionToFlow(typed)
    const restored = flowToMacroDefinition(typed, flow.nodes, flow.edges)

    expect(restored.edges.filter((edge) => edge.id !== 'legacy-enter')).toEqual(typed.edges)
  })

  it('round-trips a function subgraph and exposes dynamic call ports', () => {
    const fn: MacroFunctionDefinition = {
      id: 'select_time_slot',
      name: 'Select Time Slot',
      inputs: [{ id: 'index', type: 'int' as const }],
      outputs: [{ id: 'success', type: 'bool' as const }],
      entry_node_id: 'fn-entry',
      return_node_id: 'fn-return',
      nodes: [
        { id: 'fn-entry', type: 'function_entry' as const, config: { inputs: [{ id: 'index', type: 'int' }] } },
        { id: 'fn-return', type: 'function_return' as const, config: { outputs: [{ id: 'success', type: 'bool' }] } },
      ],
      edges: [],
    }
    const flow = macroFunctionToFlow(fn)
    const restored = flowToMacroFunction(fn, flow.nodes, flow.edges)
    const ports = getNodePorts('call_function', {
      function_id: fn.id,
      inputs: fn.inputs,
      outputs: fn.outputs,
    })

    expect(restored).toMatchObject({
      id: fn.id,
      name: fn.name,
      inputs: fn.inputs,
      outputs: fn.outputs,
      entry_node_id: fn.entry_node_id,
      return_node_id: fn.return_node_id,
      edges: [],
    })
    expect(flow.nodes.every((node) => node.deletable === false)).toBe(true)
    expect(ports.inputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'exec_in', type: 'exec' }),
      expect.objectContaining({ id: 'index', type: 'int' }),
    ]))
    expect(ports.outputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'exec_out', type: 'exec' }),
      expect.objectContaining({ id: 'success', type: 'bool' }),
    ]))
  })

  it('preserves variable declarations and creates typed Set/Get ports', () => {
    const variableDefinition: MacroDefinition = {
      ...definition,
      variables: [{ name: 'count', type: 'int', default: 0 }],
      nodes: [
        ...definition.nodes,
        { id: 'set-count', type: 'set_variable', config: { name: 'count', type: 'int', default: 0 } },
        { id: 'get-count', type: 'get_variable', config: { name: 'count', type: 'int' } },
      ],
    }
    const flow = macroDefinitionToFlow(variableDefinition)
    const restored = flowToMacroDefinition(variableDefinition, flow.nodes, flow.edges)

    expect(restored.variables).toEqual([{ name: 'count', type: 'int', default: 0 }])
    const setPorts = getNodePorts(
      'set_variable',
      restored.nodes.find((node) => node.id === 'set-count')!.config,
    )
    expect(setPorts.inputs.find((port) => port.id === 'value')).toMatchObject({ type: 'int' })
    expect(setPorts.outputs.find((port) => port.id === 'value')).toMatchObject({ type: 'int' })
    expect(getNodePorts('get_variable', restored.nodes.find((node) => node.id === 'get-count')!.config))
      .toMatchObject({ outputs: [{ id: 'value', type: 'int' }] })
  })
})

describe('frontend graph validation', () => {
  it('reports missing entry, dangling edges, required config, and duplicate ids', () => {
    const invalid: MacroDefinition = {
      ...definition,
      entry_node_id: 'missing',
      nodes: [
        { id: 'same', type: 'find_element', config: {} },
        { id: 'same', type: 'branch', config: {} },
      ],
      edges: [{ id: 'edge', source: 'same', target: 'gone', source_handle: 'maybe' }],
    }

    const messages = validateMacroDefinition(invalid).map((issue) => issue.message)

    expect(messages).toContain('Duplicate node id: same')
    expect(messages).toContain('Entry node is required.')
    expect(messages).toContain('Edge references a missing node.')
    expect(messages).toContain('Invalid source handle: maybe')
    expect(messages).toContain('Enter at least one selector field.')
    expect(messages).toContain('Variable is required.')
  })

  it('requires exactly one protected entry for each screen lifecycle event', () => {
    const invalid: MacroDefinition = {
      id: 'screen', name: 'Screen', version: 1,
      screen: { id: 'reservation_home', match: {} },
      event_entry_node_ids: { enter: 'enter', update: 'missing', exit: 'exit' },
      metadata: {},
      nodes: [
        { id: 'enter', type: 'screen_enter', config: {} },
        { id: 'exit', type: 'screen_exit', config: {} },
      ],
      edges: [{ id: 'incoming', source: 'exit', target: 'enter' }],
    }

    const messages = validateMacroDefinition(invalid).map((item) => item.message)
    expect(messages).toContain('Screen graph must contain exactly one screen_update node.')
    expect(messages).toContain('Screen update entry is missing.')
    expect(messages).toContain('Event nodes cannot have incoming edges.')
  })

  it('validates sequence output handles and extended block config', () => {
    const invalid: MacroDefinition = {
      id: 'invalid-extended', name: 'Invalid extended', version: 1,
      entry_node_id: 'sequence', metadata: {},
      nodes: [
        { id: 'sequence', type: 'sequence', config: { outputs: 2 } },
        { id: 'random', type: 'random_click_area', config: {
          area: { left: 10, top: 10, right: 5, bottom: 5 },
          coordinate_space: 'pixel', sampling: { type: 'normal', sigma_x: 0, sigma_y: -1 }, duration_ms: 70,
        } },
      ],
      edges: [{ id: 'bad-handle', source: 'sequence', target: 'random', source_handle: 'then_2' }],
    }

    const messages = validateMacroDefinition(invalid).map((item) => item.message)
    expect(messages).toContain('Invalid source handle: then_2')
    expect(messages).toContain('Area must have positive width and height.')
    expect(messages).toContain('Normal sigma values must be greater than zero.')
  })

  it('rejects mismatched typed data ports', () => {
    const invalid: MacroDefinition = {
      id: 'typed-invalid', name: 'Typed invalid', version: 1,
      entry_node_id: 'for', metadata: {},
      nodes: [
        { id: 'for', type: 'for_loop', config: { start: 0, end: 1, step: 1, inclusive_end: false, index_variable: 'i' } },
        { id: 'branch', type: 'branch', config: {} },
      ],
      edges: [
        { id: 'exec', source: 'for', target: 'branch', source_handle: 'loop', target_handle: 'exec_in', kind: 'exec' },
        { id: 'bad', source: 'for', target: 'branch', source_handle: 'index', target_handle: 'condition', kind: 'data' },
      ],
    }

    const messages = validateMacroDefinition(invalid).map((item) => item.message)
    expect(messages).toContain('Port type mismatch: int → bool')
  })

  it('allows optional unused returns while validating required returns, defaults, and types', () => {
    const invalid: MacroDefinition = {
      id: 'functions', name: 'Functions', version: 1,
      entry_node_id: 'done', metadata: {},
      nodes: [{ id: 'done', type: 'stop', config: {} }],
      edges: [],
      functions: [{
        id: 'check', name: 'Check',
        inputs: [{ id: 'index', type: 'int' }],
        outputs: [
          { id: 'optional_success', type: 'bool' },
          { id: 'required_count', type: 'int', required: true },
          { id: 'bad_default', type: 'bool', default: 'yes' },
        ],
        entry_node_id: 'fn-entry', return_node_id: 'fn-return',
        nodes: [
          { id: 'fn-entry', type: 'function_entry', config: {
            inputs: [{ id: 'index', type: 'int' }],
          } },
          { id: 'fn-return', type: 'function_return', config: { outputs: [
            { id: 'optional_success', type: 'bool' },
            { id: 'required_count', type: 'int', required: true },
            { id: 'bad_default', type: 'bool', default: 'yes' },
          ] } },
        ],
        edges: [
          { id: 'exec', source: 'fn-entry', target: 'fn-return', source_handle: 'exec_out', target_handle: 'exec_in', kind: 'exec' },
          { id: 'typed', source: 'fn-entry', target: 'fn-return', source_handle: 'index', target_handle: 'optional_success', kind: 'data' },
        ],
      }],
    }

    const messages = validateMacroDefinition(invalid).map((item) => item.message)

    expect(messages).not.toContain('Required function output optional_success is not connected.')
    expect(messages).toContain('Required function output required_count is not connected.')
    expect(messages).toContain('Function output bad_default default must match bool.')
    expect(messages).toContain('Port type mismatch: int → bool')
  })
})
