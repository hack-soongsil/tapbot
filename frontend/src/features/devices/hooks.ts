import { useCallback, useEffect, useState } from 'react'
import { devicesApi } from './api'
import type {
  AndroidDeviceSummary,
  AndroidDiscoveryStatus,
  ManualDeviceInput,
} from './types'

const SUMMARY_INTERVAL_MS = 7_500
export const SELECTED_DEVICE_STORAGE_KEY = 'tapbot.selectedAndroidDeviceId'

function caughtMessage(value: unknown): string {
  return value instanceof Error ? value.message : 'Unknown error'
}

export function discoveryMessage(status: AndroidDiscoveryStatus): string | null {
  if (!status.enabled || (!status.tailscale_available && status.last_error !== null)) {
    return '자동 기기 검색을 사용할 수 없습니다.'
  }
  if (status.last_refresh === null) return null
  if (status.last_error?.toLowerCase().includes('token')) {
    return 'Automatic discovery could not authenticate with TapBot Agent.'
  }
  if (status.last_error) return '자동 기기 검색을 새로고침하지 못했습니다.'
  if (status.discovered_agent_count === 0) return 'TapBot 기기를 찾지 못했습니다.'
  return null
}

export function useDevices() {
  const [devices, setDevices] = useState<AndroidDeviceSummary[]>([])
  const [defaultDeviceId, setDefaultDeviceId] = useState<string | null>(null)
  const [discovery, setDiscovery] = useState<AndroidDiscoveryStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [discovering, setDiscovering] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<string | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [deviceResponse, discoveryResponse] = await Promise.all([
        devicesApi.list(signal),
        devicesApi.discoveryStatus(signal),
      ])
      setDevices(deviceResponse.devices)
      setDefaultDeviceId(deviceResponse.default_device_id)
      setDiscovery(discoveryResponse)
      setError(discoveryMessage(discoveryResponse))
      setDetail(discoveryResponse.last_error)
    } catch (caught) {
      if (signal?.aborted) return
      setError('안드로이드 기기 목록을 불러오지 못했습니다.')
      setDetail(caughtMessage(caught))
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  const refresh = useCallback(async () => {
    setDiscovering(true)
    setError(null)
    try {
      const response = await devicesApi.refresh()
      setDevices(response.devices)
      setDefaultDeviceId(response.default_device_id)
      setDiscovery(response.discovery)
      setError(discoveryMessage(response.discovery))
      setDetail(response.discovery.last_error)
    } catch (caught) {
      setError('기기를 새로고침하지 못했습니다. 기존 기기 목록은 계속 사용할 수 있습니다.')
      setDetail(caughtMessage(caught))
    } finally {
      setDiscovering(false)
    }
  }, [])

  const addManual = useCallback(async (input: ManualDeviceInput) => {
    const response = await devicesApi.addManual(input)
    setDevices((current) => {
      const rest = current.filter((device) => device.id !== response.device.id)
      return [...rest, response.device]
    })
    return response.device
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const firstRequest = window.setTimeout(() => void load(controller.signal), 0)
    const timer = window.setInterval(() => {
      void devicesApi
        .list(controller.signal)
        .then((response) => {
          setDevices(response.devices)
          setDefaultDeviceId(response.default_device_id)
        })
        .catch(() => undefined)
    }, SUMMARY_INTERVAL_MS)
    return () => {
      controller.abort()
      window.clearTimeout(firstRequest)
      window.clearInterval(timer)
    }
  }, [load])

  return {
    devices,
    defaultDeviceId,
    discovery,
    loading,
    discovering,
    error,
    detail,
    refresh,
    addManual,
  }
}
