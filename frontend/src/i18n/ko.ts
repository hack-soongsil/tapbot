import type {
  MacroNodeCategory,
  MacroNodeType,
  PortType,
} from '../features/macro-editor/types'

export const ko = {
  panels: {
    androidRemoteDebug: '안드로이드 원격 디버그',
    androidLiveScreen: '안드로이드 실시간 화면',
    macroCanvas: '매크로 캔버스',
    uiTree: 'UI 트리',
    uiTreeHierarchy: 'UI 트리 계층',
    nodeInspector: '노드 인스펙터',
    console: '콘솔',
    system: '시스템',
    userDebug: '사용자 디버그',
  },
  actions: {
    newMacro: '새 매크로',
    loadDraft: '초안 불러오기',
    duplicate: '복제',
    validate: '검증',
    fitView: '화면 맞춤',
    save: '저장',
    run: '실행',
    pause: '일시정지',
    resume: '계속',
    step: '한 단계 실행',
    stop: '중지',
    reset: '초기화',
  },
  quickSearch: {
    label: '빠른 블록 검색',
    inputLabel: '매크로 블록 검색',
    placeholder: '블록 검색...',
    recent: '최근 사용',
    results: '검색 결과',
    empty: '검색 결과가 없습니다',
  },
  inspector: {
    configuration: '노드 설정',
    empty: '설정할 노드를 선택하세요.',
    label: '표시 이름',
    nodeId: '노드 ID',
    text: '텍스트',
    uiTreePath: 'UI 트리 경로',
    clickSamplingMode: '클릭 샘플링 방식',
    screen: '화면',
    element: '엘리먼트',
    index: '인덱스',
    name: '이름',
    type: '타입',
    defaultValue: '기본값',
  },
} as const

export const macroCategoryLabels: Record<MacroNodeCategory, string> = {
  event: '이벤트',
  ui: 'UI',
  action: '동작',
  condition: '조건',
  control: '흐름 제어',
  validation: '검증',
  utility: '유틸리티',
}

export const macroNodeLabels: Record<MacroNodeType, string> = {
  screen_enter: '화면 진입',
  screen_update: '화면 업데이트',
  screen_exit: '화면 이탈',
  function_entry: '함수 시작',
  function_return: '함수 반환',
  call_function: '함수 호출',
  set_variable: '변수 설정',
  get_variable: '변수 가져오기',
  debug_print: '디버그 출력',
  click_point: '위치 클릭',
  drag_point: '위치 드래그',
  random_click_area: '영역 랜덤 클릭',
  random_drag_area: '영역 랜덤 드래그',
  click_element: '엘리먼트 클릭',
  find_screen_element: '화면 엘리먼트 찾기',
  click_screen_element: '화면 엘리먼트 클릭',
  for_loop: 'For 반복',
  sequence: '순차 실행',
  tap_element: '엘리먼트 탭',
  tap_point: '위치 탭',
  swipe: '스와이프',
  back: '뒤로',
  home: '홈',
  wait: '대기',
  find_element: '엘리먼트 찾기',
  require_element: '엘리먼트 필수 확인',
  read_ui_tree: 'UI 트리 읽기',
  element_exists: '엘리먼트 존재 여부',
  element_text_equals: '엘리먼트 텍스트 비교',
  state_equals: '상태 비교',
  branch: '분기',
  retry: '재시도',
  repeat: '반복',
  timeout: '시간 제한',
  stop: '중지',
  wait_for_element: '엘리먼트 대기',
  wait_for_state: '상태 대기',
  assert_element: '엘리먼트 검증',
}

export const macroNodeDescriptions: Partial<Record<MacroNodeType, string>> = {
  call_function: '재사용 가능한 사용자 함수 그래프를 실행합니다.',
  set_variable: '현재 실행 범위에 타입이 지정된 값을 저장합니다.',
  get_variable: '현재 실행 범위의 변수 값을 가져옵니다.',
  debug_print: '사용자 디버그 콘솔에 값이나 메시지를 출력합니다.',
  click_point: '화면의 지정 좌표를 클릭합니다.',
  drag_point: '두 화면 좌표 사이를 드래그합니다.',
  random_click_area: '지정 영역 안에서 좌표를 샘플링해 클릭합니다.',
  random_drag_area: '시작·끝 영역에서 각각 좌표를 샘플링해 드래그합니다.',
  click_element: 'UI 트리 엘리먼트를 찾아 클릭합니다.',
  find_screen_element: '현재 화면에서 의미 기반 엘리먼트를 찾습니다.',
  for_loop: '인덱스 변수를 갱신하며 흐름을 반복합니다.',
  sequence: '출력 흐름을 순서대로 실행합니다.',
}

const legacyNodeLabels = new Map<string, string>([
  ['Screen Enter', '화면 진입'], ['Screen Update', '화면 업데이트'],
  ['Screen Exit', '화면 이탈'], ['Function Entry', '함수 시작'],
  ['Function Return', '함수 반환'], ['Call Function', '함수 호출'],
  ['Set Variable', '변수 설정'], ['Get Variable', '변수 가져오기'],
  ['Debug Print', '디버그 출력'], ['Click Point', '위치 클릭'],
  ['Drag Point', '위치 드래그'], ['Random Click Area', '영역 랜덤 클릭'],
  ['Random Drag Area', '영역 랜덤 드래그'], ['Find Element', '엘리먼트 찾기'],
  ['Find Screen Element', '화면 엘리먼트 찾기'], ['Click Element', '엘리먼트 클릭'],
  ['Element Exists', '엘리먼트 존재 여부'], ['For', 'For 반복'],
  ['Branch', '분기'], ['Sequence', '순차 실행'], ['Wait', '대기'],
  ['Retry', '재시도'], ['Stop', '중지'], ['Repeat', '반복'],
  ['Back', '뒤로'], ['Home', '홈'], ['Swipe', '스와이프'],
  ['Tap Element', '엘리먼트 탭'], ['Tap Point', '위치 탭'],
  ['Find Element', '엘리먼트 찾기'], ['Require Element', '엘리먼트 필수 확인'],
  ['Read UI Tree', 'UI 트리 읽기'], ['Wait For Element', '엘리먼트 대기'],
  ['Wait For State', '상태 대기'], ['Assert Element', '엘리먼트 검증'],
])

export function localizeNodeLabel(label: string, type: MacroNodeType) {
  const legacyScreenEvent = /^(Reservation Home|Reservation Detail) \/ (Enter|Update|Exit)$/.exec(label)
  if (legacyScreenEvent) {
    const screen = legacyScreenEvent[1] === 'Reservation Home'
      ? '스터디룸 예약 메인'
      : '스터디룸 예약 상세'
    const event = legacyScreenEvent[2] === 'Enter'
      ? '화면 진입'
      : legacyScreenEvent[2] === 'Update' ? '화면 업데이트' : '화면 이탈'
    return `${screen} / ${event}`
  }
  return legacyNodeLabels.get(label) ?? (label === type ? macroNodeLabels[type] : label)
}

const portLabels: Record<string, string> = {
  exec: '실행', exec_in: '실행', exec_out: '실행',
  true: '참', false: '거짓', loop: '반복', completed: '완료',
  index: '인덱스', element: '엘리먼트', found: '찾음', missing: '없음',
  value: '값', result: '결과', condition: '조건', position: '위치',
  sampled_position: '샘플 위치', sampled_start: '시작 위치', sampled_end: '종료 위치',
  start: '시작', end: '끝', retry: '재시도', exhausted: '재시도 소진',
  repeat: '반복', done: '완료', within: '제한 내', expired: '만료',
  timeout: '시간 초과', matched: '일치',
}

export function macroPortLabel(id: string) {
  const sequence = /^then_(\d+)$/.exec(id)
  if (sequence) return `다음 ${sequence[1]}`
  return portLabels[id] ?? id.replaceAll('_', ' ')
}

export const portTypeLabels: Record<PortType, string> = {
  exec: '실행', any: '모든 타입', bool: '불리언', int: '정수', float: '실수',
  string: '문자열', position: '위치', rect: '영역', element: '엘리먼트',
}

export const runtimeStateLabels: Record<string, string> = {
  idle: '대기', running: '실행 중', paused: '일시정지', completed: '완료',
  stopped: '중지됨', error: '오류', pending: '대기', success: '성공',
  failure: '실패', skipped: '건너뜀',
}

export const eventKindLabels: Record<string, string> = {
  enter: '진입', update: '업데이트', exit: '이탈',
}
