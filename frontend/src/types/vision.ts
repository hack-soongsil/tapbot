export interface VisionBoundingBox {
  x: number
  y: number
  width: number
  height: number
}

export interface VisionPoint {
  x: number
  y: number
}

export interface VisionDetection {
  id: string
  label: string
  bbox: VisionBoundingBox
  center: VisionPoint
  confidence: number
  detector_type: string
  detector_name: string
}
