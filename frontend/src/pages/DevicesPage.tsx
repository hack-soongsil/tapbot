import { Button, Callout, Spinner } from '@blueprintjs/core'
import { DeviceGrid } from '../features/devices/DeviceGrid'
import { useDevices } from '../features/devices/hooks'

export function DevicesPage() {
  const deviceList = useDevices()

  return (
    <section className="devices-page" aria-labelledby="devices-page-title">
      <header className="devices-page__heading">
        <div>
          <span>Android Devices</span>
          <h1 id="devices-page-title">디바이스</h1>
          <p>연결된 Android 기기의 화면과 실행 상태를 확인하고 디버그 작업을 시작합니다.</p>
        </div>
        <Button
          icon="refresh"
          loading={deviceList.discovering}
          disabled={deviceList.discovering}
          onClick={() => void deviceList.refresh()}
        >
          새로고침
        </Button>
      </header>

      {deviceList.error && (
        <Callout intent="warning" title={deviceList.error}>
          {deviceList.detail ?? '기존 디바이스 목록을 계속 표시합니다.'}
        </Callout>
      )}

      {deviceList.loading && deviceList.devices.length === 0 ? (
        <div className="devices-page__loading"><Spinner size={34} />디바이스를 불러오는 중…</div>
      ) : deviceList.devices.length > 0 ? (
        <DeviceGrid
          devices={deviceList.devices}
          refreshing={deviceList.discovering}
          onRefresh={() => void deviceList.refresh()}
        />
      ) : (
        <div className="devices-page__empty">
          <strong>등록된 Android 디바이스가 없습니다.</strong>
          <span>TapBot Agent 연결을 확인한 뒤 새로고침하세요.</span>
          <Button icon="refresh" onClick={() => void deviceList.refresh()}>다시 검색</Button>
        </div>
      )}
    </section>
  )
}
