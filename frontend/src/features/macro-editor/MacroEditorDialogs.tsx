import { Checkbox, FormGroup, HTMLSelect, InputGroup, TextArea } from '@blueprintjs/core'
import { useId, useState } from 'react'
import { AppDialog } from '../../components/AppDialog'
import { BLUEPRINT_DATA_TYPES } from './blueprint-dnd'
import type {
  JsonValue,
  MacroFunctionPort,
  MacroVariableDefinition,
} from './types'

interface NameEditorDialogProps {
  title: string
  label: string
  initialValue?: string
  submitLabel: string
  existingNames?: readonly string[]
  busy?: boolean
  onCancel: () => void
  onSubmit: (name: string) => void | Promise<void>
}

export function NameEditorDialog({
  title,
  label,
  initialValue = '',
  submitLabel,
  existingNames = [],
  busy,
  onCancel,
  onSubmit,
}: NameEditorDialogProps) {
  const [name, setName] = useState(initialValue)
  const [error, setError] = useState('')
  const inputId = useId()

  const submit = async () => {
    const normalized = name.trim()
    if (!normalized) {
      setError(`${label}을 입력하세요.`)
      return
    }
    if (existingNames.includes(normalized)) {
      setError(`이미 존재하는 ${label}입니다.`)
      return
    }
    setError('')
    await onSubmit(normalized)
  }

  return (
    <AppDialog
      title={title}
      submitLabel={submitLabel}
      busy={busy}
      onCancel={onCancel}
      onSubmit={submit}
    >
      <FormGroup
        label={label}
        labelFor={inputId}
        intent={error ? 'danger' : 'none'}
        helperText={error || undefined}
      >
        <InputGroup
          id={inputId}
          autoFocus
          value={name}
          intent={error ? 'danger' : 'none'}
          onChange={(event) => {
            setName(event.target.value)
            if (error) setError('')
          }}
        />
      </FormGroup>
    </AppDialog>
  )
}

interface VariableEditorDialogProps {
  title: string
  submitLabel: string
  initial?: MacroVariableDefinition
  suggestedName?: string
  suggestedType?: MacroVariableDefinition['type']
  existingNames: readonly string[]
  busy?: boolean
  onCancel: () => void
  onSubmit: (variable: MacroVariableDefinition) => void | Promise<void>
}

export function VariableEditorDialog({
  title,
  submitLabel,
  initial,
  suggestedName = '',
  suggestedType = 'int',
  existingNames,
  busy,
  onCancel,
  onSubmit,
}: VariableEditorDialogProps) {
  const [name, setName] = useState(initial?.name ?? suggestedName)
  const [type, setType] = useState<MacroVariableDefinition['type']>(initial?.type ?? suggestedType)
  const [defaultText, setDefaultText] = useState(() => variableDefaultText(initial, suggestedType))
  const [input, setInput] = useState(initial?.input === true)
  const [errors, setErrors] = useState<{ name?: string; default?: string }>({})
  const nameId = useId()
  const typeId = useId()
  const defaultId = useId()

  const submit = async () => {
    const normalized = name.trim()
    const nextErrors: typeof errors = {}
    if (!normalized) nextErrors.name = '변수 이름을 입력하세요.'
    else if (existingNames.includes(normalized)) nextErrors.name = '이미 존재하는 변수 이름입니다.'

    let defaultValue: JsonValue | undefined
    if (type !== 'element') {
      try {
        defaultValue = parseVariableDefault(defaultText, type)
      } catch (error) {
        nextErrors.default = error instanceof Error ? error.message : '기본값이 올바르지 않습니다.'
      }
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }
    setErrors({})
    await onSubmit({
      ...initial,
      name: normalized,
      type,
      input,
      ...(type === 'element' ? { default: undefined } : { default: defaultValue }),
    })
  }

  const changeType = (next: MacroVariableDefinition['type']) => {
    setType(next)
    setDefaultText(defaultVariableText(next))
    setErrors((current) => ({ ...current, default: undefined }))
  }

  return (
    <AppDialog
      title={title}
      submitLabel={submitLabel}
      busy={busy}
      onCancel={onCancel}
      onSubmit={submit}
    >
      <FormGroup label="이름" labelFor={nameId} intent={errors.name ? 'danger' : 'none'} helperText={errors.name}>
        <InputGroup id={nameId} autoFocus value={name} intent={errors.name ? 'danger' : 'none'} onChange={(event) => { setName(event.target.value); setErrors((current) => ({ ...current, name: undefined })) }} />
      </FormGroup>
      <FormGroup label="타입" labelFor={typeId}>
        <HTMLSelect id={typeId} fill value={type} onChange={(event) => changeType(event.target.value as MacroVariableDefinition['type'])}>
          {BLUEPRINT_DATA_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
        </HTMLSelect>
      </FormGroup>
      <FormGroup label="기본값" labelFor={defaultId} intent={errors.default ? 'danger' : 'none'} helperText={errors.default}>
        <TextArea
          id={defaultId}
          fill
          rows={3}
          disabled={type === 'element'}
          value={type === 'element' ? '' : defaultText}
          intent={errors.default ? 'danger' : 'none'}
          placeholder={defaultVariableText(type)}
          onChange={(event) => { setDefaultText(event.target.value); setErrors((current) => ({ ...current, default: undefined })) }}
        />
      </FormGroup>
      <Checkbox
        checked={input}
        label="실행 입력으로 사용"
        onChange={(event) => setInput(event.currentTarget.checked)}
      />
    </AppDialog>
  )
}

interface FunctionPortDialogProps {
  kind: 'inputs' | 'outputs'
  existingIds: readonly string[]
  onCancel: () => void
  onSubmit: (port: MacroFunctionPort) => void
}

export function FunctionPortDialog({ kind, existingIds, onCancel, onSubmit }: FunctionPortDialogProps) {
  const [id, setId] = useState('')
  const [type, setType] = useState<MacroFunctionPort['type']>('string')
  const [error, setError] = useState('')
  const inputId = useId()

  return (
    <AppDialog
      title={`${kind === 'inputs' ? '입력' : '출력'} 포트 추가`}
      submitLabel="추가"
      onCancel={onCancel}
      onSubmit={() => {
        const normalized = id.trim()
        if (!normalized) return setError('포트 이름을 입력하세요.')
        if (existingIds.includes(normalized)) return setError('이미 존재하는 포트 이름입니다.')
        onSubmit({ id: normalized, type })
      }}
    >
      <FormGroup label="포트 이름" labelFor={inputId} intent={error ? 'danger' : 'none'} helperText={error}>
        <InputGroup id={inputId} autoFocus value={id} intent={error ? 'danger' : 'none'} onChange={(event) => { setId(event.target.value); setError('') }} />
      </FormGroup>
      <FormGroup label="타입">
        <HTMLSelect fill value={type} onChange={(event) => setType(event.target.value as MacroFunctionPort['type'])}>
          <option value="any">any</option>
          {BLUEPRINT_DATA_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
        </HTMLSelect>
      </FormGroup>
    </AppDialog>
  )
}

function variableDefaultText(
  variable: MacroVariableDefinition | undefined,
  fallbackType: MacroVariableDefinition['type'],
): string {
  if (variable?.default !== undefined) {
    return typeof variable.default === 'string' ? variable.default : JSON.stringify(variable.default)
  }
  return defaultVariableText(variable?.type ?? fallbackType)
}

function defaultVariableText(type: MacroVariableDefinition['type']): string {
  if (type === 'bool') return 'false'
  if (type === 'string' || type === 'element') return ''
  if (type === 'position') return '{"x":0,"y":0}'
  if (type === 'rect') return '{"left":0,"top":0,"right":100,"bottom":100}'
  return '0'
}

function parseVariableDefault(
  raw: string,
  type: Exclude<MacroVariableDefinition['type'], 'element'>,
): JsonValue {
  if (type === 'string') return raw
  if (type === 'bool') {
    if (raw === 'true') return true
    if (raw === 'false') return false
    throw new Error('불리언 기본값은 true 또는 false여야 합니다.')
  }
  if (type === 'int') {
    const value = Number(raw)
    if (!Number.isInteger(value)) throw new Error('정수 기본값은 정수여야 합니다.')
    return value
  }
  if (type === 'float') {
    const value = Number(raw)
    if (!Number.isFinite(value)) throw new Error('실수 기본값은 유한한 숫자여야 합니다.')
    return value
  }
  try {
    const value = JSON.parse(raw) as JsonValue
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    const keys = type === 'position' ? ['x', 'y'] : ['left', 'top', 'right', 'bottom']
    if (keys.some((key) => typeof value[key] !== 'number')) throw new Error()
    return value
  } catch {
    throw new Error(`${type} 기본값은 올바른 JSON 객체여야 합니다.`)
  }
}
