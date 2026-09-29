import { Button, type ButtonProps } from '@blueprintjs/core'

interface MacroActionButtonProps extends Omit<ButtonProps, 'children' | 'text' | 'title' | 'aria-label' | 'icon'> {
  label: string
  icon: NonNullable<ButtonProps['icon']>
}

export function MacroActionButton({ label, className = '', ...props }: MacroActionButtonProps) {
  return (
    <Button
      {...props}
      className={`macro-action-button ${className}`}
      aria-label={label}
      title={label}
    />
  )
}
