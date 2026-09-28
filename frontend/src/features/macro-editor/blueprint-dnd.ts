import type { PortType } from './types'

export const MACRO_BLUEPRINT_MIME = 'application/x-tapbot-blueprint-item'

export type BlueprintDragItem =
  | { kind: 'variable'; id: string; mode?: 'get' | 'set' }
  | { kind: 'function'; id: string }

export const BLUEPRINT_DATA_TYPES: readonly Exclude<PortType, 'exec' | 'any'>[] = [
  'bool', 'int', 'float', 'string', 'position', 'rect', 'element',
]
