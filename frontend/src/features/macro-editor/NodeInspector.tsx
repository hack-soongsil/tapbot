import { Button, Callout } from '@blueprintjs/core'
import { useEffect, useRef, type ChangeEvent, type ReactNode } from 'react'
import { ko } from '../../i18n/ko'
import {
  getNodeDefinition,
  type CustomInspectorEditor,
  type InspectorFieldDefinition,
} from './blocks'
import { RuntimeErrorSection } from './RuntimeErrorSection'
import type { RuntimeTrace } from './runtime-trace'
import {
  SCREEN_ELEMENTS,
  SEMANTIC_SCREEN_OPTIONS,
  canonicalElementId,
  canonicalScreenId,
} from './screen-elements'
import type {
  JsonValue,
  MacroFlowNode,
  MacroFunctionDefinition,
  MacroVariableDefinition,
  ValidationIssue,
} from './types'

export interface NodeInspectorProps {
  node: MacroFlowNode | null
  issues: ValidationIssue[]
  onUpdateConfig: (config: Record<string, JsonValue>) => void
  onUpdateLabel: (label: string) => void
  onSetEntry: () => void
  onDelete: () => void
  allowLegacyEntry?: boolean
  functions?: readonly MacroFunctionDefinition[]
  variables?: readonly MacroVariableDefinition[]
  runtimeError?: RuntimeTrace | null
  onFocusErrorNode?: (nodeId: string) => void
}

interface InspectorContext {
  node: MacroFlowNode
  functions: readonly MacroFunctionDefinition[]
  variables: readonly MacroVariableDefinition[]
  update: (key: string, value: JsonValue) => void
  updateMany: (values: Record<string, JsonValue>) => void
  updateObject: (key: string, field: string, value: JsonValue) => void
}

export function NodeInspector({
  node,
  issues,
  onUpdateConfig,
  onUpdateLabel,
  onSetEntry,
  onDelete,
  allowLegacyEntry = true,
  functions = [],
  variables = [],
  runtimeError,
  onFocusErrorNode,
}: NodeInspectorProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (runtimeError && bodyRef.current) bodyRef.current.scrollTop = 0
  }, [runtimeError])
  if (!node) {
    return (
      <aside className="macro-inspector" aria-label="선택한 노드 설정">
        <div className="macro-section-heading"><span>{ko.inspector.configuration}</span></div>
        <div className="macro-inspector__empty">{ko.inspector.empty}</div>
      </aside>
    )
  }

  const definition = getNodeDefinition(node.data.nodeType)
  const update = (key: string, value: JsonValue) =>
    onUpdateConfig(setConfigPath(node.data.config, key, value))
  const updateMany = (values: Record<string, JsonValue>) =>
    onUpdateConfig({ ...node.data.config, ...values })
  const updateObject = (key: string, field: string, value: JsonValue) =>
    update(key, { ...jsonObject(getConfigPath(node.data.config, key)), [field]: value })
  const context: InspectorContext = {
    node, functions, variables, update, updateMany, updateObject,
  }

  return (
    <aside className="macro-inspector" aria-label="선택한 노드 설정">
      <div className="macro-section-heading">
        <span>{ko.inspector.configuration}</span>
        <code>{node.data.nodeType}</code>
      </div>
      <div className="macro-inspector__body" ref={bodyRef}>
        {runtimeError && (
          <RuntimeErrorSection trace={runtimeError} node={node} functions={functions} onFocusNode={onFocusErrorNode} />
        )}
        <Field label={ko.inspector.label}>
          <input value={node.data.label} onChange={(event) => onUpdateLabel(event.target.value)} />
        </Field>
        <Field label={ko.inspector.nodeId}><input className="node-id" value={node.id} disabled /></Field>

        {definition?.customInspector && renderCustomInspector(definition.customInspector, context)}
        <InspectorFields
          config={node.data.config}
          schema={definition?.inspectorSchema ?? []}
          onChange={update}
          onChangeObject={updateObject}
        />

        {issues.length > 0 && (
          <Callout intent="danger" title="노드 검증">
            <ul>{issues.map((item, index) => <li key={`${item.source}-${index}`}>{item.message}</li>)}</ul>
          </Callout>
        )}
        <div className="macro-inspector__actions">
          {allowLegacyEntry && !node.data.isEvent && (
            <Button small outlined intent={node.data.isEntry ? 'success' : 'none'} onClick={onSetEntry}>
              {node.data.isEntry ? '레거시 시작점' : '레거시 시작점으로 지정'}
            </Button>
          )}
          <Button small outlined intent="danger" disabled={node.data.isEvent} onClick={onDelete}>
            {node.data.isEvent ? '수명 주기 이벤트' : '노드 삭제'}
          </Button>
        </div>
      </div>
    </aside>
  )
}

function InspectorFields({
  config,
  schema,
  onChange,
  onChangeObject,
}: {
  config: Record<string, JsonValue>
  schema: readonly InspectorFieldDefinition[]
  onChange: (key: string, value: JsonValue) => void
  onChangeObject: (key: string, field: string, value: JsonValue) => void
}) {
  return schema.map((field) => {
    if (!isFieldVisible(field, config)) return null
    const value = getConfigPath(config, field.key)
      ?? (field.fallbackKey ? getConfigPath(config, field.fallbackKey) : undefined)
    if (field.editor === 'selector') {
      return <SelectorFields key={field.key} config={jsonObject(value)} onChange={(key, next) => onChangeObject(field.key, key, next)} />
    }
    if (field.editor === 'coordinate-space') {
      return <CoordinateSpace key={field.key} value={text(value, text(field.defaultValue, 'pixel'))} onChange={(next) => onChange(field.key, next)} />
    }
    if (field.editor === 'point') {
      return <PointFields key={field.key} label={field.label} value={jsonObject(value)} onChange={(key, next) => onChangeObject(field.key, key, next)} />
    }
    if (field.editor === 'area') {
      return <AreaFields key={field.key} label={field.label} value={jsonObject(value)} onChange={(key, next) => onChangeObject(field.key, key, next)} />
    }
    if (field.editor === 'sampling') {
      return <SamplingFields key={field.key} label={field.label} value={jsonObject(value)} onChange={(key, next) => onChangeObject(field.key, key, next)} />
    }
    if (field.editor === 'number') {
      return <NumberField
        key={field.key}
        label={field.label}
        value={number(value, number(field.defaultValue))}
        min={field.min}
        max={field.max}
        step={field.step}
        onChange={(next) => onChange(field.key, field.integer ? Math.trunc(next) : next)}
      />
    }
    if (field.editor === 'select') {
      return (
        <Field key={field.key} label={field.label}>
          <select value={text(value, text(field.defaultValue))} onChange={(event) => onChange(field.key, event.target.value)}>
            {field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
      )
    }
    if (field.editor === 'boolean') {
      return (
        <label className="macro-checkbox" key={field.key}>
          <input
            type="checkbox"
            checked={value === undefined ? field.defaultValue === true : value === true}
            disabled={field.disabled}
            onChange={(event) => onChange(field.key, event.target.checked)}
          />
          {field.label}
        </label>
      )
    }
    return <TextField
      key={field.key}
      label={field.label}
      value={text(value, text(field.defaultValue))}
      code={field.code}
      onChange={(next) => onChange(field.key, next || (field.emptyValue ?? next))}
    />
  })
}

function renderCustomInspector(editor: CustomInspectorEditor, context: InspectorContext) {
  const editors: Record<CustomInspectorEditor, () => ReactNode> = {
    function: () => <FunctionEditor context={context} />,
    variable: () => <VariableEditor context={context} />,
    branch: () => <BranchEditor context={context} />,
    sequence: () => <SequenceEditor context={context} />,
    'screen-element': () => <ScreenElementFields
      config={context.node.data.config}
      updateMany={context.updateMany}
      updateObject={context.updateObject}
    />,
  }
  return editors[editor]()
}

function FunctionEditor({ context }: { context: InspectorContext }) {
  return (
    <Field label="함수">
      <select
        aria-label="호출할 함수"
        value={text(context.node.data.config.function_id)}
        onChange={(event) => {
          const selected = context.functions.find((item) => item.id === event.target.value)
          context.updateMany({
            function_id: event.target.value,
            inputs: structuredClone(selected?.inputs ?? []),
            outputs: structuredClone(selected?.outputs ?? []),
          })
        }}
      >
        <option value="">함수 선택…</option>
        {context.functions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </Field>
  )
}

function VariableEditor({ context }: { context: InspectorContext }) {
  return (
    <Field label="변수">
      <select
        aria-label="변수 이름"
        value={text(context.node.data.config.name)}
        onChange={(event) => {
          const selected = context.variables.find((item) => item.name === event.target.value)
          if (!selected) {
            context.updateMany({ name: '', type: 'int' })
            return
          }
          context.updateMany({
            name: selected.name,
            type: selected.type,
            ...(context.node.data.nodeType === 'set_variable' ? { default: selected.default ?? null } : {}),
          })
        }}
      >
        <option value="">변수 선택…</option>
        {context.variables.map((item) => <option key={item.name} value={item.name}>{item.name} · {item.type}</option>)}
      </select>
    </Field>
  )
}

function BranchEditor({ context }: { context: InspectorContext }) {
  const condition = jsonObject(context.node.data.config.condition)
  return (
    <>
      <Field label="조건">
        <select value={text(condition.type, 'variable_equals')} onChange={(event) => context.updateObject('condition', 'type', event.target.value)}>
          <option value="variable_equals">변수 값과 같음</option>
          <option value="variable_not_equals">변수 값과 다름</option>
          <option value="variable_truthy">변수가 참임</option>
        </select>
      </Field>
      <TextField label="변수" value={text(condition.variable)} onChange={(value) => context.updateObject('condition', 'variable', value)} />
      {condition.type !== 'variable_truthy' && (
        <TextField label="비교 값" value={displayValue(condition.value)} onChange={(value) => context.updateObject('condition', 'value', parseValue(value))} />
      )}
    </>
  )
}

function SequenceEditor({ context }: { context: InspectorContext }) {
  const outputs = number(context.node.data.config.outputs, 2)
  const update = (value: number) => context.update('outputs', Math.max(2, Math.min(16, Math.trunc(value))))
  return (
    <div className="macro-sequence-config">
      <NumberField label="출력 수" min={2} max={16} value={outputs} onChange={update} />
      <div className="macro-inspector__actions">
        <Button small onClick={() => update(outputs + 1)}>+ 출력</Button>
        <Button small disabled={outputs <= 2} onClick={() => update(outputs - 1)}>− 출력</Button>
      </div>
    </div>
  )
}

function SelectorFields({
  config,
  onChange,
}: {
  config: Record<string, JsonValue>
  onChange: (key: string, value: JsonValue) => void
}) {
  return (
    <fieldset className="macro-selector-fields">
      <legend>선택자</legend>
      <TextField label="텍스트" value={text(config.text)} onChange={(value) => onChange('text', value)} />
      <TextField label="텍스트 정규식" value={text(config.text_regex)} onChange={(value) => onChange('text_regex', value)} code />
      <TextField label="콘텐츠 설명" value={text(config.content_description)} onChange={(value) => onChange('content_description', value)} />
      <TextField label="설명 정규식" value={text(config.content_description_regex)} onChange={(value) => onChange('content_description_regex', value)} code />
      <TextField label="뷰 ID" value={text(config.view_id)} onChange={(value) => onChange('view_id', value)} code />
      <TextField label="클래스 이름" value={text(config.class_name)} onChange={(value) => onChange('class_name', value)} code />
      <TriState label="클릭 가능" value={config.clickable} onChange={(value) => onChange('clickable', value)} />
      <TriState label="활성화" value={config.enabled} onChange={(value) => onChange('enabled', value)} />
      <TriState label="표시됨" value={config.visible_to_user} onChange={(value) => onChange('visible_to_user', value)} />
      <Field label="화면 영역">
        <select value={text(config.bounds_region)} onChange={(event) => onChange('bounds_region', event.target.value || null)}>
          <option value="">전체</option>
          {['top_left', 'top', 'top_right', 'left', 'center', 'right', 'bottom_left', 'bottom', 'bottom_right']
            .map((region) => <option key={region} value={region}>{region}</option>)}
        </select>
      </Field>
    </fieldset>
  )
}

function CoordinateSpace({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <Field label="좌표 기준"><select value={value} onChange={(event) => onChange(event.target.value)}><option value="pixel">픽셀</option><option value="normalized">정규화</option></select></Field>
}

function PointFields({ label, value, onChange }: { label: string; value: Record<string, JsonValue>; onChange: (field: string, value: JsonValue) => void }) {
  return <fieldset className="macro-selector-fields"><legend>{label}</legend><NumberField label="X" value={number(value.x)} onChange={(next) => onChange('x', next)} /><NumberField label="Y" value={number(value.y)} onChange={(next) => onChange('y', next)} /></fieldset>
}

function AreaFields({ label, value, onChange }: { label: string; value: Record<string, JsonValue>; onChange: (field: string, value: JsonValue) => void }) {
  const labels = { left: '왼쪽', top: '위', right: '오른쪽', bottom: '아래' }
  return <fieldset className="macro-selector-fields"><legend>{label}</legend>{(['left', 'top', 'right', 'bottom'] as const).map((key) => <NumberField key={key} label={labels[key]} value={number(value[key])} onChange={(next) => onChange(key, next)} />)}</fieldset>
}

function SamplingFields({ label, value, onChange }: { label: string; value: Record<string, JsonValue>; onChange: (field: string, value: JsonValue) => void }) {
  const type = text(value.type, 'uniform')
  return <fieldset className="macro-selector-fields"><legend>{label}</legend><Field label="타입"><select value={type} onChange={(event) => onChange('type', event.target.value)}><option value="uniform">균등 분포</option><option value="normal">정규 분포</option></select></Field>{type === 'normal' && <>{(['center_x', 'center_y', 'sigma_x', 'sigma_y'] as const).map((key) => <NumberField key={key} label={key} value={number(value[key], key.startsWith('center') ? 0.5 : 0.18)} onChange={(next) => onChange(key, next)} />)}</>}</fieldset>
}

function ScreenElementFields({ config, updateMany, updateObject }: { config: Record<string, JsonValue>; updateMany: (values: Record<string, JsonValue>) => void; updateObject: (key: string, field: string, value: JsonValue) => void }) {
  const screenId = canonicalScreenId(text(config.screen_id, 'study_room_list'))
  const elements = SCREEN_ELEMENTS[screenId] ?? []
  const elementId = canonicalElementId(
    screenId,
    text(config.element_id, elements[0]?.id ?? ''),
  )
  const selected = elements.find((element) => element.id === elementId)
  const params = jsonObject(config.params)
  const defaultParams = (option: typeof selected): Record<string, JsonValue> => {
    if (!option?.collection) return {}
    return option.param === 'name' ? { name: option.values?.[0] ?? '' } : { index: 0 }
  }
  return <><Field label={ko.inspector.screen}><select value={screenId} onChange={(event) => { const next = event.target.value; const first = SCREEN_ELEMENTS[next]?.[0]; updateMany({ screen_id: next, element_id: first?.id ?? '', params: defaultParams(first) }) }}>{SEMANTIC_SCREEN_OPTIONS.map((screen) => <option key={screen.id} value={screen.id}>{screen.label}</option>)}</select></Field><Field label={ko.inspector.element}><select value={elementId} onChange={(event) => { const next = event.target.value; updateMany({ element_id: next, params: defaultParams(elements.find((element) => element.id === next)) }) }}>{elements.map((element) => <option key={element.id} value={element.id}>{element.label}</option>)}</select></Field>{selected?.collection && (selected.param === 'name' ? selected.values ? <Field label="시간"><select value={text(params.name, selected.values[0])} onChange={(event) => updateObject('params', 'name', event.target.value)}>{selected.values.map((value) => <option key={value} value={value}>{value}</option>)}</select></Field> : <TextField label="이름" value={text(params.name)} onChange={(value) => updateObject('params', 'name', value)} /> : <NumberField label={ko.inspector.index} min={0} max={selected.maxIndex} value={number(params.index)} onChange={(value) => updateObject('params', 'index', Math.min(selected.maxIndex ?? Number.MAX_SAFE_INTEGER, Math.max(0, Math.trunc(value))))} />)}</>
}

function TriState({ label, value, onChange }: { label: string; value: JsonValue | undefined; onChange: (value: JsonValue) => void }) {
  const selected = value === true ? 'true' : value === false ? 'false' : 'any'
  return <Field label={label}><select value={selected} onChange={(event) => onChange(event.target.value === 'any' ? null : event.target.value === 'true')}><option value="any">전체</option><option value="true">참</option><option value="false">거짓</option></select></Field>
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="macro-field"><span>{label}</span>{children}</label>
}

function TextField({ label, value, onChange, code = false }: { label: string; value: string; onChange: (value: string) => void; code?: boolean }) {
  return <Field label={label}><input className={code ? 'code-text' : undefined} value={value} onChange={(event) => onChange(event.target.value)} /></Field>
}

function NumberField({ label, value, min, max, step, onChange }: { label: string; value: number; min?: number; max?: number; step?: number; onChange: (value: number) => void }) {
  const changed = (event: ChangeEvent<HTMLInputElement>) => onChange(Number.isNaN(event.target.valueAsNumber) ? 0 : event.target.valueAsNumber)
  return <Field label={label}><input type="number" min={min} max={max} step={step} value={value} onChange={changed} /></Field>
}

function isFieldVisible(field: InspectorFieldDefinition, config: Record<string, JsonValue>) {
  if (!field.visibleWhen) return true
  const value = getConfigPath(config, field.visibleWhen.key)
  if ('equals' in field.visibleWhen) return value === field.visibleWhen.equals
  return value !== field.visibleWhen.notEquals
}

function getConfigPath(config: Record<string, JsonValue>, path: string): JsonValue | undefined {
  let current: JsonValue | undefined = config
  for (const part of path.split('.')) {
    const object = jsonObject(current)
    current = object[part]
  }
  return current
}

function setConfigPath(config: Record<string, JsonValue>, path: string, value: JsonValue): Record<string, JsonValue> {
  const [key, ...rest] = path.split('.')
  if (!key) return config
  if (rest.length === 0) return { ...config, [key]: value }
  return {
    ...config,
    [key]: setConfigPath(jsonObject(config[key]), rest.join('.'), value),
  }
}

function jsonObject(value: JsonValue | undefined): Record<string, JsonValue> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function text(value: JsonValue | undefined, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function number(value: JsonValue | undefined, fallback = 0) {
  return typeof value === 'number' ? value : fallback
}

function parseValue(value: string): JsonValue {
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null') return null
  const numeric = Number(value)
  return value.trim() !== '' && Number.isFinite(numeric) ? numeric : value
}

function displayValue(value: JsonValue | undefined) {
  if (value === undefined || value === null) return value === null ? 'null' : ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return `${value}`
  return JSON.stringify(value)
}
