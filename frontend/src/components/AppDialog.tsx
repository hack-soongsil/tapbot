import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  type Intent,
} from '@blueprintjs/core'
import { useId, type FormEvent, type ReactNode } from 'react'

interface AppDialogProps {
  title: string
  description?: ReactNode
  children?: ReactNode
  cancelLabel?: string
  submitLabel?: string
  submitIntent?: Intent
  busy?: boolean
  role?: 'dialog' | 'alertdialog'
  onCancel: () => void
  onSubmit?: () => void | Promise<void>
}

export function AppDialog({
  title,
  description,
  children,
  cancelLabel = '취소',
  submitLabel = '확인',
  submitIntent = 'primary',
  busy = false,
  role = 'dialog',
  onCancel,
  onSubmit,
}: AppDialogProps) {
  const descriptionId = useId()
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!busy) void onSubmit?.()
  }

  return (
    <Dialog
      isOpen
      title={title}
      role={role}
      className="tapbot-dialog bp6-dark"
      portalClassName="tapbot-dialog-portal"
      canEscapeKeyClose={!busy}
      canOutsideClickClose={false}
      isCloseButtonShown={!busy}
      autoFocus
      enforceFocus
      shouldReturnFocusOnClose
      aria-describedby={description ? descriptionId : undefined}
      onClose={onCancel}
    >
      <form onSubmit={submit}>
        <DialogBody>
          {description && <div id={descriptionId} className="tapbot-dialog__description">{description}</div>}
          {children}
        </DialogBody>
        <DialogFooter
          actions={(
            <>
              <Button disabled={busy} onClick={onCancel}>{cancelLabel}</Button>
              {onSubmit && (
                <Button type="submit" intent={submitIntent} loading={busy}>{submitLabel}</Button>
              )}
            </>
          )}
        />
      </form>
    </Dialog>
  )
}

interface ConfirmDialogProps {
  title: string
  description: ReactNode
  confirmLabel?: string
  danger?: boolean
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void | Promise<void>
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel = '확인',
  danger = false,
  busy,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <AppDialog
      title={title}
      description={description}
      role="alertdialog"
      submitLabel={confirmLabel}
      submitIntent={danger ? 'danger' : 'primary'}
      busy={busy}
      onCancel={onCancel}
      onSubmit={onConfirm}
    />
  )
}
