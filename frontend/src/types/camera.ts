export interface CameraFrame {
  frameId: number
  width: number
  height: number
  capturedAt: string
  blob: Blob
  objectUrl: string
}

export type CameraSourceType = 'physical' | 'image' | 'video'

export interface CameraSourceMetadata {
  width: number
  height: number
  fps: number
  type: CameraSourceType
  name: string
  [key: string]: unknown
}

export interface CameraSourceDescriptor {
  id: string
  name: string
  type: CameraSourceType
  available: boolean
  metadata: CameraSourceMetadata
}

export interface CameraSourcesResponse {
  active_id: string
  sources: CameraSourceDescriptor[]
}

export interface CameraSourceStatus {
  source_id: string | null
  name: string | null
  type: CameraSourceType | null
  opened: boolean
  connected: boolean
  state: 'connected' | 'disconnected' | 'error'
  error: string | null
  metadata: CameraSourceMetadata | null
  discovery_completed: boolean
  frame_id?: number | null
}

export interface CameraSourceSelectionResponse {
  active_id: string
  metadata: CameraSourceMetadata
}
