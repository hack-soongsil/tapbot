import {
  Handle,
  Position,
  useConnection,
  useNodeConnections,
  type NodeConnection,
  type NodeProps,
} from '@xyflow/react'
import { useEffect, useRef, useState, type SyntheticEvent } from 'react'
import { Button, Icon, Tooltip } from '@blueprintjs/core'
import { ElementReferenceDialog } from '../ElementReferenceDialog'
import {
  getNodeDefinition,
  getInlineProperties,
  getNodePorts,
  type InlinePropertyDefinition,
  type NodeVisualKind,
} from '../blocks'
import { useInlineEditing } from '../inline-editing'
import { portTypesAreCompatible } from '../port-compatibility'
import {
  SCREEN_ELEMENT_CATEGORIES,
  SEMANTIC_SCREEN_OPTIONS,
  defaultParamsForElement,
  elementsInCategory,
  selectedScreenElement,
  withoutScreenElementEditorMetadata,
} from '../screen-elements'
import type {
  JsonValue,
  MacroFlowNode,
  MacroVariableDefinition,
  PortDefinition,
  PortType,
} from '../types'
import {
  localizeNodeLabel,
  macroCategoryLabels,
  macroPortLabel,
  portTypeLabels,
  runtimeStateLabels,
} from '../../../i18n/ko'

type PortDirection = 'input' | 'output'

export function BaseNode({ id, data, selected }: NodeProps<MacroFlowNode>) {
  const [elementReferenceOpen, setElementReferenceOpen] = useState(false)
  const ports = getNodePorts(data.nodeType, data.config)
  const definition = getNodeDefinition(data.nodeType)
  const inlineEditing = useInlineEditing()
  const inputConnections = useNodeConnections({ id, handleType: 'target' })
  const inlineProperties = getInlineProperties(data.nodeType, data.config)
  const isEvent = data.category === 'event'
  const inputPorts = isEvent ? [] : ports.inputs
  const hasLegacyExecOutput = ports.outputs.length === 0
    && (definition?.runtimePolicy.implicitExecOutput ?? true)
  const rowCount = Math.max(inputPorts.length, ports.outputs.length, hasLegacyExecOutput ? 1 : 0)
  const connection = useConnection<MacroFlowNode>()
  const connectedPortType = connection.inProgress
    ? connectionPortType(
        connection.fromNode.data,
        connection.fromHandle.id,
        connection.fromHandle.type,
      )
    : null

  const compatibility = (port: PortDefinition, direction: PortDirection) => {
    if (!connection.inProgress || connectedPortType === null) return undefined
    if (connection.fromHandle.type === 'source' && direction === 'input') {
      return portTypesAreCompatible(connectedPortType, port.type)
    }
    if (connection.fromHandle.type === 'target' && direction === 'output') {
      return portTypesAreCompatible(port.type, connectedPortType)
    }
    return undefined
  }
  const displayLabel = localizeNodeLabel(data.label, data.nodeType)
  const visualKind = definition?.visualKind ?? data.category
  const runtimeState = data.runtimeError ? 'failure' : data.runtimeState

  return (
    <div
      className={`macro-node macro-node--${data.category} macro-node--kind-${visualKind}${selected ? ' is-selected' : ''}${data.errors.length > 0 ? ' has-error' : ''}${runtimeState ? ` runtime-${runtimeState}` : ''}`}
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
            {runtimeState === 'failure' ? (
              <span className="macro-node__badge is-runtime-error" aria-label="런타임 오류">
                <Icon icon="error" size={12} /> 실행 오류
              </span>
            ) : runtimeState && runtimeState !== 'pending' && (
              <span className="macro-node__badge is-runtime">{runtimeStateLabels[runtimeState]}</span>
            )}
            {data.errors.length > 0 && (
              <span className="macro-node__badge is-error" title={data.errors.join('\n')}>
                검증 오류 {data.errors.length}개
              </span>
            )}
          </span>
        </div>
        <div className="macro-node__title">{displayLabel}</div>
      </header>

      {rowCount > 0 && (
        <div className="macro-node__pin-rows">
          {Array.from({ length: rowCount }, (_, rowIndex) => {
            const input = inputPorts[rowIndex]
            const output = ports.outputs[rowIndex]
            return (
              <div className="macro-node__pin-row" data-pin-row={rowIndex} key={rowIndex}>
                <div className="macro-node__pin-slot macro-node__pin-slot--input">
                  {input && (
                    <PortRow
                      nodeId={id}
                      port={input}
                      direction="input"
                      compatible={compatibility(input, 'input')}
                    />
                  )}
                </div>
                <div className="macro-node__pin-slot macro-node__pin-slot--output">
                  {output ? (
                    <PortRow
                      nodeId={id}
                      port={output}
                      direction="output"
                      compatible={compatibility(output, 'output')}
                    />
                  ) : hasLegacyExecOutput && rowIndex === 0 ? (
                    <LegacyExecOutput />
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      )}
      {inlineProperties.length > 0 && (
        <InlineProperties
          config={data.config}
          connections={inputConnections}
          editable={inlineEditing.updateNodeConfig !== undefined}
          properties={inlineProperties}
          variables={inlineEditing.variables}
          onChange={(config) => inlineEditing.updateNodeConfig?.(id, config)}
          onOpenElementReference={data.nodeType === 'find_screen_element'
            ? () => setElementReferenceOpen(true)
            : undefined}
        />
      )}
      {elementReferenceOpen && data.nodeType === 'find_screen_element' && (
        <ElementReferenceDialog
          screenId={selectedScreenElement(data.config).screenId}
          elementId={selectedScreenElement(data.config).element?.id ?? ''}
          onClose={() => setElementReferenceOpen(false)}
          onUseElement={(reference) => {
            inlineEditing.updateNodeConfig?.(id, withoutScreenElementEditorMetadata({
              ...data.config,
              screen_id: reference.screen.id,
              element_id: reference.element.id,
              params: defaultParamsForElement(reference.element),
            }))
            setElementReferenceOpen(false)
          }}
        />
      )}
    </div>
  )
}

function InlineProperties({
  config,
  connections,
  editable,
  properties,
  variables,
  onChange,
  onOpenElementReference,
}: {
  config: Record<string, JsonValue>
  connections: NodeConnection[]
  editable: boolean
  properties: readonly InlinePropertyDefinition[]
  variables: readonly MacroVariableDefinition[]
  onChange: (config: Record<string, JsonValue>) => void
  onOpenElementReference?: () => void
}) {
  const visibleProperties = properties
  if (visibleProperties.length === 0) return null

  return (
    <div className="macro-node__inline-properties nodrag nowheel" aria-label="핵심 설정">
      {onOpenElementReference && (
        <div className="macro-node__inline-actions">
          <Tooltip content="엘리먼트 설명" compact hoverOpenDelay={250} openOnTargetFocus>
            <Button
              type="button"
              icon="info-sign"
              minimal
              small
              className="macro-node__element-reference-button nodrag nowheel"
              aria-label="엘리먼트 설명 열기"
              onClick={(event) => {
                event.stopPropagation()
                onOpenElementReference()
              }}
            />
          </Tooltip>
        </div>
      )}
      {visibleProperties.map((property) => {
        const connection = property.inputPortId
          ? connections.find((item) => item.targetHandle === property.inputPortId)
          : undefined
        return (
          <label className="macro-node__inline-property" key={property.key}>
            <span className="macro-node__inline-label">{property.label}</span>
            {connection ? (
              <span
                className="macro-node__inline-connected"
                title={`${connection.source}${connection.sourceHandle ? `.${connection.sourceHandle}` : ''}에서 연결됨`}
              >
                <span>연결됨</span>
                <small>{connection.sourceHandle ?? connection.source}</small>
              </span>
            ) : (
              <InlinePropertyEditor
                config={config}
                disabled={!editable}
                property={property}
                variables={variables}
                onChange={onChange}
              />
            )}
          </label>
        )
      })}
    </div>
  )
}

function InlinePropertyEditor({
  config,
  disabled,
  property,
  variables,
  onChange,
}: {
  config: Record<string, JsonValue>
  disabled: boolean
  property: InlinePropertyDefinition
  variables: readonly MacroVariableDefinition[]
  onChange: (config: Record<string, JsonValue>) => void
}) {
  const value = getConfigValue(config, property.key)
  const common = {
    'aria-label': `${property.label} 인라인 설정`,
    className: 'macro-node__inline-control nodrag nowheel',
    disabled,
  }

  if (property.editor === 'number') {
    return (
      <input
        {...common}
        type="number"
        min={property.min}
        max={property.max}
        step={property.step}
        value={typeof value === 'number' ? value : 0}
        onChange={(event) => {
          const parsed = event.target.valueAsNumber
          if (!Number.isFinite(parsed)) return
          const stepped = property.step === 1 ? Math.trunc(parsed) : parsed
          const bounded = property.min === undefined ? stepped : Math.max(property.min, stepped)
          const next = property.max === undefined ? bounded : Math.min(property.max, bounded)
          onChange(setConfigValue(config, property.key, next))
        }}
      />
    )
  }

  if (property.editor === 'boolean') {
    return (
      <input
        {...common}
        className="macro-node__inline-checkbox nodrag nowheel"
        type="checkbox"
        checked={value === true}
        onChange={(event) => onChange(setConfigValue(config, property.key, event.target.checked))}
      />
    )
  }

  if (property.editor === 'select') {
    return (
      <select
        {...common}
        value={typeof value === 'string' ? value : property.options?.[0]?.value ?? ''}
        onChange={(event) => onChange(setConfigValue(config, property.key, event.target.value))}
      >
        {property.options?.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    )
  }

  if (property.editor === 'screen-element-screen') {
    const selection = selectedScreenElement(config)
    return (
      <select
        {...common}
        value={selection.screenId}
        onChange={(event) => {
          const screenId = event.target.value
          const categoryId = SCREEN_ELEMENT_CATEGORIES[screenId]?.[0]?.id ?? ''
          const element = elementsInCategory(screenId, categoryId)[0]
          onChange(withoutScreenElementEditorMetadata({
            ...config,
            screen_id: screenId,
            element_id: element?.id ?? '',
            params: defaultParamsForElement(element),
          }))
        }}
      >
        {SEMANTIC_SCREEN_OPTIONS.map((screen) => (
          <option key={screen.id} value={screen.id}>{screen.label}</option>
        ))}
      </select>
    )
  }

  if (property.editor === 'screen-element-category') {
    const selection = selectedScreenElement(config)
    const categories = SCREEN_ELEMENT_CATEGORIES[selection.screenId] ?? []
    return (
      <select
        {...common}
        value={selection.categoryId}
        onChange={(event) => {
          const categoryId = event.target.value
          const element = elementsInCategory(selection.screenId, categoryId)[0]
          onChange(withoutScreenElementEditorMetadata({
            ...config,
            element_id: element?.id ?? '',
            params: defaultParamsForElement(element),
          }))
        }}
      >
        {categories.map((category) => (
          <option key={category.id} value={category.id}>{category.label}</option>
        ))}
      </select>
    )
  }

  if (property.editor === 'screen-element') {
    const selection = selectedScreenElement(config)
    const elements = elementsInCategory(selection.screenId, selection.categoryId)
    return (
      <select
        {...common}
        value={selection.element?.id ?? elements[0]?.id ?? ''}
        onChange={(event) => {
          const elementId = event.target.value
          const selected = elements.find((element) => element.id === elementId)
          onChange(withoutScreenElementEditorMetadata({
            ...config,
            element_id: elementId,
            params: defaultParamsForElement(selected),
          }))
        }}
      >
        {elements.map((element) => (
          <option key={element.id} value={element.id}>{element.label}</option>
        ))}
      </select>
    )
  }

  if (property.editor === 'variable') {
    return (
      <select
        {...common}
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => {
          const variable = variables.find((item) => item.name === event.target.value)
          onChange(variable ? {
            ...config,
            name: variable.name,
            type: variable.type,
            default: variable.default ?? null,
          } : { ...config, name: '', type: 'int', default: 0 })
        }}
      >
        <option value="">변수 선택…</option>
        {variables.map((variable) => (
          <option key={variable.name} value={variable.name}>
            {variable.name} · {variable.type}
          </option>
        ))}
      </select>
    )
  }

  if (property.editor === 'dynamic-value') {
    return (
      <DynamicValueEditor
        config={config}
        disabled={disabled}
        label={property.label}
        value={value}
        onChange={(next) => onChange(setConfigValue(config, property.key, next))}
      />
    )
  }

  return (
    <InlineTextProperty
      ariaLabel={common['aria-label']}
      className={common.className}
      disabled={disabled}
      placeholder={property.placeholder}
      value={typeof value === 'string' ? value : ''}
      onCommit={(next) => onChange(setConfigValue(config, property.key, next))}
    />
  )
}

function InlineTextProperty({
  ariaLabel,
  className,
  disabled,
  placeholder,
  value,
  onCommit,
}: {
  ariaLabel: string
  className: string
  disabled: boolean
  placeholder?: string
  value: string
  onCommit: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const [composing, setComposing] = useState(false)
  const composingRef = useRef(false)
  const committedRef = useRef(value)

  useEffect(() => {
    committedRef.current = value
    if (!composingRef.current) setDraft(value)
  }, [value])

  const commit = (next: string) => {
    if (next === committedRef.current) return
    committedRef.current = next
    onCommit(next)
  }

  return (
    <input
      aria-label={ariaLabel}
      className={className}
      disabled={disabled}
      type="text"
      placeholder={placeholder}
      value={draft}
      onPointerDown={stopPropagation}
      onCompositionStart={(event) => {
        event.stopPropagation()
        composingRef.current = true
        setComposing(true)
      }}
      onCompositionUpdate={(event) => event.stopPropagation()}
      onCompositionEnd={(event) => {
        event.stopPropagation()
        const next = event.currentTarget.value
        composingRef.current = false
        setComposing(false)
        setDraft(next)
        commit(next)
      }}
      onChange={(event) => {
        const next = event.currentTarget.value
        setDraft(next)
        if (!composingRef.current) commit(next)
      }}
      onBlur={(event) => {
        composingRef.current = false
        setComposing(false)
        commit(event.currentTarget.value)
      }}
      onKeyDown={(event) => {
        const isComposing = event.nativeEvent.isComposing
          || event.nativeEvent.keyCode === 229
          || composing
        if (!isComposing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          return
        }
        event.stopPropagation()
        if (isComposing) return
        if (event.key === 'Enter') {
          event.preventDefault()
          commit(event.currentTarget.value)
        }
      }}
    />
  )
}

function DynamicValueEditor({
  config,
  disabled,
  label,
  value,
  onChange,
}: {
  config: Record<string, JsonValue>
  disabled: boolean
  label: string
  value: JsonValue | undefined
  onChange: (value: JsonValue) => void
}) {
  const type = typeof config.type === 'string' ? config.type : 'string'
  const displayedValue = displayJsonValue(value)
  const [draft, setDraft] = useState(displayedValue)
  const syncedValueRef = useRef(`${type}\u0000${displayedValue}`)

  useEffect(() => {
    const token = `${type}\u0000${displayedValue}`
    if (syncedValueRef.current === token) return
    syncedValueRef.current = token
    setDraft(displayedValue)
  }, [displayedValue, type])

  if (type === 'bool') {
    return (
      <input
        aria-label={`${label} 인라인 설정`}
        className="macro-node__inline-checkbox nodrag nowheel"
        disabled={disabled}
        type="checkbox"
        checked={value === true}
        onChange={(event) => onChange(event.target.checked)}
      />
    )
  }
  if (type === 'int' || type === 'float') {
    return (
      <input
        aria-label={`${label} 인라인 설정`}
        className="macro-node__inline-control nodrag nowheel"
        disabled={disabled}
        type="number"
        step={type === 'int' ? 1 : 'any'}
        value={typeof value === 'number' ? value : 0}
        onChange={(event) => {
          const parsed = event.target.valueAsNumber
          if (Number.isFinite(parsed)) onChange(type === 'int' ? Math.trunc(parsed) : parsed)
        }}
      />
    )
  }
  if (type === 'string') {
    return (
      <InlineTextProperty
        ariaLabel={`${label} 인라인 설정`}
        className="macro-node__inline-control nodrag nowheel"
        disabled={disabled}
        value={typeof value === 'string' ? value : ''}
        onCommit={onChange}
      />
    )
  }
  const commit = () => {
    try {
      onChange(JSON.parse(draft) as JsonValue)
    } catch {
      setDraft(displayJsonValue(value))
    }
  }
  return (
    <input
      aria-label={`${label} 인라인 설정`}
      className="macro-node__inline-control nodrag nowheel"
      disabled={disabled}
      type="text"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onPointerDown={stopPropagation}
      onCompositionStart={stopPropagation}
      onCompositionUpdate={stopPropagation}
      onCompositionEnd={stopPropagation}
      onBlur={commit}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
        }
      }}
    />
  )
}

function stopPropagation(event: SyntheticEvent): void {
  event.stopPropagation()
}

function getConfigValue(config: Record<string, JsonValue>, path: string): JsonValue | undefined {
  return path.split('.').reduce<JsonValue | undefined>((current, key) => {
    if (!isJsonObject(current)) return undefined
    return current[key]
  }, config)
}

function setConfigValue(
  config: Record<string, JsonValue>,
  path: string,
  value: JsonValue,
): Record<string, JsonValue> {
  const [key, ...rest] = path.split('.')
  if (!key) return config
  if (rest.length === 0) return { ...config, [key]: value }
  const child = isJsonObject(config[key]) ? config[key] : {}
  return { ...config, [key]: setConfigValue(child, rest.join('.'), value) }
}

function isJsonObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function displayJsonValue(value: JsonValue | undefined): string {
  if (value === undefined) return ''
  return typeof value === 'string' ? value : JSON.stringify(value)
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
      <PortHandle direction={direction} port={port} label={label} />
      {isInput && <VisualPin type={port.type} />}
      <span className="macro-node__port-label">{label}</span>
      {!isInput && <VisualPin type={port.type} />}
    </div>
  )
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
      className="macro-node__port-hitbox"
      type={direction === 'input' ? 'target' : 'source'}
      position={direction === 'input' ? Position.Left : Position.Right}
      id={port.id}
      aria-label={`${direction === 'input' ? '입력' : '출력'} ${label} ${portTypeLabels[port.type]} 포트`}
    />
  )
}

function VisualPin({ type }: { type: PortType }) {
  return (
    <span
      className={`macro-node__visual-pin macro-node__visual-pin--circle macro-node__visual-pin--${type === 'exec' ? 'exec' : 'data'}`}
      aria-hidden="true"
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
      <Handle
        className="macro-node__port-hitbox"
        type="source"
        position={Position.Right}
        aria-label="출력 실행 포트"
      />
      <span className="macro-node__port-label">실행</span>
      <VisualPin type="exec" />
    </div>
  )
}

function connectionPortType(
  data: MacroFlowNode['data'],
  handleId: string | null | undefined,
  handleType: 'source' | 'target',
): PortType | null {
  if (handleId == null) return 'exec'
  const ports = getNodePorts(data.nodeType, data.config)
  return (handleType === 'source' ? ports.outputs : ports.inputs)
    .find((port) => port.id === handleId)?.type ?? null
}

function portLabel(port: PortDefinition) {
  return macroPortLabel(port.id)
}
