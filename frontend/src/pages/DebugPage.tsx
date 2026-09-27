import { Callout, Spinner } from '@blueprintjs/core'
import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AndroidDebugWorkspace } from '../features/android/AndroidDebugWorkspace'
import { useAndroidDebug } from '../features/android/useAndroidDebug'
import { DeviceSelector } from '../features/devices/DeviceSelector'
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
    if (deviceList.loading || selectedDeviceId || deviceList.devices.length === 0) return
    const remembered = window.localStorage.getItem(SELECTED_DEVICE_STORAGE_KEY)
    const next = chooseInitialDevice(deviceList.devices, routeDeviceId, remembered)
    if (next) {
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

  const selectDevice = (deviceId: string) => {
    window.localStorage.setItem(SELECTED_DEVICE_STORAGE_KEY, deviceId)
    void navigate(`/debug/android/${encodeURIComponent(deviceId)}`)
  }

  const selectedDevice =
    deviceList.devices.find((device) => device.id === selectedDeviceId) ?? null

  return (
    <div className="vision-workspace-page android-editor-page">
      <DeviceSelector
        devices={deviceList.devices}
        selectedDeviceId={selectedDeviceId}
        discovering={deviceList.discovering}
        message={deviceList.error}
        detail={deviceList.detail}
        onSelect={selectDevice}
        onRefresh={deviceList.refresh}
        onAddManual={async (input) => {
          const device = await deviceList.addManual(input)
          selectDevice(device.id)
        }}
      />
      {selectedDevice && !selectedDevice.connected && (
        <Callout intent="warning" title={`${selectedDevice.name} is offline`}>
          The device remains selected. Refresh discovery or choose another device.
        </Callout>
      )}
      {selectedDevice ? (
        <AndroidDebugWorkspace controller={controller} />
      ) : (
        <Callout intent="primary" title="Select a device">
          {deviceList.devices.length > 1
            ? 'Choose an available Android device to open the debug workspace.'
            : 'Refresh automatic discovery or use Advanced to add a manual device.'}
        </Callout>
      )}
    </div>
  )
}
