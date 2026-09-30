import { describe, expect, it } from 'vitest'
import { NODE_DEFINITIONS, NODE_REGISTRY, getInlineProperties, getNodePorts } from './blocks'

describe('node definition registry', () => {
  it('provides rendering, editor, search, and runtime metadata from one definition', () => {
    for (const definition of NODE_DEFINITIONS) {
      expect(NODE_REGISTRY.get(definition.type)).toBe(definition)
      expect(definition.ports).toBeTypeOf('function')
      expect(definition.inlineProperties).toBeInstanceOf(Array)
      expect(definition.inspectorSchema).toBeInstanceOf(Array)
      expect(definition.visualKind).toBeTruthy()
      expect(definition.runtimePolicy.implicitExecOutput).toBeTypeOf('boolean')
    }
  })

  it('keeps dynamic ports and node-specific UI policy inside the registry', () => {
    expect(getNodePorts('set_variable', { type: 'bool' }).inputs).toContainEqual({
      id: 'value', type: 'bool', optional: true,
    })
    expect(getNodePorts('sequence', { outputs: 3 }).outputs.map((port) => port.id)).toEqual([
      'then_0', 'then_1', 'then_2',
    ])
    expect(NODE_REGISTRY.get('debug_print')?.inspectorSchema.map((field) => field.key)).toEqual([
      'level', 'message',
    ])
    expect(NODE_REGISTRY.get('set_variable')?.visualKind).toBe('variable')
    expect(NODE_REGISTRY.get('function_return')?.runtimePolicy.implicitExecOutput).toBe(false)
  })

  it('uses the element input as the Click Element target', () => {
    const definition = NODE_REGISTRY.get('click_element')!

    expect(definition.defaultConfig).toEqual({
      sampling_mode: 'center', click: { duration_ms: 70 },
    })
    expect(definition.ports(definition.defaultConfig).inputs).toContainEqual({
      id: 'element', type: 'element',
    })
    expect(definition.inspectorSchema.map((field) => field.key)).toEqual(['sampling_mode'])
  })

  it('derives Find Screen Element ports and compact fields from the manifest', () => {
    const config = {
      screen_id: 'study_room_detail', element_id: 'time_slot', params: { index: 25 },
    }

    expect(getNodePorts('find_screen_element', config).inputs).toEqual([
      { id: 'exec_in', type: 'exec' },
      { id: 'index', type: 'int', optional: true },
    ])
    expect(getInlineProperties('find_screen_element', config).map((field) => field.key)).toEqual([
      'screen_id', 'category', 'element_id', 'params.index',
    ])
  })

  it('indexes semantic categories and element labels for quick search', () => {
    const keywords = NODE_REGISTRY.get('find_screen_element')?.keywords
    expect(keywords).toEqual(expect.arrayContaining([
      '기본 정보', '스터디룸', '예약 CTA', '이름으로 스터디룸 카드',
    ]))
  })
})
