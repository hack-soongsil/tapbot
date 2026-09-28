import { Callout } from '@blueprintjs/core'
import { Link, useParams } from 'react-router-dom'
import { AndroidDebugWorkspace } from '../features/android/AndroidDebugWorkspace'
import { useAndroidDebug } from '../features/android/useAndroidDebug'

export function DebugPage() {
  const { deviceId: routeDeviceId } = useParams<{ deviceId: string }>()
  const deviceId = routeDeviceId ?? null
  const controller = useAndroidDebug(deviceId)

  return (
    <div className="vision-workspace-page android-editor-page">
      {deviceId ? (
        <AndroidDebugWorkspace controller={controller} />
      ) : (
        <Callout intent="primary" title="디바이스를 선택하세요">
          <Link to="/debug">디바이스 탭</Link>에서 작업할 기기를 선택하세요.
        </Callout>
      )}
    </div>
  )
}
