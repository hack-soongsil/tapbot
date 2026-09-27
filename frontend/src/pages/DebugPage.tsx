import { Callout, Spinner } from '@blueprintjs/core'
import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AndroidDebugWorkspace } from '../features/android/AndroidDebugWorkspace'
import { useAndroidDebug } from '../features/android/useAndroidDebug'
import {
  chooseInitialDevice,
  SELECTED_DEVICE_STORAGE_KEY,
  useDevices,
} from '../features/devices/hooks'

export function DebugPage() {
  const { deviceId: routeDeviceId } = useParams<{ deviceId: string }>()
  const navigate = useNavigate()
  const deviceList = useDevices()
  const selectedDeviceId =
    routeDeviceId && deviceList.devices.some((device) => device.id === routeDeviceId)
      ? routeDeviceId
      : null
  const controller = useAndroidDebug(selectedDeviceId)

  useEffect(() => {
    if (selectedDeviceId) {
      window.localStorage.setItem(SELECTED_DEVICE_STORAGE_KEY, selectedDeviceId)
    }
  }, [selectedDeviceId])

  useEffect(() => {
    if (deviceList.loading || selectedDeviceId || deviceList.devices.length === 0) return
    const remembered = window.localStorage.getItem(SELECTED_DEVICE_STORAGE_KEY)
    const next = chooseInitialDevice(deviceList.devices, routeDeviceId, remembered)
    if (next) {
      window.localStorage.setItem(SELECTED_DEVICE_STORAGE_KEY, next)
      void navigate(`/debug/android/${encodeURIComponent(next)}`, { replace: true })
    }
  }, [
    deviceList.devices,
    deviceList.loading,
    navigate,
    routeDeviceId,
    selectedDeviceId,
  ])

  if (deviceList.loading && deviceList.devices.length === 0) {
    return <Spinner size={36} />
  }

  const selectedDevice =
    deviceList.devices.find((device) => device.id === selectedDeviceId) ?? null

  return (
    <div className="vision-workspace-page android-editor-page">
      {selectedDevice ? (
        <AndroidDebugWorkspace controller={controller} />
      ) : (
        <Callout intent="primary" title="연결된 디바이스 없음">
          상단 디바이스 선택기에서 작업할 기기를 선택하거나 새로고침하세요.
        </Callout>
      )}
    </div>
  )
}
