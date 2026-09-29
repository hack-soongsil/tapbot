import { ButtonGroup, Tag } from '@blueprintjs/core'
import { ko, runtimeStateLabels } from '../../i18n/ko'
import { MacroActionButton } from './MacroActionButton'

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
        <MacroActionButton icon="add" label={ko.actions.newMacro} onClick={onNew} />
        <MacroActionButton icon="folder-open" label={ko.actions.loadDraft} onClick={onLoad} />
        <MacroActionButton icon="duplicate" label={ko.actions.duplicate} onClick={onDuplicate} />
        <MacroActionButton icon="tick" label={ko.actions.validate} onClick={onValidate} />
        <MacroActionButton icon="zoom-to-fit" label={ko.actions.fitView} onClick={onFitView} />
        <MacroActionButton icon="floppy-disk" label={ko.actions.save} className="macro-save-button" intent="primary" loading={busy} onClick={onSave} />
        <MacroActionButton icon="play" label={ko.actions.run} intent="success" disabled={busy || runStatus === 'running' || runStatus === 'paused'} onClick={onRun} />
        <MacroActionButton icon="pause" label={ko.actions.pause} disabled={busy || runStatus !== 'running'} onClick={onPause} />
        <MacroActionButton icon="play" label={ko.actions.resume} disabled={busy || runStatus !== 'paused'} onClick={onResume} />
        <MacroActionButton icon="step-forward" label={ko.actions.step} disabled={busy || (runStatus !== 'paused' && runStatus !== 'idle' && runStatus !== null)} onClick={onStep} />
        <MacroActionButton icon="stop" label={ko.actions.stop} intent="danger" disabled={busy || (runStatus !== 'running' && runStatus !== 'paused')} onClick={onStop} />
        <MacroActionButton icon="reset" label={ko.actions.reset} disabled={busy || runStatus !== 'error'} onClick={onReset} />
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
