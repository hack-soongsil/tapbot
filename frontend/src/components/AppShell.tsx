import { Classes } from '@blueprintjs/core'
import { Outlet, useLocation } from 'react-router-dom'
import { Header } from './Header'

export function AppShell() {
  const location = useLocation()
  const isFullWorkspace = location.pathname.startsWith('/debug/android/')

  return (
    <div
      className={`${Classes.DARK} app-shell vision-app-shell${isFullWorkspace ? ' is-debug-route' : ''}`}
    >
      <Header />
      <main className="route-content">
        <Outlet />
      </main>
    </div>
  )
}
