import type {
  JsonValue,
  MacroNodeCategory,
  MacroNodeType,
} from './types'

export interface BlockDefinition {
  type: MacroNodeType
  label: string
  category: MacroNodeCategory
  defaultConfig: Record<string, JsonValue>
  palette: boolean
}

const selector = {
  text: '',
  view_id: '',
  class_name: '',
  clickable: null,
  visible_to_user: true,
}

export const BLOCKS: readonly BlockDefinition[] = [
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
    palette: true,
  },
  {
    type: 'tap_point',
    label: 'Tap Point',
    category: 'action',
    defaultConfig: { x: 0, y: 0, duration_ms: 70 },
    palette: true,
  },
  {
    type: 'swipe',
    label: 'Swipe',
    category: 'action',
    defaultConfig: { x1: 0, y1: 0, x2: 0, y2: 0, duration_ms: 450 },
    palette: true,
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
    palette: false,
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
    defaultConfig: { variable: '', equals: true },
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

export const BLOCK_BY_TYPE = new Map(BLOCKS.map((block) => [block.type, block]))

export function cloneDefaultConfig(type: MacroNodeType) {
  const config = BLOCK_BY_TYPE.get(type)?.defaultConfig ?? {}
  return structuredClone(config)
}
