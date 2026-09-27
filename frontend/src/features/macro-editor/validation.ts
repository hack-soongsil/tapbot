import { BLOCK_BY_TYPE } from './blocks'
import type {
  BackendValidationResponse,
  JsonValue,
  MacroDefinition,
  ValidationIssue,
} from './types'

const selectorTypes = new Set([
  'find_element',
  'require_element',
  'tap_element',
  'element_exists',
  'element_text_equals',
  'wait_for_element',
  'assert_element',
])

const outputHandles: Partial<Record<string, readonly string[]>> = {
  branch: ['true', 'false'],
  element_exists: ['true', 'false'],
  element_text_equals: ['true', 'false'],
  state_equals: ['true', 'false'],
  find_element: ['found', 'missing'],
  require_element: ['found', 'missing'],
  retry: ['retry', 'exhausted'],
  repeat: ['repeat', 'done'],
  timeout: ['within', 'expired'],
  wait_for_element: ['found', 'timeout'],
  wait_for_state: ['matched', 'timeout'],
  assert_element: ['found', 'missing'],
}

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
  if (!definition.entry_node_id || !nodeIds.has(definition.entry_node_id)) {
    issues.push(issue('Choose an entry node before saving.'))
  }
  for (const edge of definition.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      issues.push(issue('Edge references a missing node.', { edgeId: edge.id }))
    }
    const source = nodeById.get(edge.source)
    const handles = source ? outputHandles[source.type] : undefined
    if (edge.source_handle && !handles?.includes(edge.source_handle)) {
      issues.push(issue(`Invalid source handle: ${edge.source_handle}`, { edgeId: edge.id }))
    }
  }
  const routes = new Set<string>()
  for (const edge of definition.edges) {
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
    if (node.type === 'branch' && !text(node.config.variable)) {
      issues.push(issue('Variable is required.', { nodeId: node.id }))
    }
  }
  return issues
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
  return Object.values(value).some((item) => typeof item === 'string' && item.trim())
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
