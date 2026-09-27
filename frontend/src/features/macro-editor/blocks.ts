import type {
  JsonValue,
  MacroNodeCategory,
  MacroNodeType,
  PortDefinition,
} from './types'
import { macroNodeDescriptions, macroNodeLabels } from '../../i18n/ko'

export interface BlockDefinition {
  type: MacroNodeType
  label: string
  category: MacroNodeCategory
  defaultConfig: Record<string, JsonValue>
  palette: boolean
  quickSearch?: boolean
  keywords?: readonly string[]
  description?: string
  inputs?: readonly PortDefinition[]
  outputs?: readonly PortDefinition[]
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

const BLOCK_DEFINITIONS = [
  {
    type: 'screen_enter',
    label: 'Screen Enter',
    category: 'event',
    defaultConfig: {},
    palette: false,
    quickSearch: false,
  },
  {
    type: 'screen_update',
    label: 'Screen Update',
    category: 'event',
    defaultConfig: { interval_ms: 1_000, skip_if_running: true },
    palette: false,
    quickSearch: false,
  },
  {
    type: 'screen_exit',
    label: 'Screen Exit',
    category: 'event',
    defaultConfig: {},
    palette: false,
    quickSearch: false,
  },
  {
    type: 'function_entry',
    label: 'Function Entry',
    category: 'event',
    defaultConfig: { inputs: [] as JsonValue[] },
    palette: false,
    quickSearch: false,
  },
  {
    type: 'function_return',
    label: 'Function Return',
    category: 'control',
    defaultConfig: { outputs: [] as JsonValue[] },
    palette: false,
    quickSearch: false,
  },
  {
    type: 'call_function',
    label: 'Call Function',
    category: 'control',
    defaultConfig: { function_id: '', inputs: [] as JsonValue[], outputs: [] as JsonValue[] },
    palette: true,
    keywords: ['call', 'function', 'subgraph', '함수', '호출'],
    description: 'Run a reusable user-defined function subgraph',
  },
  {
    type: 'set_variable',
    label: 'Set Variable',
    category: 'control',
    defaultConfig: { name: '', type: 'int', default: 0 },
    palette: true,
    keywords: ['set', 'variable', 'assign', 'store', '변수', '저장'],
    description: 'Store a typed value in the current runtime scope',
  },
  {
    type: 'get_variable',
    label: 'Get Variable',
    category: 'ui',
    defaultConfig: { name: '', type: 'int' },
    palette: true,
    keywords: ['get', 'variable', 'read', 'load', '변수', '조회'],
    description: 'Read a typed value from the current runtime scope',
  },
  {
    type: 'debug_print',
    label: 'Debug Print',
    category: 'utility',
    defaultConfig: { message: '', level: 'info' },
    palette: true,
    keywords: ['debug', 'print', 'log', 'message', 'console', '출력', '로그'],
    description: 'Write a value or message to the User Debug console',
  },
  {
    type: 'click_point',
    label: 'Click Point',
    category: 'action',
    defaultConfig: { x: 0, y: 0, coordinate_space: 'pixel', duration_ms: 70 },
    palette: true,
    keywords: ['tap', 'touch', 'coordinate', 'point', '클릭', '좌표'],
    description: 'Click an exact screen coordinate',
  },
  {
    type: 'drag_point',
    label: 'Drag Point',
    category: 'action',
    defaultConfig: {
      start: { x: 0, y: 0 }, end: { x: 0, y: 0 },
      coordinate_space: 'pixel', duration_ms: 450,
    },
    palette: true,
    keywords: ['swipe', 'gesture', 'drag', '드래그', '스와이프'],
    description: 'Drag between two screen coordinates',
  },
  {
    type: 'random_click_area',
    label: 'Random Click Area',
    category: 'action',
    defaultConfig: {
      area: { left: 0, top: 0, right: 100, bottom: 100 },
      coordinate_space: 'pixel', sampling: { type: 'uniform' }, duration_ms: 70,
    },
    palette: true,
    keywords: ['random', 'click', 'area', 'rectangle', '랜덤', '영역'],
    description: 'Click a sampled point inside an area',
  },
  {
    type: 'random_drag_area',
    label: 'Random Drag Area',
    category: 'action',
    defaultConfig: {
      start_area: { left: 0, top: 0, right: 100, bottom: 100 },
      end_area: { left: 0, top: 200, right: 100, bottom: 300 },
      coordinate_space: 'pixel',
      start_sampling: { type: 'uniform' }, end_sampling: { type: 'uniform' },
      duration_ms: 450,
    },
    palette: true,
    keywords: ['random', 'drag', 'area', 'gesture', '랜덤', '영역'],
    description: 'Drag between independently sampled areas',
  },
  {
    type: 'click_element',
    label: 'Click Element',
    category: 'action',
    defaultConfig: {
      selector: {
        text: '', ui_tree_path: null, clickable: true,
        enabled: true, visible_to_user: true,
      },
      resolve: { strategy: 'best_match', require_enabled: true, require_visible: true },
      sampling_mode: 'center',
      click: { duration_ms: 70 },
    },
    palette: true,
    keywords: ['element', 'selector', 'button', 'tap', '요소', '버튼', '클릭'],
    description: 'Resolve and click a UI tree element',
  },
  {
    type: 'find_screen_element',
    label: 'Find Screen Element',
    category: 'ui',
    defaultConfig: {
      screen_id: 'reservation_home', element_id: 'quick_date', params: { index: 0 },
    },
    palette: true,
    keywords: ['screen', 'semantic', 'element', 'find', '화면', '요소', '찾기'],
    description: 'Resolve a semantic element from the current screen',
  },
  {
    type: 'for_loop',
    label: 'For',
    category: 'control',
    defaultConfig: { start: 0, end: 5, step: 1, inclusive_end: false, index_variable: 'i' },
    palette: true,
    keywords: ['for', 'loop', 'index', 'iteration', '반복'],
    description: 'Repeat a branch while updating an index variable',
  },
  {
    type: 'sequence',
    label: 'Sequence',
    category: 'control',
    defaultConfig: { outputs: 2 },
    palette: true,
    keywords: ['sequence', 'then', 'ordered', '순서'],
    description: 'Run output branches in order',
  },
  {
    type: 'find_element',
    label: 'Find Element',
    category: 'ui',
    defaultConfig: { selector },
    palette: true,
  },
  {
    type: 'require_element',
    label: 'Require Element',
    category: 'ui',
    defaultConfig: { selector },
    palette: true,
  },
  {
    type: 'read_ui_tree',
    label: 'Read UI Tree',
    category: 'ui',
    defaultConfig: {},
    palette: false,
  },
  {
    type: 'tap_element',
    label: 'Tap Element',
    category: 'action',
    defaultConfig: { source: 'selector', selector, duration_ms: 70 },
    palette: false,
  },
  {
    type: 'tap_point',
    label: 'Tap Point',
    category: 'action',
    defaultConfig: { x: 0, y: 0, duration_ms: 70 },
    palette: false,
  },
  {
    type: 'swipe',
    label: 'Swipe',
    category: 'action',
    defaultConfig: { x1: 0, y1: 0, x2: 0, y2: 0, duration_ms: 450 },
    palette: false,
  },
  {
    type: 'back',
    label: 'Back',
    category: 'action',
    defaultConfig: {},
    palette: true,
  },
  {
    type: 'home',
    label: 'Home',
    category: 'action',
    defaultConfig: {},
    palette: true,
  },
  {
    type: 'element_exists',
    label: 'Element Exists',
    category: 'condition',
    defaultConfig: { selector },
    palette: true,
  },
  {
    type: 'element_text_equals',
    label: 'Element Text Equals',
    category: 'condition',
    defaultConfig: { selector, text: '' },
    palette: false,
  },
  {
    type: 'state_equals',
    label: 'State Equals',
    category: 'condition',
    defaultConfig: { state: '' },
    palette: false,
  },
  {
    type: 'wait',
    label: 'Wait',
    category: 'control',
    defaultConfig: { duration_ms: 500 },
    palette: true,
  },
  {
    type: 'branch',
    label: 'Branch',
    category: 'control',
    defaultConfig: { condition: { type: 'variable_equals', variable: '', value: true } },
    palette: true,
  },
  {
    type: 'retry',
    label: 'Retry',
    category: 'control',
    defaultConfig: { max_attempts: 3 },
    palette: true,
  },
  {
    type: 'repeat',
    label: 'Repeat',
    category: 'control',
    defaultConfig: { count: 1 },
    palette: true,
  },
  {
    type: 'timeout',
    label: 'Timeout',
    category: 'control',
    defaultConfig: { timeout_ms: 5_000 },
    palette: false,
  },
  {
    type: 'stop',
    label: 'Stop',
    category: 'control',
    defaultConfig: {},
    palette: true,
  },
  {
    type: 'wait_for_element',
    label: 'Wait For Element',
    category: 'validation',
    defaultConfig: { selector, timeout_ms: 5_000, poll_interval_ms: 100 },
    palette: true,
  },
  {
    type: 'wait_for_state',
    label: 'Wait For State',
    category: 'validation',
    defaultConfig: { state: '', timeout_ms: 5_000, poll_interval_ms: 100 },
    palette: true,
  },
  {
    type: 'assert_element',
    label: 'Assert Element',
    category: 'validation',
    defaultConfig: { selector },
    palette: true,
  },
] as const

const execIn: PortDefinition = { id: 'exec_in', type: 'exec' }
const execOut: PortDefinition = { id: 'exec_out', type: 'exec' }

const NODE_PORTS: Partial<Record<MacroNodeType, {
  inputs: readonly PortDefinition[]
  outputs: readonly PortDefinition[]
}>> = {
  debug_print: {
    inputs: [execIn, { id: 'value', type: 'any', optional: true }],
    outputs: [execOut],
  },
  screen_enter: { inputs: [], outputs: [execOut] },
  screen_update: { inputs: [], outputs: [execOut] },
  screen_exit: { inputs: [], outputs: [execOut] },
  click_point: { inputs: [execIn], outputs: [execOut] },
  drag_point: { inputs: [execIn], outputs: [execOut] },
  random_click_area: {
    inputs: [execIn],
    outputs: [execOut, { id: 'sampled_position', type: 'position', label: 'position' }],
  },
  random_drag_area: {
    inputs: [execIn],
    outputs: [
      execOut,
      { id: 'sampled_start', type: 'position', label: 'start' },
      { id: 'sampled_end', type: 'position', label: 'end' },
    ],
  },
  element_exists: {
    inputs: [execIn],
    outputs: [
      execOut,
      { id: 'true', type: 'exec', label: 'true (legacy)' },
      { id: 'false', type: 'exec', label: 'false (legacy)' },
      { id: 'result', type: 'bool' },
    ],
  },
  branch: {
    inputs: [execIn, { id: 'condition', type: 'bool', optional: true }],
    outputs: [{ id: 'true', type: 'exec' }, { id: 'false', type: 'exec' }],
  },
  for_loop: {
    inputs: [execIn],
    outputs: [
      { id: 'loop', type: 'exec' },
      { id: 'index', type: 'int' },
      { id: 'completed', type: 'exec' },
    ],
  },
  find_element: {
    inputs: [execIn],
    outputs: [
      execOut,
      { id: 'missing', type: 'exec', label: 'missing (legacy)' },
      { id: 'element', type: 'element' },
      { id: 'found', type: 'bool' },
    ],
  },
  find_screen_element: {
    inputs: [execIn, { id: 'index', type: 'int', optional: true }],
    outputs: [
      execOut,
      { id: 'element', type: 'element' },
      { id: 'found', type: 'bool' },
    ],
  },
  click_element: {
    inputs: [execIn, { id: 'element', type: 'element', optional: true }],
    outputs: [execOut],
  },
  back: { inputs: [execIn], outputs: [execOut] },
  home: { inputs: [execIn], outputs: [execOut] },
  wait: { inputs: [execIn], outputs: [execOut] },
  require_element: {
    inputs: [execIn],
    outputs: [{ id: 'found', type: 'exec' }, { id: 'missing', type: 'exec' }],
  },
  element_text_equals: {
    inputs: [execIn], outputs: [{ id: 'true', type: 'exec' }, { id: 'false', type: 'exec' }],
  },
  state_equals: {
    inputs: [execIn], outputs: [{ id: 'true', type: 'exec' }, { id: 'false', type: 'exec' }],
  },
  retry: {
    inputs: [execIn], outputs: [{ id: 'retry', type: 'exec' }, { id: 'exhausted', type: 'exec' }],
  },
  repeat: {
    inputs: [execIn], outputs: [{ id: 'repeat', type: 'exec' }, { id: 'done', type: 'exec' }],
  },
  timeout: {
    inputs: [execIn], outputs: [{ id: 'within', type: 'exec' }, { id: 'expired', type: 'exec' }],
  },
  stop: { inputs: [execIn], outputs: [] },
  wait_for_element: {
    inputs: [execIn], outputs: [{ id: 'found', type: 'exec' }, { id: 'timeout', type: 'exec' }],
  },
  wait_for_state: {
    inputs: [execIn], outputs: [{ id: 'matched', type: 'exec' }, { id: 'timeout', type: 'exec' }],
  },
  assert_element: {
    inputs: [execIn], outputs: [{ id: 'found', type: 'exec' }, { id: 'missing', type: 'exec' }],
  },
}

export function getNodePorts(type: MacroNodeType, config: Record<string, JsonValue>) {
  if (type === 'set_variable' || type === 'get_variable') {
    const variableType = variablePortType(config.type)
    if (type === 'get_variable') {
      return { inputs: [], outputs: [{ id: 'value', type: variableType }] }
    }
    return {
      inputs: [execIn, { id: 'value', type: variableType, optional: true }],
      outputs: [execOut, { id: 'value', type: variableType }],
    }
  }
  if (type === 'function_entry' || type === 'function_return' || type === 'call_function') {
    const inputs = functionPorts(config.inputs)
    const outputs = functionPorts(config.outputs)
    if (type === 'function_entry') return { inputs: [], outputs: [execOut, ...inputs] }
    if (type === 'function_return') return { inputs: [execIn, ...outputs], outputs: [] }
    return { inputs: [execIn, ...inputs], outputs: [execOut, ...outputs] }
  }
  if (type === 'sequence') {
    const value = config.outputs
    const count = typeof value === 'number' && Number.isFinite(value)
      ? Math.max(2, Math.min(16, Math.trunc(value)))
      : 2
    return {
      inputs: [execIn],
      outputs: Array.from({ length: count }, (_, index): PortDefinition => ({
        id: `then_${index}`,
        type: 'exec',
      })),
    }
  }
  return NODE_PORTS[type] ?? { inputs: [execIn], outputs: [] }
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

export const BLOCKS: readonly BlockDefinition[] = BLOCK_DEFINITIONS.map((block) => ({
  ...block,
  label: macroNodeLabels[block.type],
  description: macroNodeDescriptions[block.type]
    ?? ('description' in block ? block.description : undefined),
  ...getNodePorts(block.type, block.defaultConfig),
}))

export const BLOCK_BY_TYPE = new Map(BLOCKS.map((block) => [block.type, block]))

export function cloneDefaultConfig(type: MacroNodeType) {
  const config = BLOCK_BY_TYPE.get(type)?.defaultConfig ?? {}
  return structuredClone(config)
}
