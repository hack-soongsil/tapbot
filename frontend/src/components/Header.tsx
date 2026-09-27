import {
  Alignment,
  Button,
  Navbar,
  NavbarDivider,
  NavbarGroup,
  NavbarHeading,
  Tag,
} from '@blueprintjs/core'
import { useEffect, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useSystemStatus } from '../app/system-status'
import { devicesApi } from '../features/devices/api'
import { SELECTED_DEVICE_STORAGE_KEY } from '../features/devices/hooks'
import type { AndroidDeviceSummary } from '../features/devices/types'

export function Header() {
  const system = useSystemStatus()
  const location = useLocation()
  const navigate = useNavigate()
  const [devices, setDevices] = useState<AndroidDeviceSummary[]>([])
  const [refreshingDevices, setRefreshingDevices] = useState(false)
  const [deviceRefreshError, setDeviceRefreshError] = useState<string | null>(null)
  const isAndroidWorkspace = location.pathname.startsWith('/debug')
  const routeId = location.pathname.startsWith('/debug/android/')
    ? decodeURIComponent(location.pathname.slice('/debug/android/'.length))
    : null
  const android = devices.find((device) => device.id === routeId) ?? null

  useEffect(() => {
    const controller = new AbortController()
    const refresh = async () => {
      try {
        const response = await devicesApi.list(controller.signal)
        setDevices(response.devices)
        setDeviceRefreshError(null)
      } catch {
        if (!controller.signal.aborted) setDeviceRefreshError('기기 목록을 갱신하지 못했습니다.')
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 7_500)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [location.pathname])

  const refreshDevices = async () => {
    setRefreshingDevices(true)
    setDeviceRefreshError(null)
    try {
      const response = await devicesApi.refresh()
      setDevices(response.devices)
      if (!response.devices.some((device) => device.id === routeId)) {
        const remembered = window.localStorage.getItem(SELECTED_DEVICE_STORAGE_KEY)
        const next = response.devices.find((device) => device.id === remembered)
          ?? response.devices.find((device) => device.connected)
        if (next) selectDevice(next.id)
      }
    } catch {
      setDeviceRefreshError('기기 목록을 갱신하지 못했습니다.')
    } finally {
      setRefreshingDevices(false)
    }
  }

  const selectDevice = (deviceId: string) => {
    if (!deviceId) return
    window.localStorage.setItem(SELECTED_DEVICE_STORAGE_KEY, deviceId)
    void navigate(`/debug/android/${encodeURIComponent(deviceId)}`)
  }

  const workspace = location.pathname.startsWith('/tools/camera')
    ? '로봇 카메라'
    : '안드로이드 디버그'

  return (
    <Navbar className="vision-navbar" fixedToTop>
      <NavbarGroup align={Alignment.LEFT}>
        <NavbarHeading className="vision-navbar__brand">TAPBOT</NavbarHeading>
        <NavbarDivider />
        <span className="vision-navbar__workspace">{workspace}</span>
        <nav className="vision-navbar__links" aria-label="디버그 도구">
          <NavLink to="/debug">안드로이드</NavLink>
          <NavLink to="/tools/camera">로봇 카메라</NavLink>
        </nav>
      </NavbarGroup>
      <NavbarGroup align={Alignment.RIGHT} className="vision-navbar__status">
        {isAndroidWorkspace && (
          <div className="vision-navbar__device-selector">
            <label htmlFor="header-device-selector">디바이스</label>
            <select
              id="header-device-selector"
              aria-label="작업 디바이스"
              value={android?.id ?? ''}
              title={deviceRefreshError ?? undefined}
              onChange={(event) => selectDevice(event.target.value)}
            >
              <option value="" disabled>
                {devices.some((device) => device.connected)
                  ? '디바이스 선택…'
                  : '연결된 디바이스 없음'}
              </option>
              {devices.map((device) => {
                const shortId = device.id === device.name ? '' : ` · ${device.id.slice(0, 12)}`
                return (
                  <option key={device.id} value={device.id}>
                    {device.name}{shortId} · {device.connected ? '● 온라인' : '○ 오프라인'}
                  </option>
                )
              })}
            </select>
            <Button
              minimal
              small
              icon="refresh"
              aria-label="기기 새로고침"
              loading={refreshingDevices}
              disabled={refreshingDevices}
              onClick={() => void refreshDevices()}
            />
          </div>
        )}
        <span>백엔드</span>
        <Tag
          intent={
            system.backendState === 'online'
              ? 'success'
              : system.backendState === 'connecting'
                ? 'warning'
                : 'danger'
          }
          minimal
        >
          {system.backendState === 'online' ? '온라인' : system.backendState === 'connecting' ? '연결 중' : '오프라인'}
        </Tag>
        <span>안드로이드</span>
        <Tag intent={android?.connected ? 'success' : 'danger'} minimal>
          {android?.connected ? '온라인' : '오프라인'}
        </Tag>
        <span>스트림</span>
        <Tag intent={android?.stream_running ? 'success' : 'warning'} minimal>
          {android?.stream_running ? '실시간' : '꺼짐'}
        </Tag>
        <span>매크로</span>
        <Tag intent={android?.macro_status === 'RUNNING' ? 'success' : 'none'} minimal>
          {android?.macro_status ?? '대기'}
        </Tag>
      </NavbarGroup>
    </Navbar>
  )
}
