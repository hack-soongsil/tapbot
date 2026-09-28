import { Button, ButtonGroup, Tag } from '@blueprintjs/core'
import { ko, runtimeStateLabels } from '../../i18n/ko'

export interface MacroToolbarProps {
  name: string
  dirty: boolean
  validationStatus: 'unknown' | 'valid' | 'invalid' | 'stale'
  validationErrorCount: number
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
  validationStatus,
  validationErrorCount,
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
        <Tag intent={dirty ? 'warning' : 'success'} minimal>
          {dirty ? '저장 안 됨' : '저장됨'}
        </Tag>
        <ValidationStatusTag status={validationStatus} errorCount={validationErrorCount} />
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

function ValidationStatusTag({
  status,
  errorCount,
}: {
  status: MacroToolbarProps['validationStatus']
  errorCount: number
}) {
  if (status === 'valid') return <Tag intent="success" minimal>검증됨</Tag>
  if (status === 'invalid') {
    return <Tag intent="danger" minimal>검증 오류 {errorCount}개</Tag>
  }
  if (status === 'stale') return <Tag intent="warning" minimal>검증 결과 오래됨</Tag>
  return <Tag minimal>검증 안 됨</Tag>
}
