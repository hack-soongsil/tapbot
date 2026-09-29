import { Button, Callout, Icon } from '@blueprintjs/core'
import { SEMANTIC_SCREEN_OPTIONS, canonicalScreenId } from './screen-elements'
import { traceErrorCode, traceErrorMessage, traceErrorPayload, traceGraphPath, type RuntimeTrace } from './runtime-trace'
import type { JsonValue, MacroFlowNode, MacroFunctionDefinition } from './types'

export function RuntimeErrorSection({ trace, node, functions, onFocusNode }: {
  trace: RuntimeTrace
  node: MacroFlowNode
  functions: readonly MacroFunctionDefinition[]
  onFocusNode?: (nodeId: string) => void
}) {
  const payload = traceErrorPayload(trace)
  const graphPath = Array.isArray(payload.graph_path)
    ? payload.graph_path.filter((value): value is string => typeof value === 'string')
    : Array.isArray(trace.graph_path_labels)
    ? trace.graph_path_labels.filter((value): value is string => typeof value === 'string')
    : ['Main', ...traceGraphPath(trace).map((id) => functions.find((item) => item.id === id)?.name ?? id)]
  const rawScreenId = typeof payload.screen_id === 'string'
    ? payload.screen_id
    : typeof trace.screen_id === 'string' ? trace.screen_id : null
  const screenId = rawScreenId ? canonicalScreenId(rawScreenId) : null
  const screenName = SEMANTIC_SCREEN_OPTIONS.find((item) => item.id === screenId)?.label
  const inputs = object(trace.resolved_inputs ?? trace.input_summary)
  const actualInputs = { ...inputs, ...object(payload.input_values), ...object(payload.inputs) }
  const fields: Array<[string, JsonValue | undefined]> = [
    ['Error Code', traceErrorCode(trace)],
    ['그래프 경로', graphPath.join(' > ')],
    ['Screen', screenName ? `${screenName} (${screenId})` : screenId],
    ['Node ID', payload.node_id ?? trace.node_id ?? node.id],
    ['Node Type', payload.node_type ?? trace.node_type ?? node.data.nodeType],
    ['Node Label', payload.node_label ?? trace.node_label ?? node.data.label],
    ['Function ID', trace.function_id],
    ['Function Name', trace.function_name],
    ['Caller Node ID', trace.caller_node_id],
    ['실패 Port', payload.port_id ?? payload.port ?? payload.target_handle],
    ['Source Node ID', payload.source_node_id],
    ['Source Port ID', payload.source_port_id],
    ['Expected', payload.expected_type ?? payload.expected],
    ['Actual', payload.actual_type ?? payload.actual],
    ['실제 값의 타입', payload.actual_type],
  ]
  return (
    <section className="macro-runtime-error" aria-label="Runtime Error">
      <h3><Icon icon="error" /> Runtime Error</h3>
      <Callout compact intent="danger">{traceErrorMessage(trace)}</Callout>
      <dl>
        {fields.map(([label, value]) => (
          <div key={label}><dt>{label}</dt><dd>{display(value)}</dd></div>
        ))}
        <div><dt>실제 입력값</dt><dd><pre>{JSON.stringify(actualInputs, null, 2)}</pre></dd></div>
        {'actual_value' in payload && <div><dt>실패 Port 값</dt><dd><pre>{JSON.stringify(payload.actual_value, null, 2)}</pre></dd></div>}
        <div><dt>Details</dt><dd><pre>{display(payload.details ?? trace.error ?? payload)}</pre></dd></div>
        {payload.element !== undefined && <div><dt>Element Context</dt><dd><pre>{JSON.stringify(payload.element, null, 2)}</pre></dd></div>}
        <div><dt>Function Inputs</dt><dd><pre>{JSON.stringify(trace.function_inputs ?? payload.function_inputs ?? {}, null, 2)}</pre></dd></div>
        <div><dt>Hint</dt><dd>{display(payload.hint ?? '노드 입력값·연결·대상 화면 상태를 확인한 뒤 다시 실행하세요.')}</dd></div>
        <div><dt>실패 시각 / Step</dt><dd>{display(trace.timestamp ?? trace.completed_at)} / {display(trace.step)}</dd></div>
        <div><dt>출력값</dt><dd><pre>{JSON.stringify(trace.output_summary ?? {}, null, 2)}</pre></dd></div>
      </dl>
      {(['source', 'target'] as const).map((key) => {
        const nodeId = payload[key]
        return typeof nodeId === 'string'
          ? <Button key={key} small onClick={() => onFocusNode?.(nodeId)}>{key === 'source' ? '출발 노드로 이동' : '도착 노드로 이동'}</Button>
          : null
      })}
    </section>
  )
}

function object(value: JsonValue | undefined): Record<string, JsonValue> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function display(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return '정보 없음'
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}
