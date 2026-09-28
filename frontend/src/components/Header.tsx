import {
  Alignment,
  Navbar,
  NavbarDivider,
  NavbarGroup,
  NavbarHeading,
  Tag,
} from '@blueprintjs/core'
import { NavLink, useLocation } from 'react-router-dom'
import { useSystemStatus } from '../app/system-status'
import { SELECTED_DEVICE_STORAGE_KEY } from '../features/devices/hooks'

export function Header() {
  const system = useSystemStatus()
  const location = useLocation()
  const routeId = location.pathname.startsWith('/debug/android/')
    ? decodeURIComponent(location.pathname.slice('/debug/android/'.length))
    : null
  const rememberedDeviceId = window.localStorage.getItem(SELECTED_DEVICE_STORAGE_KEY)
  const debugDeviceId = routeId ?? rememberedDeviceId
  const debugTarget = debugDeviceId
    ? `/debug/android/${encodeURIComponent(debugDeviceId)}`
    : '/debug'

  return (
    <Navbar className="vision-navbar" fixedToTop>
      <NavbarGroup align={Alignment.LEFT}>
        <NavbarHeading className="vision-navbar__brand">TAPBOT</NavbarHeading>
        <NavbarDivider />
        <nav className="vision-navbar__links" aria-label="디버그 도구">
          <NavLink to="/debug" end>디바이스</NavLink>
          <NavLink
            to={debugTarget}
            className={location.pathname.startsWith('/debug/android/') ? 'active' : undefined}
          >
            안드로이드 디버그
          </NavLink>
          <NavLink to="/tools/camera">로봇 카메라</NavLink>
        </nav>
      </NavbarGroup>
      <NavbarGroup align={Alignment.RIGHT} className="vision-navbar__status">
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
      </NavbarGroup>
    </Navbar>
  )
}
