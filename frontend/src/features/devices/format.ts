export function relativeLastSeen(value: string | null, now = Date.now()): string {
  if (!value) return '확인된 적 없음'
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return '마지막 확인 시각 알 수 없음'
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1_000))
  if (seconds < 10) return '방금 확인됨'
  if (seconds < 60) return `${seconds.toString()}초 전에 확인됨`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes.toString()}분 전에 확인됨`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours.toString()}시간 전에 확인됨`
  const days = Math.floor(hours / 24)
  return `${days.toString()}일 전에 확인됨`
}
