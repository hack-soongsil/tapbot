import { macroNodeDescriptions, macroNodeLabels } from '../../i18n/ko'
import type {
  JsonValue,
  MacroNodeCategory,
  MacroNodeType,
  PortDefinition,
} from './types'

export interface NodePorts {
  inputs: readonly PortDefinition[]
  outputs: readonly PortDefinition[]
}

export type NodeVisualKind = MacroNodeCategory | 'variable' | 'function'
export type PaletteGroup = 'input' | 'flow' | 'ui' | 'validation' | 'utility' | 'action'
export type CustomInspectorEditor = 'function' | 'variable' | 'branch' | 'sequence' | 'screen-element'

export interface NodeSearchDescriptor {
  type: MacroNodeType
  label: string
  category: MacroNodeCategory
  description?: string
  keywords?: readonly string[]
  defaultConfig: Record<string, JsonValue>
  palette: boolean
  quickSearch?: boolean
  presetConfig?: Record<string, JsonValue>
  presetLabel?: string
}

export interface InspectorFieldDefinition {
  key: string
  label: string
  editor: 'text' | 'number' | 'select' | 'boolean' | 'selector' | 'coordinate-space' | 'point' | 'area' | 'sampling'
  defaultValue?: JsonValue
  fallbackKey?: string
  min?: number
  max?: number
  step?: number
  integer?: boolean
  disabled?: boolean
  code?: boolean
  emptyValue?: JsonValue
  options?: readonly InlinePropertyOption[]
  visibleWhen?: { key: string; equals?: JsonValue; notEquals?: JsonValue }
}

export interface NodeDefinition extends NodeSearchDescriptor {
  ports: (config: Record<string, JsonValue>) => NodePorts
  inputs: readonly PortDefinition[]
  outputs: readonly PortDefinition[]
  inlineProperties: readonly InlinePropertyDefinition[]
  inspectorSchema: readonly InspectorFieldDefinition[]
  customInspector?: CustomInspectorEditor
  visualKind: NodeVisualKind
  paletteGroup?: PaletteGroup
  runtimePolicy: {
    implicitExecOutput: boolean
  }
}

/** @deprecated Use NodeDefinition. */
export type BlockDefinition = NodeDefinition

export interface InlinePropertyOption {
  value: string
  label: string
}

export interface InlinePropertyDefinition {
  key: string
  label: string
  editor: 'text' | 'number' | 'select' | 'screen-element' | 'variable' | 'dynamic-value'
  inputPortId?: string
  min?: number
  step?: number
  options?: readonly InlinePropertyOption[]
  visible?: 'screen-element-collection'
}

interface NodeDefinitionInput extends NodeSearchDescriptor {
  ports?: (config: Record<string, JsonValue>) => NodePorts
  inlineProperties?: readonly InlinePropertyDefinition[]
  inspectorSchema?: readonly InspectorFieldDefinition[]
  customInspector?: CustomInspectorEditor
  visualKind?: NodeVisualKind
  paletteGroup?: PaletteGroup
  runtimePolicy?: Partial<NodeDefinition['runtimePolicy']>
}

const execIn: PortDefinition = { id: 'exec_in', type: 'exec' }
const execOut: PortDefinition = { id: 'exec_out', type: 'exec' }
const defaultPorts = fixedPorts([execIn], [])

function fixedPorts(inputs: readonly PortDefinition[], outputs: readonly PortDefinition[]) {
  return () => ({ inputs, outputs })
}

function functionPorts(value: JsonValue | undefined): PortDefinition[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const id = item.id
    const type = item.type
    if (typeof id !== 'string' || !id || typeof type !== 'string') return []
    if (!['any', 'bool', 'int', 'float', 'string', 'position', 'rect', 'element'].includes(type)) return []
    return [{ id, type: type as PortDefinition['type'] }]
  })
}

function variablePortType(value: JsonValue | undefined): PortDefinition['type'] {
  return typeof value === 'string' && [
    'bool', 'int', 'float', 'string', 'position', 'rect', 'element',
  ].includes(value)
    ? value as PortDefinition['type']
    : 'any'
}

const selector = {
  text: '',
  text_regex: '',
  content_description: '',
  content_description_regex: '',
  view_id: '',
  class_name: '',
  clickable: null,
  enabled: null,
  visible_to_user: true,
}

const selectorInspector: readonly InspectorFieldDefinition[] = [
  { key: 'selector', label: '선택자', editor: 'selector' },
]
const duration = (defaultValue: number, min = 0): InspectorFieldDefinition => ({
  key: 'duration_ms', label: '지속 시간(ms)', editor: 'number', defaultValue, min,
})
const timeoutFields: readonly InspectorFieldDefinition[] = [
  { key: 'timeout_ms', label: '시간 제한(ms)', editor: 'number', defaultValue: 5_000, min: 1 },
  { key: 'poll_interval_ms', label: '확인 간격(ms)', editor: 'number', defaultValue: 100, min: 1 },
]

const NODE_DEFINITION_INPUTS: readonly NodeDefinitionInput[] = [
  {
    type: 'screen_enter', label: 'Screen Enter', category: 'event', defaultConfig: {},
    palette: false, quickSearch: false, ports: fixedPorts([], [execOut]),
  },
  {
    type: 'screen_update', label: 'Screen Update', category: 'event',
    defaultConfig: { interval_ms: 1_000, skip_if_running: true }, palette: false, quickSearch: false,
    ports: fixedPorts([], [execOut]),
    inspectorSchema: [
      { key: 'interval_ms', label: '실행 간격(ms)', editor: 'number', defaultValue: 1_000, min: 1 },
      { key: 'skip_if_running', label: '실행 중에는 다음 틱 건너뛰기', editor: 'boolean', defaultValue: true, disabled: true },
    ],
  },
  {
    type: 'screen_exit', label: 'Screen Exit', category: 'event', defaultConfig: {},
    palette: false, quickSearch: false, ports: fixedPorts([], [execOut]),
  },
  {
    type: 'function_entry', label: 'Function Entry', category: 'event',
    defaultConfig: { inputs: [] }, palette: false, quickSearch: false, visualKind: 'function',
    ports: (config) => ({ inputs: [], outputs: [execOut, ...functionPorts(config.inputs)] }),
  },
  {
    type: 'function_return', label: 'Function Return', category: 'control',
    defaultConfig: { outputs: [] }, palette: false, quickSearch: false, visualKind: 'function',
    ports: (config) => ({ inputs: [execIn, ...functionPorts(config.outputs)], outputs: [] }),
    runtimePolicy: { implicitExecOutput: false },
  },
  {
    type: 'call_function', label: 'Call Function', category: 'control',
    defaultConfig: { function_id: '', inputs: [], outputs: [] }, palette: true,
    keywords: ['call', 'function', 'subgraph', '함수', '호출'],
    description: 'Run a reusable user-defined function subgraph', visualKind: 'function',
    ports: (config) => ({
      inputs: [execIn, ...functionPorts(config.inputs)],
      outputs: [execOut, ...functionPorts(config.outputs)],
    }),
    customInspector: 'function',
  },
  {
    type: 'set_variable', label: 'Set Variable', category: 'control',
    defaultConfig: { name: '', type: 'int', default: 0 }, palette: true,
    keywords: ['set', 'variable', 'assign', 'store', '변수', '저장'],
    description: 'Store a typed value in the current runtime scope', visualKind: 'variable',
    ports: (config) => {
      const type = variablePortType(config.type)
      return {
        inputs: [execIn, { id: 'value', type, optional: true }],
        outputs: [execOut, { id: 'value', type }],
      }
    },
    inlineProperties: [
      { key: 'name', label: '변수', editor: 'variable' },
      { key: 'default', label: '값', editor: 'dynamic-value', inputPortId: 'value' },
    ],
    customInspector: 'variable',
  },
  {
    type: 'get_variable', label: 'Get Variable', category: 'ui',
    defaultConfig: { name: '', type: 'int' }, palette: true,
    keywords: ['get', 'variable', 'read', 'load', '변수', '조회'],
    description: 'Read a typed value from the current runtime scope', visualKind: 'variable',
    ports: (config) => ({ inputs: [], outputs: [{ id: 'value', type: variablePortType(config.type) }] }),
    customInspector: 'variable',
  },
  {
    type: 'debug_print', label: 'Debug Print', category: 'utility',
    defaultConfig: { message: '', level: 'info' }, palette: true,
    keywords: ['debug', 'print', 'log', 'message', 'console', '출력', '로그'],
    description: 'Write a value or message to the User Debug console',
    ports: fixedPorts([execIn, { id: 'value', type: 'any', optional: true }], [execOut]),
    inlineProperties: [
      { key: 'level', label: '레벨', editor: 'select', options: [
        { value: 'debug', label: 'Debug' }, { value: 'info', label: 'Info' },
        { value: 'warning', label: 'Warning' }, { value: 'error', label: 'Error' },
      ] },
      { key: 'message', label: '메시지', editor: 'text', inputPortId: 'value' },
    ],
    inspectorSchema: [
      { key: 'level', label: '레벨', editor: 'select', defaultValue: 'info', options: [
        { value: 'debug', label: '디버그' }, { value: 'info', label: '정보' },
        { value: 'warning', label: '경고' }, { value: 'error', label: '오류' },
      ] },
      { key: 'message', label: '메시지', editor: 'text' },
    ],
    paletteGroup: 'utility',
  },
  {
    type: 'click_point', label: 'Click Point', category: 'action',
    defaultConfig: { x: 0, y: 0, coordinate_space: 'pixel', duration_ms: 70 }, palette: true,
    keywords: ['tap', 'touch', 'coordinate', 'point', '클릭', '좌표'],
    description: 'Click an exact screen coordinate', ports: fixedPorts([execIn], [execOut]),
    inspectorSchema: [
      { key: 'coordinate_space', label: '좌표 기준', editor: 'coordinate-space', defaultValue: 'pixel' },
      { key: 'x', label: 'X', editor: 'number', defaultValue: 0 },
      { key: 'y', label: 'Y', editor: 'number', defaultValue: 0 }, duration(70, 1),
    ], paletteGroup: 'input',
  },
  {
    type: 'drag_point', label: 'Drag Point', category: 'action',
    defaultConfig: { start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, coordinate_space: 'pixel', duration_ms: 450 },
    palette: true, keywords: ['swipe', 'gesture', 'drag', '드래그', '스와이프'],
    description: 'Drag between two screen coordinates', ports: fixedPorts([execIn], [execOut]),
    inspectorSchema: [
      { key: 'coordinate_space', label: '좌표 기준', editor: 'coordinate-space', defaultValue: 'pixel' },
      { key: 'start', label: '시작', editor: 'point' }, { key: 'end', label: '끝', editor: 'point' },
      duration(450, 1),
    ], paletteGroup: 'input',
  },
  {
    type: 'random_click_area', label: 'Random Click Area', category: 'action',
    defaultConfig: { area: { left: 0, top: 0, right: 100, bottom: 100 }, coordinate_space: 'pixel', sampling: { type: 'uniform' }, duration_ms: 70 },
    palette: true, keywords: ['random', 'click', 'area', 'rectangle', '랜덤', '영역'],
    description: 'Click a sampled point inside an area',
    ports: fixedPorts([execIn], [execOut, { id: 'sampled_position', type: 'position', label: 'position' }]),
    inspectorSchema: [
      { key: 'coordinate_space', label: '좌표 기준', editor: 'coordinate-space', defaultValue: 'pixel' },
      { key: 'area', label: '영역', editor: 'area' }, { key: 'sampling', label: '샘플링', editor: 'sampling' },
      duration(70, 1),
    ], paletteGroup: 'input',
  },
  {
    type: 'random_drag_area', label: 'Random Drag Area', category: 'action',
    defaultConfig: {
      start_area: { left: 0, top: 0, right: 100, bottom: 100 },
      end_area: { left: 0, top: 200, right: 100, bottom: 300 }, coordinate_space: 'pixel',
      start_sampling: { type: 'uniform' }, end_sampling: { type: 'uniform' }, duration_ms: 450,
    },
    palette: true, keywords: ['random', 'drag', 'area', 'gesture', '랜덤', '영역'],
    description: 'Drag between independently sampled areas',
    ports: fixedPorts([execIn], [
      execOut, { id: 'sampled_start', type: 'position', label: 'start' },
      { id: 'sampled_end', type: 'position', label: 'end' },
    ]),
    inspectorSchema: [
      { key: 'coordinate_space', label: '좌표 기준', editor: 'coordinate-space', defaultValue: 'pixel' },
      { key: 'start_area', label: '시작 영역', editor: 'area' },
      { key: 'start_sampling', label: '시작 샘플링', editor: 'sampling' },
      { key: 'end_area', label: '끝 영역', editor: 'area' },
      { key: 'end_sampling', label: '끝 샘플링', editor: 'sampling' }, duration(450, 1),
    ], paletteGroup: 'input',
  },
  {
    type: 'click_element', label: 'Click Element', category: 'action',
    defaultConfig: {
      selector: { text: '', ui_tree_path: null, clickable: true, enabled: true, visible_to_user: true },
      resolve: { strategy: 'best_match', require_enabled: true, require_visible: true },
      sampling_mode: 'center', click: { duration_ms: 70 },
    },
    palette: true, keywords: ['element', 'selector', 'button', 'tap', '요소', '버튼', '클릭'],
    description: 'Resolve and click a UI tree element',
    ports: fixedPorts([execIn, { id: 'element', type: 'element', optional: true }], [execOut]),
    inlineProperties: [{ key: 'sampling_mode', label: '샘플링', editor: 'select', options: [
      { value: 'center', label: '중앙' }, { value: 'uniform', label: '균등 분포' },
      { value: 'normal', label: '정규 분포' },
    ] }],
    inspectorSchema: [
      { key: 'selector.text', label: '텍스트', editor: 'text' },
      { key: 'selector.ui_tree_path', label: 'UI 트리 경로', editor: 'text', code: true, emptyValue: null },
      { key: 'sampling_mode', fallbackKey: 'click.mode', label: '클릭 샘플링 방식', editor: 'select', defaultValue: 'center', options: [
        { value: 'center', label: '중앙' }, { value: 'uniform', label: '균등 분포' },
        { value: 'normal', label: '정규 분포' },
      ] },
    ], paletteGroup: 'ui',
  },
  {
    type: 'find_screen_element', label: 'Find Screen Element', category: 'ui',
    defaultConfig: { screen_id: 'study_room_list', element_id: 'reservation_history', params: {} },
    palette: true, keywords: ['screen', 'semantic', 'element', 'find', '화면', '요소', '찾기'],
    description: 'Resolve a semantic element from the current screen',
    ports: fixedPorts([
      execIn,
      { id: 'index', type: 'int', optional: true },
      { id: 'name', type: 'string', optional: true },
    ], [
      execOut, { id: 'element', type: 'element' }, { id: 'found', type: 'bool' },
    ]),
    inlineProperties: [
      { key: 'element_id', label: '요소', editor: 'screen-element' },
      { key: 'params.index', label: '인덱스', editor: 'number', inputPortId: 'index', min: 0, step: 1, visible: 'screen-element-collection' },
      { key: 'params.name', label: '이름', editor: 'text', inputPortId: 'name', visible: 'screen-element-collection' },
    ], customInspector: 'screen-element', paletteGroup: 'ui',
  },
  {
    type: 'for_loop', label: 'For', category: 'control',
    defaultConfig: { start: 0, end: 5, step: 1, inclusive_end: false, index_variable: 'i' },
    palette: true, keywords: ['for', 'loop', 'index', 'iteration', '반복'],
    description: 'Repeat a branch while updating an index variable',
    ports: fixedPorts([execIn], [
      { id: 'loop', type: 'exec' }, { id: 'index', type: 'int' }, { id: 'completed', type: 'exec' },
    ]),
    inlineProperties: [
      { key: 'start', label: '시작', editor: 'number', step: 1 },
      { key: 'end', label: '끝', editor: 'number', step: 1 },
      { key: 'step', label: '증가', editor: 'number', step: 1 },
    ],
    inspectorSchema: [
      { key: 'start', label: '시작', editor: 'number', defaultValue: 0 },
      { key: 'end', label: '끝', editor: 'number', defaultValue: 5 },
      { key: 'step', label: '증가값', editor: 'number', defaultValue: 1 },
      { key: 'index_variable', label: '인덱스 변수', editor: 'text', defaultValue: 'i' },
      { key: 'inclusive_end', label: '끝 값 포함', editor: 'boolean', defaultValue: false },
    ], paletteGroup: 'flow',
  },
  {
    type: 'sequence', label: 'Sequence', category: 'control', defaultConfig: { outputs: 2 },
    palette: true, keywords: ['sequence', 'then', 'ordered', '순서'],
    description: 'Run output branches in order', paletteGroup: 'flow', customInspector: 'sequence',
    ports: (config) => {
      const value = config.outputs
      const count = typeof value === 'number' && Number.isFinite(value)
        ? Math.max(2, Math.min(16, Math.trunc(value))) : 2
      return {
        inputs: [execIn],
        outputs: Array.from({ length: count }, (_, index): PortDefinition => ({ id: `then_${index}`, type: 'exec' })),
      }
    },
  },
  {
    type: 'find_element', label: 'Find Element', category: 'ui', defaultConfig: { selector }, palette: true,
    ports: fixedPorts([execIn], [
      execOut, { id: 'missing', type: 'exec', label: 'missing (legacy)' },
      { id: 'element', type: 'element' }, { id: 'found', type: 'bool' },
    ]), inspectorSchema: selectorInspector, paletteGroup: 'ui',
  },
  {
    type: 'require_element', label: 'Require Element', category: 'ui', defaultConfig: { selector }, palette: true,
    ports: fixedPorts([execIn], [{ id: 'found', type: 'exec' }, { id: 'missing', type: 'exec' }]),
    inspectorSchema: selectorInspector, paletteGroup: 'ui',
  },
  { type: 'read_ui_tree', label: 'Read UI Tree', category: 'ui', defaultConfig: {}, palette: false },
  {
    type: 'tap_element', label: 'Tap Element', category: 'action',
    defaultConfig: { source: 'selector', selector, duration_ms: 70 }, palette: false,
    inspectorSchema: [
      { key: 'source', label: '소스', editor: 'select', defaultValue: 'selector', options: [
        { value: 'selector', label: '선택자' }, { value: 'previous', label: '이전에 찾은 엘리먼트' },
      ] },
      { ...selectorInspector[0]!, visibleWhen: { key: 'source', notEquals: 'previous' } }, duration(70),
    ],
  },
  {
    type: 'tap_point', label: 'Tap Point', category: 'action',
    defaultConfig: { x: 0, y: 0, duration_ms: 70 }, palette: false,
    inspectorSchema: [
      { key: 'x', label: 'X', editor: 'number', defaultValue: 0 },
      { key: 'y', label: 'Y', editor: 'number', defaultValue: 0 }, duration(70),
    ],
  },
  {
    type: 'swipe', label: 'Swipe', category: 'action',
    defaultConfig: { x1: 0, y1: 0, x2: 0, y2: 0, duration_ms: 450 }, palette: false,
    inspectorSchema: [
      ...['x1', 'y1', 'x2', 'y2'].map((key): InspectorFieldDefinition => ({ key, label: key.toUpperCase(), editor: 'number', defaultValue: 0 })),
      duration(450),
    ],
  },
  { type: 'back', label: 'Back', category: 'action', defaultConfig: {}, palette: true, ports: fixedPorts([execIn], [execOut]), paletteGroup: 'action' },
  { type: 'home', label: 'Home', category: 'action', defaultConfig: {}, palette: true, ports: fixedPorts([execIn], [execOut]), paletteGroup: 'action' },
  {
    type: 'element_exists', label: 'Element Exists', category: 'condition', defaultConfig: { selector }, palette: true,
    ports: fixedPorts([execIn], [
      execOut, { id: 'true', type: 'exec', label: 'true (legacy)' },
      { id: 'false', type: 'exec', label: 'false (legacy)' }, { id: 'result', type: 'bool' },
    ]), inspectorSchema: selectorInspector, paletteGroup: 'ui',
  },
  {
    type: 'element_text_equals', label: 'Element Text Equals', category: 'condition',
    defaultConfig: { selector, text: '' }, palette: false,
    ports: fixedPorts([execIn], [{ id: 'true', type: 'exec' }, { id: 'false', type: 'exec' }]),
    inspectorSchema: [...selectorInspector, { key: 'text', label: '예상 텍스트', editor: 'text' }],
  },
  {
    type: 'state_equals', label: 'State Equals', category: 'condition', defaultConfig: { state: '' }, palette: false,
    ports: fixedPorts([execIn], [{ id: 'true', type: 'exec' }, { id: 'false', type: 'exec' }]),
    inspectorSchema: [{ key: 'state', label: '상태', editor: 'text' }],
  },
  {
    type: 'wait', label: 'Wait', category: 'control', defaultConfig: { duration_ms: 500 }, palette: true,
    ports: fixedPorts([execIn], [execOut]),
    inlineProperties: [{ key: 'duration_ms', label: '시간(ms)', editor: 'number', min: 0, step: 100 }],
    inspectorSchema: [duration(500)], paletteGroup: 'flow',
  },
  {
    type: 'branch', label: 'Branch', category: 'control',
    defaultConfig: { condition: { type: 'variable_equals', variable: '', value: true } }, palette: true,
    ports: fixedPorts([execIn, { id: 'condition', type: 'bool', optional: true }], [
      { id: 'true', type: 'exec' }, { id: 'false', type: 'exec' },
    ]), customInspector: 'branch', paletteGroup: 'flow',
  },
  {
    type: 'retry', label: 'Retry', category: 'control', defaultConfig: { max_attempts: 3 }, palette: true,
    ports: fixedPorts([execIn], [{ id: 'retry', type: 'exec' }, { id: 'exhausted', type: 'exec' }]),
    inspectorSchema: [{ key: 'max_attempts', label: '최대 시도 횟수', editor: 'number', defaultValue: 3, min: 1, integer: true }],
    paletteGroup: 'flow',
  },
  {
    type: 'repeat', label: 'Repeat', category: 'control', defaultConfig: { count: 1 }, palette: true,
    ports: fixedPorts([execIn], [{ id: 'repeat', type: 'exec' }, { id: 'done', type: 'exec' }]),
    inspectorSchema: [{ key: 'count', label: '반복 횟수', editor: 'number', defaultValue: 1, min: 0, integer: true }],
    paletteGroup: 'flow',
  },
  {
    type: 'timeout', label: 'Timeout', category: 'control', defaultConfig: { timeout_ms: 5_000 }, palette: false,
    ports: fixedPorts([execIn], [{ id: 'within', type: 'exec' }, { id: 'expired', type: 'exec' }]),
    inspectorSchema: [{ key: 'timeout_ms', label: '시간 제한(ms)', editor: 'number', defaultValue: 5_000, min: 1 }],
  },
  {
    type: 'stop', label: 'Stop', category: 'control', defaultConfig: {}, palette: true,
    ports: fixedPorts([execIn], []), runtimePolicy: { implicitExecOutput: false }, paletteGroup: 'flow',
  },
  {
    type: 'wait_for_element', label: 'Wait For Element', category: 'validation',
    defaultConfig: { selector, timeout_ms: 5_000, poll_interval_ms: 100 }, palette: true,
    ports: fixedPorts([execIn], [{ id: 'found', type: 'exec' }, { id: 'timeout', type: 'exec' }]),
    inspectorSchema: [...selectorInspector, ...timeoutFields], paletteGroup: 'validation',
  },
  {
    type: 'wait_for_state', label: 'Wait For State', category: 'validation',
    defaultConfig: { state: '', timeout_ms: 5_000, poll_interval_ms: 100 }, palette: true,
    ports: fixedPorts([execIn], [{ id: 'matched', type: 'exec' }, { id: 'timeout', type: 'exec' }]),
    inspectorSchema: [...timeoutFields, { key: 'state', label: '상태', editor: 'text' }],
    paletteGroup: 'validation',
  },
  {
    type: 'assert_element', label: 'Assert Element', category: 'validation', defaultConfig: { selector }, palette: true,
    ports: fixedPorts([execIn], [{ id: 'found', type: 'exec' }, { id: 'missing', type: 'exec' }]),
    inspectorSchema: selectorInspector, paletteGroup: 'validation',
  },
]

export const NODE_DEFINITIONS: readonly NodeDefinition[] = NODE_DEFINITION_INPUTS.map((node): NodeDefinition => {
  const ports = node.ports ?? defaultPorts
  const initialPorts = ports(node.defaultConfig)
  return {
    ...node,
    label: macroNodeLabels[node.type],
    description: macroNodeDescriptions[node.type] ?? node.description,
    ports,
    inputs: initialPorts.inputs,
    outputs: initialPorts.outputs,
    inlineProperties: node.inlineProperties ?? [],
    inspectorSchema: node.inspectorSchema ?? [],
    visualKind: node.visualKind ?? node.category,
    runtimePolicy: { implicitExecOutput: true, ...node.runtimePolicy },
  }
})

export const NODE_REGISTRY = new Map<MacroNodeType, NodeDefinition>(
  NODE_DEFINITIONS.map((node) => [node.type, node]),
)

/** @deprecated Use NODE_DEFINITIONS. */
export const BLOCKS = NODE_DEFINITIONS
/** @deprecated Use NODE_REGISTRY. */
export const BLOCK_BY_TYPE = NODE_REGISTRY

export function getNodeDefinition(type: MacroNodeType): NodeDefinition | undefined {
  return NODE_REGISTRY.get(type)
}

export function getNodePorts(type: MacroNodeType, config: Record<string, JsonValue>): NodePorts {
  return getNodeDefinition(type)?.ports(config) ?? defaultPorts()
}

export function cloneDefaultConfig(type: MacroNodeType) {
  return structuredClone(getNodeDefinition(type)?.defaultConfig ?? {})
}
