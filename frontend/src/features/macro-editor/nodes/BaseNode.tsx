import { Handle, Position, type NodeProps } from '@xyflow/react'
import { getNodePorts } from '../blocks'
import type { MacroFlowNode } from '../types'

export function BaseNode({ data, selected }: NodeProps<MacroFlowNode>) {
  const ports = getNodePorts(data.nodeType, data.config)
  const execInputs = ports.inputs.filter((port) => port.type === 'exec')
  const dataInputs = ports.inputs.filter((port) => port.type !== 'exec')
  const execOutputs = ports.outputs.filter((port) => port.type === 'exec')
  const dataOutputs = ports.outputs.filter((port) => port.type !== 'exec')
  const isEvent = data.category === 'event'
  return (
    <div
      className={`macro-node macro-node--${data.category}${selected ? ' is-selected' : ''}${data.errors.length > 0 ? ' has-error' : ''}${data.runtimeState ? ` runtime-${data.runtimeState}` : ''}`}
      tabIndex={0}
      aria-label={`${data.label} macro node`}
    >
      {!isEvent && execInputs.map((port) => (
        <Handle key={port.id} type="target" position={Position.Top} id={port.id} />
      ))}
      {dataInputs.map((port, index) => (
        <div
          className="macro-node__data-port macro-node__data-port--input"
          data-port-type={port.type}
          key={port.id}
          style={{ top: `${((index + 1) / (dataInputs.length + 1)) * 100}%` }}
        >
          <Handle type="target" position={Position.Left} id={port.id} />
          <span>{port.label ?? port.id}</span>
        </div>
      ))}
      {dataOutputs.map((port, index) => (
        <div
          className="macro-node__data-port macro-node__data-port--output"
          data-port-type={port.type}
          key={port.id}
          style={{ top: `${((index + 1) / (dataOutputs.length + 1)) * 100}%` }}
        >
          <span>{port.label ?? port.id}</span>
          <Handle type="source" position={Position.Right} id={port.id} />
        </div>
      ))}
      <div className="macro-node__eyebrow">{data.category}</div>
      <div className="macro-node__title">{data.label}</div>
      <div className="macro-node__type">{data.nodeType}</div>
      {data.isEntry && !isEvent && <span className="macro-node__entry">LEGACY ENTRY</span>}
      {data.eventKind && <span className="macro-node__entry">{data.eventKind.toUpperCase()}</span>}
      {data.runtimeState && data.runtimeState !== 'pending' && (
        <span className="macro-node__runtime">{data.runtimeState}</span>
      )}
      {data.errors.length > 0 && (
        <span className="macro-node__error" title={data.errors.join('\n')}>
          {data.errors.length} error{data.errors.length === 1 ? '' : 's'}
        </span>
      )}
      {execOutputs.length > 0 ? (
        <div className="macro-node__handles" aria-hidden="true">
          {execOutputs.map((port, index) => (
            <div className="macro-node__handle-label" key={port.id}>
              <span>{port.label ?? port.id}</span>
              <Handle
                type="source"
                position={Position.Bottom}
                id={port.id}
                style={{ left: `${((index + 1) / (execOutputs.length + 1)) * 100}%` }}
              />
            </div>
          ))}
        </div>
      ) : (
        data.nodeType !== 'stop' && <Handle type="source" position={Position.Bottom} />
      )}
    </div>
  )
}
