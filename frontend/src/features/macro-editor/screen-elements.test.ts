import { describe, expect, it } from 'vitest'
import { normalizeSemanticScreenIds } from './graph-converters'
import {
  SCREEN_ELEMENTS,
  SCREEN_OPTIONS,
  SEMANTIC_SCREEN_OPTIONS,
  canonicalElementId,
  canonicalScreenId,
} from './screen-elements'
import type { MacroDefinition } from './types'

describe('semantic screen manifest', () => {
  it('exposes one canonical screen list to lifecycle and semantic editors', () => {
    expect(SCREEN_OPTIONS.map((screen) => screen.id)).toEqual([
      'study_room_list', 'study_room_detail',
    ])
    expect(SEMANTIC_SCREEN_OPTIONS.map((screen) => screen.id)).toEqual([
      'study_room_list', 'study_room_detail', 'study_room_confirm', 'study_room_complete',
    ])
    expect(Object.keys(SCREEN_ELEMENTS)).toEqual([
      'study_room_list', 'study_room_detail', 'study_room_confirm', 'study_room_complete',
    ])
    expect(SCREEN_ELEMENTS).not.toHaveProperty('reservation_home')
    expect(SCREEN_ELEMENTS).not.toHaveProperty('reservation_detail')
  })

  it('derives the complete half-hour selector range from the shared manifest', () => {
    const byTime = SCREEN_ELEMENTS.study_room_detail
      ?.find((element) => element.id === 'time_slot_by_time')
    expect(byTime?.values).toHaveLength(32)
    expect(byTime?.values?.[0]).toBe('06:00')
    expect(byTime?.values?.[31]).toBe('21:30')
    expect(byTime?.maxIndex).toBeUndefined()
    expect(SCREEN_ELEMENTS.study_room_detail
      ?.find((element) => element.id === 'time_slot')?.maxIndex).toBe(31)
  })

  it('normalizes legacy lifecycle, element, metadata, and function screen ids', () => {
    const legacy: MacroDefinition = {
      id: 'legacy', name: 'Legacy', version: 1,
      metadata: { editor_screen_node_ids: { reservation_detail: ['find'] } },
      screen_event_entry_node_ids: {
        reservation_home: { enter: 'enter', update: 'update', exit: 'exit' },
      },
      nodes: [{
        id: 'find', type: 'find_screen_element',
        config: { screen_id: 'reservation_home', element_id: 'quick_date', params: { index: 2 } },
      }],
      edges: [],
      functions: [{
        id: 'fn', name: 'Fn', inputs: [], outputs: [],
        entry_node_id: 'entry', return_node_id: 'return', edges: [],
        nodes: [
          { id: 'entry', type: 'function_entry', config: {} },
          { id: 'inside', type: 'find_screen_element', config: {
            screen_id: 'reservation_detail', element_id: 'time_slot', params: { index: 1 },
          } },
          { id: 'return', type: 'function_return', config: {} },
        ],
      }],
    }

    const normalized = normalizeSemanticScreenIds(legacy)
    expect(normalized.screen_event_entry_node_ids).toHaveProperty('study_room_list')
    expect(normalized.nodes[0]?.config).toMatchObject({
      screen_id: 'study_room_list', element_id: 'date_chip',
    })
    expect(normalized.functions?.[0]?.nodes[1]?.config.screen_id).toBe('study_room_detail')
    expect(normalized.metadata.editor_screen_node_ids).toEqual({
      study_room_detail: ['find'],
    })
    expect(JSON.stringify(normalized)).not.toContain('reservation_home')
    expect(JSON.stringify(normalized)).not.toContain('reservation_detail')
    expect(canonicalScreenId('reservation_home')).toBe('study_room_list')
    expect(canonicalElementId('reservation_home', 'quick_date')).toBe('date_chip')
  })
})
