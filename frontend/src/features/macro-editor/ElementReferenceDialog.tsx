import { Button, Dialog, DialogBody, DialogFooter } from '@blueprintjs/core'
import { useMemo, useState } from 'react'
import { getTapbotOverlayRoot } from '../../components/overlay-root'
import { ElementReferenceDetail } from './ElementReferenceDetail'
import { ElementReferenceNavigation } from './ElementReferenceNavigation'
import {
  allElementReferences,
  elementReferenceFor,
  type ScreenElementReference,
} from './screen-elements'

interface ElementReferenceDialogProps {
  screenId: string
  elementId: string
  onClose: () => void
  onUseElement: (reference: ScreenElementReference) => void
}

export function ElementReferenceDialog({
  screenId,
  elementId,
  onClose,
  onUseElement,
}: ElementReferenceDialogProps) {
  const initialReference = useMemo(
    () => elementReferenceFor(screenId, elementId) ?? allElementReferences()[0],
    [elementId, screenId],
  )
  if (!initialReference) return null
  return (
    <ElementReferenceDialogContent
      initialReference={initialReference}
      onClose={onClose}
      onUseElement={onUseElement}
    />
  )
}

function ElementReferenceDialogContent({
  initialReference,
  onClose,
  onUseElement,
}: {
  initialReference: ScreenElementReference
  onClose: () => void
  onUseElement: (reference: ScreenElementReference) => void
}) {
  const [selected, setSelected] = useState(initialReference)
  const [query, setQuery] = useState('')
  return (
    <Dialog
      isOpen
      title="Element Reference"
      className="tapbot-dialog element-reference-dialog bp6-dark"
      portalClassName="tapbot-dialog-portal"
      portalContainer={getTapbotOverlayRoot()}
      canEscapeKeyClose
      canOutsideClickClose={false}
      isCloseButtonShown
      autoFocus
      enforceFocus
      shouldReturnFocusOnClose
      onClose={onClose}
    >
      <DialogBody className="element-reference-dialog__body">
        <ElementReferenceNavigation
          query={query}
          selected={selected}
          onQueryChange={setQuery}
          onSelect={setSelected}
        />
        <ElementReferenceDetail reference={selected} />
      </DialogBody>
      <DialogFooter actions={(
        <>
          <Button onClick={onClose}>닫기</Button>
          <Button intent="primary" onClick={() => onUseElement(selected)}>이 요소 사용</Button>
        </>
      )} />
    </Dialog>
  )
}
