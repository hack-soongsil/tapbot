import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { DebugPage } from '../pages/DebugPage'
import { DevicesPage } from '../pages/DevicesPage'
import { SettingsPage } from '../pages/SettingsPage'
import { RobotCameraPage } from '../pages/RobotCameraPage'
import { SystemStatusProvider } from './SystemStatusContext'

export function App() {
  return (
    <SystemStatusProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/debug" replace />} />
          <Route path="debug" element={<DevicesPage />} />
          <Route path="debug/android/:deviceId" element={<DebugPage />} />
          <Route path="tools/camera" element={<RobotCameraPage />} />
          <Route path="macros" element={<Navigate to="/debug" replace />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/debug" replace />} />
        </Route>
      </Routes>
    </SystemStatusProvider>
  )
}
