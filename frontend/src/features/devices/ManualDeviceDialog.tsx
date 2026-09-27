import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  FormGroup,
  InputGroup,
} from '@blueprintjs/core'
import { useState } from 'react'
import type { FormEvent } from 'react'
import type { ManualDeviceInput } from './types'

interface ManualDeviceDialogProps {
  isOpen: boolean
  onClose: () => void
  onAdd: (input: ManualDeviceInput) => Promise<void>
}

export function ManualDeviceDialog({
  isOpen,
  onClose,
  onAdd,
}: ManualDeviceDialogProps) {
  const [name, setName] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = () => {
    setName('')
    setEndpoint('')
    setToken('')
    setError(null)
    onClose()
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await onAdd({
        name: name.trim(),
        endpoint: endpoint.trim(),
        ...(token ? { token } : {}),
      })
      close()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not add device.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog isOpen={isOpen} onClose={close} title="Add manual device">
      <form onSubmit={(event) => void submit(event)}>
        <DialogBody>
          <p className="device-dialog-copy">
            Use this fallback only when automatic discovery is unavailable.
          </p>
          <FormGroup label="Name" labelFor="manual-device-name">
            <InputGroup
              id="manual-device-name"
              value={name}
              required
              autoComplete="off"
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </FormGroup>
          <FormGroup label="Endpoint URL" labelFor="manual-device-endpoint">
            <InputGroup
              id="manual-device-endpoint"
              value={endpoint}
              required
              type="url"
              placeholder="http://device:8765"
              autoComplete="url"
              onChange={(event) => setEndpoint(event.currentTarget.value)}
            />
          </FormGroup>
          <FormGroup
            label="Agent token (optional)"
            labelFor="manual-device-token"
            helperText="Leave blank to use the token configured on the backend."
          >
            <InputGroup
              id="manual-device-token"
              value={token}
              type="password"
              autoComplete="new-password"
              onChange={(event) => setToken(event.currentTarget.value)}
            />
          </FormGroup>
          {error && <p className="device-dialog-error">{error}</p>}
        </DialogBody>
        <DialogFooter
          actions={
            <>
              <Button onClick={close} disabled={saving}>
                Cancel
              </Button>
              <Button intent="primary" type="submit" loading={saving}>
                Add device
              </Button>
            </>
          }
        />
      </form>
    </Dialog>
  )
}
