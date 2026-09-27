import { Button, Callout } from '@blueprintjs/core'
import type { ChangeEvent, ReactNode } from 'react'
import type { JsonValue, MacroFlowNode, ValidationIssue } from './types'
import { SCREEN_ELEMENTS, SCREEN_OPTIONS } from './screen-elements'

export interface NodeInspectorProps {
  node: MacroFlowNode | null
  issues: ValidationIssue[]
  onUpdateConfig: (config: Record<string, JsonValue>) => void
  onUpdateLabel: (label: string) => void
  onSetEntry: () => void
  onDelete: () => void
}

export function NodeInspector({
  node,
  issues,
  onUpdateConfig,
  onUpdateLabel,
  onSetEntry,
  onDelete,
}: NodeInspectorProps) {
  if (!node) {
    return (
      <aside className="macro-inspector" aria-label="Selected node configuration">
        <div className="macro-section-heading"><span>Configuration</span></div>
        <div className="macro-inspector__empty">Select a node to configure it.</div>
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
    <aside className="macro-inspector" aria-label="Selected node configuration">
      <div className="macro-section-heading">
        <span>Configuration</span>
        <code>{node.data.nodeType}</code>
      </div>
      <div className="macro-inspector__body">
        <Field label="Label">
          <input
            value={node.data.label}
            onChange={(event) => onUpdateLabel(event.target.value)}
          />
        </Field>
        <Field label="Node ID"><input value={node.id} disabled /></Field>

        {node.data.nodeType === 'tap_element' && (
          <Field label="Source">
            <select
              value={text(node.data.config.source, 'selector')}
              onChange={(event) => update('source', event.target.value)}
            >
              <option value="selector">Selector</option>
              <option value="previous">Previous resolved element</option>
            </select>
          </Field>
        )}

        {usesSelector(node) &&
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
            <NumberField label="Duration (ms)" min={1} value={number(node.data.config.duration_ms, 70)} onChange={(v) => update('duration_ms', v)} />
          </>
        )}
        {node.data.nodeType === 'drag_point' && (
          <>
            <CoordinateSpace value={text(node.data.config.coordinate_space, 'pixel')} onChange={(value) => update('coordinate_space', value)} />
            <PointFields label="Start" value={selector(node.data.config.start)} onChange={(field, value) => updateObject('start', field, value)} />
            <PointFields label="End" value={selector(node.data.config.end)} onChange={(field, value) => updateObject('end', field, value)} />
            <NumberField label="Duration (ms)" min={1} value={number(node.data.config.duration_ms, 450)} onChange={(v) => update('duration_ms', v)} />
          </>
        )}
        {node.data.nodeType === 'random_click_area' && (
          <>
            <CoordinateSpace value={text(node.data.config.coordinate_space, 'pixel')} onChange={(value) => update('coordinate_space', value)} />
            <AreaFields label="Area" value={selector(node.data.config.area)} onChange={(field, value) => updateObject('area', field, value)} />
            <SamplingFields label="Sampling" value={selector(node.data.config.sampling)} onChange={(field, value) => updateObject('sampling', field, value)} />
            <NumberField label="Duration (ms)" min={1} value={number(node.data.config.duration_ms, 70)} onChange={(v) => update('duration_ms', v)} />
          </>
        )}
        {node.data.nodeType === 'random_drag_area' && (
          <>
            <CoordinateSpace value={text(node.data.config.coordinate_space, 'pixel')} onChange={(value) => update('coordinate_space', value)} />
            <AreaFields label="Start area" value={selector(node.data.config.start_area)} onChange={(field, value) => updateObject('start_area', field, value)} />
            <SamplingFields label="Start sampling" value={selector(node.data.config.start_sampling)} onChange={(field, value) => updateObject('start_sampling', field, value)} />
            <AreaFields label="End area" value={selector(node.data.config.end_area)} onChange={(field, value) => updateObject('end_area', field, value)} />
            <SamplingFields label="End sampling" value={selector(node.data.config.end_sampling)} onChange={(field, value) => updateObject('end_sampling', field, value)} />
            <NumberField label="Duration (ms)" min={1} value={number(node.data.config.duration_ms, 450)} onChange={(v) => update('duration_ms', v)} />
          </>
        )}
        {node.data.nodeType === 'swipe' &&
          (['x1', 'y1', 'x2', 'y2'] as const).map((key) => (
            <NumberField key={key} label={key.toUpperCase()} value={number(node.data.config[key])} onChange={(v) => update(key, v)} />
          ))}
        {hasDuration(node) && (
          <NumberField label="Duration (ms)" min={0} value={number(node.data.config.duration_ms)} onChange={(v) => update('duration_ms', v)} />
        )}
        {node.data.nodeType === 'branch' && (
          <>
            <Field label="Condition">
              <select
                value={text(selector(node.data.config.condition).type, 'variable_equals')}
                onChange={(event) => updateObject('condition', 'type', event.target.value)}
              >
                <option value="variable_equals">Variable equals</option>
                <option value="variable_not_equals">Variable not equals</option>
                <option value="variable_truthy">Variable truthy</option>
              </select>
            </Field>
            <TextField label="Variable" value={text(selector(node.data.config.condition).variable)} onChange={(v) => updateObject('condition', 'variable', v)} />
            {selector(node.data.config.condition).type !== 'variable_truthy' && (
              <TextField label="Compare value" value={displayValue(selector(node.data.config.condition).value)} onChange={(v) => updateObject('condition', 'value', parseValue(v))} />
            )}
          </>
        )}
        {node.data.nodeType === 'for_loop' && (
          <>
            <NumberField label="Start" value={number(node.data.config.start)} onChange={(v) => update('start', v)} />
            <NumberField label="End" value={number(node.data.config.end, 5)} onChange={(v) => update('end', v)} />
            <NumberField label="Step" value={number(node.data.config.step, 1)} onChange={(v) => update('step', v)} />
            <TextField label="Index variable" value={text(node.data.config.index_variable, 'i')} onChange={(v) => update('index_variable', v)} />
            <label className="macro-checkbox"><input type="checkbox" checked={node.data.config.inclusive_end === true} onChange={(event) => update('inclusive_end', event.target.checked)} />Inclusive end</label>
          </>
        )}
        {node.data.nodeType === 'sequence' && (
          <div className="macro-sequence-config">
            <NumberField label="Output count" min={2} value={number(node.data.config.outputs, 2)} onChange={(v) => update('outputs', Math.max(2, Math.min(16, Math.trunc(v))))} />
            <div className="macro-inspector__actions">
              <Button small onClick={() => update('outputs', Math.min(16, number(node.data.config.outputs, 2) + 1))}>+ Output</Button>
              <Button small disabled={number(node.data.config.outputs, 2) <= 2} onClick={() => update('outputs', Math.max(2, number(node.data.config.outputs, 2) - 1))}>− Output</Button>
            </div>
          </div>
        )}
        {node.data.nodeType === 'click_element' && (
          <>
            <Field label="Resolve strategy"><select value={text(selector(node.data.config.resolve).strategy, 'best_match')} onChange={(event) => updateObject('resolve', 'strategy', event.target.value)}><option value="first">First</option><option value="best_match">Best match</option><option value="unique">Unique</option></select></Field>
            <NumberField label="Duration (ms)" min={1} value={number(selector(node.data.config.click).duration_ms, 70)} onChange={(v) => updateObject('click', 'duration_ms', v)} />
          </>
        )}
        {node.data.nodeType === 'click_screen_element' && (
          <ScreenElementFields config={node.data.config} updateMany={updateMany} updateObject={updateObject} />
        )}
        {node.data.nodeType === 'retry' && (
          <NumberField label="Max attempts" min={1} value={number(node.data.config.max_attempts, 3)} onChange={(v) => update('max_attempts', v)} />
        )}
        {node.data.nodeType === 'repeat' && (
          <NumberField label="Repeat count" min={0} value={number(node.data.config.count, 1)} onChange={(v) => update('count', v)} />
        )}
        {(node.data.nodeType === 'wait_for_element' || node.data.nodeType === 'wait_for_state') && (
          <>
            <NumberField label="Timeout (ms)" min={1} value={number(node.data.config.timeout_ms, 5_000)} onChange={(v) => update('timeout_ms', v)} />
            <NumberField label="Poll interval (ms)" min={1} value={number(node.data.config.poll_interval_ms, 100)} onChange={(v) => update('poll_interval_ms', v)} />
          </>
        )}
        {(node.data.nodeType === 'wait_for_state' || node.data.nodeType === 'state_equals') && (
          <TextField label="State" value={text(node.data.config.state)} onChange={(v) => update('state', v)} />
        )}
        {node.data.nodeType === 'element_text_equals' && (
          <TextField label="Expected text" value={text(node.data.config.text)} onChange={(v) => update('text', v)} />
        )}
        {node.data.nodeType === 'screen_update' && (
          <>
            <NumberField label="Interval (ms)" min={1} value={number(node.data.config.interval_ms, 1_000)} onChange={(v) => update('interval_ms', v)} />
            <label className="macro-checkbox">
              <input type="checkbox" checked disabled />
              Skip tick while handler is running
            </label>
          </>
        )}

        {issues.length > 0 && (
          <Callout intent="danger" title="Node validation">
            <ul>{issues.map((item, index) => <li key={`${item.source}-${index}`}>{item.message}</li>)}</ul>
          </Callout>
        )}
        <div className="macro-inspector__actions">
          {!node.data.isEvent && (
            <Button small outlined intent={node.data.isEntry ? 'success' : 'none'} onClick={onSetEntry}>
              {node.data.isEntry ? 'Legacy entry' : 'Set as legacy entry'}
            </Button>
          )}
          <Button small outlined intent="danger" disabled={node.data.isEvent} onClick={onDelete}>
            {node.data.isEvent ? 'Lifecycle event' : 'Delete node'}
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
      <legend>Selector</legend>
      <TextField label="Text" value={text(value.text)} onChange={(v) => onChange('text', v)} />
      <TextField label="Text regex" value={text(value.text_regex)} onChange={(v) => onChange('text_regex', v)} />
      <TextField label="Content description" value={text(value.content_description)} onChange={(v) => onChange('content_description', v)} />
      <TextField label="Description regex" value={text(value.content_description_regex)} onChange={(v) => onChange('content_description_regex', v)} />
      <TextField label="View ID" value={text(value.view_id)} onChange={(v) => onChange('view_id', v)} />
      <TextField label="Class name" value={text(value.class_name)} onChange={(v) => onChange('class_name', v)} />
      <TriState label="Clickable" value={value.clickable} onChange={(v) => onChange('clickable', v)} />
      <TriState label="Enabled" value={value.enabled} onChange={(v) => onChange('enabled', v)} />
      <TriState label="Visible" value={value.visible_to_user} onChange={(v) => onChange('visible_to_user', v)} />
      <Field label="Bounds region"><select value={text(value.bounds_region)} onChange={(event) => onChange('bounds_region', event.target.value || null)}><option value="">Any</option>{['top_left', 'top', 'top_right', 'left', 'center', 'right', 'bottom_left', 'bottom', 'bottom_right'].map((region) => <option key={region} value={region}>{region}</option>)}</select></Field>
    </fieldset>
  )
}

function CoordinateSpace({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <Field label="Coordinate space"><select value={value} onChange={(event) => onChange(event.target.value)}><option value="pixel">Pixel</option><option value="normalized">Normalized</option></select></Field>
}

function PointFields({ label, value, onChange }: { label: string; value: Record<string, JsonValue>; onChange: (field: string, value: JsonValue) => void }) {
  return <fieldset className="macro-selector-fields"><legend>{label}</legend><NumberField label="X" value={number(value.x)} onChange={(v) => onChange('x', v)} /><NumberField label="Y" value={number(value.y)} onChange={(v) => onChange('y', v)} /></fieldset>
}

function AreaFields({ label, value, onChange }: { label: string; value: Record<string, JsonValue>; onChange: (field: string, value: JsonValue) => void }) {
  return <fieldset className="macro-selector-fields"><legend>{label}</legend>{(['left', 'top', 'right', 'bottom'] as const).map((key) => <NumberField key={key} label={key} value={number(value[key])} onChange={(v) => onChange(key, v)} />)}</fieldset>
}

function SamplingFields({ label, value, onChange }: { label: string; value: Record<string, JsonValue>; onChange: (field: string, value: JsonValue) => void }) {
  const type = text(value.type, 'uniform')
  return <fieldset className="macro-selector-fields"><legend>{label}</legend><Field label="Type"><select value={type} onChange={(event) => onChange('type', event.target.value)}><option value="uniform">Uniform</option><option value="normal">Normal</option></select></Field>{type === 'normal' && <>{(['center_x', 'center_y', 'sigma_x', 'sigma_y'] as const).map((key) => <NumberField key={key} label={key} value={number(value[key], key.startsWith('center') ? 0.5 : 0.18)} onChange={(v) => onChange(key, v)} />)}</>}</fieldset>
}

function ScreenElementFields({ config, updateMany, updateObject }: { config: Record<string, JsonValue>; updateMany: (values: Record<string, JsonValue>) => void; updateObject: (key: string, field: string, value: JsonValue) => void }) {
  const screenId = text(config.screen_id, 'reservation_home')
  const elements = SCREEN_ELEMENTS[screenId] ?? []
  const elementId = text(config.element_id, elements[0]?.id ?? '')
  const selected = elements.find((element) => element.id === elementId)
  return <><Field label="Screen"><select value={screenId} onChange={(event) => { const next = event.target.value; const first = SCREEN_ELEMENTS[next]?.[0]; updateMany({ screen_id: next, element_id: first?.id ?? '', params: first?.collection ? { index: 0 } : {} }) }}>{SCREEN_OPTIONS.map((screen) => <option key={screen.id} value={screen.id}>{screen.label}</option>)}</select></Field><Field label="Element"><select value={elementId} onChange={(event) => { const next = event.target.value; updateMany({ element_id: next, params: elements.find((element) => element.id === next)?.collection ? { index: 0 } : {} }) }}>{elements.map((element) => <option key={element.id} value={element.id}>{element.label}</option>)}</select></Field>{selected?.collection && <NumberField label="Index" min={0} value={number(selector(config.params).index)} onChange={(value) => updateObject('params', 'index', Math.max(0, Math.trunc(value)))} />}<NumberField label="Duration (ms)" min={1} value={number(selector(config.click).duration_ms, 70)} onChange={(value) => updateObject('click', 'duration_ms', value)} /></>
}

function TriState({ label, value, onChange }: { label: string; value: JsonValue | undefined; onChange: (value: JsonValue) => void }) {
  const selected = value === true ? 'true' : value === false ? 'false' : 'any'
  return <Field label={label}><select value={selected} onChange={(event) => onChange(event.target.value === 'any' ? null : event.target.value === 'true')}><option value="any">Any</option><option value="true">True</option><option value="false">False</option></select></Field>
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="macro-field"><span>{label}</span>{children}</label>
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <Field label={label}><input value={value} onChange={(event) => onChange(event.target.value)} /></Field>
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
