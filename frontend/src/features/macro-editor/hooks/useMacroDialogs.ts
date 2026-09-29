import { useCallback, useMemo, useState } from 'react'
import type { PromoteVariablePort } from '../MacroCanvas'
import type { MacroDefinition, MacroVariableDefinition } from '../types'

export type VariableDialogState =
  | { mode: 'create' }
  | { mode: 'edit'; variable: MacroVariableDefinition }
  | {
      mode: 'promote'
      suggestedName: string
      suggestedType: MacroVariableDefinition['type']
      port: PromoteVariablePort
      position: { x: number; y: number }
    }

export type NameDialogState =
  | { kind: 'macro-create'; initialValue: string }
  | { kind: 'macro-rename'; initialValue: string; macro: MacroDefinition }
  | { kind: 'function-create'; initialValue: string }
  | { kind: 'function-rename'; initialValue: string; functionId: string }

export interface ConfirmDialogState {
  title: string
  description: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void | Promise<void>
}

export function useMacroDialogs() {
  const [runSetupMacro, setRunSetupMacro] = useState<MacroDefinition | null>(null)
  const [variableDialog, setVariableDialog] = useState<VariableDialogState | null>(null)
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null)

  const editorDialogOpen = useMemo(
    () => Boolean(variableDialog || nameDialog || confirmDialog || runSetupMacro),
    [confirmDialog, nameDialog, runSetupMacro, variableDialog],
  )

  const discardOrRun = useCallback((hasUnsavedChanges: boolean, action: () => void | Promise<void>) => {
    if (!hasUnsavedChanges) {
      void action()
      return
    }
    setConfirmDialog({
      title: '변경사항 버리기',
      description: '저장하지 않은 매크로 변경 사항을 버릴까요?',
      confirmLabel: '버리기',
      danger: true,
      onConfirm: action,
    })
  }, [])

  return {
    runSetupMacro,
    setRunSetupMacro,
    variableDialog,
    setVariableDialog,
    nameDialog,
    setNameDialog,
    confirmDialog,
    setConfirmDialog,
    editorDialogOpen,
    discardOrRun,
  }
}
