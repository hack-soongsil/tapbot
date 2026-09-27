import { EmptyState } from '../../components/EmptyState'
import { Panel } from '../../components/Panel'
import { CameraIcon } from '../../components/icons'
import { CameraSourceSelector } from '../camera/CameraSourceSelector'
import type { CameraStreamController } from '../camera/useCameraStream'

interface CameraPreviewPanelProps {
  camera: CameraStreamController
}

export function CameraPreviewPanel({ camera }: CameraPreviewPanelProps) {
  return (
    <Panel
      title="Robot Camera"
      eyebrow="Live hardware input"
      className="camera-panel"
      actions={
        <span className={camera.isConnected ? 'camera-connection is-connected' : 'camera-connection'}>
          {camera.isConnected ? 'Live' : 'Offline'}
        </span>
      }
    >
      <CameraSourceSelector camera={camera} />
      <div className="camera-stage">
        {camera.frame ? (
          <img
            src={camera.frame.objectUrl}
            alt={`Robot camera frame ${camera.frame.frameId.toString()}`}
          />
        ) : (
          <div className="preview-surface">
            <EmptyState
              icon={<CameraIcon />}
              title={camera.error ? 'Camera is unavailable' : 'Connecting to camera'}
              description={camera.error ?? 'Waiting for a frame from the robot camera.'}
            />
          </div>
        )}
        {camera.frame && camera.error && (
          <div className="stale-frame-message" role="status">
            <span>Connection lost · showing frame #{camera.frame.frameId}</span>
            <button type="button" onClick={camera.retry}>Retry</button>
          </div>
        )}
      </div>
      <div className="camera-footer">
        <span>Frame <strong>#{camera.frame?.frameId ?? '—'}</strong></span>
        <span>{camera.frame ? `${camera.frame.width.toString()} × ${camera.frame.height.toString()}` : '— × —'}</span>
        <span>{camera.fps ? `${camera.fps.toFixed(1)} FPS` : '— FPS'}</span>
      </div>
    </Panel>
  )
}
