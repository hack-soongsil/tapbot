import type { MacroDefinition } from './types'

export function persistedSaveTimestamp(definition: MacroDefinition | null): string | null {
  if (!definition) return null
  for (const key of ['updated_at', 'saved_at']) {
    const value = definition.metadata[key]
    if (typeof value === 'string' && parseSaveTimestamp(value)) return value
  }
  return null
}

export function withPersistedSaveTimestamp(
  definition: MacroDefinition,
  fallback = new Date(),
): MacroDefinition {
  if (persistedSaveTimestamp(definition)) return definition
  return {
    ...definition,
    metadata: { ...definition.metadata, updated_at: fallback.toISOString() },
  }
}

export function withoutPersistedSaveTimestamp(definition: MacroDefinition): MacroDefinition {
  const metadata = { ...definition.metadata }
  delete metadata.updated_at
  delete metadata.saved_at
  return { ...definition, metadata }
}

export function formatSavedAtCompact(value: string, now = new Date()): string {
  const parsed = parseSaveTimestamp(value)
  if (!parsed) return ''
  const time = `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
  return isSameLocalDay(parsed, now)
    ? time
    : `${pad(parsed.getMonth() + 1)}/${pad(parsed.getDate())} ${time}`
}

export function formatSavedAtFull(value: string): string {
  const parsed = parseSaveTimestamp(value)
  if (!parsed) return ''
  return [
    parsed.getFullYear(),
    '-',
    pad(parsed.getMonth() + 1),
    '-',
    pad(parsed.getDate()),
    ' ',
    pad(parsed.getHours()),
    ':',
    pad(parsed.getMinutes()),
    ':',
    pad(parsed.getSeconds()),
  ].join('')
}

export function saveButtonTooltip(value: string | null): string {
  return value
    ? `저장\n마지막 저장: ${formatSavedAtFull(value)}`
    : '저장\n마지막 저장 시각 없음'
}

function parseSaveTimestamp(value: string): Date | null {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function isSameLocalDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate()
}

function pad(value: number): string {
  return value.toString().padStart(2, '0')
}
