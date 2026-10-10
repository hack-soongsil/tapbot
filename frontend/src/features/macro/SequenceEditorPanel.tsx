import { Button, Callout, Card, Tag } from '@blueprintjs/core'
import { useState } from 'react'
import type { AndroidUiNode } from '../../types/android-debug'
import { moveStep, selectorForNode, updateBookingRange } from './sequence-model'
import type { ElementSelector } from './sequence-model'
import type { SequenceEditor } from './useSequenceEditor'
import './sequence.css'

const statusLabels = {
  IDLE: '대기',
  RUNNING: '실행 중',
  PAUSED: '일시정지',
  STOPPING: '정지 중',
  STOPPED: '정지됨',
  COMPLETED: '완료',
  ERROR: '오류',
}

function selectorLabel(selector?: ElementSelector) {
  if (selector?.time_slot) return `${selector.time_slot} 시간 칸`
  return (
    selector?.text ||
    selector?.content_description ||
    selector?.view_id ||
    'UI 요소'
  )
}

export function SequenceEditorPanel({
  editor,
  selectedNode,
  packageName,
  roomName,
  ready,
}: {
  editor: SequenceEditor
  selectedNode: AndroidUiNode | null
  packageName: string | null
  roomName: string | null
  ready: boolean
}) {
  const { definition, runtime, active, busy } = editor
  const locked = active || busy
  const selector = selectedNode ? selectorForNode(selectedNode) : null
  const [slotTime, setSlotTime] = useState('12:00')
  const updateStep = (id: string, change: Record<string, string | number>) =>
    editor.edit((value) => ({
      ...value,
      steps: value.steps.map((step) =>
        step.id === id ? { ...step, ...change } : step,
      ),
    }))
  return (
    <Card className="sequence-editor" aria-label="클릭 프리셋 편집기">
      <header className="sequence-heading">
        <div>
          <strong>클릭 프리셋</strong>
          <span>UI 컴포넌트와 좌표를 원하는 순서로 연결하세요.</span>
        </div>
        <Tag
          intent={runtime?.status === 'ERROR' ? 'danger' : active ? 'success' : 'none'}
        >
          {runtime ? statusLabels[runtime.status] : '대기'}
        </Tag>
      </header>
      <div className="sequence-toolbar">
        <label>
          프리셋 이름
          <input
            aria-label="프리셋 이름"
            value={definition.name}
            disabled={locked}
            onChange={(event) =>
              editor.edit((value) => ({ ...value, name: event.target.value }))
            }
          />
        </label>
        <label>
          저장한 프리셋
          <select
            aria-label="저장한 프리셋"
            disabled={locked}
            value={
              editor.presets.some((value) => value.id === definition.id)
                ? definition.id
                : ''
            }
            onChange={(event) => editor.load(event.target.value)}
          >
            <option value="">프리셋 선택</option>
            {editor.presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          반복 횟수
          <input
            aria-label="반복 횟수"
            type="number"
            min={1}
            max={1000}
            value={definition.repeat_count}
            disabled={locked}
            onChange={(event) =>
              editor.edit((value) => ({
                ...value,
                repeat_count: Number(event.target.value),
              }))
            }
          />
        </label>
        <Button text="새 프리셋" icon="add" disabled={locked} onClick={editor.create} />
        <Button
          text="저장"
          icon="floppy-disk"
          disabled={locked || !definition.steps.length}
          onClick={() => void editor.save()}
        />
      </div>
      {definition.booking_ranges?.map((range, index) => (
        <div className="sequence-toolbar" key={index}>
          <strong>{index + 1}번째 예약</strong>
          {(['start_time', 'end_time'] as const).map((key) => (
            <label key={key}>
              {key === 'start_time' ? '시작 시각' : '종료 시각'}
              <select
                aria-label={`${index + 1}번째 예약 ${key === 'start_time' ? '시작' : '종료'} 시각`}
                value={range[key]}
                disabled={locked}
                onChange={(event) =>
                  editor.edit((value) =>
                    updateBookingRange(value, index, key, event.target.value),
                  )
                }
              >
                {Array.from(
                  { length: 32 },
                  (_, position) => 360 + position * 30 + (key === 'end_time' ? 30 : 0),
                )
                  .map(
                    (minutes) =>
                      `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
                  )
                  .map((time) => (
                    <option key={time}>{time}</option>
                  ))}
              </select>
            </label>
          ))}
          <span className="sequence-help">
            시작 칸과 종료 직전 30분 칸을 선택한 뒤 별도로 예약합니다.
          </span>
        </div>
      ))}
      {packageName === 'com.ssutoday' && roomName && (
        <div className="sequence-toolbar">
          <label>
            슈투데이 시간 칸
            <select
              aria-label="슈투데이 시간 칸"
              value={slotTime}
              disabled={locked}
              onChange={(event) => setSlotTime(event.target.value)}
            >
              {Array.from(
                { length: 32 },
                (_, index) =>
                  `${String(6 + Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`,
              ).map((time) => (
                <option key={time}>{time}</option>
              ))}
            </select>
          </label>
          <Button
            text="시간 칸 추가"
            disabled={locked}
            onClick={() =>
              editor.append({
                id: crypto.randomUUID(),
                label: `${roomName} · ${slotTime}`,
                kind: 'element',
                selector: { time_slot: slotTime },
                package_name: packageName,
                required_text: roomName,
                duration_ms: 70,
                delay_ms: 500,
              })
            }
          />
          <span className="sequence-help">
            예: 12–14시는 12:00 → 13:30 칸을 추가합니다.
          </span>
        </div>
      )}
      <div className="sequence-toolbar">
        <Button
          text={editor.capture ? '좌표 지정 끝내기' : '화면에서 좌표 추가'}
          icon="locate"
          active={editor.capture}
          disabled={locked || !ready}
          onClick={() => editor.setCapture(!editor.capture)}
        />
        <Button
          text="선택한 UI 컴포넌트 추가"
          icon="widget"
          disabled={locked || !selector}
          onClick={() => {
            if (!selector || !selectedNode) return
            editor.append({
              id: crypto.randomUUID(),
              label:
                selectedNode.text?.trim() ||
                selectedNode.content_description ||
                selectedNode.view_id_resource_name ||
                'UI 요소',
              kind: 'element',
              selector,
              ...(packageName ? { package_name: packageName } : {}),
              duration_ms: 70,
              delay_ms: 500,
            })
          }}
        />
        <Button
          text="확인 대기 추가"
          icon="hand"
          disabled={locked}
          onClick={() =>
            editor.append({
              id: crypto.randomUUID(),
              label: '휴대폰 확인 후 계속 실행',
              kind: 'checkpoint',
              duration_ms: 70,
              delay_ms: 0,
            })
          }
        />
        <span className="sequence-help">
          오른쪽 UI Tree에서 요소를 고른 뒤 추가하세요. 화면 이동은 Manual Control로
          합니다.
        </span>
      </div>
      {editor.capture && (
        <Callout intent="primary">
          휴대폰 화면을 누르면 클릭 좌표가 순서에 추가됩니다.
        </Callout>
      )}
      <ol className="sequence-map" aria-label="프리셋 클릭 순서">
        {definition.steps.map((step, index) => (
          <li
            key={step.id}
            className={
              runtime?.sequence_id === definition.id && runtime.step_id === step.id
                ? 'is-current'
                : ''
            }
          >
            <span className="sequence-number">{index + 1}</span>
            <div className="sequence-node">
              <input
                aria-label={`${index + 1}단계 이름`}
                value={step.label}
                disabled={locked}
                onChange={(event) => updateStep(step.id, { label: event.target.value })}
              />
              <small>
                {step.kind === 'point'
                  ? '좌표 클릭'
                  : step.kind === 'checkpoint'
                    ? `확인 대기${step.selector ? ` · ${selectorLabel(step.selector)}` : ''}`
                    : `UI 클릭 · ${selectorLabel(step.selector)}`}
              </small>
              <div className="sequence-step-fields">
                {step.kind === 'point' && (
                  <>
                    <label>
                      X
                      <input
                        aria-label={`${index + 1}단계 X`}
                        type="number"
                        value={step.x}
                        disabled={locked}
                        onChange={(event) =>
                          updateStep(step.id, { x: Number(event.target.value) })
                        }
                      />
                    </label>
                    <label>
                      Y
                      <input
                        aria-label={`${index + 1}단계 Y`}
                        type="number"
                        value={step.y}
                        disabled={locked}
                        onChange={(event) =>
                          updateStep(step.id, { y: Number(event.target.value) })
                        }
                      />
                    </label>
                  </>
                )}
                <label>
                  클릭 후 대기(ms)
                  <input
                    aria-label={`${index + 1}단계 대기 시간`}
                    type="number"
                    min={0}
                    value={step.delay_ms}
                    disabled={locked}
                    onChange={(event) =>
                      updateStep(step.id, { delay_ms: Number(event.target.value) })
                    }
                  />
                </label>
                {step.kind !== 'checkpoint' && (
                  <label>
                    클릭 시간(ms)
                    <input
                      aria-label={`${index + 1}단계 클릭 시간`}
                      type="number"
                      min={1}
                      value={step.duration_ms}
                      disabled={locked}
                      onChange={(event) =>
                        updateStep(step.id, { duration_ms: Number(event.target.value) })
                      }
                    />
                  </label>
                )}
              </div>
            </div>
            <div className="sequence-step-actions">
              <Button
                icon="arrow-up"
                aria-label={`${index + 1}단계 위로`}
                disabled={locked || index === 0}
                onClick={() =>
                  editor.edit((value) => ({
                    ...value,
                    steps: moveStep(value.steps, step.id, -1),
                  }))
                }
              />
              <Button
                icon="arrow-down"
                aria-label={`${index + 1}단계 아래로`}
                disabled={locked || index === definition.steps.length - 1}
                onClick={() =>
                  editor.edit((value) => ({
                    ...value,
                    steps: moveStep(value.steps, step.id, 1),
                  }))
                }
              />
              <Button
                icon="trash"
                aria-label={`${index + 1}단계 삭제`}
                disabled={locked}
                onClick={() =>
                  editor.edit((value) => ({
                    ...value,
                    steps: value.steps.filter((item) => item.id !== step.id),
                  }))
                }
              />
            </div>
          </li>
        ))}
      </ol>
      {!definition.steps.length && (
        <p className="sequence-empty">
          아직 클릭 단계가 없습니다. UI 컴포넌트나 좌표를 추가하세요.
        </p>
      )}
      <footer className="sequence-toolbar">
        <Button
          text="프리셋 실행"
          icon="play"
          intent="success"
          disabled={!ready || locked || !definition.steps.length}
          loading={busy && !active}
          onClick={() => void editor.start()}
        />
        <Button
          text={runtime?.status === 'PAUSED' ? '계속 실행' : '일시정지'}
          icon={runtime?.status === 'PAUSED' ? 'play' : 'pause'}
          disabled={!active || busy || runtime?.status === 'STOPPING'}
          onClick={() =>
            void editor.command(runtime?.status === 'PAUSED' ? 'resume' : 'pause')
          }
        />
        <Button
          text="정지"
          icon="stop"
          intent="danger"
          disabled={!active || busy}
          onClick={() => void editor.command('stop')}
        />
        <span aria-live="polite">
          {runtime &&
            `${runtime.completed_steps} / ${runtime.total_steps} 단계 · ${runtime.iteration} / ${runtime.repeat_count}회`}
        </span>
        <small>실행 중에는 현재 클릭을 마친 뒤 정지합니다.</small>
      </footer>
      {editor.message && (
        <Callout intent={editor.failed ? 'danger' : 'success'}>
          {editor.message}
        </Callout>
      )}
      {runtime?.pause_reason && (
        <Callout intent="primary">
          {runtime.pause_reason} · 휴대폰에서 확인을 마친 뒤 ‘계속 실행’을 누르세요.
        </Callout>
      )}
      {runtime?.error && (
        <Callout intent="danger">
          {runtime.error}
          {runtime.outcome_unknown &&
            ' 입력 결과가 불확실하므로 휴대폰 화면을 확인하세요.'}
        </Callout>
      )}
    </Card>
  )
}
