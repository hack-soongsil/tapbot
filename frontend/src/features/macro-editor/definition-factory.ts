import type { MacroDefinition } from './types'

export const MACRO_DRAFT_STORAGE_KEY = 'tapbot.macro-editor.draft.v1'

export function createEmptyMacroDefinition(
  id = 'untitled-macro',
  name = '이름 없는 매크로',
): MacroDefinition {
  return {
    id,
    name,
    version: 1,
    screen_event_entry_node_ids: {
      reservation_home: {
        enter: 'event-home-enter', update: 'event-home-update', exit: 'event-home-exit',
      },
      reservation_detail: {
        enter: 'event-detail-enter', update: 'event-detail-update', exit: 'event-detail-exit',
      },
    },
    nodes: [
      { id: 'event-home-enter', type: 'screen_enter', label: '스터디룸 예약 메인 / 화면 진입', config: { screen_id: 'reservation_home', event: 'enter' }, position: { x: 80, y: 60 } },
      { id: 'event-home-update', type: 'screen_update', label: '스터디룸 예약 메인 / 화면 업데이트', config: { screen_id: 'reservation_home', event: 'update', interval_ms: 1_000, skip_if_running: true }, position: { x: 340, y: 60 } },
      { id: 'event-home-exit', type: 'screen_exit', label: '스터디룸 예약 메인 / 화면 이탈', config: { screen_id: 'reservation_home', event: 'exit' }, position: { x: 600, y: 60 } },
      { id: 'event-detail-enter', type: 'screen_enter', label: '스터디룸 예약 상세 / 화면 진입', config: { screen_id: 'reservation_detail', event: 'enter' }, position: { x: 80, y: 60 } },
      { id: 'event-detail-update', type: 'screen_update', label: '스터디룸 예약 상세 / 화면 업데이트', config: { screen_id: 'reservation_detail', event: 'update', interval_ms: 1_000, skip_if_running: true }, position: { x: 340, y: 60 } },
      { id: 'event-detail-exit', type: 'screen_exit', label: '스터디룸 예약 상세 / 화면 이탈', config: { screen_id: 'reservation_detail', event: 'exit' }, position: { x: 600, y: 60 } },
    ],
    edges: [],
    functions: [],
    variables: [],
    metadata: {},
  }
}
