import { Button, Callout } from '@blueprintjs/core'
import type { ChangeEvent, ReactNode } from 'react'
import type {
  JsonValue,
  MacroFlowNode,
  MacroFunctionDefinition,
  MacroVariableDefinition,
  ValidationIssue,
} from './types'
import { SCREEN_ELEMENTS, SCREEN_OPTIONS } from './screen-elements'
import { ko } from '../../i18n/ko'

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
}: NodeInspectorProps) {
  if (!node) {
    return (
      <aside className="macro-inspector" aria-label="선택한 노드 설정">
        <div className="macro-section-heading"><span>{ko.inspector.configuration}</span></div>
        <div className="macro-inspector__empty">{ko.inspector.empty}</div>
      </aside>
    )
  }

  const update = (key: string, value: JsonValue) =>
    onUpdateConfig({ ...node.data.config, [key]: value })
  const updateMany = (values: Record<string, JsonValue>) =>
    onUpdateConfig({ ...node.data.config, ...values })
  const updateSelector = (key: string, value: JsonValue) => {
    const current = selector(node.data.config.selector)
    update('selector', { ...current, [key]: value })
  }
  const updateObject = (key: string, field: string, value: JsonValue) =>
    update(key, { ...selector(node.data.config[key]), [field]: value })

  return (
    <aside className="macro-inspector" aria-label="선택한 노드 설정">
      <div className="macro-section-heading">
        <span>{ko.inspector.configuration}</span>
        <code>{node.data.nodeType}</code>
      </div>
      <div className="macro-inspector__body">
        <Field label={ko.inspector.label}>
          <input
            value={node.data.label}
            onChange={(event) => onUpdateLabel(event.target.value)}
          />
        </Field>
        <Field label={ko.inspector.nodeId}><input className="node-id" value={node.id} disabled /></Field>

        {node.data.nodeType === 'call_function' && (
          <Field label="함수">
            <select
              aria-label="호출할 함수"
              value={text(node.data.config.function_id)}
              onChange={(event) => {
                const selected = functions.find((item) => item.id === event.target.value)
                updateMany({
                  function_id: event.target.value,
                  inputs: structuredClone(selected?.inputs ?? []),
                  outputs: structuredClone(selected?.outputs ?? []),
                })
              }}
            >
              <option value="">함수 선택…</option>
              {functions.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </Field>
        )}

        {(node.data.nodeType === 'set_variable' || node.data.nodeType === 'get_variable') && (
          <Field label="변수">
            <select
              aria-label="변수 이름"
              value={text(node.data.config.name)}
              onChange={(event) => {
                const selected = variables.find((item) => item.name === event.target.value)
                if (!selected) {
                  updateMany({ name: '', type: 'int' })
                  return
                }
                updateMany({
                  name: selected.name,
                  type: selected.type,
                  ...(node.data.nodeType === 'set_variable'
                    ? { default: selected.default ?? null }
                    : {}),
                })
              }}
            >
              <option value="">변수 선택…</option>
              {variables.map((item) => (
                <option key={item.name} value={item.name}>{item.name} · {item.type}</option>
              ))}
            </select>
          </Field>
        )}

        {node.data.nodeType === 'tap_element' && (
          <Field label="소스">
            <select
              value={text(node.data.config.source, 'selector')}
              onChange={(event) => update('source', event.target.value)}
            >
              <option value="selector">선택자</option>
              <option value="previous">이전에 찾은 엘리먼트</option>
            </select>
          </Field>
        )}

        {usesSelector(node) && node.data.nodeType !== 'click_element' &&
          !(node.data.nodeType === 'tap_element' && node.data.config.source === 'previous') && (
            <SelectorFields config={node.data.config} onChange={updateSelector} />
          )}

        {node.data.nodeType === 'tap_point' && (
          <>
            <NumberField label="X" value={number(node.data.config.x)} onChange={(v) => update('x', v)} />
            <NumberField label="Y" value={number(node.data.config.y)} onChange={(v) => update('y', v)} />
          </>
        )}
        {node.data.nodeType === 'click_point' && (
          <>
            <CoordinateSpace value={text(node.data.config.coordinate_space, 'pixel')} onChange={(value) => update('coordinate_space', value)} />
            <NumberField label="X" value={number(node.data.config.x)} onChange={(v) => update('x', v)} />
            <NumberField label="Y" value={number(node.data.config.y)} onChange={(v) => update('y', v)} />
            <NumberField label="지속 시간(ms)" min={1} value={number(node.data.config.duration_ms, 70)} onChange={(v) => update('duration_ms', v)} />
          </>
        )}
        {node.data.nodeType === 'drag_point' && (
          <>
            <CoordinateSpace value={text(node.data.config.coordinate_space, 'pixel')} onChange={(value) => update('coordinate_space', value)} />
            <PointFields label="시작" value={selector(node.data.config.start)} onChange={(field, value) => updateObject('start', field, value)} />
            <PointFields label="끝" value={selector(node.data.config.end)} onChange={(field, value) => updateObject('end', field, value)} />
            <NumberField label="지속 시간(ms)" min={1} value={number(node.data.config.duration_ms, 450)} onChange={(v) => update('duration_ms', v)} />
          </>
        )}
        {node.data.nodeType === 'random_click_area' && (
          <>
            <CoordinateSpace value={text(node.data.config.coordinate_space, 'pixel')} onChange={(value) => update('coordinate_space', value)} />
            <AreaFields label="영역" value={selector(node.data.config.area)} onChange={(field, value) => updateObject('area', field, value)} />
            <SamplingFields label="샘플링" value={selector(node.data.config.sampling)} onChange={(field, value) => updateObject('sampling', field, value)} />
            <NumberField label="지속 시간(ms)" min={1} value={number(node.data.config.duration_ms, 70)} onChange={(v) => update('duration_ms', v)} />
          </>
        )}
        {node.data.nodeType === 'random_drag_area' && (
          <>
            <CoordinateSpace value={text(node.data.config.coordinate_space, 'pixel')} onChange={(value) => update('coordinate_space', value)} />
            <AreaFields label="시작 영역" value={selector(node.data.config.start_area)} onChange={(field, value) => updateObject('start_area', field, value)} />
            <SamplingFields label="시작 샘플링" value={selector(node.data.config.start_sampling)} onChange={(field, value) => updateObject('start_sampling', field, value)} />
            <AreaFields label="끝 영역" value={selector(node.data.config.end_area)} onChange={(field, value) => updateObject('end_area', field, value)} />
            <SamplingFields label="끝 샘플링" value={selector(node.data.config.end_sampling)} onChange={(field, value) => updateObject('end_sampling', field, value)} />
            <NumberField label="지속 시간(ms)" min={1} value={number(node.data.config.duration_ms, 450)} onChange={(v) => update('duration_ms', v)} />
          </>
        )}
        {node.data.nodeType === 'swipe' &&
          (['x1', 'y1', 'x2', 'y2'] as const).map((key) => (
            <NumberField key={key} label={key.toUpperCase()} value={number(node.data.config[key])} onChange={(v) => update(key, v)} />
          ))}
        {hasDuration(node) && (
          <NumberField label="지속 시간(ms)" min={0} value={number(node.data.config.duration_ms)} onChange={(v) => update('duration_ms', v)} />
        )}
        {node.data.nodeType === 'branch' && (
          <>
            <Field label="조건">
              <select
                value={text(selector(node.data.config.condition).type, 'variable_equals')}
                onChange={(event) => updateObject('condition', 'type', event.target.value)}
              >
                <option value="variable_equals">변수 값과 같음</option>
                <option value="variable_not_equals">변수 값과 다름</option>
                <option value="variable_truthy">변수가 참임</option>
              </select>
            </Field>
            <TextField label="변수" value={text(selector(node.data.config.condition).variable)} onChange={(v) => updateObject('condition', 'variable', v)} />
            {selector(node.data.config.condition).type !== 'variable_truthy' && (
              <TextField label="비교 값" value={displayValue(selector(node.data.config.condition).value)} onChange={(v) => updateObject('condition', 'value', parseValue(v))} />
            )}
          </>
        )}
        {node.data.nodeType === 'for_loop' && (
          <>
            <NumberField label="시작" value={number(node.data.config.start)} onChange={(v) => update('start', v)} />
            <NumberField label="끝" value={number(node.data.config.end, 5)} onChange={(v) => update('end', v)} />
            <NumberField label="증가값" value={number(node.data.config.step, 1)} onChange={(v) => update('step', v)} />
            <TextField label="인덱스 변수" value={text(node.data.config.index_variable, 'i')} onChange={(v) => update('index_variable', v)} />
            <label className="macro-checkbox"><input type="checkbox" checked={node.data.config.inclusive_end === true} onChange={(event) => update('inclusive_end', event.target.checked)} />끝 값 포함</label>
          </>
        )}
        {node.data.nodeType === 'sequence' && (
          <div className="macro-sequence-config">
            <NumberField label="출력 수" min={2} value={number(node.data.config.outputs, 2)} onChange={(v) => update('outputs', Math.max(2, Math.min(16, Math.trunc(v))))} />
            <div className="macro-inspector__actions">
              <Button small onClick={() => update('outputs', Math.min(16, number(node.data.config.outputs, 2) + 1))}>+ 출력</Button>
              <Button small disabled={number(node.data.config.outputs, 2) <= 2} onClick={() => update('outputs', Math.max(2, number(node.data.config.outputs, 2) - 1))}>− 출력</Button>
            </div>
          </div>
        )}
        {node.data.nodeType === 'click_element' && (
          <>
            <TextField
              label={ko.inspector.text}
              value={text(selector(node.data.config.selector).text)}
              onChange={(value) => updateSelector('text', value)}
            />
            <TextField
              label={ko.inspector.uiTreePath}
              value={text(selector(node.data.config.selector).ui_tree_path)}
              onChange={(value) => updateSelector('ui_tree_path', value || null)}
              code
            />
            <Field label={ko.inspector.clickSamplingMode}>
              <select
                value={text(node.data.config.sampling_mode, text(selector(node.data.config.click).mode, 'center'))}
                onChange={(event) => update('sampling_mode', event.target.value)}
              >
                <option value="center">중앙</option>
                <option value="uniform">균등 분포</option>
                <option value="normal">정규 분포</option>
              </select>
            </Field>
          </>
        )}
        {node.data.nodeType === 'find_screen_element' && (
          <ScreenElementFields config={node.data.config} updateMany={updateMany} updateObject={updateObject} />
        )}
        {node.data.nodeType === 'retry' && (
          <NumberField label="최대 시도 횟수" min={1} value={number(node.data.config.max_attempts, 3)} onChange={(v) => update('max_attempts', v)} />
        )}
        {node.data.nodeType === 'repeat' && (
          <NumberField label="반복 횟수" min={0} value={number(node.data.config.count, 1)} onChange={(v) => update('count', v)} />
        )}
        {(node.data.nodeType === 'wait_for_element' || node.data.nodeType === 'wait_for_state') && (
          <>
            <NumberField label="시간 제한(ms)" min={1} value={number(node.data.config.timeout_ms, 5_000)} onChange={(v) => update('timeout_ms', v)} />
            <NumberField label="확인 간격(ms)" min={1} value={number(node.data.config.poll_interval_ms, 100)} onChange={(v) => update('poll_interval_ms', v)} />
          </>
        )}
        {(node.data.nodeType === 'wait_for_state' || node.data.nodeType === 'state_equals') && (
          <TextField label="상태" value={text(node.data.config.state)} onChange={(v) => update('state', v)} />
        )}
        {node.data.nodeType === 'element_text_equals' && (
          <TextField label="예상 텍스트" value={text(node.data.config.text)} onChange={(v) => update('text', v)} />
        )}
        {node.data.nodeType === 'screen_update' && (
          <>
            <NumberField label="실행 간격(ms)" min={1} value={number(node.data.config.interval_ms, 1_000)} onChange={(v) => update('interval_ms', v)} />
            <label className="macro-checkbox">
              <input type="checkbox" checked disabled />
              실행 중에는 다음 틱 건너뛰기
            </label>
          </>
        )}
        {node.data.nodeType === 'debug_print' && (
          <>
            <Field label="레벨">
              <select
                value={text(node.data.config.level, 'info')}
                onChange={(event) => update('level', event.target.value)}
              >
                <option value="debug">디버그</option>
                <option value="info">정보</option>
                <option value="warning">경고</option>
                <option value="error">오류</option>
              </select>
            </Field>
            <TextField
              label="메시지"
              value={text(node.data.config.message)}
              onChange={(value) => update('message', value)}
            />
          </>
        )}

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

function SelectorFields({
  config,
  onChange,
}: {
  config: Record<string, JsonValue>
  onChange: (key: string, value: JsonValue) => void
}) {
  const value = selector(config.selector)
  return (
    <fieldset className="macro-selector-fields">
      <legend>선택자</legend>
      <TextField label="텍스트" value={text(value.text)} onChange={(v) => onChange('text', v)} />
      <TextField label="텍스트 정규식" value={text(value.text_regex)} onChange={(v) => onChange('text_regex', v)} code />
      <TextField label="콘텐츠 설명" value={text(value.content_description)} onChange={(v) => onChange('content_description', v)} />
      <TextField label="설명 정규식" value={text(value.content_description_regex)} onChange={(v) => onChange('content_description_regex', v)} code />
      <TextField label="뷰 ID" value={text(value.view_id)} onChange={(v) => onChange('view_id', v)} code />
      <TextField label="클래스 이름" value={text(value.class_name)} onChange={(v) => onChange('class_name', v)} code />
      <TriState label="클릭 가능" value={value.clickable} onChange={(v) => onChange('clickable', v)} />
      <TriState label="활성화" value={value.enabled} onChange={(v) => onChange('enabled', v)} />
      <TriState label="표시됨" value={value.visible_to_user} onChange={(v) => onChange('visible_to_user', v)} />
      <Field label="화면 영역"><select value={text(value.bounds_region)} onChange={(event) => onChange('bounds_region', event.target.value || null)}><option value="">전체</option>{['top_left', 'top', 'top_right', 'left', 'center', 'right', 'bottom_left', 'bottom', 'bottom_right'].map((region) => <option key={region} value={region}>{region}</option>)}</select></Field>
    </fieldset>
  )
}

function CoordinateSpace({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <Field label="좌표 기준"><select value={value} onChange={(event) => onChange(event.target.value)}><option value="pixel">픽셀</option><option value="normalized">정규화</option></select></Field>
}

function PointFields({ label, value, onChange }: { label: string; value: Record<string, JsonValue>; onChange: (field: string, value: JsonValue) => void }) {
  return <fieldset className="macro-selector-fields"><legend>{label}</legend><NumberField label="X" value={number(value.x)} onChange={(v) => onChange('x', v)} /><NumberField label="Y" value={number(value.y)} onChange={(v) => onChange('y', v)} /></fieldset>
}

function AreaFields({ label, value, onChange }: { label: string; value: Record<string, JsonValue>; onChange: (field: string, value: JsonValue) => void }) {
  const labels = { left: '왼쪽', top: '위', right: '오른쪽', bottom: '아래' }
  return <fieldset className="macro-selector-fields"><legend>{label}</legend>{(['left', 'top', 'right', 'bottom'] as const).map((key) => <NumberField key={key} label={labels[key]} value={number(value[key])} onChange={(v) => onChange(key, v)} />)}</fieldset>
}

function SamplingFields({ label, value, onChange }: { label: string; value: Record<string, JsonValue>; onChange: (field: string, value: JsonValue) => void }) {
  const type = text(value.type, 'uniform')
  return <fieldset className="macro-selector-fields"><legend>{label}</legend><Field label="타입"><select value={type} onChange={(event) => onChange('type', event.target.value)}><option value="uniform">균등 분포</option><option value="normal">정규 분포</option></select></Field>{type === 'normal' && <>{(['center_x', 'center_y', 'sigma_x', 'sigma_y'] as const).map((key) => <NumberField key={key} label={key} value={number(value[key], key.startsWith('center') ? 0.5 : 0.18)} onChange={(v) => onChange(key, v)} />)}</>}</fieldset>
}

function ScreenElementFields({ config, updateMany, updateObject }: { config: Record<string, JsonValue>; updateMany: (values: Record<string, JsonValue>) => void; updateObject: (key: string, field: string, value: JsonValue) => void }) {
  const screenId = text(config.screen_id, 'reservation_home')
  const elements = SCREEN_ELEMENTS[screenId] ?? []
  const elementId = text(config.element_id, elements[0]?.id ?? '')
  const selected = elements.find((element) => element.id === elementId)
  return <><Field label={ko.inspector.screen}><select value={screenId} onChange={(event) => { const next = event.target.value; const first = SCREEN_ELEMENTS[next]?.[0]; updateMany({ screen_id: next, element_id: first?.id ?? '', params: first?.collection ? { index: 0 } : {} }) }}>{SCREEN_OPTIONS.map((screen) => <option key={screen.id} value={screen.id}>{screen.label}</option>)}</select></Field><Field label={ko.inspector.element}><select value={elementId} onChange={(event) => { const next = event.target.value; updateMany({ element_id: next, params: elements.find((element) => element.id === next)?.collection ? { index: 0 } : {} }) }}>{elements.map((element) => <option key={element.id} value={element.id}>{element.label}</option>)}</select></Field>{selected?.collection && <NumberField label={ko.inspector.index} min={0} value={number(selector(config.params).index)} onChange={(value) => updateObject('params', 'index', Math.max(0, Math.trunc(value)))} />}</>
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

function NumberField({ label, value, min, onChange }: { label: string; value: number; min?: number; onChange: (value: number) => void }) {
  const changed = (event: ChangeEvent<HTMLInputElement>) => onChange(event.target.valueAsNumber || 0)
  return <Field label={label}><input type="number" min={min} value={value} onChange={changed} /></Field>
}

function selector(value: JsonValue | undefined): Record<string, JsonValue> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function usesSelector(node: MacroFlowNode) {
  return ['find_element', 'require_element', 'tap_element', 'click_element', 'element_exists', 'element_text_equals', 'wait_for_element', 'assert_element'].includes(node.data.nodeType)
}

function hasDuration(node: MacroFlowNode) {
  return ['tap_element', 'tap_point', 'swipe', 'wait'].includes(node.data.nodeType)
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
