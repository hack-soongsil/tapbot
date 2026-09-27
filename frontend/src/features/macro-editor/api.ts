import { apiClient } from '../../lib/api-client'
import type {
  BackendValidationResponse,
  MacroDefinition,
  MacroBindingResponse,
  MacroRunResponse,
} from './types'

const path = (id: string) => `macros/${encodeURIComponent(id)}`

export const macroEditorApi = {
  list: () => apiClient.get<{ macros: MacroDefinition[] }>('macros'),
  get: (id: string) => apiClient.get<MacroDefinition>(path(id)),
  save: (definition: MacroDefinition) =>
    apiClient.put<MacroDefinition>(path(definition.id), definition),
  create: (definition: MacroDefinition) =>
    apiClient.post<MacroDefinition>('macros', definition),
  duplicate: (id: string, input: { id?: string; name?: string } = {}) =>
    apiClient.post<MacroDefinition>(`${path(id)}/duplicate`, input),
  validate: (definition: MacroDefinition) =>
    apiClient.post<BackendValidationResponse>('macros/validate', definition),
  // Transitional methods kept for callers compiled against the 10B editor API.
  run: (id: string) =>
    apiClient.post<{ run_id: string; status: string }>(`${path(id)}/run`),
  stop: (id: string) =>
    apiClient.post<{ run_id: string; status: string }>(`${path(id)}/stop`),
  binding: (deviceId: string) =>
    apiClient.get<MacroBindingResponse>(`android/${encodeURIComponent(deviceId)}/macro-binding`),
  bind: (deviceId: string, macroId: string) =>
    apiClient.put<MacroBindingResponse>(`android/${encodeURIComponent(deviceId)}/macro-binding`, {
      macro_definition_id: macroId,
      enabled: true,
      config: {},
    }),
  unbind: (deviceId: string) =>
    apiClient.delete<void>(`android/${encodeURIComponent(deviceId)}/macro-binding`),
  runtime: (deviceId: string) =>
    apiClient.get<MacroRunResponse>(`android/${encodeURIComponent(deviceId)}/macro/runtime`),
  command: (deviceId: string, command: 'start' | 'pause' | 'resume' | 'stop' | 'reset' | 'step') =>
    apiClient.post<MacroRunResponse>(`android/${encodeURIComponent(deviceId)}/macro/${command}`),
}
