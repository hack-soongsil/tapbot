import type { MacroDefinition } from './types'
import { SCREEN_OPTIONS } from './screen-elements'

export const MACRO_DRAFT_STORAGE_KEY = 'tapbot.macro-editor.draft.v1'

export function createEmptyMacroDefinition(
  id = 'untitled-macro',
  name = '이름 없는 매크로',
): MacroDefinition {
  const eventKinds = ['enter', 'update', 'exit'] as const
  const entryIds = Object.fromEntries(SCREEN_OPTIONS.map((screen) => [
    screen.id,
    Object.fromEntries(eventKinds.map((kind) => [
      kind,
      `event-${screen.id.replaceAll('_', '-')}-${kind}`,
    ])),
  ])) as NonNullable<MacroDefinition['screen_event_entry_node_ids']>
  const nodes: MacroDefinition['nodes'] = SCREEN_OPTIONS.flatMap((screen, screenIndex) => (
    eventKinds.map((event, eventIndex) => ({
      id: entryIds[screen.id]![event],
      type: `screen_${event}`,
      label: `${screen.label} / 화면 ${event === 'enter' ? '진입' : event === 'update' ? '업데이트' : '이탈'}`,
      config: {
        screen_id: screen.id,
        event,
        ...(event === 'update' ? { interval_ms: 1_000, skip_if_running: true } : {}),
      },
      position: { x: 80 + eventIndex * 260, y: 60 + screenIndex * 190 },
    }))
  ))
  return {
    id,
    name,
    version: 1,
    screen_event_entry_node_ids: entryIds,
    nodes,
    edges: [],
    functions: [],
    variables: [],
    metadata: {},
  }
}
