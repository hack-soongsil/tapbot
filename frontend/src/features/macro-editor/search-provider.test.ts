import { describe, expect, it, vi } from 'vitest'
import { blockSupportsPortContext } from './port-compatibility'
import { createSearchItems, type SearchNodeFactory } from './search-provider'
import type { MacroDefinition } from './types'

const definition: MacroDefinition = {
  id: 'search', name: 'Search', version: 1, entry_node_id: 'stop', metadata: {},
  nodes: [{ id: 'stop', type: 'stop', config: {} }], edges: [],
  variables: [{ name: 'count', type: 'int', default: 0 }],
  functions: [{
    id: 'reserve', name: 'Reserve', inputs: [], outputs: [],
    entry_node_id: 'reserve-entry', return_node_id: 'reserve-return',
    nodes: [], edges: [],
  }],
}

describe('search provider', () => {
  it('derives static, variable, and function items from one definition and owns creation', () => {
    const createNode = vi.fn<SearchNodeFactory>((type, _position, config = {}) => ({ id: `${type}-1`, type, config }))
    const items = createSearchItems(definition, createNode)

    expect(items.find((item) => item.id === 'variable:get:count')?.label).toBe('count 가져오기')
    expect(items.find((item) => item.id === 'variable:set:count')?.label).toBe('count 설정')
    expect(items.find((item) => item.id === 'function:call:reserve')?.label).toBe('Reserve')
    expect(items.some((item) => item.id === 'get_variable')).toBe(false)

    items.find((item) => item.id === 'function:call:reserve')?.create({ x: 10, y: 20 })
    expect(createNode).toHaveBeenLastCalledWith(
      'call_function',
      { x: 10, y: 20 },
      expect.objectContaining({ function_id: 'reserve' }),
      'Reserve',
    )
  })

  it('uses the same item source for pane search and port-drag compatibility filtering', () => {
    const items = createSearchItems(definition, (type, _position, config = {}) => ({ id: type, type, config }))
    const compatible = items.filter((item) => blockSupportsPortContext(item, {
      source_node_id: 'loop', source_port_id: 'index', source_port_type: 'int', source_direction: 'output',
    }))

    expect(compatible.length).toBeLessThan(items.length)
    expect(compatible.every((item) => items.includes(item))).toBe(true)
    expect(compatible.some((item) => item.id === 'variable:set:count')).toBe(true)
  })
})
