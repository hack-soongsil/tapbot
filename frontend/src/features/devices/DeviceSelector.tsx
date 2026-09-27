import { Button, Callout, Card, Collapse } from '@blueprintjs/core'
import { useState } from 'react'
import { DeviceStatus } from './DeviceStatus'
import { ManualDeviceDialog } from './ManualDeviceDialog'
import type { AndroidDeviceSummary, ManualDeviceInput } from './types'

interface DeviceSelectorProps {
  devices: AndroidDeviceSummary[]
  selectedDeviceId: string | null
  discovering: boolean
  message: string | null
  detail: string | null
  onSelect: (deviceId: string) => void
  onRefresh: () => Promise<void>
  onAddManual: (input: ManualDeviceInput) => Promise<void>
}

export function DeviceSelector({
  devices,
  selectedDeviceId,
  discovering,
  message,
  detail,
  onSelect,
  onRefresh,
  onAddManual,
}: DeviceSelectorProps) {
  const [advanced, setAdvanced] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)

  return (
    <Card className="device-selector-card" compact>
      <div className="device-selector-heading">
        <div>
          <span>Nearby and configured</span>
          <h2>Devices</h2>
        </div>
        <div className="device-selector-actions">
          {discovering && <span className="device-discovering">Discovering…</span>}
          <Button
            icon="refresh"
            loading={discovering}
            disabled={discovering}
            onClick={() => void onRefresh()}
          >
            Refresh
          </Button>
          <Button minimal onClick={() => setAdvanced((value) => !value)}>
            Advanced
          </Button>
        </div>
      </div>

      {devices.length > 0 ? (
        <div className="device-list" role="list" aria-label="Android devices">
          {devices.map((device) => (
            <button
              type="button"
              role="listitem"
              className={`device-list-item${device.id === selectedDeviceId ? ' is-selected' : ''}`}
              aria-pressed={device.id === selectedDeviceId}
              key={device.id}
              onClick={() => onSelect(device.id)}
            >
              <strong>{device.name}</strong>
              <DeviceStatus device={device} />
            </button>
          ))}
        </div>
      ) : (
        <p className="device-empty">No TapBot devices found.</p>
      )}

      {message && (
        <Callout className="device-discovery-message" intent="warning" compact>
          {message}
        </Callout>
      )}

      <Collapse isOpen={advanced}>
        <div className="device-advanced">
          <strong>Automatic discovery setup</strong>
          <ol>
            <li>Install Tailscale on this PC and the Android device.</li>
            <li>Sign in to the same tailnet.</li>
            <li>Start TapBot Agent on Android.</li>
            <li>Refresh this device list.</li>
          </ol>
          {detail && (
            <details>
              <summary>Technical details</summary>
              <code>{detail}</code>
            </details>
          )}
          <Button icon="add" onClick={() => setManualOpen(true)}>
            Add manual device
          </Button>
        </div>
      </Collapse>

      <ManualDeviceDialog
        isOpen={manualOpen}
        onClose={() => setManualOpen(false)}
        onAdd={onAddManual}
      />
    </Card>
  )
}
