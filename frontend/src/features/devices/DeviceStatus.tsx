import { Tag } from '@blueprintjs/core'
import { relativeLastSeen } from './format'
import type { AndroidDeviceSummary } from './types'

function connectionLabel(device: AndroidDeviceSummary): string {
  const error = device.last_error?.toLowerCase() ?? ''
  if (
    !device.connected &&
    (error.includes('auth') || error.includes('unauthorized') || error.includes('401'))
  ) {
    return 'Authentication error'
  }
  return device.connected ? 'Connected' : 'Offline'
}

export function DeviceStatus({ device }: { device: AndroidDeviceSummary }) {
  return (
    <div className="device-status">
      <Tag intent={device.connected ? 'success' : 'danger'} minimal>
        {connectionLabel(device)}
      </Tag>
      <span>{relativeLastSeen(device.last_seen_at)}</span>
      <span>{device.source === 'manual' ? 'Manual' : 'Automatic'}</span>
    </div>
  )
}
