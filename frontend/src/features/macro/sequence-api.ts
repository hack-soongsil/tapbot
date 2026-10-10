import { apiClient } from '../../lib/api-client'
import type { SequenceDefinition, SequenceRuntime } from './sequence-model'

const devicePath = (deviceId: string) =>
  `android/${encodeURIComponent(deviceId)}/sequence`
export const sequenceApi = {
  list: (signal?: AbortSignal) =>
    apiClient.get<{ sequences: SequenceDefinition[] }>('macro/sequences', { signal }),
  save: (definition: SequenceDefinition) =>
    apiClient.put<SequenceDefinition>(
      `macro/sequences/${encodeURIComponent(definition.id)}`,
      definition,
    ),
  runtime: (deviceId: string, signal?: AbortSignal) =>
    apiClient.get<SequenceRuntime>(`${devicePath(deviceId)}/runtime`, { signal }),
  start: (deviceId: string, definition: SequenceDefinition) =>
    apiClient.post<SequenceRuntime>(`${devicePath(deviceId)}/start`, definition),
  command: (deviceId: string, command: 'pause' | 'resume' | 'stop') =>
    apiClient.post<SequenceRuntime>(`${devicePath(deviceId)}/${command}`),
}
