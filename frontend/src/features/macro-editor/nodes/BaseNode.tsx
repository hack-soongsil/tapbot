import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { MacroFlowNode } from '../types'

const handles: Partial<Record<MacroFlowNode['data']['nodeType'], string[]>> = {
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

export function BaseNode({ data, selected }: NodeProps<MacroFlowNode>) {
  const outputs = handles[data.nodeType]
  return (
    <div
      className={`macro-node macro-node--${data.category}${selected ? ' is-selected' : ''}${data.errors.length > 0 ? ' has-error' : ''}${data.runtimeState ? ` runtime-${data.runtimeState}` : ''}`}
      tabIndex={0}
      aria-label={`${data.label} macro node`}
    >
      <Handle type="target" position={Position.Top} />
      <div className="macro-node__eyebrow">{data.category}</div>
      <div className="macro-node__title">{data.label}</div>
      <div className="macro-node__type">{data.nodeType}</div>
      {data.isEntry && <span className="macro-node__entry">ENTRY</span>}
      {data.runtimeState && data.runtimeState !== 'pending' && (
        <span className="macro-node__runtime">{data.runtimeState}</span>
      )}
      {data.errors.length > 0 && (
        <span className="macro-node__error" title={data.errors.join('\n')}>
          {data.errors.length} error{data.errors.length === 1 ? '' : 's'}
        </span>
      )}
      {outputs ? (
        <div className="macro-node__handles" aria-hidden="true">
          {outputs.map((handle, index) => (
            <div className="macro-node__handle-label" key={handle}>
              <span>{handle}</span>
              <Handle
                type="source"
                position={Position.Bottom}
                id={handle}
                style={{ left: `${((index + 1) / (outputs.length + 1)) * 100}%` }}
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
