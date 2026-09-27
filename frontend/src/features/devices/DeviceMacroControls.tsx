import { Button, ButtonGroup, Callout, Tag } from '@blueprintjs/core'
import { useEffect, useState } from 'react'
import { macroEditorApi } from '../macro-editor/api'
import type {
  DeviceMacroBinding,
  MacroDefinition,
  MacroRuntime,
} from '../macro-editor/types'

export function DeviceMacroControls({ deviceId }: { deviceId: string }) {
  const [macros, setMacros] = useState<MacroDefinition[]>([])
  const [binding, setBinding] = useState<DeviceMacroBinding | null>(null)
  const [sharedCount, setSharedCount] = useState(0)
  const [runtime, setRuntime] = useState<MacroRuntime | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void Promise.all([
      macroEditorApi.list(),
      macroEditorApi.binding(deviceId),
      macroEditorApi.runtime(deviceId),
    ]).then(([definitions, bindingResponse, runtimeResponse]) => {
      if (!active) return
      setMacros(definitions.macros)
      setBinding(bindingResponse.binding)
      setSharedCount(bindingResponse.shared_device_count)
      setRuntime(runtimeResponse.runtime)
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Macro settings are unavailable.')
    })
    return () => { active = false }
  }, [deviceId])

  const choose = async (macroId: string) => {
    setBusy(true)
    setError(null)
    try {
      if (!macroId) {
        await macroEditorApi.unbind(deviceId)
        setBinding(null)
        setSharedCount(0)
      } else {
        const response = await macroEditorApi.bind(deviceId, macroId)
        setBinding(response.binding)
        setSharedCount(response.shared_device_count)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update the macro binding.')
    } finally {
      setBusy(false)
    }
  }

  const command = async (name: 'start' | 'pause' | 'resume' | 'stop' | 'step' | 'reset') => {
    setBusy(true)
    setError(null)
    try {
      setRuntime((await macroEditorApi.command(deviceId, name)).runtime)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `Could not ${name} the macro.`)
    } finally {
      setBusy(false)
    }
  }

  const selected = macros.find((macro) => macro.id === binding?.macro_definition_id)
  const runtimeState = runtime?.state ?? 'idle'
  const active = runtimeState === 'running' || runtimeState === 'paused'
  const duplicate = async () => {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      const copy = await macroEditorApi.duplicate(selected.id, {
        name: `${selected.name} — ${deviceId}`,
      })
      const response = await macroEditorApi.bind(deviceId, copy.id)
      setMacros((current) => [...current, copy])
      setBinding(response.binding)
      setSharedCount(response.shared_device_count)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not duplicate the macro.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="device-macro-controls" aria-label="Device macro">
      <label>
        <span>Macro</span>
        <select
          aria-label="Device macro"
          value={binding?.macro_definition_id ?? ''}
          disabled={busy}
          onChange={(event) => void choose(event.target.value)}
        >
          <option value="">No macro</option>
          {macros.map((macro) => (
            <option key={macro.id} value={macro.id}>{macro.name} v{macro.version}</option>
          ))}
        </select>
      </label>
      {sharedCount > 1 && <Tag minimal intent="primary">Shared by {sharedCount} devices</Tag>}
      {runtime && <Tag minimal>{runtime.state}</Tag>}
      <ButtonGroup minimal>
        <Button
          disabled={!selected}
          onClick={() => {
            if (!selected) return
            window.location.assign(`/macros?device_id=${encodeURIComponent(deviceId)}&macro_id=${encodeURIComponent(selected.id)}`)
          }}
        >Edit</Button>
        <Button disabled={!selected || busy} onClick={() => void duplicate()}>Duplicate</Button>
        <Button disabled={!binding || busy || active} intent="success" onClick={() => void command('start')}>Run</Button>
        <Button disabled={!binding || busy || (runtimeState !== 'idle' && runtimeState !== 'paused')} onClick={() => void command('step')}>Step</Button>
        {runtime?.state === 'paused' ? (
          <Button disabled={busy} onClick={() => void command('resume')}>Resume</Button>
        ) : (
          <Button disabled={runtime?.state !== 'running' || busy} onClick={() => void command('pause')}>Pause</Button>
        )}
        <Button disabled={busy || !active} intent="danger" onClick={() => void command('stop')}>Stop</Button>
        <Button disabled={busy || !['error', 'stopped', 'completed'].includes(runtimeState)} onClick={() => void command('reset')}>Reset</Button>
      </ButtonGroup>
      {error && <Callout compact intent="danger">{error}</Callout>}
    </section>
  )
}
