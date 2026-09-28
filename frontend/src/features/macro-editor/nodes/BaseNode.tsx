import { Handle, Position, useConnection, type NodeProps } from '@xyflow/react'
import { getNodePorts } from '../blocks'
import { portTypesAreCompatible } from '../port-compatibility'
import type { MacroFlowNode, PortDefinition, PortType } from '../types'
import {
  localizeNodeLabel,
  macroCategoryLabels,
  macroPortLabel,
  portTypeLabels,
  runtimeStateLabels,
} from '../../../i18n/ko'

type PortDirection = 'input' | 'output'

export function BaseNode({ id, data, selected }: NodeProps<MacroFlowNode>) {
  const ports = getNodePorts(data.nodeType, data.config)
  const isEvent = data.category === 'event'
  const connection = useConnection<MacroFlowNode>()
  const sourceType = connection.inProgress && connection.fromHandle.type === 'source'
    ? outputPortType(connection.fromNode.data, connection.fromHandle.id)
    : null

  const compatibility = (port: PortDefinition, direction: PortDirection) => {
    if (direction !== 'input' || sourceType === null) return undefined
    return portTypesAreCompatible(sourceType, port.type)
  }
  const displayLabel = localizeNodeLabel(data.label, data.nodeType)
  const visualKind = nodeVisualKind(data.nodeType, data.category)

  return (
    <div
      className={`macro-node macro-node--${data.category} macro-node--kind-${visualKind}${selected ? ' is-selected' : ''}${data.errors.length > 0 ? ' has-error' : ''}${data.runtimeState ? ` runtime-${data.runtimeState}` : ''}`}
      tabIndex={0}
      aria-label={`${displayLabel} 매크로 노드`}
      data-node-type={data.nodeType}
      title={`내부 타입: ${data.nodeType}`}
    >
      <header className="macro-node__header">
        <div className="macro-node__heading-row">
          <span className="macro-node__eyebrow">{visualKindLabel(visualKind, data.category)}</span>
          <span className="macro-node__badges">
            {data.isEntry && !isEvent && <span className="macro-node__badge is-entry">시작점</span>}
            {data.runtimeState && data.runtimeState !== 'pending' && (
              <span className="macro-node__badge is-runtime">{runtimeStateLabels[data.runtimeState]}</span>
            )}
            {data.errors.length > 0 && (
              <span className="macro-node__badge is-error" title={data.errors.join('\n')}>
                오류 {data.errors.length}개
              </span>
            )}
          </span>
        </div>
        <div className="macro-node__title">{displayLabel}</div>
      </header>

      <div className="macro-node__ports">
        <div className="macro-node__port-column macro-node__port-column--input">
          {!isEvent && ports.inputs.map((port) => (
            <PortRow
              key={port.id}
              nodeId={id}
              port={port}
              direction="input"
              compatible={compatibility(port, 'input')}
            />
          ))}
        </div>
        <div className="macro-node__port-column macro-node__port-column--output">
          {ports.outputs.map((port) => (
            <PortRow key={port.id} nodeId={id} port={port} direction="output" />
          ))}
          {ports.outputs.length === 0 && data.nodeType !== 'stop' && (
            <LegacyExecOutput />
          )}
        </div>
      </div>

    </div>
  )
}

function PortRow({
  nodeId,
  port,
  direction,
  compatible,
}: {
  nodeId?: string
  port: PortDefinition
  direction: PortDirection
  compatible?: boolean
}) {
  const label = portLabel(port)
  const isInput = direction === 'input'
  const compatibilityClass = compatible === undefined
    ? ''
    : compatible ? ' is-connection-compatible' : ' is-connection-incompatible'
  return (
    <div
      className={`macro-node__port macro-node__port--${direction} macro-node__port--${port.type}${compatibilityClass}`}
      data-port-direction={direction}
      data-port-kind={port.type === 'exec' ? 'exec' : 'data'}
      data-port-type={port.type}
      title={`${label} · ${portTypeLabels[port.type]}`}
      onContextMenu={(event) => {
        if (port.type === 'exec' || port.type === 'any') return
        const node = event.currentTarget.closest<HTMLElement>('.react-flow__node')
        if (!node) return
        event.preventDefault()
        event.stopPropagation()
        event.currentTarget.dispatchEvent(new CustomEvent('tapbot:promote-variable', {
          bubbles: true,
          detail: {
            nodeId: nodeId ?? node.dataset.id ?? node.getAttribute('data-id'),
            portId: port.id,
            portType: port.type,
            direction,
            clientX: event.clientX,
            clientY: event.clientY,
          },
        }))
      }}
    >
      {isInput && (
        <PortHandle direction={direction} port={port} label={label} />
      )}
      <span className="macro-node__port-label">{label}</span>
      {!isInput && (
        <PortHandle direction={direction} port={port} label={label} />
      )}
    </div>
  )
}

type NodeVisualKind = MacroFlowNode['data']['category'] | 'variable' | 'function'

function nodeVisualKind(
  type: MacroFlowNode['data']['nodeType'],
  category: MacroFlowNode['data']['category'],
): NodeVisualKind {
  if (type === 'set_variable' || type === 'get_variable') return 'variable'
  if (type === 'function_entry' || type === 'function_return' || type === 'call_function') {
    return 'function'
  }
  return category
}

function visualKindLabel(
  kind: NodeVisualKind,
  category: MacroFlowNode['data']['category'],
): string {
  if (kind === 'variable') return '변수'
  if (kind === 'function') return '함수'
  return macroCategoryLabels[category]
}

function PortHandle({
  direction,
  port,
  label,
}: {
  direction: PortDirection
  port: PortDefinition
  label: string
}) {
  return (
    <Handle
      className="macro-node__port-handle"
      type={direction === 'input' ? 'target' : 'source'}
      position={direction === 'input' ? Position.Left : Position.Right}
      id={port.id}
      aria-label={`${direction === 'input' ? '입력' : '출력'} ${label} ${portTypeLabels[port.type]} 포트`}
    />
  )
}

function LegacyExecOutput() {
  return (
    <div
      className="macro-node__port macro-node__port--output macro-node__port--exec"
      data-port-direction="output"
      data-port-kind="exec"
      data-port-type="exec"
      title="실행 · 실행"
    >
      <span className="macro-node__port-label">실행</span>
      <Handle
        className="macro-node__port-handle"
        type="source"
        position={Position.Right}
        aria-label="출력 실행 포트"
      />
    </div>
  )
}

function outputPortType(
  data: MacroFlowNode['data'],
  handleId: string | null | undefined,
): PortType | null {
  if (handleId == null) return 'exec'
  return getNodePorts(data.nodeType, data.config).outputs
    .find((port) => port.id === handleId)?.type ?? null
}

function portLabel(port: PortDefinition) {
  return macroPortLabel(port.id)
}
