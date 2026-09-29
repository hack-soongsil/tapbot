import { describe, expect, it } from 'vitest'
import { NODE_DEFINITIONS, NODE_REGISTRY, getNodePorts } from './blocks'

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
})
