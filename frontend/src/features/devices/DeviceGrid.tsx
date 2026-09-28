import { Button, Spinner } from '@blueprintjs/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { androidApi } from '../android/android-api'
import { SELECTED_DEVICE_STORAGE_KEY } from './hooks'
import type { AndroidDeviceSummary } from './types'

const PREVIEW_INTERVAL_MS = 500

interface DeviceGridProps {
  devices: AndroidDeviceSummary[]
  refreshing: boolean
  onRefresh: () => void
}

export function DeviceGrid({ devices, refreshing, onRefresh }: DeviceGridProps) {
  return (
    <div className="device-grid" aria-label="Android 디바이스 목록">
      {devices.map((device) => (
        <DeviceCard
          key={device.id}
          device={device}
          refreshing={refreshing}
          onRefresh={onRefresh}
        />
      ))}
    </div>
  )
}

function DeviceCard({
  device,
  refreshing,
  onRefresh,
}: {
  device: AndroidDeviceSummary
  refreshing: boolean
  onRefresh: () => void
}) {
  const [showInfo, setShowInfo] = useState(false)
  const debugUrl = `/debug/android/${encodeURIComponent(device.id)}`
  const rememberDevice = () => {
    window.localStorage.setItem(SELECTED_DEVICE_STORAGE_KEY, device.id)
  }

  return (
    <article className={`device-card${device.connected ? ' is-online' : ' is-offline'}`}>
      <header className="device-card__header">
        <div>
          <Link to={debugUrl} onClick={rememberDevice}>{device.name}</Link>
          <small title={device.id}>{device.id}</small>
        </div>
        <span className={`device-card__status is-${device.connection_state}`}>
          <i aria-hidden="true" />
          {device.connected ? '온라인' : '오프라인'}
        </span>
      </header>

      <DevicePreview device={device} debugUrl={debugUrl} onOpen={rememberDevice} />

      <div className="device-card__metrics">
        <span>{resolutionLabel(device)}</span>
        <span>{fpsLabel(device)}</span>
        <span>매크로: {macroLabel(device.macro_status)}</span>
      </div>

      {!device.connected && (
        <p className="device-card__last-seen">
          마지막 연결 {formatLastSeen(device.last_seen_at)}
        </p>
      )}

      {showInfo && (
        <dl className="device-card__info">
          <div><dt>연결</dt><dd>{device.source}</dd></div>
          <div><dt>Endpoint</dt><dd>{device.endpoint}</dd></div>
          <div><dt>화면 캡처</dt><dd>{device.capture_ready ? '준비됨' : '사용 불가'}</dd></div>
          {device.last_error && <div><dt>오류</dt><dd>{device.last_error}</dd></div>}
        </dl>
      )}

      <footer className="device-card__actions">
        {device.connected ? (
          <Link className="bp6-button bp6-intent-primary" to={debugUrl} onClick={rememberDevice}>
            디버그 열기
          </Link>
        ) : (
          <Button intent="primary" loading={refreshing} onClick={onRefresh}>
            다시 연결
          </Button>
        )}
        <details className="device-card__menu">
          <summary aria-label={`${device.name} 메뉴`}>⋯</summary>
          <div>
            <button type="button" disabled={refreshing} onClick={onRefresh}>
              {device.connected ? '새로고침' : '재연결'}
            </button>
            <button type="button" onClick={() => setShowInfo((current) => !current)}>
              디바이스 정보
            </button>
          </div>
        </details>
      </footer>
    </article>
  )
}

function DevicePreview({
  device,
  debugUrl,
  onOpen,
}: {
  device: AndroidDeviceSummary
  debugUrl: string
  onOpen: () => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<number | null>(null)
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState !== 'hidden')
  const [nonce, setNonce] = useState(() => Date.now())
  const [failed, setFailed] = useState(false)
  const previewActive = device.connected && device.capture_ready && visible && pageVisible

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const scheduleNextFrame = useCallback(() => {
    clearTimer()
    if (!previewActive) return
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      setNonce(Date.now())
    }, PREVIEW_INTERVAL_MS)
  }, [clearTimer, previewActive])

  useEffect(() => {
    const root = rootRef.current
    if (!root || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: '120px' },
    )
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const changed = () => setPageVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', changed)
    return () => document.removeEventListener('visibilitychange', changed)
  }, [])

  useEffect(() => {
    if (!previewActive) clearTimer()
    return clearTimer
  }, [clearTimer, previewActive])

  return (
    <div ref={rootRef} className="device-card__preview">
      {device.connected ? (
        previewActive ? (
          <Link to={debugUrl} onClick={onOpen} aria-label={`${device.name} 디버그 열기`}>
            <img
              src={androidApi.screenshotUrl(device.id, nonce)}
              alt={`${device.name} 실시간 화면`}
              decoding="async"
              draggable={false}
              onLoad={() => {
                setFailed(false)
                scheduleNextFrame()
              }}
              onError={() => {
                setFailed(true)
                scheduleNextFrame()
              }}
            />
            {failed && <span className="device-card__preview-message">프리뷰 재연결 중…</span>}
          </Link>
        ) : (
          <div className="device-card__preview-placeholder"><Spinner size={22} />프리뷰 대기 중</div>
        )
      ) : (
        <div className="device-card__preview-placeholder is-offline">
          <strong>Offline</strong>
          <span>디바이스 연결을 확인하세요.</span>
        </div>
      )}
    </div>
  )
}

function resolutionLabel(device: AndroidDeviceSummary): string {
  return device.screen_width && device.screen_height
    ? `${device.screen_width.toString()}×${device.screen_height.toString()}`
    : '해상도 —'
}

function fpsLabel(device: AndroidDeviceSummary): string {
  return device.stream_fps === null
    ? 'FPS —'
    : `${device.stream_fps.toFixed(1)} FPS · 프리뷰 2 FPS`
}

function macroLabel(status: AndroidDeviceSummary['macro_status']): string {
  if (status === 'RUNNING' || status === 'STEPPING') return '실행 중'
  if (status === 'PAUSED') return '일시정지'
  if (status === 'STOPPED') return '중지됨'
  return '대기'
}

function formatLastSeen(value: string | null): string {
  if (!value) return '기록 없음'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}
