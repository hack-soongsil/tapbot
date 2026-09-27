import { apiClient } from '../../lib/api-client'
import type {
  AndroidDevicesRefreshResponse,
  AndroidDevicesResponse,
  AndroidDiscoveryStatus,
  ManualDeviceInput,
  ManualDeviceResponse,
} from './types'

export const devicesApi = {
  list: (signal?: AbortSignal) =>
    apiClient.get<AndroidDevicesResponse>('android/devices', { signal }),
  refresh: () =>
    apiClient.post<AndroidDevicesRefreshResponse>('android/devices/refresh'),
  discoveryStatus: (signal?: AbortSignal) =>
    apiClient.get<AndroidDiscoveryStatus>('android/discovery/status', { signal }),
  addManual: (input: ManualDeviceInput) =>
    apiClient.post<ManualDeviceResponse>('android/devices/manual', input),
}
