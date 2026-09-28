import type { MacroStatus } from '../../types/android-debug'

export type DeviceSource = 'tailscale' | 'manual'
export type DeviceConnectionState = 'online' | 'offline' | 'stale'

export interface AndroidDeviceSummary {
  id: string
  name: string
  endpoint: string
  source: DeviceSource
  connected: boolean
  connection_state: DeviceConnectionState
  last_seen_at: string | null
  capture_ready: boolean
  stream_running: boolean
  /** Optional for compatibility with agents/backends that predate screen metrics. */
  screen_width?: number | null
  screen_height?: number | null
  stream_fps?: number | null
  accessibility_enabled: boolean
  remote_control_enabled: boolean
  macro_status: MacroStatus
  last_error: string | null
}

export interface AndroidDevicesResponse {
  devices: AndroidDeviceSummary[]
  default_device_id: string | null
}

export interface AndroidDiscoveryStatus {
  enabled: boolean
  provider: string
  tailscale_available: boolean
  last_refresh: string | null
  discovered_peer_count: number
  discovered_agent_count: number
  last_error: string | null
}

export interface AndroidDevicesRefreshResponse extends AndroidDevicesResponse {
  discovery: AndroidDiscoveryStatus
}

export interface ManualDeviceInput {
  name: string
  endpoint: string
  token?: string
}

export interface ManualDeviceResponse {
  device: AndroidDeviceSummary
}
