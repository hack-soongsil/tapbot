import { BLOCK_BY_TYPE, getNodePorts } from './blocks'
import type {
  BackendValidationResponse,
  JsonValue,
  MacroDefinition,
  ValidationIssue,
} from './types'
import { SCREEN_ELEMENTS } from './screen-elements'

const selectorTypes = new Set([
  'find_element',
  'require_element',
  'tap_element',
  'click_element',
  'element_exists',
  'element_text_equals',
  'wait_for_element',
  'assert_element',
])

export function validateMacroDefinition(
  definition: MacroDefinition,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const counts = new Map<string, number>()
  definition.nodes.forEach((node) => counts.set(node.id, (counts.get(node.id) ?? 0) + 1))
  for (const [id, count] of counts) {
    if (count > 1) issues.push(issue(`Duplicate node id: ${id}`, { nodeId: id }))
  }
  const nodeIds = new Set(definition.nodes.map((node) => node.id))
  const nodeById = new Map(definition.nodes.map((node) => [node.id, node]))
  const variableCounts = new Map<string, number>()
  for (const variable of definition.variables ?? []) {
    variableCounts.set(variable.name, (variableCounts.get(variable.name) ?? 0) + 1)
    if (variable.default === undefined) {
      if (variable.type !== 'element') {
        issues.push(issue(`Variable ${variable.name} requires a default value.`))
      }
    } else if (!matchesVariableType(variable.default, variable.type)) {
      issues.push(issue(`Variable ${variable.name} default must match ${variable.type}.`))
    }
  }
  for (const [name, count] of variableCounts) {
    if (count > 1) issues.push(issue(`Duplicate variable name: ${name}`))
  }
  const variables = new Map((definition.variables ?? []).map((item) => [item.name, item]))
  for (const node of [
    ...definition.nodes,
    ...(definition.functions ?? []).flatMap((item) => item.nodes),
  ]) {
    if (node.type !== 'set_variable' && node.type !== 'get_variable') continue
    const name = typeof node.config.name === 'string' ? node.config.name : ''
    const variable = variables.get(name)
    if (!variable) {
      issues.push(issue(`Choose a defined variable.`, { nodeId: node.id }))
    } else if (node.config.type !== variable.type) {
      issues.push(issue(`Variable port type must be ${variable.type}.`, { nodeId: node.id }))
    }
  }
  const eventEntries = definition.event_entry_node_ids
  const screenEventEntries = definition.screen_event_entry_node_ids
  if (!screenEventEntries && !eventEntries && (!definition.entry_node_id || !nodeIds.has(definition.entry_node_id))) {
    issues.push(issue('Choose an entry node before saving.'))
  }
  if (screenEventEntries) {
    const referenced = new Set<string>()
    for (const [screenId, entries] of Object.entries(screenEventEntries)) {
      const expected = [
        ['enter', 'screen_enter'],
        ['update', 'screen_update'],
        ['exit', 'screen_exit'],
      ] as const
      for (const [kind, type] of expected) {
        const matching = definition.nodes.filter((node) => (
          node.type === type && node.config.screen_id === screenId && node.config.event === kind
        ))
        if (matching.length !== 1) {
          issues.push(issue(`${screenId} must contain exactly one ${type} node.`))
        }
        const entryId = entries[kind]
        if (!entryId || !nodeIds.has(entryId)) {
          issues.push(issue(`${screenId} ${kind} entry is missing.`))
        } else {
          referenced.add(entryId)
          const node = nodeById.get(entryId)
          if (node?.type !== type || node.config.screen_id !== screenId || node.config.event !== kind) {
            issues.push(issue(`${screenId} ${kind} entry must reference its ${type} node.`, { nodeId: entryId }))
          }
        }
      }
    }
    for (const node of definition.nodes) {
      if (node.type.startsWith('screen_') && !referenced.has(node.id)) {
        issues.push(issue('Event node is not registered to a screen lifecycle.', { nodeId: node.id }))
      }
    }
  } else if (definition.screen) {
    const expected = [
      ['enter', 'screen_enter'],
      ['update', 'screen_update'],
      ['exit', 'screen_exit'],
    ] as const
    for (const [kind, type] of expected) {
      const matching = definition.nodes.filter((node) => node.type === type)
      if (matching.length !== 1) {
        issues.push(issue(`Screen graph must contain exactly one ${type} node.`))
      }
      const entryId = eventEntries?.[kind]
      if (!entryId || !nodeIds.has(entryId)) {
        issues.push(issue(`Screen ${kind} entry is missing.`))
      } else if (nodeById.get(entryId)?.type !== type) {
        issues.push(issue(`Screen ${kind} entry must reference ${type}.`, { nodeId: entryId }))
      }
    }
  }
  const wiredInputs = new Map<string, Set<string>>()
  const dataTargets = new Set<string>()
  const routes = new Set<string>()
  for (const edge of definition.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      issues.push(issue('Edge references a missing node.', { edgeId: edge.id }))
    }
    if (nodeById.get(edge.target)?.type.startsWith('screen_')) {
      issues.push(issue('Event nodes cannot have incoming edges.', { edgeId: edge.id }))
    }
    const source = nodeById.get(edge.source)
    const target = nodeById.get(edge.target)
    if (!source) continue
    const sourcePorts = getNodePorts(source.type, source.config)
    if (!target) {
      if (edge.source_handle && !sourcePorts.outputs.some((port) => port.id === edge.source_handle)) {
        issues.push(issue(`Invalid source handle: ${edge.source_handle}`, { edgeId: edge.id }))
      }
      continue
    }
    const targetPorts = getNodePorts(target.type, target.config)
    const kind = edge.kind ?? 'exec'
    if (kind === 'data') {
      if (edge.condition) {
        issues.push(issue('Data edges cannot have conditions.', { edgeId: edge.id }))
      }
      if (!edge.source_handle || !edge.target_handle) {
        issues.push(issue('Data edges require source and target handles.', { edgeId: edge.id }))
        continue
      }
      const sourcePort = sourcePorts.outputs.find((port) => port.id === edge.source_handle)
      const targetPort = targetPorts.inputs.find((port) => port.id === edge.target_handle)
      if (!sourcePort) issues.push(issue(`Invalid data source handle: ${edge.source_handle}`, { edgeId: edge.id }))
      if (!targetPort) issues.push(issue(`Invalid data target handle: ${edge.target_handle}`, { edgeId: edge.id }))
      if (sourcePort?.type === 'exec' || targetPort?.type === 'exec') {
        issues.push(issue('Data edges cannot connect exec ports.', { edgeId: edge.id }))
      } else if (sourcePort && targetPort && sourcePort.type !== targetPort.type) {
        issues.push(issue(`Port type mismatch: ${sourcePort.type} → ${targetPort.type}`, { edgeId: edge.id }))
      }
      const targetKey = `${edge.target}\u0000${edge.target_handle}`
      if (dataTargets.has(targetKey)) {
        issues.push(issue('A data input can have only one source.', { edgeId: edge.id }))
      }
      dataTargets.add(targetKey)
      const handles = wiredInputs.get(edge.target) ?? new Set<string>()
      handles.add(edge.target_handle)
      wiredInputs.set(edge.target, handles)
      continue
    }
    const legacyFindHandle = !edge.kind && source.type === 'find_element' && edge.source_handle === 'found'
    const sourcePort = edge.source_handle
      ? sourcePorts.outputs.find((port) => port.id === edge.source_handle)
      : undefined
    if (edge.source_handle && sourcePort?.type !== 'exec' && !legacyFindHandle) {
      issues.push(issue(`Invalid source handle: ${edge.source_handle}`, { edgeId: edge.id }))
    }
    const targetPort = edge.target_handle
      ? targetPorts.inputs.find((port) => port.id === edge.target_handle)
      : undefined
    if (edge.target_handle && targetPort?.type !== 'exec') {
      issues.push(issue(`Invalid target handle: ${edge.target_handle}`, { edgeId: edge.id }))
    }
    const route = `${edge.source}\u0000${edge.source_handle ?? ''}\u0000${edge.condition ?? ''}`
    if (routes.has(route)) {
      issues.push(issue('Multiple edges use the same output handle.', { edgeId: edge.id }))
    }
    routes.add(route)
  }
  for (const node of definition.nodes) {
    if (!BLOCK_BY_TYPE.has(node.type)) {
      issues.push(issue(`Unsupported node type: ${node.type}`, { nodeId: node.id }))
      continue
    }
    if (
      selectorTypes.has(node.type) &&
      !(node.type === 'tap_element' && node.config.source === 'previous') &&
      !(node.type === 'click_element' && wiredInputs.get(node.id)?.has('element')) &&
      !hasSelector(node.config.selector)
    ) {
      issues.push(issue('Enter at least one selector field.', { nodeId: node.id }))
    }
    if (node.type === 'state_equals' || node.type === 'wait_for_state') {
      if (!text(node.config.state)) {
        issues.push(issue('State is required.', { nodeId: node.id }))
      }
    }
    if (node.type === 'element_text_equals' && !text(node.config.text)) {
      issues.push(issue('Expected text is required.', { nodeId: node.id }))
    }
    if (node.type === 'branch') {
      const condition = object(node.config.condition)
      if (!wiredInputs.get(node.id)?.has('condition') && !text(condition.variable) && !text(node.config.variable)) {
        issues.push(issue('Variable is required.', { nodeId: node.id }))
      }
    }
    if (node.type === 'screen_update') {
      const interval = node.config.interval_ms
      if (typeof interval !== 'number' || interval <= 0) {
        issues.push(issue('Update interval must be greater than zero.', { nodeId: node.id }))
      }
      if (node.config.skip_if_running !== true) {
        issues.push(issue('Screen Update must skip while already running.', { nodeId: node.id }))
      }
    }
    if (node.type === 'debug_print') {
      if (typeof node.config.message !== 'string') {
        issues.push(issue('Debug message must be a string.', { nodeId: node.id }))
      }
      const configuredLevel = node.config.level
      if (
        typeof configuredLevel !== 'string'
        || !['debug', 'info', 'warning', 'error'].includes(configuredLevel)
      ) {
        issues.push(issue('Select a valid debug level.', { nodeId: node.id }))
      }
    }
    if (node.type === 'click_point') {
      validatePoint(node.config, issues, node.id)
    }
    if (node.type === 'drag_point') {
      validateNestedPoint(node.config.start, node.config, 'Start', issues, node.id)
      validateNestedPoint(node.config.end, node.config, 'End', issues, node.id)
      positiveDuration(node.config.duration_ms, issues, node.id)
    }
    if (node.type === 'random_click_area') {
      validateArea(node.config.area, node.config.coordinate_space, 'Area', issues, node.id)
      validateSampling(node.config.sampling, 'Sampling', issues, node.id)
      positiveDuration(node.config.duration_ms, issues, node.id)
    }
    if (node.type === 'random_drag_area') {
      validateArea(node.config.start_area, node.config.coordinate_space, 'Start area', issues, node.id)
      validateArea(node.config.end_area, node.config.coordinate_space, 'End area', issues, node.id)
      validateSampling(node.config.start_sampling, 'Start sampling', issues, node.id)
      validateSampling(node.config.end_sampling, 'End sampling', issues, node.id)
      positiveDuration(node.config.duration_ms, issues, node.id)
    }
    if (node.type === 'for_loop') {
      if (typeof node.config.step !== 'number' || node.config.step === 0) {
        issues.push(issue('For step must not be zero.', { nodeId: node.id }))
      }
      if (!text(node.config.index_variable)) {
        issues.push(issue('For index variable is required.', { nodeId: node.id }))
      }
    }
    if (node.type === 'sequence' && validOutputCount(node.config.outputs) < 2) {
      issues.push(issue('Sequence requires at least two outputs.', { nodeId: node.id }))
    }
    if (node.type === 'find_screen_element') {
      const screenId = typeof node.config.screen_id === 'string' ? node.config.screen_id : ''
      const elementId = typeof node.config.element_id === 'string' ? node.config.element_id : ''
      const template = SCREEN_ELEMENTS[screenId]?.find((item) => item.id === elementId)
      if (!template) {
        issues.push(issue('Choose a valid screen element.', { nodeId: node.id }))
      } else if (template.collection && !wiredInputs.get(node.id)?.has('index')) {
        const index = object(node.config.params).index
        if (typeof index !== 'number' || index < 0 || !Number.isInteger(index)) {
          issues.push(issue('Collection index must be a non-negative integer.', { nodeId: node.id }))
        }
      }
    }
  }
  return issues
}

function matchesVariableType(value: JsonValue, type: string) {
  if (type === 'bool') return typeof value === 'boolean'
  if (type === 'int') return typeof value === 'number' && Number.isInteger(value)
  if (type === 'float') return typeof value === 'number' && Number.isFinite(value)
  if (type === 'string') return typeof value === 'string'
  if (type === 'element') return value === null
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const keys = type === 'position'
    ? ['x', 'y']
    : type === 'rect' ? ['left', 'top', 'right', 'bottom'] : []
  return keys.length > 0 && keys.every((key) => typeof value[key] === 'number')
}

function object(value: JsonValue | undefined): Record<string, JsonValue> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function validOutputCount(value: JsonValue | undefined) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 2 && value <= 16
    ? value
    : 0
}

function validatePoint(config: Record<string, JsonValue>, issues: ValidationIssue[], nodeId: string) {
  validateCoordinate(config.x, config.coordinate_space, 'X', issues, nodeId)
  validateCoordinate(config.y, config.coordinate_space, 'Y', issues, nodeId)
  positiveDuration(config.duration_ms, issues, nodeId)
}

function validateNestedPoint(value: JsonValue | undefined, config: Record<string, JsonValue>, label: string, issues: ValidationIssue[], nodeId: string) {
  const point = object(value)
  validateCoordinate(point.x, config.coordinate_space, `${label} X`, issues, nodeId)
  validateCoordinate(point.y, config.coordinate_space, `${label} Y`, issues, nodeId)
}

function validateCoordinate(value: JsonValue | undefined, space: JsonValue | undefined, label: string, issues: ValidationIssue[], nodeId: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push(issue(`${label} must be a finite number.`, { nodeId }))
  } else if (space === 'normalized' && (value < 0 || value > 1)) {
    issues.push(issue(`${label} must be between 0 and 1.`, { nodeId }))
  } else if (space !== 'normalized' && value < 0) {
    issues.push(issue(`${label} must not be negative.`, { nodeId }))
  }
}

function validateArea(value: JsonValue | undefined, space: JsonValue | undefined, label: string, issues: ValidationIssue[], nodeId: string) {
  const area = object(value)
  const values = ['left', 'top', 'right', 'bottom'].map((key) => area[key])
  if (values.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    issues.push(issue(`${label} coordinates must be finite numbers.`, { nodeId }))
    return
  }
  const left = values[0] as number
  const top = values[1] as number
  const right = values[2] as number
  const bottom = values[3] as number
  if (left >= right || top >= bottom) issues.push(issue(`${label} must have positive width and height.`, { nodeId }))
  if (space === 'normalized' && values.some((item) => (item as number) < 0 || (item as number) > 1)) {
    issues.push(issue(`${label} normalized coordinates must be between 0 and 1.`, { nodeId }))
  }
}

function validateSampling(value: JsonValue | undefined, label: string, issues: ValidationIssue[], nodeId: string) {
  const sampling = object(value)
  if (sampling.type !== 'uniform' && sampling.type !== 'normal') {
    issues.push(issue(`${label} type must be uniform or normal.`, { nodeId }))
    return
  }
  if (sampling.type === 'normal') {
    const centerX = sampling.center_x ?? 0.5
    const centerY = sampling.center_y ?? 0.5
    const sigmaX = sampling.sigma_x ?? 0.18
    const sigmaY = sampling.sigma_y ?? 0.18
    if (
      typeof centerX !== 'number' || centerX < 0 || centerX > 1 ||
      typeof centerY !== 'number' || centerY < 0 || centerY > 1
    ) {
      issues.push(issue('Normal sampling centers must be between 0 and 1.', { nodeId }))
    }
    if (
      typeof sigmaX !== 'number' || !Number.isFinite(sigmaX) || sigmaX <= 0 ||
      typeof sigmaY !== 'number' || !Number.isFinite(sigmaY) || sigmaY <= 0
    ) {
      issues.push(issue('Normal sigma values must be greater than zero.', { nodeId }))
    }
  }
}

function positiveDuration(value: JsonValue | undefined, issues: ValidationIssue[], nodeId: string) {
  if (typeof value !== 'number' || value <= 0) issues.push(issue('Duration must be greater than zero.', { nodeId }))
}

export function mapBackendValidationErrors(
  response: BackendValidationResponse,
): ValidationIssue[] {
  return response.errors.map((error) => ({
    message: error.message,
    nodeId: error.node_id,
    edgeId: error.edge_id,
    path: error.path,
    source: 'backend',
  }))
}

function hasSelector(value: JsonValue | undefined) {
  if (!value || Array.isArray(value) || typeof value !== 'object') return false
  return Object.entries(value).some(([key, item]) => (
    key !== 'ui_tree_path' && typeof item === 'string' && item.trim()
  ))
}

function text(value: JsonValue | undefined) {
  return typeof value === 'string' && value.trim().length > 0
}

function issue(
  message: string,
  location: Pick<ValidationIssue, 'nodeId' | 'edgeId'> = {},
): ValidationIssue {
  return { message, source: 'client', ...location }
}
