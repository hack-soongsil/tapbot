import { Button, ButtonGroup, Tag } from '@blueprintjs/core'
import { ko, runtimeStateLabels } from '../../i18n/ko'

export interface MacroToolbarProps {
  name: string
  dirty: boolean
  busy: boolean
  runStatus: string | null
  runtimeVersion?: number | null
  onNameChange: (name: string) => void
  onNew: () => void
  onLoad: () => void
  onSave: () => void
  onDuplicate: () => void
  onValidate: () => void
  onRun: () => void
  onStop: () => void
  onPause: () => void
  onResume: () => void
  onStep: () => void
  onReset: () => void
  onFitView: () => void
}

export function MacroToolbar({
  name,
  dirty,
  busy,
  runStatus,
  runtimeVersion,
  onNameChange,
  onNew,
  onLoad,
  onSave,
  onDuplicate,
  onValidate,
  onRun,
  onStop,
  onPause,
  onResume,
  onStep,
  onReset,
  onFitView,
}: MacroToolbarProps) {
  return (
    <header className="macro-toolbar">
      <div className="macro-toolbar__identity">
        <span>매크로</span>
        <input
          aria-label="매크로 이름"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
        />
        {dirty && <Tag intent="warning" minimal>저장되지 않음</Tag>}
        {runStatus && (
          <Tag intent={runStatus === 'running' ? 'success' : 'none'}>
            {runtimeStateLabels[runStatus] ?? runStatus}{runtimeVersion ? ` v${runtimeVersion}` : ''}
          </Tag>
        )}
      </div>
      <ButtonGroup className="macro-toolbar__actions" minimal>
        <Button onClick={onNew}>{ko.actions.newMacro}</Button>
        <Button onClick={onLoad}>{ko.actions.loadDraft}</Button>
        <Button onClick={onDuplicate}>{ko.actions.duplicate}</Button>
        <Button onClick={onValidate}>{ko.actions.validate}</Button>
        <Button onClick={onFitView}>{ko.actions.fitView}</Button>
        <Button className="macro-save-button" intent="primary" loading={busy} onClick={onSave}>{ko.actions.save}</Button>
        <Button intent="success" disabled={busy || runStatus === 'running' || runStatus === 'paused'} onClick={onRun}>{ko.actions.run}</Button>
        <Button disabled={busy || runStatus !== 'running'} onClick={onPause}>{ko.actions.pause}</Button>
        <Button disabled={busy || runStatus !== 'paused'} onClick={onResume}>{ko.actions.resume}</Button>
        <Button disabled={busy || (runStatus !== 'paused' && runStatus !== 'idle' && runStatus !== null)} onClick={onStep}>{ko.actions.step}</Button>
        <Button intent="danger" disabled={busy || (runStatus !== 'running' && runStatus !== 'paused')} onClick={onStop}>{ko.actions.stop}</Button>
        <Button disabled={busy || runStatus !== 'error'} onClick={onReset}>{ko.actions.reset}</Button>
      </ButtonGroup>
    </header>
  )
}
