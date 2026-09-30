import { describe, expect, it } from 'vitest'
import { normalizeSemanticScreenIds } from './graph-converters'
import {
  SCREEN_ELEMENT_CATEGORIES,
  SCREEN_ELEMENTS,
  SCREEN_OPTIONS,
  SEMANTIC_SCREEN_OPTIONS,
  allElementReferences,
  canonicalElementId,
  canonicalScreenId,
  defaultParamsForElement,
  elementsInCategory,
  elementReferenceFor,
  selectedScreenElement,
  withoutScreenElementEditorMetadata,
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

  it('exposes categories and manifest parameter schemas', () => {
    expect(SCREEN_ELEMENT_CATEGORIES.study_room_list).toEqual([
      { id: 'basic_info', label: '기본 정보' },
      { id: 'date', label: '날짜' },
      { id: 'room', label: '스터디룸' },
      { id: 'navigation', label: '네비게이션' },
    ])
    expect(SCREEN_ELEMENT_CATEGORIES.study_room_detail).toEqual([
      { id: 'basic_info', label: '기본 정보' },
      { id: 'date', label: '날짜' },
      { id: 'time', label: '시간' },
      { id: 'selection', label: '선택' },
      { id: 'reservation', label: '예약' },
    ])
    expect(elementsInCategory('study_room_list', 'basic_info').map(({ id }) => id)).toEqual([
      'header_title', 'hero_headline', 'hero_description',
    ])
    expect(elementsInCategory('study_room_list', 'date').map(({ id }) => id)).toEqual([
      'date_chip', 'selected_date_chip', 'selected_date_label', 'date_picker',
      'live_status_indicator',
    ])
    expect(elementsInCategory('study_room_list', 'room').map(({ id }) => id)).toEqual([
      'room_card', 'room_card_by_name', 'room_name', 'room_status', 'room_capacity',
      'room_location', 'room_availability',
    ])
    expect(elementsInCategory('study_room_list', 'navigation').map(({ id }) => id)).toEqual([
      'reservation_history', 'bottom_tab_home', 'bottom_tab_booking', 'bottom_tab_me',
    ])
    expect(elementsInCategory('study_room_detail', 'basic_info').map(({ id }) => id)).toEqual([
      'back', 'room_hero_image', 'room_name', 'room_feature',
    ])
    expect(elementsInCategory('study_room_detail', 'date').map(({ id }) => id)).toEqual([
      'date_picker', 'selected_date_label', 'live_status_indicator',
    ])
    expect(elementsInCategory('study_room_detail', 'time').map(({ id }) => id)).toEqual([
      'time_slot', 'time_slot_by_time', 'time_slot_by_end_time', 'current_time_marker',
      'slot_guidance',
    ])
    expect(elementsInCategory('study_room_detail', 'selection').map(({ id }) => id)).toEqual([
      'selection_summary', 'reset_selection', 'legend_reserved', 'legend_available',
      'legend_selected',
    ])
    expect(elementsInCategory('study_room_detail', 'reservation').map(({ id }) => id)).toEqual([
      'reserve_cta', 'usage_rules',
    ])
    const slot = SCREEN_ELEMENTS.study_room_detail
      ?.find((element) => element.id === 'time_slot')
    expect(slot?.requiredParams).toEqual(['index'])
    expect(slot?.params.index).toMatchObject({
      type: 'int', label: '인덱스', min: 0, max: 31, default: 0,
    })
    expect(defaultParamsForElement(slot)).toEqual({ index: 0 })
  })

  it('derives category metadata exclusively from the persisted element id', () => {
    expect(selectedScreenElement({
      screen_id: 'reservation_detail', category_id: 'time',
      element_id: 'reserve_cta', params: {},
    })).toMatchObject({
      screenId: 'study_room_detail', categoryId: 'reservation',
      element: { id: 'reserve_cta' },
    })
    expect(withoutScreenElementEditorMetadata({
      screen_id: 'study_room_detail', category_id: 'reservation',
      element_id: 'reserve_cta', params: {},
    })).toEqual({
      screen_id: 'study_room_detail', element_id: 'reserve_cta', params: {},
    })
  })

  it('keeps exposed element references and required parameter schemas internally consistent', () => {
    const references = allElementReferences()
    expect(references.length).toBe(Object.values(SCREEN_ELEMENTS)
      .reduce((total, elements) => total + elements.length, 0))
    for (const reference of references) {
      expect(reference.element.label).not.toBe('')
      expect(reference.category.id).toBe(reference.element.categoryId)
      for (const param of reference.element.requiredParams) {
        expect(reference.element.params[param], `${reference.element.id}.${param}`).toBeDefined()
      }
    }
    expect(elementReferenceFor('reservation_detail', 'time_slot')).toMatchObject({
      screen: { id: 'study_room_detail' },
      category: { id: 'time' },
      element: {
        description: '06:00부터 30분 단위로 표시되는 예약 시간 슬롯입니다.',
        kind: 'collection', role: 'button', returnType: 'element',
      },
    })
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
