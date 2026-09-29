import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'
import { macroEditorApi } from '../api'
import type { MacroDefinition, ValidationIssue } from '../types'
import { mapBackendValidationErrors, validateMacroDefinition } from '../validation'

export interface MacroValidationState {
  status: 'unknown' | 'valid' | 'invalid' | 'stale'
  errorCount: number
}

type MessageIntent = 'primary' | 'success' | 'warning' | 'danger'

export function useMacroValidation({
  setMessage,
  setMessageIntent,
}: {
  setMessage: Dispatch<SetStateAction<string | null>>
  setMessageIntent: Dispatch<SetStateAction<MessageIntent>>
}) {
  const [issues, setIssues] = useState<ValidationIssue[]>([])
  const [validationState, setValidationState] = useState<MacroValidationState>({
    status: 'unknown',
    errorCount: 0,
  })

  const resetValidation = useCallback(() => {
    setIssues([])
    setValidationState({ status: 'unknown', errorCount: 0 })
  }, [])

  const markValidationStale = useCallback(() => {
    setValidationState((current) => current.status === 'unknown'
      ? current
      : { ...current, status: 'stale' })
  }, [])

  const validateDefinition = useCallback(async (
    candidate: MacroDefinition,
    showSuccess = true,
  ) => {
    const clientIssues = validateMacroDefinition(candidate)
    if (clientIssues.length > 0) {
      setIssues(clientIssues)
      setValidationState({ status: 'invalid', errorCount: clientIssues.length })
      setMessage(showSuccess
        ? `그래프 검증 오류 ${clientIssues.length}개를 발견했습니다.`
        : `검증 오류 ${clientIssues.length}개가 있어 실행할 수 없습니다.`)
      setMessageIntent('danger')
      return false
    }
    try {
      const response = await macroEditorApi.validate(candidate)
      const backendIssues = mapBackendValidationErrors(response)
      setIssues(backendIssues)
      if (!response.valid || backendIssues.length > 0) {
        const errorCount = Math.max(1, backendIssues.length)
        setValidationState({ status: 'invalid', errorCount })
        setMessage(showSuccess
          ? `백엔드 그래프 검증 오류 ${errorCount}개를 발견했습니다.`
          : `검증 오류 ${errorCount}개가 있어 실행할 수 없습니다.`)
        setMessageIntent('danger')
        return false
      }
      setValidationState({ status: 'valid', errorCount: 0 })
      if (showSuccess) {
        setMessage('그래프가 유효합니다.')
        setMessageIntent('success')
      }
      return true
    } catch (error) {
      setValidationState({ status: 'unknown', errorCount: 0 })
      setMessage(error instanceof Error ? error.message : '백엔드 검증을 사용할 수 없습니다.')
      setMessageIntent('danger')
      return false
    }
  }, [setMessage, setMessageIntent])

  return {
    issues,
    setIssues,
    validationState,
    setValidationState,
    resetValidation,
    markValidationStale,
    validateDefinition,
  }
}
