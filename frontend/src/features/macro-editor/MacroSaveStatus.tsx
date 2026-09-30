import { Tag } from '@blueprintjs/core'
import { formatSavedAtCompact, formatSavedAtFull } from './save-timestamp'

export function MacroSaveStatus({
  dirty,
  lastSavedAt,
}: {
  dirty: boolean
  lastSavedAt: string | null
}) {
  const compact = lastSavedAt ? formatSavedAtCompact(lastSavedAt) : ''
  const full = lastSavedAt ? formatSavedAtFull(lastSavedAt) : ''
  const timestampLabel = compact
    ? dirty ? `마지막 저장 ${compact}` : compact
    : '마지막 저장 시각 없음'

  return (
    <span
      className="macro-save-status"
      aria-label={`${dirty ? '저장 안 됨' : '저장됨'} · ${timestampLabel}`}
      title={full ? `마지막 저장: ${full}` : '마지막 저장 시각 없음'}
    >
      <Tag intent={dirty ? 'warning' : 'success'} minimal>
        {dirty ? '저장 안 됨' : '저장됨'}
      </Tag>
      <span className="macro-save-status__time">{timestampLabel}</span>
    </span>
  )
}
