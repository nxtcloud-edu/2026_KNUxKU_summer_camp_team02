/**
 * 설정 창 — 통합 설계서 §6-5 · §5-1 · §10 · §11
 *
 * §6-5  진입점은 둘(대기 화면 커스텀 패널 / 스터디룸 하단바)이지만 컴포넌트는 하나다.
 *       왼쪽 메뉴에는 "설정 대상"이 온다 (4장의 기능 4메뉴가 아니라).
 *       설정창은 두 종류 — A. 본인 설정창(방 전체 운영 설정 겸함) / B. 캐릭터 설정창(자리별).
 * §5-1  저장 버튼이 없다. 모든 변경은 즉시 반영된다. 하단에는
 *       [기본값으로 초기화] · [반응 미리보기] · [닫기] 만 남는다.
 * §10   충돌하는 항목은 비활성화하고 "왜 꺼졌는지"를 함께 보여준다 (규칙 13).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X, User, Volume2, Trash2, AlertTriangle, RotateCcw, PlayCircle, Shuffle, Info } from 'lucide-react'

import { useStore, allSeatsOff } from '../store/useStore'
import { db } from '../store/db'
import { PRESETS, PRESET_ORDER, IMAGE_KEYS, seatFromPreset } from '../lib/presets'
import { canIntervene, pickInterventionSpeaker, routeReply } from '../lib/mockAgent'
import { toneOf, toneSample, TONE_OPTIONS } from '../lib/agent/tone'
import { FUNCS, FUNC_META, ownerSlot, validateOwner } from '../lib/agent/functions'
import { sttSupported, ttsSupported, speechSupportNote } from '../lib/speech'
import {
  Section,
  Row,
  SubRow,
  Toggle,
  Segmented,
  Chips,
  CardChoice,
  TextInput,
  Stepper,
  Select,
  TimeInput,
  MinuteField,
  Button,
  IconBtn,
  Dialog,
  Drawer,
  Confirm,
  CharacterSprite,
} from './ui'

/* ── 라벨 사전 (§5-2 용어 사전을 따른다) ─────────────────────── */

const LEVEL_OPTIONS = [
  { value: 'quiet', label: '조용한 방' },
  { value: 'moderate', label: '적당한 대화' },
  { value: 'lively', label: '활발한 대화' },
  { value: 'auto', label: '사용자 맞춤 자동 조절' },
]
const LEVEL_LABEL = Object.fromEntries(LEVEL_OPTIONS.map((o) => [o.value, o.label]))

/** §6-5 개입 상황 표 — "집중 시간이 끝났을 때"는 집중 블록 UI 미정으로 데모에서 제외한다 */
const TRIGGERS = [
  { key: 'idle', label: '일정 시간 활동이 없을 때', field: 'idleMin', fieldLabel: '활동 없음 감지 시간' },
  {
    key: 'windowAway',
    label: '창을 오래 벗어났을 때',
    field: 'awayMin',
    fieldLabel: '창 이탈 감지 시간',
    needsAwayDetect: true,
  },
  {
    key: 'restOver',
    label: '휴식 시간이 길어졌을 때',
    field: 'restOverMin',
    fieldLabel: '휴식 시간 초과 기준',
  },
  { key: 'longStudy', label: '장시간 공부했을 때', field: 'longStudyMin', fieldLabel: '장시간 공부 기준' },
  { key: 'stuck', label: '같은 부분에서 계속 막힐 때' },
  { key: 'goalNear', label: '목표 완료가 가까워졌을 때', help: '홈 화면의 목표 기능이 정해지면 동작해요.' },
  { key: 'prevQuestion', label: '이전에 질문했던 내용을 확인할 때' },
]

const STYLE_ITEMS = [
  { key: 'bubble', label: '말풍선 표시' },
  { key: 'sound', label: '알림음 재생', consent: true },
  { key: 'animation', label: '캐릭터 애니메이션' },
  { key: 'ask', label: '직접 질문하기' },
  { key: 'cheer', label: '응원하기' },
  { key: 'rest', label: '휴식 제안하기' },
]

const MEMORY_FLAGS = [
  { key: 'linkPrev', label: '이전 질문과 연결해 설명' },
  { key: 'recheck', label: '나중에 이해했는지 확인' },
  { key: 'reviewBeforeEnd', label: '세션 종료 전 복습 제안' },
  { key: 'continueNext', label: '다음 세션에서 이어서 공부', nextSession: true },
  { key: 'makeQuiz', label: '어려워한 내용으로 복습 문제 생성', nextSession: true },
]

const SCOPE_LABEL = { session: '세션 한정', persistent: '계속 기억', none: '기억하지 않음' }

/** §6-5 반응 미리보기 — 상황 8개 */
const SITUATIONS = [
  {
    value: 'idle',
    label: '일정 시간 활동이 없을 때',
    trigger: 'idle',
    line: 'idle',
    field: 'idleMin',
    fieldLabel: '활동 없음 감지 시간',
  },
  { value: 'focusEnd', label: '집중 시간이 끝났을 때', excluded: true },
  { value: 'question', label: '질문을 입력했을 때', isQuestion: true },
  {
    value: 'away',
    label: '다른 창으로 이동했을 때',
    trigger: 'windowAway',
    line: 'away',
    field: 'awayMin',
    fieldLabel: '창 이탈 감지 시간',
    needsAwayDetect: true,
  },
  {
    value: 'restOver',
    label: '휴식이 길어졌을 때',
    trigger: 'restOver',
    line: 'restOver',
    field: 'restOverMin',
    fieldLabel: '휴식 시간 초과 기준',
  },
  {
    value: 'longStudy',
    label: '장시간 공부했을 때',
    trigger: 'longStudy',
    line: 'longStudy',
    field: 'longStudyMin',
    fieldLabel: '장시간 공부 기준',
  },
  { value: 'goalNear', label: '목표 완료가 가까워졌을 때', trigger: 'goalNear', line: 'cheer' },
  {
    value: 'prevQuestion',
    label: '이전에 질문했던 내용을 확인할 때',
    trigger: 'prevQuestion',
    line: 'stuck',
  },
]

const SAMPLE_QUESTION = '이 개념이 왜 이렇게 되는지 모르겠어'

/* ── 지역 헬퍼 ───────────────────────────────────────────────
   새 의존 파일을 만들지 않는다. 필요한 것은 전부 이 파일 안에 둔다. */

/** fieldset[disabled]는 자식 컨트롤을 키보드까지 막아준다 (§11 — 마우스만 막으면 초점이 샌다) */
function Ctl({ disabled, children }) {
  return (
    <fieldset disabled={!!disabled} className="contents m-0 border-0 p-0">
      {children}
    </fieldset>
  )
}

/** 권한 허용 전에는 라벨이 비어 온다 → "카메라 1" 같은 임시 이름을 쓴다 (§6-5 창 규칙) */
function deviceOptions(list, kind, tempName) {
  const items = list.filter((d) => d.kind === kind)
  const opts = items.map((d, i) => ({
    value: d.deviceId,
    label: d.label && d.label.trim() ? d.label : `${tempName} ${i + 1}`,
  }))
  return [{ value: '', label: '시스템 기본 장치' }, ...opts]
}

function previewAnswerSample(seat, settings) {
  const style =
    { T1: '짧게 끊어서', T2: '가볍게', T3: '부드럽게', T4: '단정적으로' }[seat.tone] || '짧게 끊어서'
  const len = { short: '한마디로', brief: '간단히', detailed: '자세히' }[settings.replyLength] || '간단히'
  return `"${SAMPLE_QUESTION}" → ${seat.name}이(가) ${style} ${len} 답합니다.`
}

const fmtDate = (ts) => {
  try {
    return new Date(ts).toLocaleString('ko-KR', {
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

/* ── 본체 ────────────────────────────────────────────────── */

export default function SettingsDialog() {
  // 셀렉터는 필드 단위로 하나씩 구독한다 (객체를 새로 만들면 무한 렌더)
  const open = useStore((s) => s.settingsOpen)
  const target = useStore((s) => s.settingsTarget)
  const openSettings = useStore((s) => s.openSettings)
  const closeSettings = useStore((s) => s.closeSettings)
  const seats = useStore((s) => s.seats)
  const settings = useStore((s) => s.settings)
  const device = useStore((s) => s.device)
  const setDevice = useStore((s) => s.setDevice)
  const stream = useStore((s) => s.stream)
  const displayName = useStore((s) => s.displayName)
  const setDisplayName = useStore((s) => s.setDisplayName)
  const updateSeat = useStore((s) => s.updateSeat)
  const updateSettings = useStore((s) => s.updateSettings)
  const resetSettings = useStore((s) => s.resetSettings)
  const toast = useStore((s) => s.toast)

  const isMe = target === 'me'
  const seat = isMe ? null : seats.find((s) => s.slotNo === target) || null

  const [confirmState, setConfirmState] = useState(null)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const bodyRef = useRef(null)

  /* 대상이 바뀌면 본문 스크롤을 맨 위로 (§6-5 창 레이아웃 — 이 영역만 스크롤) */
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0
  }, [target])

  /* 창을 닫으면 부속 오버레이도 함께 정리한다 */
  useEffect(() => {
    if (!open) {
      setMemoryOpen(false)
      setPreviewOpen(false)
      setConfirmState(null)
    }
  }, [open])

  const title = isMe ? '본인 설정' : `${target}번 캐릭터 설정`
  const subtitle = isMe
    ? '내 기기와 방 전체 운영 설정입니다. 변경은 바로 반영돼요.'
    : `${seat ? seat.name : ''} 자리의 이름과 성격을 설정합니다. 변경은 바로 반영돼요.`

  const askReset = () =>
    setConfirmState({
      title: '기본값으로 초기화할까요?',
      body:
        '개입·대화 운영·기억 설정과 세 자리의 캐릭터 설정이 모두 처음 상태로 돌아갑니다.\n\n' +
        '학습 통계와 저장된 기억은 지워지지 않아요.',
      confirmLabel: '초기화',
      tone: 'danger',
      onConfirm: () => {
        resetSettings()
        toast('설정을 기본값으로 되돌렸어요')
      },
    })

  return (
    <>
      <Dialog
        open={open}
        onClose={closeSettings}
        title={title}
        labelledBy="settings-title"
        footer={
          <footer className="glass flex h-[72px] shrink-0 items-center justify-between rounded-none border-0 border-t border-white/60 px-6">
            <div className="flex gap-2">
              <Button variant="secondary" onClick={askReset}>
                <RotateCcw size={15} /> 기본값으로 초기화
              </Button>
              <Button variant="secondary" onClick={() => setPreviewOpen(true)}>
                <PlayCircle size={15} /> 반응 미리보기
              </Button>
            </div>
            <div className="flex items-center gap-4">
              {/* §5-1 저장 버튼이 없다는 사실을 사용자에게 알려준다 */}
              <span className="t-caption">변경은 바로 반영돼요</span>
              <Button variant="primary" onClick={closeSettings}>
                닫기
              </Button>
            </div>
          </footer>
        }
      >
        <header className="flex shrink-0 items-start justify-between border-b border-hairline px-6 py-4">
          <div>
            <h2 id="settings-title" className="t-section">
              {title}
            </h2>
            <p className="t-help mt-0.5">{subtitle}</p>
          </div>
          <IconBtn label="설정 창 닫기" tone="plain" onClick={closeSettings}>
            <X size={18} />
          </IconBtn>
        </header>

        <div className="flex min-h-0 flex-1">
          {/* 왼쪽 메뉴 240px — 설정 "대상" 전환 (§6-5 창 레이아웃) */}
          <nav
            aria-label="설정 대상"
            className="glass w-[240px] shrink-0 overflow-y-auto scroll-soft rounded-none border-0 border-r border-white/60 p-3"
          >
            <p className="t-caption px-3 pb-2 pt-1">설정 대상</p>
            <TargetItem
              active={isMe}
              autofocus
              onClick={() => openSettings('me')}
              icon={
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-lavender">
                  <User size={15} />
                </span>
              }
              label="나"
              status="본인 · 방 전체 설정"
            />
            {seats.map((s) => (
              <TargetItem
                key={s.slotNo}
                active={target === s.slotNo}
                onClick={() => openSettings(s.slotNo)}
                icon={<CharacterSprite imageKey={s.imageKey} size={28} state="studying" />}
                label={`${s.slotNo}번 ${s.name}`}
                status={s.enabled ? '참여 중' : '참여 안 함'}
                off={!s.enabled}
              />
            ))}
            <p className="t-help mt-3 px-3">
              캐릭터에는 마이크·카메라 설정이 없어요. 내 기기로 말하는 참가자가 아니기 때문이에요.
            </p>
          </nav>

          {/* 본문 — 이 영역만 스크롤한다 */}
          <div ref={bodyRef} className="min-w-0 flex-1 overflow-y-auto scroll-soft px-8 py-6">
            <div key={String(target)} className="fade-in">
              {isMe ? (
                <MePanel
                  settings={settings}
                  device={device}
                  setDevice={setDevice}
                  stream={stream}
                  seats={seats}
                  displayName={displayName}
                  setDisplayName={setDisplayName}
                  updateSettings={updateSettings}
                  toast={toast}
                  setConfirmState={setConfirmState}
                  onOpenMemory={() => setMemoryOpen(true)}
                />
              ) : seat ? (
                <SeatPanel
                  seat={seat}
                  seats={seats}
                  updateSeat={updateSeat}
                  setConfirmState={setConfirmState}
                  toast={toast}
                />
              ) : null}
            </div>
          </div>
        </div>
      </Dialog>

      {/* 저장된 기억 확인 드로어 (§6-5) */}
      <MemoryDrawer open={memoryOpen} onClose={() => setMemoryOpen(false)} toast={toast} />

      {/* 반응 미리보기 드로어 (§6-5) */}
      <PreviewDrawer
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        settings={settings}
        seats={seats}
      />

      <Confirm
        open={!!confirmState}
        title={confirmState?.title || ''}
        body={confirmState?.body || ''}
        confirmLabel={confirmState?.confirmLabel || '확인'}
        tone={confirmState?.tone || 'primary'}
        onConfirm={() => {
          confirmState?.onConfirm?.()
          setConfirmState(null)
        }}
        onCancel={() => setConfirmState(null)}
      />
    </>
  )
}

/* ── 왼쪽 메뉴 항목 ──────────────────────────────────────── */

function TargetItem({ active, onClick, icon, label, status, off, autofocus }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      data-autofocus={autofocus ? '' : undefined}
      className={[
        'mb-1 flex w-full items-center gap-3 rounded-sm px-3 py-2.5 text-left transition-colors duration-300 border',
        active
          ? 'bg-peach border-[var(--text-dark)] font-semibold'
          : 'bg-transparent border-transparent hover:bg-[var(--hover-bg)]',
      ].join(' ')}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="t-item block truncate">{label}</span>
        {/* 상태를 색만으로 구분하지 않는다 (§11) */}
        <span className={['t-caption block truncate', off ? 'text-danger' : ''].join(' ')}>{status}</span>
      </span>
    </button>
  )
}

/* ══ A. 본인 설정창 ═══════════════════════════════════════ */

function MePanel({
  settings,
  device,
  setDevice,
  stream,
  seats,
  displayName,
  setDisplayName,
  updateSettings,
  toast,
  setConfirmState,
  onOpenMemory,
}) {
  const [devices, setDevices] = useState([])
  const [level, setLevel] = useState(0)
  const [nameDraft, setNameDraft] = useState(displayName)
  const [soundConsent, setSoundConsent] = useState(settings.interventionStyles.sound)
  const videoRef = useRef(null)

  /* 기기 목록 — 헤드셋을 꽂거나 뽑으면 알아서 갱신된다 (§6-5 창 규칙) */
  useEffect(() => {
    let alive = true
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : null
    if (!md?.enumerateDevices) return undefined
    const load = async () => {
      try {
        const list = await md.enumerateDevices()
        if (alive) setDevices(list.map((d) => ({ deviceId: d.deviceId, kind: d.kind, label: d.label })))
      } catch {
        if (alive) setDevices([])
      }
    }
    load()
    md.addEventListener?.('devicechange', load)
    return () => {
      alive = false
      md.removeEventListener?.('devicechange', load)
    }
  }, [])

  /* 마이크 레벨 — 대기 화면이 잡아둔 MediaStream을 그대로 쓴다. 새로 권한을 묻지 않는다 (§5-4) */
  useEffect(() => {
    const track = stream?.getAudioTracks?.()[0]
    if (!track || !device.micOn) {
      setLevel(0)
      return undefined
    }
    let raf = 0
    let ctx = null
    let last = 0
    try {
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) return undefined
      ctx = new AC()
      const src = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      src.connect(analyser)
      const buf = new Uint8Array(analyser.frequencyBinCount)
      const tick = (t) => {
        raf = requestAnimationFrame(tick)
        if (t - last < 70) return // 과한 리렌더 방지
        last = t
        analyser.getByteTimeDomainData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128
          sum += v * v
        }
        setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 3.2))
      }
      raf = requestAnimationFrame(tick)
    } catch {
      setLevel(0)
    }
    return () => {
      cancelAnimationFrame(raf)
      ctx?.close?.().catch?.(() => {})
    }
  }, [stream, device.micOn])

  /* 작은 미리보기 — 팝업이 뒤의 큰 미리보기를 가리므로 여기서 결과를 확인할 수 있어야 한다 (§6-5) */
  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream
  }, [stream, device.cameraOn])

  const camOpts = useMemo(() => deviceOptions(devices, 'videoinput', '카메라'), [devices])
  const micOpts = useMemo(() => deviceOptions(devices, 'audioinput', '마이크'), [devices])
  const spkOpts = useMemo(() => deviceOptions(devices, 'audiooutput', '스피커'), [devices])

  const nameError = nameDraft.trim() ? '' : '이름을 비워둘 수 없어요.'
  const onNameChange = (v) => {
    setNameDraft(v)
    if (v.trim()) setDisplayName(v.trim()) // §5-1 즉시 반영. 검증 실패면 커밋하지 않는다
  }

  const playTestTone = () => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext
      const ctx = new AC()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = 660
      gain.gain.setValueAtTime(0.0001, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.03)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.42)
      osc.onended = () => ctx.close?.()
      toast('테스트음을 재생했어요')
    } catch {
      toast('이 브라우저에서는 테스트음을 재생할 수 없어요', 'danger')
    }
  }

  /* ── §10 충돌 계산 ── */
  const quiet = settings.interventionLevel === 'quiet'
  const quietReason = "개입 빈도가 '조용한 방'이라 먼저 말을 걸지 않아요"
  const awayDetectOff = !settings.privacyFlags.awayDetect
  const onlyOne = settings.multiReply === 'one'
  const noSup = settings.noSupplement
  const crossBlocked = onlyOne || noSup
  const noMemory = settings.memoryScope === 'none'
  const seatsAllOff = allSeatsOff(seats)
  const voiceNote = speechSupportNote()

  const setTrigger = (k, v) => updateSettings({ triggers: { [k]: v } })
  const setThreshold = (k, v) => updateSettings({ thresholds: { [k]: v } })
  const setStyle = (k, v) => updateSettings({ interventionStyles: { [k]: v } })
  const setDnd = (k, v) => updateSettings({ dnd: { [k]: v } })

  const toggleStyle = (item, v) => {
    // 알림음은 최초 1회 동의를 받는다 (§6-5 개입 방식)
    if (item.consent && v && !soundConsent) {
      setConfirmState({
        title: '알림음을 재생할까요?',
        body: '개입할 때 이 탭에서 짧은 알림음이 납니다.\n스피커 볼륨을 확인해 주세요.',
        confirmLabel: '허용',
        tone: 'primary',
        onConfirm: () => {
          setSoundConsent(true)
          setStyle(item.key, true)
        },
      })
      return
    }
    setStyle(item.key, v)
  }

  return (
    <>
      {/* 작은 미리보기 */}
      <div className="mb-6 flex items-center gap-4 rounded-lg border border-hairline bg-surface p-4">
        <div className="h-[135px] w-[240px] shrink-0 overflow-hidden rounded-sm bg-surface-dark">
          {stream && device.cameraOn ? (
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              aria-label="내 카메라 미리보기"
              className="h-full w-full object-cover"
              style={{
                transform: device.mirror ? 'scaleX(-1)' : 'none',
                filter: device.background === 'blur' ? 'blur(6px)' : 'none',
              }}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center px-4 text-center">
              <span className="t-caption text-warm">
                {device.cameraOn ? '대기 화면에서 카메라를 연결하면 여기에 보여요' : '카메라가 꺼져 있어요'}
              </span>
            </div>
          )}
        </div>
        <div className="min-w-0">
          <div className="t-item">{displayName || '나'}</div>
          <p className="t-help mt-1">
            카메라 {device.cameraOn ? '켜짐' : '꺼짐'} · 마이크 {device.micOn ? '켜짐' : '꺼짐'} · 배경{' '}
            {{ none: '없음', blur: '흐림', image: '이미지' }[device.background] || '없음'}
          </p>
          <p className="t-help mt-1">설정 창이 떠 있어도 카메라·마이크 연결은 그대로 유지돼요.</p>
        </div>
      </div>

      {/* 1) 기기 */}
      <Section title="기기" help="권한을 허용하기 전에는 장치 이름이 임시로 표시돼요.">
        <Row title="카메라">
          <Select
            ariaLabel="카메라 선택"
            value={device.cameraDeviceId}
            onChange={(v) => setDevice({ cameraDeviceId: v })}
            options={camOpts}
          />
        </Row>
        <Row
          title="마이크"
          help={
            stream ? '말하면 입력 레벨이 움직여요.' : '대기 화면에서 마이크를 연결하면 입력 레벨이 표시돼요.'
          }
        >
          <div className="flex items-center gap-3">
            <div
              role="meter"
              aria-label="마이크 입력 레벨"
              aria-valuenow={Math.round(level * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-2 w-32 overflow-hidden rounded-full bg-chart-track"
            >
              <div
                className="h-full rounded-full bg-chart-focus"
                style={{ width: `${Math.round(level * 100)}%` }}
              />
            </div>
            <span className="t-caption tnum w-8 text-right">{Math.round(level * 100)}</span>
            <Select
              ariaLabel="마이크 선택"
              value={device.micDeviceId}
              onChange={(v) => setDevice({ micDeviceId: v })}
              options={micOpts}
            />
          </div>
        </Row>
        <Row
          title="스피커"
          help="브라우저가 출력 장치 지정을 지원하지 않으면 시스템 기본 장치로 재생돼요."
          last
        >
          <div className="flex items-center gap-2">
            <Select
              ariaLabel="스피커 선택"
              value={device.speakerDeviceId}
              onChange={(v) => setDevice({ speakerDeviceId: v })}
              options={spkOpts}
            />
            <Button variant="secondary" onClick={playTestTone}>
              <Volume2 size={15} /> 테스트음
            </Button>
          </div>
        </Row>
      </Section>

      {/* 2) 영상 */}
      <Section title="영상">
        <Row title="좌우 반전" help="내 화면에서만 좌우가 뒤집혀 보여요.">
          <Toggle label="좌우 반전" checked={device.mirror} onChange={(v) => setDevice({ mirror: v })} />
        </Row>
        <Row title="배경">
          <div className="w-[420px]">
            <CardChoice
              ariaLabel="배경 선택"
              columns={3}
              value={device.background}
              onChange={(v) => setDevice({ background: v })}
              options={[
                { value: 'none', label: '없음' },
                { value: 'blur', label: '흐림' },
                { value: 'image', label: '이미지' },
              ]}
            />
          </div>
        </Row>
        <Row title="화질" last>
          <Select
            ariaLabel="화질 선택"
            value={device.quality}
            onChange={(v) => setDevice({ quality: v })}
            options={[
              { value: 'auto', label: '자동' },
              { value: 'high', label: '높음 (720p)' },
              { value: 'medium', label: '보통 (480p)' },
              { value: 'low', label: '낮음 (360p)' },
            ]}
          />
        </Row>
      </Section>

      {/* 3) 프로필 */}
      <Section title="프로필">
        <Row title="방에서 보일 이름" help="스터디룸 내 자리에 표시돼요. 최대 12자." last>
          <TextInput
            className="w-[280px]"
            ariaLabel="방에서 보일 이름"
            value={nameDraft}
            onChange={onNameChange}
            maxLength={12}
            placeholder="예: 수형"
            error={nameError}
          />
        </Row>
      </Section>

      {/* 4) 입장 옵션 */}
      <Section
        title="입장 옵션"
        help="스터디룸에 들어갈 때의 시작 상태입니다. 방 안에서 언제든 바꿀 수 있어요."
      >
        <Row title="마이크 끄고 입장">
          <Toggle
            label="마이크 끄고 입장"
            checked={!device.micOn}
            onChange={(v) => setDevice({ micOn: !v })}
          />
        </Row>
        <Row title="카메라 끄고 입장" last>
          <Toggle
            label="카메라 끄고 입장"
            checked={!device.cameraOn}
            onChange={(v) => setDevice({ cameraOn: !v })}
          />
        </Row>
      </Section>

      {/* 5) 집중 및 개입 */}
      <Section title="집중 및 개입" help="방해 방지 설정은 아래의 다른 개입 설정보다 항상 우선해요.">
        <Row title="개입 빈도" help="방 전체가 먼저 말을 거는 양의 상한이에요.">
          <Segmented
            ariaLabel="개입 빈도"
            value={settings.interventionLevel}
            onChange={(v) => updateSettings({ interventionLevel: v })}
            options={LEVEL_OPTIONS}
          />
        </Row>
      </Section>

      <Section title="개입 상황" help="어떤 상황에서 스터디 메이트가 먼저 말을 걸지 고릅니다.">
        {TRIGGERS.map((t) => {
          const blockedByAway = t.needsAwayDetect && awayDetectOff
          const disabled = quiet || blockedByAway
          const reason = quiet ? quietReason : blockedByAway ? "'창 이탈 감지 허용'이 꺼져 있어요" : ''
          const on = settings.triggers[t.key]
          return (
            <div key={t.key}>
              <Row title={t.label} help={t.help} disabled={disabled} disabledReason={reason}>
                <Toggle
                  label={t.label}
                  checked={on}
                  disabled={disabled}
                  onChange={(v) => setTrigger(t.key, v)}
                />
              </Row>
              {on && t.field && !disabled && (
                <SubRow>
                  <MinuteField
                    label={t.fieldLabel}
                    value={settings.thresholds[t.field]}
                    onChange={(v) => setThreshold(t.field, v)}
                  />
                </SubRow>
              )}
            </div>
          )
        })}
        <SubRow>
          <MinuteField
            label="개입 후 재개입 대기 시간"
            value={settings.thresholds.cooldownMin}
            onChange={(v) => setThreshold('cooldownMin', v)}
          />
          <span className="t-help">한 번 말을 건 뒤 이 시간 동안은 다시 말을 걸지 않아요.</span>
        </SubRow>
      </Section>

      <Section title="개입 방식" help="말을 걸 때 어떤 방법을 쓸지 고릅니다. 여러 개를 함께 켤 수 있어요.">
        {STYLE_ITEMS.map((s, i) => (
          <Row
            key={s.key}
            title={s.label}
            disabled={quiet}
            disabledReason={quiet ? quietReason : ''}
            last={i === STYLE_ITEMS.length - 1}
          >
            <Toggle
              label={s.label}
              checked={settings.interventionStyles[s.key]}
              disabled={quiet}
              onChange={(v) => toggleStyle(s, v)}
            />
          </Row>
        ))}
      </Section>

      <Section title="방해 방지" help="여기서 막히면 위의 개입 설정은 실행되지 않아요.">
        <Row
          title="집중 중에는 먼저 말 걸지 않기"
          help="키보드·마우스를 계속 쓰는 동안에는 말을 걸지 않아요."
        >
          <Toggle
            label="집중 중에는 먼저 말 걸지 않기"
            checked={settings.dnd.focusSilence}
            onChange={(v) => setDnd('focusSilence', v)}
          />
        </Row>
        <Row
          title="종이책 공부 모드"
          help="창을 벗어나도 자리 비움으로 보지 않아요. 켜면 랭킹 비교에서 제외돼요."
        >
          <Toggle
            label="종이책 공부 모드"
            checked={settings.dnd.paperMode}
            onChange={(v) => setDnd('paperMode', v)}
          />
        </Row>
        <Row
          title="온라인 강의 시청 모드"
          help="화면이 오래 고정돼도 집중력 저하로 보지 않아요. 켜면 랭킹 비교에서 제외돼요."
        >
          <Toggle
            label="온라인 강의 시청 모드"
            checked={settings.dnd.lectureMode}
            onChange={(v) => setDnd('lectureMode', v)}
          />
        </Row>
        <Row
          title="다른 창에서 자료 탐색 허용"
          help="자료를 찾는 창 이동을 이탈로 세지 않아요. 켜면 랭킹 비교에서 제외돼요."
        >
          <Toggle
            label="다른 창에서 자료 탐색 허용"
            checked={settings.dnd.browseAllowed}
            onChange={(v) => setDnd('browseAllowed', v)}
          />
        </Row>
        <Row
          title="방해 금지 시간"
          help="이 시간에는 어떤 개입도 하지 않아요."
          last={!settings.dnd.quietEnabled}
        >
          <Toggle
            label="방해 금지 시간"
            checked={settings.dnd.quietEnabled}
            onChange={(v) => setDnd('quietEnabled', v)}
          />
        </Row>
        {settings.dnd.quietEnabled && (
          <SubRow>
            <label className="inline-flex items-center gap-2">
              <span className="t-help">시작</span>
              <TimeInput
                ariaLabel="방해 금지 시작 시각"
                value={settings.dnd.quietFrom}
                onChange={(v) => setDnd('quietFrom', v)}
              />
            </label>
            <label className="inline-flex items-center gap-2">
              <span className="t-help">종료</span>
              <TimeInput
                ariaLabel="방해 금지 종료 시각"
                value={settings.dnd.quietTo}
                onChange={(v) => setDnd('quietTo', v)}
              />
            </label>
            <span className="t-help">자정을 넘겨도 됩니다. (예: 23:00 ~ 07:00)</span>
          </SubRow>
        )}
      </Section>

      {/* 6) 대화 운영 */}
      {/* §10 규칙 9 — 3자리 모두 참여 OFF면 경고 */}
      {seatsAllOff && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-sm border border-[var(--danger)] bg-danger-bg px-4 py-3"
        >
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-danger" />
          <div>
            <div className="t-item text-danger">참여 중인 캐릭터가 없어요</div>
            <p className="t-help mt-0.5">
              세 자리가 모두 참여 꺼짐 상태라 아래 설정은 실제로 적용되지 않아요. 왼쪽 메뉴에서 캐릭터를 골라
              참여 여부를 켜주세요.
            </p>
          </div>
        </div>
      )}

      <Section title="대화 운영" help="질문했을 때 누가, 얼마나 답할지 정합니다.">
        <Row title="답변 캐릭터 결정">
          <div className="w-[460px]">
            <CardChoice
              ariaLabel="답변 캐릭터 결정"
              columns={1}
              value={settings.replyPolicy}
              onChange={(v) => updateSettings({ replyPolicy: v })}
              options={[
                {
                  value: 'primary',
                  label: '주 담당 캐릭터가 답변',
                  help: '항상 정해둔 자리가 먼저 답합니다.',
                },
                {
                  value: 'mention',
                  label: '질문할 때 직접 지정',
                  help: '채팅에 @이름을 적어 부르면 그 캐릭터가 답합니다.',
                },
                {
                  value: 'auto',
                  label: '가장 적합한 캐릭터가 자동 응답',
                  help: '질문 내용과 담당 기능을 보고 골라요.',
                },
              ]}
            />
          </div>
        </Row>
        {settings.replyPolicy === 'primary' && (
          <SubRow>
            <label className="inline-flex items-center gap-2">
              <span className="t-help">주 담당 자리</span>
              <Select
                ariaLabel="주 담당 캐릭터 자리"
                value={String(settings.primarySlotNo)}
                onChange={(v) => updateSettings({ primarySlotNo: Number(v) })}
                options={seats.map((s) => ({
                  value: String(s.slotNo),
                  label: `${s.slotNo}번 ${s.name}${s.enabled ? '' : ' (참여 안 함)'}`,
                }))}
              />
            </label>
          </SubRow>
        )}
        <Row
          title="다른 캐릭터의 참여"
          help="한 질문에 답할 수 있는 최대 인원이에요."
          disabled={noSup}
          disabledReason={noSup ? "'보충 발언 완전히 끄기'가 켜져 있어요" : ''}
        >
          <Ctl disabled={noSup}>
            <Segmented
              ariaLabel="다른 캐릭터의 참여"
              value={settings.multiReply}
              onChange={(v) => updateSettings({ multiReply: v })}
              options={[
                { value: 'one', label: '한 명만' },
                { value: 'two', label: '최대 두 명' },
                { value: 'many', label: '여러 캐릭터' },
              ]}
            />
          </Ctl>
        </Row>
        <Row
          title="캐릭터끼리 짧은 대화 허용"
          disabled={crossBlocked}
          disabledReason={
            crossBlocked
              ? noSup
                ? "'보충 발언 완전히 끄기'가 켜져 있어요"
                : "'한 명만' 답변으로 설정돼 있어요"
              : ''
          }
          last={!settings.crossTalk || crossBlocked}
        >
          <Toggle
            label="캐릭터끼리 짧은 대화 허용"
            checked={settings.crossTalk}
            disabled={crossBlocked}
            onChange={(v) => updateSettings({ crossTalk: v })}
          />
        </Row>
        {settings.crossTalk && !crossBlocked && (
          <SubRow>
            <span className="t-help">대화 빈도</span>
            <Segmented
              ariaLabel="캐릭터끼리 대화 빈도"
              value={settings.crossTalkFreq}
              onChange={(v) => updateSettings({ crossTalkFreq: v })}
              options={[
                { value: 'rare', label: '드물게' },
                { value: 'sometimes', label: '가끔' },
                { value: 'often', label: '자주' },
              ]}
            />
          </SubRow>
        )}
        <Row
          title="보충 발언 완전히 끄기"
          help="켜면 질문을 받은 한 명만 답하고 다른 캐릭터는 끼어들지 않아요."
        >
          <Toggle
            label="보충 발언 완전히 끄기"
            checked={settings.noSupplement}
            onChange={(v) => updateSettings({ noSupplement: v })}
          />
        </Row>
        <Row title="같은 캐릭터 최대 연속 발화" help="이 횟수를 넘으면 다른 캐릭터에게 차례를 넘겨요.">
          <Stepper
            ariaLabel="같은 캐릭터 최대 연속 발화"
            value={settings.maxConsecutive}
            min={1}
            max={5}
            onChange={(v) => updateSettings({ maxConsecutive: v })}
          />
        </Row>
        <Row title="같은 내용 반복 방지">
          <Toggle
            label="같은 내용 반복 방지"
            checked={settings.noRepeat}
            onChange={(v) => updateSettings({ noRepeat: v })}
          />
        </Row>
        <Row title="답변 길이" last>
          <Segmented
            ariaLabel="답변 길이"
            value={settings.replyLength}
            onChange={(v) => updateSettings({ replyLength: v })}
            options={[
              { value: 'short', label: '한마디' },
              { value: 'brief', label: '간단히' },
              { value: 'detailed', label: '자세히' },
            ]}
          />
        </Row>
      </Section>

      {/* 7) 기억 및 개인정보 */}
      <Section title="기억 활용" help="지난 대화를 어떻게 쓸지 정합니다.">
        {MEMORY_FLAGS.map((m, i) => {
          const disabled = m.nextSession && noMemory
          return (
            <Row
              key={m.key}
              title={m.label}
              disabled={disabled}
              disabledReason={disabled ? "기억 범위가 '기억하지 않음'이에요" : ''}
              last={i === MEMORY_FLAGS.length - 1}
            >
              <Toggle
                label={m.label}
                checked={settings.memoryFlags[m.key]}
                disabled={disabled}
                onChange={(v) => updateSettings({ memoryFlags: { [m.key]: v } })}
              />
            </Row>
          )
        })}
      </Section>

      <Section title="기억 범위">
        <Row title="어디까지 기억할까요" last>
          <div className="w-[520px]">
            <CardChoice
              ariaLabel="기억 범위"
              columns={3}
              value={settings.memoryScope}
              onChange={(v) => updateSettings({ memoryScope: v })}
              options={[
                { value: 'session', label: '세션 한정', help: '공부 종료와 함께 지워요.' },
                { value: 'persistent', label: '계속 기억', help: '다음 세션에도 이어서 써요.' },
                { value: 'none', label: '기억하지 않음', help: '아무것도 저장하지 않아요.' },
              ]}
            />
          </div>
        </Row>
      </Section>

      <Section title="개인정보">
        {/* §8-3 — 감지를 끄면 집중 지표가 산출되지 않는다 */}
        <Row title="창 이탈 감지 허용" help="끄면 학습 점수와 집중 통계를 볼 수 없어요.">
          <Toggle
            label="창 이탈 감지 허용"
            checked={settings.privacyFlags.awayDetect}
            onChange={(v) => updateSettings({ privacyFlags: { awayDetect: v } })}
          />
        </Row>
        <Row title="입력 활동 감지 허용" help="끄면 학습 점수와 집중 통계를 볼 수 없어요.">
          <Toggle
            label="입력 활동 감지 허용"
            checked={settings.privacyFlags.inputDetect}
            onChange={(v) => updateSettings({ privacyFlags: { inputDetect: v } })}
          />
        </Row>
        <Row title="세션 종료 시 대화 삭제" help="공부를 마치면 이번 대화를 지워요. 학습 통계는 남습니다.">
          <Toggle
            label="세션 종료 시 대화 삭제"
            checked={settings.privacyFlags.wipeOnEnd}
            onChange={(v) => updateSettings({ privacyFlags: { wipeOnEnd: v } })}
          />
        </Row>
        <Row title="저장된 기억" help="무엇이 저장돼 있는지 확인하고 하나씩 지울 수 있어요." last>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onOpenMemory}>
              저장된 기억 확인
            </Button>
            <Button
              variant="danger"
              onClick={() =>
                setConfirmState({
                  title: '모든 기억을 초기화할까요?',
                  body:
                    `지워지는 것\n· 저장된 기억 ${db.getMemories().length}개\n· 지금까지의 대화 기록 전체\n\n` +
                    '지워지지 않는 것\n· 공부 시간·집중 시간·학습 점수 같은 학습 통계\n\n' +
                    '한 번 지우면 되돌릴 수 없어요.',
                  confirmLabel: '모두 지우기',
                  tone: 'danger',
                  onConfirm: () => {
                    db.wipeConversationMemory()
                    toast('기억과 대화 기록을 모두 지웠어요')
                  },
                })
              }
            >
              <Trash2 size={15} /> 모든 기억 초기화
            </Button>
          </div>
        </Row>
      </Section>

      {/* 음성 */}
      <Section title="음성" help={voiceNote || '마이크로 질문하고, 답변을 소리로 들을 수 있어요.'}>
        <Row
          title="음성으로 질문하기"
          help="마이크 버튼을 누르고 말하면 채팅으로 옮겨 적어요."
          disabled={!sttSupported}
          disabledReason={!sttSupported ? '이 브라우저는 음성 입력을 지원하지 않아요' : ''}
        >
          <Toggle
            label="음성으로 질문하기"
            checked={settings.voice.stt}
            disabled={!sttSupported}
            onChange={(v) => updateSettings({ voice: { stt: v } })}
          />
        </Row>
        <Row
          title="답변 읽어주기"
          help="스터디 메이트의 답변을 소리로 읽어줘요."
          disabled={!ttsSupported}
          disabledReason={!ttsSupported ? '이 브라우저는 읽어주기를 지원하지 않아요' : ''}
          last
        >
          <Toggle
            label="답변 읽어주기"
            checked={settings.voice.tts}
            disabled={!ttsSupported}
            onChange={(v) => updateSettings({ voice: { tts: v } })}
          />
        </Row>
      </Section>
    </>
  )
}

/* ══ B. 캐릭터 설정창 ═════════════════════════════════════
   §6-5 B — 마이크·카메라·기기 항목은 여기에 들어가지 않는다. */

function SeatPanel({ seat, seats, updateSeat, setConfirmState, toast }) {
  const [nameDraft, setNameDraft] = useState(seat.name)

  useEffect(() => {
    setNameDraft(seat.name)
    // 자리를 바꿀 때만 초안을 갈아끼운다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seat.slotNo])

  const others = seats.filter((s) => s.slotNo !== seat.slotNo)
  const trimmed = nameDraft.trim()
  const dup = !!trimmed && others.some((s) => s.name.trim() === trimmed)
  const nameError = !trimmed
    ? '이름을 비워둘 수 없어요.'
    : dup
      ? '다른 자리와 같은 이름은 쓸 수 없어요. @멘션이 헷갈려요.'
      : ''

  const onNameChange = (v) => {
    setNameDraft(v)
    const t = v.trim()
    if (!t) return
    if (others.some((s) => s.name.trim() === t)) return // 검증 실패 → 커밋하지 않는다 (§5-1)
    updateSeat(seat.slotNo, { name: t })
  }

  /** §7-2 [판단] 프리셋을 바꾸면 커스텀 값이 덮어써진다 → 확인 팝업 1회 */
  const onPresetChange = (key) => {
    if (key === seat.preset) return
    if (key === 'custom') {
      updateSeat(seat.slotNo, { preset: 'custom' })
      return
    }
    setConfirmState({
      title: `${PRESETS[key].name} 프리셋으로 바꿀까요?`,
      body:
        `이름·이미지·말투가 ${PRESETS[key].name}의 기본값으로 덮어써집니다.\n\n` +
        `${PRESETS[key].blurb}\n\n지금 직접 고친 값은 사라져요.`,
      confirmLabel: '프리셋 적용',
      tone: 'primary',
      onConfirm: () => {
        // 참여 여부는 자리 운영 상태라 프리셋이 건드리지 않는다
        updateSeat(seat.slotNo, { ...seatFromPreset(seat.slotNo, key), enabled: seat.enabled })
        setNameDraft(PRESETS[key].name)
        toast(`${PRESETS[key].name} 프리셋을 적용했어요`)
      },
    })
  }

  /** 프리셋 값을 직접 고치면 '직접 설정'으로 표시한다 */
  const patchPersonality = (patch) => updateSeat(seat.slotNo, { ...patch, preset: 'custom' })

  const presetOptions = [
    ...PRESET_ORDER.map((k) => ({ value: k, label: `${PRESETS[k].name} · ${PRESETS[k].archetype}` })),
    { value: 'custom', label: '직접 설정' },
  ]

  return (
    <>
      <Section title="기본">
        <Row title="캐릭터 이미지" help="자리에 앉아 있을 모습이에요.">
          <div role="radiogroup" aria-label="캐릭터 이미지" className="flex gap-2">
            {IMAGE_KEYS.map((k) => {
              const on = seat.imageKey === k
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={`${k} 이미지${on ? ' (선택됨)' : ''}`}
                  onClick={() => updateSeat(seat.slotNo, { imageKey: k })}
                  className={[
                    'flex h-[72px] w-[72px] items-center justify-center rounded-sm border transition-all duration-300',
                    on
                      ? 'bg-peach border-[var(--text-dark)] shadow-soft'
                      : 'bg-white border-hairline hover:bg-[var(--hover-bg)]',
                  ].join(' ')}
                >
                  <CharacterSprite imageKey={k} size={52} state="studying" />
                </button>
              )
            })}
          </div>
        </Row>
        <Row title="이름" help="채팅에서 @이름으로 부를 때 쓰는 이름이에요. 최대 12자.">
          <TextInput
            className="w-[280px]"
            ariaLabel={`${seat.slotNo}번 캐릭터 이름`}
            value={nameDraft}
            onChange={onNameChange}
            maxLength={12}
            error={nameError}
          />
        </Row>
        <Row title="참여 여부" help="끄면 빈 자리로 표시되고 답변·개입에서 빠져요." last>
          <Toggle
            label={`${seat.slotNo}번 자리 참여 여부`}
            checked={seat.enabled}
            onChange={(v) => updateSeat(seat.slotNo, { enabled: v })}
          />
        </Row>
      </Section>

      <Section
        title="성격"
        help="프리셋을 고르면 아래 값이 한 번에 채워지고, 직접 고치면 '직접 설정'이 돼요."
      >
        <Row title="프리셋">
          <Select
            ariaLabel="성격 프리셋"
            value={PRESETS[seat.preset] ? seat.preset : 'custom'}
            onChange={onPresetChange}
            options={presetOptions}
          />
        </Row>
        <Row title="말투" help="같은 내용을 어떻게 말할지만 정해요. 무엇을 말할지는 담당 기능이 정합니다.">
          <div className="w-[420px]">
            <CardChoice
              ariaLabel="말투"
              columns={2}
              value={seat.tone || 'T1'}
              onChange={(v) => patchPersonality({ tone: v })}
              options={TONE_OPTIONS.map((t) => ({
                value: t.id,
                label: t.label,
                help: `${t.one} · ${t.ending}`,
              }))}
            />
          </div>
        </Row>
        <Row title="이렇게 말해요" help="실제 AI를 부르지 않고 보여주는 예시예요." last>
          <p className="t-body text-subtle w-[420px] leading-relaxed">
            {toneSample(seat.tone || 'T1', '개념')}
          </p>
        </Row>
      </Section>

      <Section title="담당 기능" help="여섯 가지를 세 자리에 나눠 맡깁니다. 한 자리에 두 개씩이에요.">
        <FunctionAssign slotNo={seat.slotNo} />
      </Section>

      <p className="t-help -mt-4 flex items-start gap-1.5">
        <Info size={14} className="mt-0.5 shrink-0" />
        전체 개입 빈도가 &apos;조용한 방&apos;이면 캐릭터가 &apos;적극적으로 도움&apos;이어도 먼저 말을 걸지
        않아요. 개입 빈도는 본인 설정에서 바꿀 수 있어요.
      </p>
    </>
  )
}

/* ══ 저장된 기억 드로어 (§6-5) ═══════════════════════════ */

function MemoryDrawer({ open, onClose, toast }) {
  const [items, setItems] = useState([])

  const reload = useCallback(() => setItems([...db.getMemories()].reverse()), [])

  useEffect(() => {
    if (open) reload()
  }, [open, reload])

  return (
    <Drawer open={open} onClose={onClose} title="저장된 기억" width={440}>
      <p className="t-help mb-4">
        스터디 메이트가 다음에 참고하려고 남겨둔 내용이에요. 하나씩 지울 수 있어요. 학습 통계는 여기에
        포함되지 않아요.
      </p>
      {items.length === 0 ? (
        <div className="rounded-sm border border-hairline bg-surface px-5 py-8 text-center">
          <p className="t-item">저장된 기억이 없어요</p>
          <p className="t-help mt-1">공부하면서 나눈 대화에서 기억할 내용이 생기면 여기에 쌓여요.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((m) => (
            <li
              key={m.id}
              className="flex items-start gap-3 rounded-sm border border-hairline bg-surface px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="t-body break-words">{m.content}</p>
                <p className="t-caption mt-1">
                  {SCOPE_LABEL[m.scope] || m.scope} · {fmtDate(m.created_at)}
                </p>
              </div>
              <IconBtn
                label="이 기억 삭제"
                tone="plain"
                onClick={() => {
                  db.deleteMemory(m.id)
                  reload()
                  toast('기억 하나를 지웠어요')
                }}
              >
                <Trash2 size={16} />
              </IconBtn>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  )
}

/* ══ 반응 미리보기 드로어 (§6-5) ══════════════════════════
   실제 AI를 호출하지 않는다. 지금 설정으로 어떤 판정이 나오는지만 보여준다. */

function PreviewDrawer({ open, onClose, settings, seats }) {
  const [sit, setSit] = useState('idle')
  const [nonce, setNonce] = useState(0)

  const situation = SITUATIONS.find((s) => s.value === sit) || SITUATIONS[0]

  const result = useMemo(() => {
    if (!open) return null
    void nonce // 다시 뽑기용 의존

    const styles = STYLE_ITEMS.filter((s) => settings.interventionStyles[s.key]).map((s) => s.label)

    /* 질문 입력은 개입이 아니라 답변이다 (§7-3) */
    if (situation.isQuestion) {
      const repliers = routeReply(SAMPLE_QUESTION, seats, settings)
      return {
        allowed: true,
        verdict: '해당 없음',
        reason: '질문에는 개입 설정과 상관없이 답합니다.',
        speakers: repliers,
        line: repliers[0] ? previewAnswerSample(repliers[0], settings) : '',
        styles: [],
        facts: [
          [
            '답변 캐릭터 결정',
            { primary: '주 담당 캐릭터', mention: '질문할 때 직접 지정', auto: '자동 응답' }[
              settings.replyPolicy
            ],
          ],
          [
            '다른 캐릭터의 참여',
            settings.noSupplement
              ? '보충 발언 끔 (한 명만)'
              : { one: '한 명만', two: '최대 두 명', many: '여러 캐릭터' }[settings.multiReply],
          ],
          ['답변 길이', { short: '한마디', brief: '간단히', detailed: '자세히' }[settings.replyLength]],
        ],
      }
    }

    const facts = [
      ['개입 빈도', LEVEL_LABEL[settings.interventionLevel]],
      [
        '이 상황 개입',
        situation.trigger ? (settings.triggers[situation.trigger] ? '켜짐' : '꺼짐') : '해당 없음',
      ],
    ]
    if (situation.field) facts.push([situation.fieldLabel, `${settings.thresholds[situation.field]}분`])
    facts.push(['재개입 대기 시간', `${settings.thresholds.cooldownMin}분`])
    facts.push([
      '방해 금지 시간',
      settings.dnd.quietEnabled ? `${settings.dnd.quietFrom} ~ ${settings.dnd.quietTo}` : '꺼짐',
    ])

    const block = (reason) => ({
      allowed: false,
      verdict: '개입 안 함',
      reason,
      speakers: [],
      line: '',
      styles: [],
      facts,
    })

    if (situation.excluded)
      return block('집중 블록을 시작하고 끝내는 화면이 아직 없어서 이번 데모에서는 제외된 상황이에요.')
    if (allSeatsOff(seats)) return block('세 자리가 모두 참여 꺼짐 상태예요.')
    if (situation.needsAwayDetect && !settings.privacyFlags.awayDetect)
      return block("'창 이탈 감지 허용'이 꺼져 있어 이 상황을 감지하지 않아요.")
    if (situation.trigger && !settings.triggers[situation.trigger])
      return block('이 상황의 개입이 꺼져 있어요.')

    const verdictRaw = canIntervene(settings, {
      userTyping: false,
      sinceLastInterventionSec: settings.thresholds.cooldownMin * 60 + 60,
      interventionsThisHour: 0,
    })
    if (!verdictRaw.allowed) return block(`${verdictRaw.reason} 규칙에 막혔어요.`)
    if (!styles.length) return block('개입 방식이 하나도 켜져 있지 않아 표현할 방법이 없어요.')

    const speaker = pickInterventionSpeaker(seats)
    return {
      allowed: true,
      verdict: '개입함',
      reason: '방해 방지·개입 빈도·재개입 대기 시간을 모두 통과했어요.',
      speakers: speaker ? [speaker] : [],
      line: speaker ? toneSample(toneOf(speaker), situation.line === 'away' ? '복귀' : '개념') : '',
      styles,
      facts,
    }
  }, [open, sit, nonce, settings, seats, situation])

  return (
    <Drawer open={open} onClose={onClose} title="반응 미리보기" width={460}>
      <p className="t-help mb-4">실제 AI를 부르지 않고, 지금 설정으로 어떤 판정이 나오는지만 보여줍니다.</p>

      <div className="mb-5 flex items-center gap-2">
        <label className="t-help shrink-0">상황</label>
        <Select
          ariaLabel="미리볼 상황"
          value={sit}
          onChange={setSit}
          options={SITUATIONS.map((s) => ({ value: s.value, label: s.label }))}
        />
      </div>

      {result && (
        <div className="flex flex-col gap-4">
          <PreviewBlock step="1" title="현재 적용된 주요 설정">
            <dl className="flex flex-col gap-1.5">
              {result.facts.map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-4">
                  <dt className="t-help">{k}</dt>
                  <dd className="t-item text-right">{v}</dd>
                </div>
              ))}
            </dl>
          </PreviewBlock>

          <PreviewBlock step="2" title="개입 여부">
            <div className="flex items-start gap-2">
              <span
                className={[
                  't-caption shrink-0 rounded-full border px-2.5 py-1',
                  result.allowed
                    ? 'bg-sage border-[var(--text-dark)]'
                    : 'bg-danger-bg border-[var(--danger)] text-danger',
                ].join(' ')}
              >
                {result.verdict}
              </span>
              <p className="t-body">{result.reason}</p>
            </div>
          </PreviewBlock>

          <PreviewBlock step="3" title="답변 담당 캐릭터">
            {result.speakers.length ? (
              <div className="flex flex-wrap items-center gap-3">
                {result.speakers.map((s) => (
                  <span
                    key={s.slotNo}
                    className="inline-flex items-center gap-2 rounded-full border border-hairline bg-white px-3 py-1.5"
                  >
                    <CharacterSprite imageKey={s.imageKey} size={24} state="studying" />
                    <span className="t-item">
                      {s.slotNo}번 {s.name}
                    </span>
                  </span>
                ))}
                <Button variant="ghost" onClick={() => setNonce((n) => n + 1)}>
                  <Shuffle size={14} /> 다시 뽑기
                </Button>
              </div>
            ) : (
              <p className="t-body text-subtle">없음</p>
            )}
          </PreviewBlock>

          <PreviewBlock step="4" title="예상 반응">
            {result.line ? (
              <p className="t-body rounded-sm rounded-tl-none bg-peach px-4 py-3">{result.line}</p>
            ) : (
              <p className="t-body text-subtle">아무 말도 하지 않아요.</p>
            )}
          </PreviewBlock>

          <PreviewBlock step="5" title="사용되는 개입 방식">
            {result.styles.length ? (
              <div className="flex flex-wrap gap-2">
                {result.styles.map((s) => (
                  <span key={s} className="t-caption rounded-full border border-hairline bg-white px-3 py-1">
                    {s}
                  </span>
                ))}
              </div>
            ) : (
              <p className="t-body text-subtle">
                {result.allowed ? '이 상황에서는 개입 방식을 쓰지 않아요.' : '없음'}
              </p>
            )}
          </PreviewBlock>
        </div>
      )}
    </Drawer>
  )
}

function PreviewBlock({ step, title, children }) {
  return (
    <section className="rounded-sm border border-hairline bg-surface p-4">
      <h3 className="t-caption mb-2 flex items-center gap-2">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-lavender tnum">
          {step}
        </span>
        {title}
      </h3>
      {children}
    </section>
  )
}

/**
 * 기능 배정.
 *
 * 배정은 좌석이 아니라 **방 전체의 맵 하나**에 있다(settings.functionOwner).
 * 맵이면 "두 캐릭터가 같은 기능을 맡음"과 "아무도 안 맡음"이 표현 자체가 불가능하다.
 *
 * 여섯 기능을 세 자리에 나누면 한 자리당 정확히 두 개라 **여유가 0**이다.
 * 그래서 고르면 비활성화가 아니라 **자리를 맞바꾼다** — 비활성화만 쓰면 한 번 정해진 뒤
 * 어떤 줄에서도 다른 자리를 고를 수 없어 배정기가 잠긴 것처럼 보인다.
 *
 * 개념 해설과 심화 해설은 한 줄로 묶었다. 문서가 "같은 캐릭터여야 한다"고 못 박았고,
 * 따로 두면 사용자가 어길 수 있는 규칙을 만들어 놓고 나중에 혼내는 꼴이 된다.
 */
function FunctionAssign({ slotNo }) {
  const seats = useStore((s) => s.seats)
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)

  const rows = [
    { key: 'F1', label: '개념 해설 + 심화 해설', pair: ['F1', 'F6'], hint: FUNC_META.F1.hint },
    { key: 'F2', label: FUNC_META.F2.label, pair: ['F2'], hint: FUNC_META.F2.hint },
    { key: 'F3', label: FUNC_META.F3.label, pair: ['F3'], hint: FUNC_META.F3.hint },
    { key: 'F4', label: FUNC_META.F4.label, pair: ['F4'], hint: FUNC_META.F4.hint },
    { key: 'F5', label: FUNC_META.F5.label, pair: ['F5'], hint: FUNC_META.F5.hint },
  ]

  const move = (pair, toSlot) => {
    const map = { ...settings.functionOwner }
    const fromSlot = map[pair[0]]
    if (fromSlot === toSlot) return
    // 자리를 맞바꾼다. 상대 자리에서 옮겨올 기능을 하나 고른다
    const victim = FUNCS.filter((f) => map[f] === toSlot && !pair.includes(f))
      .filter((f) => !(pair.includes('F1') && f === 'F6'))
      .slice(0, pair.length)
    for (const f of pair) map[f] = toSlot
    for (const f of victim) map[f] = fromSlot
    // F1·F6 는 언제나 함께
    if (map.F1 !== map.F6) map.F6 = map.F1
    if (validateOwner(map).length) return // 규칙을 어기는 이동은 무시한다
    updateSettings({ functionOwner: map })
  }

  const warnings = validateOwner(settings.functionOwner)

  return (
    <>
      {rows.map((r, i) => (
        <Row key={r.key} title={r.label} help={r.hint} last={i === rows.length - 1}>
          <Segmented
            ariaLabel={r.label}
            value={ownerSlot(settings, r.key)}
            onChange={(v) => move(r.pair, Number(v))}
            options={seats.map((st) => ({
              value: st.slotNo,
              label: st.name + (st.slotNo === slotNo ? ' (여기)' : ''),
            }))}
          />
        </Row>
      ))}
      {warnings.map((w) => (
        <p key={w} className="t-help text-danger mt-2">
          {w}
        </p>
      ))}
    </>
  )
}
