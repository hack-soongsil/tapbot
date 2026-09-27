import { Handle, Position, useConnection, type NodeProps } from '@xyflow/react'
import { getNodePorts } from '../blocks'
import { portTypesAreCompatible } from '../port-compatibility'
import type { MacroFlowNode, PortDefinition, PortType } from '../types'
import {
  eventKindLabels,
  localizeNodeLabel,
  macroCategoryLabels,
  macroPortLabel,
  portTypeLabels,
  runtimeStateLabels,
} from '../../../i18n/ko'

type PortDirection = 'input' | 'output'

export function BaseNode({ data, selected }: NodeProps<MacroFlowNode>) {
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

  return (
    <div
      className={`macro-node macro-node--${data.category}${selected ? ' is-selected' : ''}${data.errors.length > 0 ? ' has-error' : ''}${data.runtimeState ? ` runtime-${data.runtimeState}` : ''}`}
      tabIndex={0}
      aria-label={`${displayLabel} 매크로 노드`}
    >
      <header className="macro-node__header">
        <div className="macro-node__eyebrow">{macroCategoryLabels[data.category]}</div>
        <div className="macro-node__title">{displayLabel}</div>
        <div className="macro-node__type">{data.nodeType}</div>
        {data.isEntry && !isEvent && <span className="macro-node__entry">레거시 시작점</span>}
        {data.eventKind && <span className="macro-node__entry">{eventKindLabels[data.eventKind]}</span>}
        {data.runtimeState && data.runtimeState !== 'pending' && (
          <span className="macro-node__runtime">{runtimeStateLabels[data.runtimeState]}</span>
        )}
      </header>

      <div className="macro-node__ports">
        <div className="macro-node__port-column macro-node__port-column--input">
          {!isEvent && ports.inputs.map((port) => (
            <PortRow
              key={port.id}
              port={port}
              direction="input"
              compatible={compatibility(port, 'input')}
            />
          ))}
        </div>
        <div className="macro-node__port-column macro-node__port-column--output">
          {ports.outputs.map((port) => (
            <PortRow key={port.id} port={port} direction="output" />
          ))}
          {ports.outputs.length === 0 && data.nodeType !== 'stop' && (
            <LegacyExecOutput />
          )}
        </div>
      </div>

      {data.errors.length > 0 && (
        <span className="macro-node__error" title={data.errors.join('\n')}>
          오류 {data.errors.length}개
        </span>
      )}
    </div>
  )
}

function PortRow({
  port,
  direction,
  compatible,
}: {
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
    >
      {isInput && (
        <PortHandle direction={direction} port={port} label={label} />
      )}
      <span className="macro-node__port-label">{label}</span>
      {port.type !== 'exec' && (
        <small className="macro-node__port-type">{portTypeLabels[port.type]}</small>
      )}
      {!isInput && (
        <PortHandle direction={direction} port={port} label={label} />
      )}
    </div>
  )
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
