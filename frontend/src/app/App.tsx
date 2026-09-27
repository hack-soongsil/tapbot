import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { DebugPage } from '../pages/DebugPage'
import { SettingsPage } from '../pages/SettingsPage'
import { RobotCameraPage } from '../pages/RobotCameraPage'
import { MacroEditorPage } from '../features/macro-editor/MacroEditorPage'
import { SystemStatusProvider } from './SystemStatusContext'

export function App() {
  return (
    <SystemStatusProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/debug" replace />} />
          <Route path="debug" element={<DebugPage />} />
          <Route path="debug/android/:deviceId" element={<DebugPage />} />
          <Route path="tools/camera" element={<RobotCameraPage />} />
          <Route path="macros" element={<MacroEditorPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/debug" replace />} />
        </Route>
      </Routes>
    </SystemStatusProvider>
  )
}
