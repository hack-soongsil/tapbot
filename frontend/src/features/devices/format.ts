export function relativeLastSeen(value: string | null, now = Date.now()): string {
  if (!value) return 'Never seen'
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return 'Last seen unknown'
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1_000))
  if (seconds < 10) return 'Last seen just now'
  if (seconds < 60) return `Last seen ${seconds.toString()} sec ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `Last seen ${minutes.toString()} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Last seen ${hours.toString()} hr ago`
  const days = Math.floor(hours / 24)
  return `Last seen ${days.toString()} day${days === 1 ? '' : 's'} ago`
}
