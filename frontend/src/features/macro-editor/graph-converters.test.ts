import { describe, expect, it } from 'vitest'
import { flowToMacroDefinition, macroDefinitionToFlow } from './graph-converters'
import type { MacroDefinition } from './types'
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

    const restored = flowToMacroDefinition(definition, flow.nodes, flow.edges)

    expect(restored).toEqual(definition)
    expect(restored.nodes[0]).not.toHaveProperty('selected')
    expect(restored.nodes[0]).not.toHaveProperty('measured')
  })

  it('keeps position as editor metadata without changing config', () => {
    const flow = macroDefinitionToFlow(definition)
    flow.nodes[0]!.position = { x: 900, y: 450 }

    const restored = flowToMacroDefinition(definition, flow.nodes, flow.edges)

    expect(restored.nodes[0]!.position).toEqual({ x: 900, y: 450 })
    expect(restored.nodes[0]!.config).toEqual(definition.nodes[0]!.config)
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
    expect(messages).toContain('Choose an entry node before saving.')
    expect(messages).toContain('Edge references a missing node.')
    expect(messages).toContain('Invalid source handle: maybe')
    expect(messages).toContain('Enter at least one selector field.')
    expect(messages).toContain('Variable is required.')
  })
})
