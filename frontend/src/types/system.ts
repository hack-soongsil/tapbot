export interface BackendSystemStatus {
  robot: string
  robot_connected: boolean
  robot_mode: 'REAL' | 'DRY-RUN'
  camera_opened: boolean
  camera_error: string | null
  android_configured: boolean
}

export type BackendConnectionState = 'connecting' | 'online' | 'offline'

export interface SystemStatusContextValue {
  backend: BackendSystemStatus | null
  backendState: BackendConnectionState
  backendError: string | null
  refresh: () => void
}
