import type { AndroidUiNode } from '../../types/android-debug'

export interface ElementSelector {
  view_id?: string
  text?: string
  content_description?: string
  time_slot?: string
}

export interface SequenceStep {
  id: string
  label: string
  kind: 'point' | 'element' | 'checkpoint'
  x?: number
  y?: number
  selector?: ElementSelector
  package_name?: string
  required_text?: string
  duration_ms: number
  delay_ms: number
  timeout_ms?: number
}

export interface SequenceDefinition {
  id: string
  name: string
  version: 1
  screen_width: number
  screen_height: number
  rotation: number
  repeat_count: number
  steps: SequenceStep[]
  booking_ranges?:
    | [
        { start_time: string; end_time: string },
        { start_time: string; end_time: string },
      ]
    | null
}

export interface SequenceRuntime {
  status: 'IDLE' | 'RUNNING' | 'PAUSED' | 'STOPPING' | 'STOPPED' | 'COMPLETED' | 'ERROR'
  sequence_id: string | null
  step_id: string | null
  completed_steps: number
  total_steps: number
  iteration: number
  repeat_count: number
  error: string | null
  outcome_unknown: boolean
  pause_reason?: string | null
}

export function selectorForNode(node: AndroidUiNode): ElementSelector | null {
  if (node.password) return null
  const selector: ElementSelector = {}
  if (node.view_id_resource_name) selector.view_id = node.view_id_resource_name
  if (node.text?.trim()) selector.text = node.text
  else if (node.content_description?.trim())
    selector.content_description = node.content_description
  return Object.keys(selector).length ? selector : null
}

export function emptySequence(
  width: number,
  height: number,
  rotation: number,
): SequenceDefinition {
  return {
    id: `preset-${crypto.randomUUID()}`,
    name: '새 클릭 프리셋',
    version: 1,
    screen_width: width,
    screen_height: height,
    rotation,
    repeat_count: 1,
    steps: [],
  }
}

export function sequenceError(value: SequenceDefinition): string | null {
  if (!value.name.trim()) return '프리셋 이름을 입력하세요.'
  if (
    !Number.isInteger(value.repeat_count) ||
    value.repeat_count < 1 ||
    value.repeat_count > 1000
  )
    return '반복 횟수는 1~1000 사이의 정수여야 합니다.'
  if (!value.steps.length) return '클릭할 컴포넌트나 좌표를 먼저 추가하세요.'
  if (value.steps.length > 200) return '프리셋에는 최대 200개 단계를 넣을 수 있습니다.'
  if (value.booking_ranges) {
    for (const [index, range] of value.booking_ranges.entries()) {
      if (range.start_time >= range.end_time)
        return `${index + 1}번째 예약의 종료 시각은 시작 시각보다 늦어야 합니다.`
    }
  }
  for (const step of value.steps) {
    if (!step.label.trim()) return '각 단계의 이름을 입력하세요.'
    if (!Number.isInteger(step.delay_ms) || step.delay_ms < 0 || step.delay_ms > 600000)
      return `${step.label}: 대기 시간은 0~600000ms 사이의 정수여야 합니다.`
    if (
      !Number.isInteger(step.duration_ms) ||
      step.duration_ms < 1 ||
      step.duration_ms > 10000
    )
      return `${step.label}: 클릭 시간은 1~10000ms 사이의 정수여야 합니다.`
    if (
      step.kind === 'point' &&
      (step.x === undefined ||
        step.y === undefined ||
        !Number.isFinite(step.x) ||
        !Number.isFinite(step.y) ||
        step.x < 0 ||
        step.y < 0 ||
        step.x >= value.screen_width ||
        step.y >= value.screen_height)
    )
      return `${step.label}: 화면 안의 좌표를 지정하세요.`
    if (step.kind === 'element' && !step.selector)
      return `${step.label}: UI 선택자가 없습니다.`
  }
  return null
}

export function updateBookingRange(
  value: SequenceDefinition,
  index: number,
  key: 'start_time' | 'end_time',
  time: string,
): SequenceDefinition {
  if (!value.booking_ranges) return value
  const ranges = value.booking_ranges.map((range, position) =>
    position === index ? { ...range, [key]: time } : range,
  ) as NonNullable<SequenceDefinition['booking_ranges']>
  const range = ranges[index]!
  const number = index + 1
  const [hour, minute] = range.end_time.split(':').map(Number)
  const last = hour! * 60 + minute! - 30
  const lastSlot = `${String(Math.floor(last / 60)).padStart(2, '0')}:${String(last % 60).padStart(2, '0')}`
  const selected = `${range.start_time} ~ ${range.end_time}`
  return {
    ...value,
    booking_ranges: ranges,
    steps: value.steps.map((step) => {
      if (step.id === `start-${number}`)
        return {
          ...step,
          label: `${range.start_time} 시작 칸`,
          selector: { time_slot: range.start_time },
        }
      if (step.id === `end-${number}`)
        return {
          ...step,
          label: `${lastSlot} 마지막 칸 (${range.end_time} 종료)`,
          selector: { time_slot: lastSlot },
        }
      if (step.id === `submit-${number}` || step.id === `confirm-${number}`)
        return {
          ...step,
          label: `${selected} · ${step.selector?.text ?? ''}`,
          required_text: selected,
        }
      return step
    }),
  }
}

export function moveStep(
  steps: SequenceStep[],
  id: string,
  offset: number,
): SequenceStep[] {
  const from = steps.findIndex((step) => step.id === id)
  const to = from + offset
  if (from < 0 || to < 0 || to >= steps.length) return steps
  const next = [...steps]
  ;[next[from], next[to]] = [next[to]!, next[from]!]
  return next
}
