import { Button, ButtonGroup, Tag } from '@blueprintjs/core'

export interface MacroToolbarProps {
  name: string
  dirty: boolean
  busy: boolean
  runStatus: string | null
  runtimeVersion?: number | null
  screenId?: string
  onNameChange: (name: string) => void
  onScreenChange: (screenId: string) => void
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
  screenId,
  onNameChange,
  onScreenChange,
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
        <span>Macro</span>
        <input
          aria-label="Macro name"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
        />
        <select aria-label="Screen" value={screenId ?? ''} onChange={(event) => onScreenChange(event.target.value)}>
          <option value="reservation_home">Reservation Home</option>
          <option value="reservation_detail">Reservation Detail</option>
        </select>
        {dirty && <Tag intent="warning" minimal>Unsaved</Tag>}
        {runStatus && (
          <Tag intent={runStatus === 'running' ? 'success' : 'none'}>
            {runStatus}{runtimeVersion ? ` v${runtimeVersion}` : ''}
          </Tag>
        )}
      </div>
      <ButtonGroup className="macro-toolbar__actions" minimal>
        <Button onClick={onNew}>New</Button>
        <Button onClick={onLoad}>Load Draft</Button>
        <Button onClick={onDuplicate}>Duplicate</Button>
        <Button onClick={onValidate}>Validate</Button>
        <Button onClick={onFitView}>Fit View</Button>
        <Button className="macro-save-button" intent="primary" loading={busy} onClick={onSave}>Save</Button>
        <Button intent="success" disabled={busy || runStatus === 'running' || runStatus === 'paused'} onClick={onRun}>Run</Button>
        <Button disabled={busy || runStatus !== 'running'} onClick={onPause}>Pause</Button>
        <Button disabled={busy || runStatus !== 'paused'} onClick={onResume}>Resume</Button>
        <Button disabled={busy || (runStatus !== 'paused' && runStatus !== 'idle' && runStatus !== null)} onClick={onStep}>Step</Button>
        <Button intent="danger" disabled={busy || (runStatus !== 'running' && runStatus !== 'paused')} onClick={onStop}>Stop</Button>
        <Button disabled={busy || runStatus !== 'error'} onClick={onReset}>Reset</Button>
      </ButtonGroup>
    </header>
  )
}
