import { useEffect, useRef, useState } from 'react'
import { sequenceApi } from './sequence-api'
import {
  emptySequence,
  sequenceError,
  type SequenceDefinition,
  type SequenceRuntime,
  type SequenceStep,
} from './sequence-model'

function readDraft(
  deviceId: string,
  width: number,
  height: number,
  rotation: number,
): SequenceDefinition {
  try {
    const raw = window.localStorage.getItem(`tapbot.sequence.draft.${deviceId}`)
    if (raw) {
      const parsed = JSON.parse(raw) as SequenceDefinition
      if (
        parsed.version === 1 &&
        typeof parsed.id === 'string' &&
        Array.isArray(parsed.steps)
      )
        return parsed
    }
  } catch {
    /* An unavailable draft must not prevent editing. */
  }
  return emptySequence(width, height, rotation)
}

export function useSequenceEditor(
  deviceId: string | null,
  width: number,
  height: number,
  rotation: number,
) {
  const [state, setState] = useState(() => ({
    deviceId,
    definition: readDraft(deviceId ?? '', width, height, rotation),
  }))
  const [presets, setPresets] = useState<SequenceDefinition[]>([])
  const [runtime, setRuntime] = useState<SequenceRuntime | null>(null)
  const [captureDevice, setCaptureDevice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const generation = useRef(0)
  const commandVersion = useRef(0)
  const definition = state.definition
  const current = state.deviceId === deviceId
  const active =
    current &&
    runtime !== null &&
    ['RUNNING', 'PAUSED', 'STOPPING'].includes(runtime.status)
  const capture =
    current && captureDevice !== null && captureDevice === deviceId && !active

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setState((previous) =>
        previous.deviceId === deviceId
          ? previous
          : {
              deviceId,
              definition: readDraft(deviceId ?? '', width, height, rotation),
            },
      )
    }, 0)
    return () => window.clearTimeout(timer)
  }, [deviceId, width, height, rotation])

  useEffect(() => {
    if (!current || !deviceId) return
    try {
      window.localStorage.setItem(
        `tapbot.sequence.draft.${deviceId}`,
        JSON.stringify(definition),
      )
    } catch {
      /* Server save remains available when browser storage is unavailable. */
    }
  }, [current, definition, deviceId])

  useEffect(() => {
    generation.current += 1
    const controller = new AbortController()
    let polling = false
    const reset = window.setTimeout(() => {
      setRuntime(null)
      setCaptureDevice(null)
      setMessage(null)
      setBusy(false)
    }, 0)
    void sequenceApi
      .list(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setPresets(result.sequences)
      })
      .catch(() => {
        /* A failed fetch does not destroy a local draft. */
      })
    const poll = async () => {
      if (!deviceId || polling || controller.signal.aborted) return
      polling = true
      const version = commandVersion.current
      try {
        const next = await sequenceApi.runtime(deviceId, controller.signal)
        if (!controller.signal.aborted && version === commandVersion.current)
          setRuntime(next)
      } catch {
        /* Commands show actionable errors; reconnect polling continues. */
      } finally {
        polling = false
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 750)
    return () => {
      controller.abort()
      window.clearInterval(timer)
      window.clearTimeout(reset)
    }
  }, [deviceId])

  const edit = (transform: (value: SequenceDefinition) => SequenceDefinition) => {
    if (!current || active || busy) return
    setState((value) => ({ ...value, definition: transform(value.definition) }))
    setMessage(null)
  }
  const append = (step: SequenceStep) =>
    edit((value) => ({
      ...value,
      ...(value.steps.length === 0
        ? { screen_width: width, screen_height: height, rotation }
        : {}),
      steps: [...value.steps, step],
    }))
  const addPoint = (x: number, y: number) =>
    append({
      id: crypto.randomUUID(),
      label: `좌표 ${Math.round(x)}, ${Math.round(y)}`,
      kind: 'point',
      x: Math.round(x),
      y: Math.round(y),
      duration_ms: 70,
      delay_ms: 500,
    })
  const operation = async (work: (isCurrent: () => boolean) => Promise<void>) => {
    if (!deviceId || !current || busy) return
    const epoch = generation.current
    commandVersion.current += 1
    setBusy(true)
    setMessage(null)
    setFailed(false)
    try {
      await work(() => epoch === generation.current)
    } catch (error) {
      if (epoch === generation.current) {
        setMessage(error instanceof Error ? error.message : String(error))
        setFailed(true)
      }
    } finally {
      if (epoch === generation.current) setBusy(false)
    }
  }
  const save = async (isCurrent: () => boolean) => {
    const error = sequenceError(definition)
    if (error) throw new Error(error)
    const saved = await sequenceApi.save(definition)
    if (isCurrent())
      setPresets((values) => [
        ...values.filter((value) => value.id !== saved.id),
        saved,
      ])
    return saved
  }

  return {
    definition,
    presets,
    runtime: current ? runtime : null,
    active,
    capture,
    busy,
    message,
    failed,
    edit,
    append,
    addPoint,
    setCapture: (value: boolean) => setCaptureDevice(value ? deviceId : null),
    load: (id: string) =>
      edit(() => presets.find((value) => value.id === id) ?? definition),
    create: () => edit(() => emptySequence(width, height, rotation)),
    save: () =>
      operation(async (isCurrent) => {
        await save(isCurrent)
        if (isCurrent()) setMessage('프리셋을 PC에 저장했습니다.')
      }),
    start: () =>
      operation(async (isCurrent) => {
        const saved = await save(isCurrent)
        if (!isCurrent()) return
        setCaptureDevice(null)
        const next = await sequenceApi.start(deviceId ?? '', saved)
        if (isCurrent()) {
          setRuntime(next)
          setMessage('프리셋 실행을 시작했습니다.')
        }
      }),
    command: (command: 'pause' | 'resume' | 'stop') =>
      operation(async (isCurrent) => {
        const next = await sequenceApi.command(deviceId ?? '', command)
        if (isCurrent()) setRuntime(next)
      }),
  }
}

export type SequenceEditor = ReturnType<typeof useSequenceEditor>
