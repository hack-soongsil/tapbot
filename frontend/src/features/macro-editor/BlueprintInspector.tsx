import { Button } from '@blueprintjs/core'
import { useState } from 'react'
import { BLUEPRINT_DATA_TYPES } from './blueprint-dnd'
import type { BlueprintSelection } from './MyBlueprintPanel'
import type {
  JsonValue,
  MacroFunctionDefinition,
  MacroFunctionPort,
  MacroVariableDefinition,
} from './types'

interface BlueprintInspectorProps {
  selection: BlueprintSelection
  variable?: MacroVariableDefinition
  functionDefinition?: MacroFunctionDefinition
  onEditVariable: (name: string) => void
  onDeleteVariable: (name: string) => void
  onRenameFunction: (functionId: string) => void
  onUpdateFunctionPorts: (
    functionId: string,
    kind: 'inputs' | 'outputs',
    ports: MacroFunctionPort[],
  ) => void
  onOpenFunction: (functionId: string) => void
  onDeleteFunction: (functionId: string) => void
}

export function BlueprintInspector(props: BlueprintInspectorProps) {
  const { selection, variable, functionDefinition } = props
  return (
    <aside className="macro-inspector blueprint-inspector" aria-label="My Blueprint 설정">
      <div className="macro-section-heading">
        <span>{selection.kind === 'variable' ? 'Variable' : 'Function'}</span>
        <code>{selection.id}</code>
      </div>
      <div className="macro-inspector__body">
        {selection.kind === 'variable' && variable ? (
          <VariableEditor key={`${variable.name}:${variable.type}`} variable={variable} {...props} />
        ) : selection.kind === 'function' && functionDefinition ? (
          <FunctionEditor key={functionDefinition.id} definition={functionDefinition} {...props} />
        ) : (
          <div className="macro-inspector__empty">선택한 항목을 찾을 수 없습니다.</div>
        )}
      </div>
    </aside>
  )
}

function VariableEditor({
  variable,
  onEditVariable,
  onDeleteVariable,
}: BlueprintInspectorProps & { variable: MacroVariableDefinition }) {
  return (
    <div className="blueprint-inspector__form">
      <div className="macro-field"><span>Name</span><strong>{variable.name}</strong></div>
      <div className="macro-field"><span>Type</span><code>{variable.type}</code></div>
      <div className="macro-field"><span>Default Value</span><code>{formatDefault(variable) || '—'}</code></div>
      <div className="macro-field"><span>실행 입력</span><strong>{variable.input === true ? '사용' : '사용 안 함'}</strong></div>
      <div className="macro-inspector__actions">
        <Button small intent="primary" onClick={() => onEditVariable(variable.name)}>편집</Button>
        <Button small intent="danger" onClick={() => onDeleteVariable(variable.name)}>삭제</Button>
      </div>
      <p className="blueprint-inspector__hint">캔버스로 드래그하면 Get/Set을 선택할 수 있습니다.</p>
    </div>
  )
}

function FunctionEditor({
  definition,
  onRenameFunction,
  onUpdateFunctionPorts,
  onOpenFunction,
  onDeleteFunction,
}: BlueprintInspectorProps & { definition: MacroFunctionDefinition }) {
  const updatePort = (
    kind: 'inputs' | 'outputs',
    index: number,
    patch: Partial<MacroFunctionPort>,
  ) => {
    const next = definition[kind].map((port, portIndex): MacroFunctionPort => {
      if (portIndex !== index) return port
      const updated: MacroFunctionPort = { ...port }
      if (patch.id !== undefined) updated.id = patch.id
      if (patch.type !== undefined) updated.type = patch.type
      if (patch.required !== undefined) {
        updated.required = patch.required
        delete updated.optional
      }
      if ('default' in patch) {
        if (patch.default === undefined) delete updated.default
        else updated.default = patch.default
      }
      return updated
    })
    onUpdateFunctionPorts(definition.id, kind, next)
  }

  const addPort = (kind: 'inputs' | 'outputs') => {
    const prefix = kind === 'inputs' ? 'input' : 'output'
    let index = definition[kind].length + 1
    while (definition[kind].some((port) => port.id === `${prefix}_${index}`)) index += 1
    onUpdateFunctionPorts(definition.id, kind, [
      ...definition[kind],
      {
        id: `${prefix}_${index}`,
        type: 'string',
        ...(kind === 'outputs' ? { required: false } : {}),
      },
    ])
  }

  return (
    <div className="blueprint-inspector__form">
      <div className="macro-field"><span>Name</span><strong>{definition.name}</strong></div>
      <Button small onClick={() => onRenameFunction(definition.id)}>이름 변경</Button>
      <SignatureEditor title="Inputs" ports={definition.inputs} onAdd={() => addPort('inputs')} onUpdate={(index, patch) => updatePort('inputs', index, patch)} onRemove={(index) => onUpdateFunctionPorts(definition.id, 'inputs', definition.inputs.filter((_, portIndex) => portIndex !== index))} />
      <SignatureEditor title="Outputs" ports={definition.outputs} onAdd={() => addPort('outputs')} onUpdate={(index, patch) => updatePort('outputs', index, patch)} onRemove={(index) => onUpdateFunctionPorts(definition.id, 'outputs', definition.outputs.filter((_, portIndex) => portIndex !== index))} />
      <div className="macro-inspector__actions">
        <Button small intent="primary" onClick={() => onOpenFunction(definition.id)}>함수 그래프 열기</Button>
        <Button small intent="danger" onClick={() => onDeleteFunction(definition.id)}>삭제</Button>
      </div>
    </div>
  )
}

function SignatureEditor({
  title,
  ports,
  onAdd,
  onUpdate,
  onRemove,
}: {
  title: string
  ports: readonly MacroFunctionPort[]
  onAdd: () => void
  onUpdate: (index: number, patch: Partial<MacroFunctionPort>) => void
  onRemove: (index: number) => void
}) {
  return (
    <section className="blueprint-signature">
      <header><strong>{title}</strong><Button small minimal onClick={onAdd}>+ Add {title === 'Inputs' ? 'Input' : 'Output'}</Button></header>
      {ports.map((port, index) => (
        <div className={`blueprint-signature__row${title === 'Outputs' ? ' is-output' : ''}`} key={`${index}-${port.id}`}>
          <span className={`blueprint-type-dot blueprint-type--${port.type}`} aria-hidden="true" />
          <input aria-label={`${title} ${index + 1} 이름`} value={port.id} onChange={(event) => onUpdate(index, { id: event.target.value })} />
          <select aria-label={`${title} ${index + 1} 타입`} value={port.type} onChange={(event) => onUpdate(index, { type: event.target.value as MacroFunctionPort['type'], default: undefined })}>{BLUEPRINT_DATA_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}</select>
          <Button small minimal icon="cross" aria-label={`${port.id} 제거`} onClick={() => onRemove(index)} />
          {title === 'Outputs' && (
            <div className="blueprint-signature__options">
              <label>
                <input
                  type="checkbox"
                  aria-label={`Outputs ${index + 1} 필수`}
                  checked={functionPortIsRequired(port)}
                  onChange={(event) => onUpdate(index, { required: event.target.checked })}
                />
                Required
              </label>
              <FunctionPortDefaultEditor
                key={`${port.type}:${JSON.stringify(port.default)}`}
                index={index}
                port={port}
                onUpdate={(value) => onUpdate(index, { default: value })}
              />
            </div>
          )}
        </div>
      ))}
      {ports.length === 0 && <div className="my-blueprint__empty">포트가 없습니다.</div>}
    </section>
  )
}

function FunctionPortDefaultEditor({
  index,
  port,
  onUpdate,
}: {
  index: number
  port: MacroFunctionPort
  onUpdate: (value: JsonValue | undefined) => void
}) {
  const [value, setValue] = useState(() => functionPortDefaultText(port.default))
  const [error, setError] = useState('')

  const commit = () => {
    if (!value.trim()) {
      setError('')
      onUpdate(undefined)
      return
    }
    try {
      onUpdate(parseFunctionPortDefault(value, port.type))
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '기본값이 올바르지 않습니다.')
    }
  }

  return (
    <span className="blueprint-signature__default">
      <input
        aria-label={`Outputs ${index + 1} 기본값`}
        aria-invalid={Boolean(error)}
        disabled={functionPortIsRequired(port) || port.type === 'element'}
        value={port.type === 'element' ? '' : value}
        placeholder={`Default: ${functionPortTypeDefaultText(port.type)}`}
        onChange={(event) => { setValue(event.target.value); setError('') }}
        onBlur={commit}
      />
      {error && <small role="alert">{error}</small>}
    </span>
  )
}

function functionPortDefaultText(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return ''
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function functionPortIsRequired(port: MacroFunctionPort): boolean {
  return port.required === true || (port.required === undefined && port.optional === false)
}

function functionPortTypeDefaultText(type: MacroFunctionPort['type']): string {
  if (type === 'bool') return 'false'
  if (type === 'int' || type === 'float') return '0'
  if (type === 'string') return '""'
  return 'null'
}

function parseFunctionPortDefault(raw: string, type: MacroFunctionPort['type']): JsonValue {
  if (type === 'string') return raw
  if (type === 'any') {
    try {
      return JSON.parse(raw) as JsonValue
    } catch {
      return raw
    }
  }
  if (type === 'bool') {
    if (raw === 'true') return true
    if (raw === 'false') return false
    throw new Error('true 또는 false를 입력하세요.')
  }
  if (type === 'int') {
    const value = Number(raw)
    if (!Number.isInteger(value)) throw new Error('정수를 입력하세요.')
    return value
  }
  if (type === 'float') {
    const value = Number(raw)
    if (!Number.isFinite(value)) throw new Error('유한한 숫자를 입력하세요.')
    return value
  }
  if (raw === 'null') return null
  try {
    const value = JSON.parse(raw) as JsonValue
    if (!matchesFunctionPortDefault(value, type)) throw new Error()
    return value
  } catch {
    throw new Error(`${type} 기본값은 올바른 JSON 객체 또는 null이어야 합니다.`)
  }
}

function matchesFunctionPortDefault(value: JsonValue, type: MacroFunctionPort['type']): boolean {
  if (type === 'any') return true
  if (value === null) return type === 'position' || type === 'rect' || type === 'element'
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const keys = type === 'position' ? ['x', 'y'] : ['left', 'top', 'right', 'bottom']
  return keys.every((key) => typeof value[key] === 'number')
}

function formatDefault(variable: MacroVariableDefinition): string {
  if (variable.default === undefined) return ''
  return typeof variable.default === 'string'
    ? variable.default
    : JSON.stringify(variable.default)
}
