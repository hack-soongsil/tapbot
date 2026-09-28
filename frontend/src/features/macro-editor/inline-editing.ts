import { createContext, useContext } from 'react'
import type { JsonValue, MacroVariableDefinition } from './types'

export interface InlineEditingContextValue {
  variables: readonly MacroVariableDefinition[]
  updateNodeConfig?: (nodeId: string, config: Record<string, JsonValue>) => void
}

export const InlineEditingContext = createContext<InlineEditingContextValue>({
  variables: [],
})

export function useInlineEditing(): InlineEditingContextValue {
  return useContext(InlineEditingContext)
}
