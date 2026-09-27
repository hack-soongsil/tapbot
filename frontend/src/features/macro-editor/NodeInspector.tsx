import { Button, Callout } from '@blueprintjs/core'
import type { ChangeEvent, ReactNode } from 'react'
import type { JsonValue, MacroFlowNode, ValidationIssue } from './types'

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
  const updateSelector = (key: string, value: JsonValue) => {
    const current = selector(node.data.config.selector)
    update('selector', { ...current, [key]: value })
  }

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
        {node.data.nodeType === 'swipe' &&
          (['x1', 'y1', 'x2', 'y2'] as const).map((key) => (
            <NumberField key={key} label={key.toUpperCase()} value={number(node.data.config[key])} onChange={(v) => update(key, v)} />
          ))}
        {hasDuration(node) && (
          <NumberField label="Duration (ms)" min={0} value={number(node.data.config.duration_ms)} onChange={(v) => update('duration_ms', v)} />
        )}
        {node.data.nodeType === 'branch' && (
          <>
            <TextField label="Variable" value={text(node.data.config.variable)} onChange={(v) => update('variable', v)} />
            <Field label="Expected value">
              <select
                value={node.data.config.equals === false ? 'false' : 'true'}
                onChange={(event) => update('equals', event.target.value === 'true')}
              >
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            </Field>
          </>
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

        {issues.length > 0 && (
          <Callout intent="danger" title="Node validation">
            <ul>{issues.map((item, index) => <li key={`${item.source}-${index}`}>{item.message}</li>)}</ul>
          </Callout>
        )}
        <div className="macro-inspector__actions">
          <Button small outlined intent={node.data.isEntry ? 'success' : 'none'} onClick={onSetEntry}>
            {node.data.isEntry ? 'Entry node' : 'Set as entry'}
          </Button>
          <Button small outlined intent="danger" onClick={onDelete}>Delete node</Button>
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
      <TextField label="View ID" value={text(value.view_id)} onChange={(v) => onChange('view_id', v)} />
      <TextField label="Class name" value={text(value.class_name)} onChange={(v) => onChange('class_name', v)} />
      <label className="macro-checkbox">
        <input
          type="checkbox"
          checked={value.clickable === true}
          onChange={(event) => onChange('clickable', event.target.checked ? true : null)}
        />
        Clickable only
      </label>
      <label className="macro-checkbox">
        <input
          type="checkbox"
          checked={value.visible_to_user !== false}
          onChange={(event) => onChange('visible_to_user', event.target.checked ? true : null)}
        />
        Visible only
      </label>
    </fieldset>
  )
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
  return ['find_element', 'require_element', 'tap_element', 'element_exists', 'element_text_equals', 'wait_for_element', 'assert_element'].includes(node.data.nodeType)
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
