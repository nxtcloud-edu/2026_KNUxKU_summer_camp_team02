/**
 * 대기 화면 (입장 직전) — 통합 설계서 §6-2
 *
 * 존재 이유: 내가 어떻게 보이고 들리는지 확인시켜 주고, 함께 들어올 자리를 미리 살펴보게 하는 것 (§6-2)
 * 판정 기준 §12-3의 1~15를 이 파일에서 만족시킨다.
 *
 * 모션 존 B (§4-3): 배경 블롭·그레인·카드 기울임 금지. 진입 애니메이션만 절제해서 쓴다.
 * 데스크톱 전용 (§12-2, [결정 5]) — 반응형 분기 없음.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Settings,
  RotateCcw,
  AlertTriangle,
  WifiOff,
  Users,
  Paperclip,
} from 'lucide-react'
import { useStore, allSeatsOff } from '../store/useStore'
import { db } from '../store/db'
import { PRESETS } from '../lib/presets'
import { Button, IconBtn, CharacterSprite } from '../components/ui'

/* ── 지역 상수 · 헬퍼 ─────────────────────────────────────── */

/** 셀렉터 지점 4개 (§6-2 레이아웃) — 순서 = 좌→우 */
const POINT_KEYS = ['me', 1, 2, 3]
const BAR_COUNT = 18

/** 자리별 파스텔 배경 — 토큰만 사용 (§4-1) */
const SEAT_BG = { 1: 'bg-lavender', 2: 'bg-sage', 3: 'bg-peach' }

/** getUserMedia 에러 이름 → device.permission 열거값 (§6-2 카메라를 보여줄 수 없는 상황) */
function classifyError(err) {
  const n = (err && err.name) || ''
  if (n === 'NotAllowedError' || n === 'PermissionDeniedError' || n === 'SecurityError') return 'denied'
  if (n === 'NotFoundError' || n === 'DevicesNotFoundError' || n === 'OverconstrainedError') return 'notfound'
  if (n === 'NotReadableError' || n === 'TrackStartError' || n === 'AbortError') return 'busy'
  return 'unknown'
}

/** 4가지 상황별 안내 문구 (§6-2 표) — 어떤 경우에도 입장은 가능하다 */
const CAM_ISSUE = {
  denied: {
    title: '카메라 권한이 꺼져 있어요',
    body: '주소창 왼쪽 자물쇠 아이콘을 눌러 카메라를 "허용"으로 바꾼 뒤 다시 시도해 주세요.',
    retry: '다시 시도',
  },
  notfound: {
    title: '연결된 카메라를 찾을 수 없어요',
    body: '카메라를 연결한 뒤 다시 확인해 주세요. 카메라 없이도 그대로 입장할 수 있어요.',
    retry: '다시 확인',
  },
  busy: {
    title: '다른 프로그램이 카메라를 쓰는 중이에요',
    body: '화상 회의나 녹화 앱을 종료한 뒤 다시 시도해 주세요. 카메라 없이도 입장할 수 있어요.',
    retry: '다시 시도',
  },
  unknown: {
    title: '카메라를 시작하지 못했어요',
    body: '잠시 뒤 다시 시도해 주세요. 카메라 없이도 그대로 입장할 수 있어요.',
    retry: '다시 시도',
  },
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/* ── 화면 ─────────────────────────────────────────────────── */

export default function LobbyScreen() {
  /* 스토어는 반드시 필드 단위로 구독한다 (객체를 새로 만들면 무한 렌더) */
  const go = useStore((s) => s.go)
  const seats = useStore((s) => s.seats)
  const device = useStore((s) => s.device)
  const setDevice = useStore((s) => s.setDevice)
  const setStream = useStore((s) => s.setStream)
  const previewTarget = useStore((s) => s.previewTarget)
  const setPreviewTarget = useStore((s) => s.setPreviewTarget)
  const openSettings = useStore((s) => s.openSettings)
  const displayName = useStore((s) => s.displayName)
  const setSessionId = useStore((s) => s.setSessionId)
  const setPendingDoc = useStore((s) => s.setPendingDoc)
  const toast = useStore((s) => s.toast)

  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const barsRef = useRef(null)
  const tokenRef = useRef(0)
  const handoffRef = useRef(false) // 룸으로 스트림을 넘기는 중이면 언마운트에서 끊지 않는다 (§5-4)
  const enteringRef = useRef(false)
  const enterTimerRef = useRef(null)
  const dragEndAtRef = useRef(0) // 셀렉터 드래그 직후 설정 버튼 클릭 차단 (§12-3 12)
  const micOnRef = useRef(device.micOn)

  const [localStream, setLocalStream] = useState(null)
  const [acquiring, setAcquiring] = useState(true)
  const [entering, setEntering] = useState(false)
  /**
   * 이번에 뭘 할지 한 줄.
   *
   * 목표 추적(F4)이 이걸 **원문 그대로 인용**해서 되묻는다. 비워도 입장은 된다 —
   * 매번 목표를 강요하면 그냥 아무거나 적게 되고, 그러면 되묻는 말이 더 어색해진다.
   */
  const [goal, setGoal] = useState('')
  const [tick, setTick] = useState(0) // 트랙 ended 등으로 재계산이 필요할 때
  const [counts, setCounts] = useState({ cams: null, mics: null })
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)

  // PDF 업로드 관련
  const fileRef = useRef(null)
  const [uploadedFile, setUploadedFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  // 랜덤 캐릭터 (mina/theo/juno 중 하나)
  const [randomChar] = useState(() => {
    const chars = ['bear', 'tiger', 'duck']
    return chars[Math.floor(Math.random() * chars.length)]
  })

  const seatOf = (n) => seats.find((s) => s.slotNo === n) || null
  const isMe = previewTarget === 'me'

  /* ── 카메라·마이크 확보 ─────────────────────────────────── */

  /** 얻은 스트림을 스토어·비디오에 붙인다. 토큰이 어긋나면(재마운트) 즉시 정리한다 */
  const attach = useCallback(
    (s, kind, token) => {
      if (token !== tokenRef.current) {
        if (s) s.getTracks().forEach((t) => t.stop())
        return
      }
      const hasVideo = !!(s && s.getVideoTracks().length)
      const d = useStore.getState().device
      if (s) {
        // 빠른 토글의 현재 의사를 그대로 적용 (§5-4 단일 전역 상태)
        s.getVideoTracks().forEach((t) => {
          t.enabled = d.cameraOn
        })
        s.getAudioTracks().forEach((t) => {
          t.enabled = d.micOn
        })
        // 사용 중 장치를 뽑았을 때 (§6-2 예외)
        s.getTracks().forEach((t) => {
          t.onended = () => {
            setTick((x) => x + 1)
            if (t.kind === 'video') useStore.getState().setDevice({ permission: 'notfound' })
          }
        })
      }
      streamRef.current = s
      setStream(s) // 룸이 그대로 재사용한다 (§5-4)
      setLocalStream(s)
      setDevice({ permission: hasVideo ? 'granted' : kind, cameraOn: hasVideo ? true : false })
      setTick((x) => x + 1)
    },
    [setDevice, setStream],
  )

  const acquire = useCallback(
    async (token) => {
      setAcquiring(true)
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        attach(null, 'notfound', token)
        setAcquiring(false)
        return
      }
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        attach(s, 'granted', token)
      } catch (err) {
        const kind = classifyError(err)
        // 권한 거부가 아니라면 카메라만 문제일 수 있다 — 마이크라도 살려서 입력 레벨을 보여준다
        if (kind !== 'denied') {
          try {
            const a = await navigator.mediaDevices.getUserMedia({ audio: true })
            attach(a, kind, token)
            setAcquiring(false)
            return
          } catch {
            /* 마이크도 실패 — 아래로 */
          }
        }
        attach(null, kind, token)
      }
      setAcquiring(false)
    },
    [attach],
  )

  const stopStream = useCallback(() => {
    const s = streamRef.current
    if (s) s.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  /* 진입 시 한 번만 확보. 살아 있는 스트림이 이미 있으면 권한을 다시 묻지 않는다 (§12-3 3) */
  useEffect(() => {
    const token = ++tokenRef.current
    const existing = useStore.getState().stream
    if (existing && existing.getTracks().some((t) => t.readyState === 'live')) {
      attach(existing, 'granted', token)
      setAcquiring(false)
    } else {
      acquire(token)
    }
    return () => {
      tokenRef.current++
      if (!handoffRef.current) stopStream() // 화면을 벗어나면 카메라 표시등이 꺼진다 (§12-3 15)
      if (enterTimerRef.current) clearTimeout(enterTimerRef.current)
    }
  }, [acquire, attach, stopStream])

  /* 비디오 엘리먼트에 연결 — muted 필수 (내 목소리를 스피커로 되돌리지 않는다, §6-2) */
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.muted = true // 되돌림 방지를 속성만이 아니라 프로퍼티로도 확실히 (§6-2)
    if (v.srcObject !== localStream) v.srcObject = localStream
    if (localStream) {
      const p = v.play()
      if (p && p.catch) p.catch(() => {})
    }
  }, [localStream])

  /* 새로고침·탭 닫기에서도 확실히 해제 (§6-2 예외) */
  useEffect(() => {
    const bye = () => {
      if (!handoffRef.current) stopStream()
    }
    window.addEventListener('beforeunload', bye)
    window.addEventListener('pagehide', bye)
    return () => {
      window.removeEventListener('beforeunload', bye)
      window.removeEventListener('pagehide', bye)
    }
  }, [stopStream])

  /* 장치를 꽂거나 뺐을 때 목록 갱신 (§6-2 예외) */
  useEffect(() => {
    const md = navigator.mediaDevices
    if (!md || !md.enumerateDevices) return undefined
    let first = true
    const refresh = async () => {
      try {
        const list = await md.enumerateDevices()
        setCounts({
          cams: list.filter((d) => d.kind === 'videoinput').length,
          mics: list.filter((d) => d.kind === 'audioinput').length,
        })
        if (!first) toast('연결된 장치 목록을 새로 읽었어요.')
      } catch {
        /* 목록을 못 읽어도 화면은 멀쩡해야 한다 */
      }
      first = false
    }
    refresh()
    if (md.addEventListener) md.addEventListener('devicechange', refresh)
    return () => {
      if (md.removeEventListener) md.removeEventListener('devicechange', refresh)
    }
  }, [toast])

  /* 인터넷 연결 (§6-2 예외 — 끊기면 입장 버튼이 눌리지 않고 이유를 알려준다) */
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  /* ── 마이크 입력 레벨 (§6-2) — AnalyserNode를 destination에 연결하지 않아 되돌림이 없다 ── */
  useEffect(() => {
    micOnRef.current = device.micOn
  }, [device.micOn])

  useEffect(() => {
    const s = localStream
    if (!s || !s.getAudioTracks().length) return undefined
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return undefined

    let ctx
    try {
      ctx = new Ctx()
    } catch {
      return undefined
    }
    const src = ctx.createMediaStreamSource(s)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    analyser.smoothingTimeConstant = 0.65
    src.connect(analyser) // 여기서 끝 — destination으로 보내지 않는다
    const buf = new Uint8Array(analyser.fftSize)
    let raf = 0
    let smooth = 0

    const paint = () => {
      analyser.getByteTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128
        sum += v * v
      }
      const rms = Math.sqrt(sum / buf.length)
      const target = micOnRef.current ? clamp(rms * 3.4, 0, 1) : 0
      smooth = smooth + (target - smooth) * (target > smooth ? 0.55 : 0.12)
      const host = barsRef.current
      if (host) {
        const lit = Math.round(smooth * BAR_COUNT)
        for (let i = 0; i < host.children.length; i++) {
          const el = host.children[i]
          const on = i < lit
          // 색만으로 구분하지 않는다 (§11) — 높이도 함께 바뀐다
          el.style.transform = `scaleY(${on ? 0.35 + (i / BAR_COUNT) * 0.65 : 0.18})`
          el.style.background = on ? 'var(--chart-focus)' : 'var(--chart-track)'
        }
      }
      raf = requestAnimationFrame(paint)
    }
    raf = requestAnimationFrame(paint)

    return () => {
      cancelAnimationFrame(raf)
      try {
        src.disconnect()
      } catch {
        /* noop */
      }
      try {
        analyser.disconnect()
      } catch {
        /* noop */
      }
      if (ctx.state !== 'closed') ctx.close().catch(() => {}) // 언마운트 시 close (§6-2)
    }
  }, [localStream])

  /* ── 빠른 토글 — 트랙 enabled만 바꾼다. 권한 재요청·스트림 재생성 없음 (§12-3 2·3) ── */
  const videoTrack = localStream && localStream.getVideoTracks ? localStream.getVideoTracks()[0] : null
  const audioTrack = localStream && localStream.getAudioTracks ? localStream.getAudioTracks()[0] : null
  const camLive = !!videoTrack && videoTrack.readyState === 'live'
  const micLive = !!audioTrack && audioTrack.readyState === 'live'
  const camShown = camLive && device.cameraOn
  void tick // 트랙 상태 변화를 렌더에 반영하기 위한 의존값

  const toggleCam = () => {
    const next = !device.cameraOn
    setDevice({ cameraOn: next })
    if (streamRef.current)
      streamRef.current.getVideoTracks().forEach((t) => {
        t.enabled = next
      })
  }
  const toggleMic = () => {
    const next = !device.micOn
    setDevice({ micOn: next })
    if (streamRef.current)
      streamRef.current.getAudioTracks().forEach((t) => {
        t.enabled = next
      })
  }

  /* ── 셀렉터 ───────────────────────────────────────────── */
  const items = POINT_KEYS.map((key) => {
    if (key === 'me') {
      return { key, label: displayName || '나', aria: `나 — 내 카메라 미리보기`, dim: false }
    }
    const seat = seatOf(key)
    const name = seat ? seat.name : `${key}번`
    return {
      key,
      label: `${key}번 · ${name}`,
      aria: `${key}번 자리 ${name}${seat && seat.enabled ? '' : ' (참여 꺼짐)'}`,
      dim: !(seat && seat.enabled), // 참여 OFF인 자리는 옅게 (§6-2)
    }
  })

  const stepTarget = (delta) => {
    const i = POINT_KEYS.indexOf(previewTarget)
    const next = clamp((i < 0 ? 0 : i) + delta, 0, POINT_KEYS.length - 1)
    setPreviewTarget(POINT_KEYS[next])
  }

  /* 미리보기 영역을 좌우로 밀어도 이전·다음 자리로 넘어간다 (§6-2 셀렉터 조작 2) */
  const swipeRef = useRef({ active: false, startX: 0 })
  const onPreviewDown = (e) => {
    if (e.target && e.target.closest && e.target.closest('button')) return
    swipeRef.current = { active: true, startX: e.clientX }
    if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPreviewMove = (e) => {
    const d = swipeRef.current
    if (!d.active) return
    const dx = e.clientX - d.startX
    if (Math.abs(dx) >= 80) {
      stepTarget(dx > 0 ? -1 : 1)
      d.startX = e.clientX
    }
  }
  const onPreviewUp = () => {
    swipeRef.current.active = false
  }

  /* ── 설정 버튼 (§6-2 · §12-3 9·12) ─────────────────────── */
  const openTargetSettings = () => {
    // 셀렉터를 끌다 커서가 오른쪽 끝에 닿아도 팝업이 열리면 안 된다
    if (Date.now() - dragEndAtRef.current < 300) return
    openSettings(previewTarget)
  }
  const targetLabel = isMe
    ? '나'
    : `${previewTarget}번 ${seatOf(previewTarget) ? seatOf(previewTarget).name : ''}`.trim()

  /* ── 입장 (§6-2) ──────────────────────────────────────── */
  const enterRoom = () => {
    if (enteringRef.current) return // 두 번 눌러도 두 번 들어가지 않는다
    if (!online) {
      toast('인터넷 연결이 끊겨 입장할 수 없어요. 연결을 확인해 주세요.', 'danger')
      return
    }
    if (!String(displayName || '').trim()) {
      toast('방에서 쓸 이름을 먼저 정해 주세요.', 'danger')
      openSettings('me') // 본인 설정창 → 프로필 (§5-4 이름의 소유 화면)
      return
    }
    enteringRef.current = true
    setEntering(true)
    handoffRef.current = true // 스트림을 룸으로 그대로 넘긴다 (§5-4)
    const id = db.startSession()
    db.setGoal(id, goal.trim())
    setSessionId(id)
    db.logEvent(id, 'enter', { camera: camShown, mic: micLive && device.micOn })
    enterTimerRef.current = setTimeout(() => go('room'), 240)
  }

  const leave = () => {
    stopStream() // 카메라 표시등이 꺼지게 한다 (§12-3 15)
    setStream(null)
    setLocalStream(null)
    go('home')
  }

  const noSeats = allSeatsOff(seats)
  const issue = CAM_ISSUE[device.permission] || CAM_ISSUE.unknown
  const showIssue = isMe && !camLive && device.permission !== 'unknown'
  const initial = (String(displayName || '나').trim()[0] || '나').toUpperCase()

  /* ── 렌더 ─────────────────────────────────────────────── */
  return (
    <main className="relative min-h-full overflow-hidden bg-warm pb-16">
      {/* 존 B — 움직이는 장식은 없다. 다만 유리는 뒤에 색이 있어야 읽히므로
          정지한 색 층만 아주 옅게 깐다 (§4-3 존 B: 블롭·그레인 금지, 모션 금지) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(900px 420px at 12% 96%, rgba(232,239,232,.9), transparent 62%),' +
            'radial-gradient(760px 380px at 88% 88%, rgba(255,240,237,.95), transparent 60%),' +
            'radial-gradient(680px 340px at 60% 4%, rgba(239,237,244,.75), transparent 58%)',
        }}
      />
      <header className="relative mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-0 pt-7">
        <button
          type="button"
          onClick={leave}
          className="inline-flex items-center gap-2 rounded-full px-3 py-2 t-item text-subtle transition-colors duration-300 hover:bg-[var(--hover-bg)] hover:text-ink"
        >
          <ArrowLeft size={18} aria-hidden="true" />
          뒤로가기
        </button>
        <h1 className="t-screen mt-4 enter-up">들어가기 전에 확인해요</h1>
        <p className="t-help enter-up d1">
          내 모습과 소리를 확인하고, 함께 들어갈 자리를 살펴보세요. 카메라를 끄면 집중 시간이 체크되지 않아요.
        </p>
      </header>

      {/* ── 미리보기 + 우측 패널 ─────────────────────────── */}
      <div className="relative mx-auto mt-6 flex w-full max-w-6xl px-4 sm:px-6 lg:px-0 items-stretch gap-4 enter-up d2">
        <section
          aria-label="본인 미리보기"
          onPointerDown={onPreviewDown}
          onPointerMove={onPreviewMove}
          onPointerUp={onPreviewUp}
          onPointerCancel={onPreviewUp}
          className="relative h-[360px] sm:h-[500px] flex-[3] select-none overflow-hidden rounded-lg bg-surface-dark shadow-soft"
          style={{ touchAction: 'none' }}
        >
          {/* 나 — 카메라 레이어. 자리를 옮겨도 언마운트하지 않는다(스트림 재생성 금지, §12-3 7) */}
          <div
            aria-hidden={!isMe}
            className={[
              'absolute inset-0 transition-opacity duration-300',
              isMe ? 'opacity-100' : 'pointer-events-none opacity-0',
            ].join(' ')}
          >
            <video
              ref={videoRef}
              muted /* 자기 목소리를 스피커로 되돌려 보내지 않는다 (§6-2) */
              autoPlay
              playsInline
              className="h-full w-full object-cover"
              style={{
                transform: device.mirror ? 'scaleX(-1)' : 'none', // 거울처럼 좌우 반전 (§6-2)
                visibility: camShown ? 'visible' : 'hidden',
              }}
            />

            {/* 카메라를 보여줄 수 없는 4가지 상황 — 모두 surface-dark + 프로필 이니셜로 통일 (§6-2) */}
            {!camShown && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-surface-dark px-10 text-center">
                <div
                  aria-hidden="true"
                  className="flex h-24 w-24 items-center justify-center rounded-full bg-[var(--bg-warm)] text-[34px] font-semibold text-strong"
                >
                  {initial}
                </div>
                <div className="t-section text-[var(--bg-warm)]">
                  {acquiring ? '카메라를 켜는 중…' : showIssue ? issue.title : '카메라 꺼짐'}
                </div>
                <p className="t-body max-w-full sm:max-w-[520px] text-[var(--bg-warm)] opacity-80">
                  {acquiring
                    ? '잠시만 기다려 주세요.'
                    : showIssue
                      ? issue.body
                      : `${displayName || '나'} — 카메라가 꺼져 있어요. 위의 카메라 버튼으로 다시 켤 수 있어요.`}
                </p>
                {isMe && showIssue && !acquiring && (
                  <Button variant="secondary" onClick={() => acquire(tokenRef.current)}>
                    <RotateCcw size={16} aria-hidden="true" />
                    {issue.retry}
                  </Button>
                )}
                {showIssue && counts.cams === 0 && (
                  <p className="t-caption text-[var(--bg-warm)] opacity-70">연결된 카메라 0대</p>
                )}
              </div>
            )}
          </div>

          {/* 캐릭터 레이어 — 항상 마운트해 두어 지점을 옮기는 즉시 나타난다 (§12-3 8). 좌우 반전 없음 */}
          {seats.map((seat) => {
            const on = previewTarget === seat.slotNo
            const preset = PRESETS[seat.preset]
            return (
              <div
                key={seat.slotNo}
                aria-hidden={!on}
                className={[
                  'absolute inset-0 flex flex-col items-center justify-center gap-3 transition-opacity duration-300',
                  SEAT_BG[seat.slotNo] || 'bg-lavender',
                  on ? 'opacity-100' : 'pointer-events-none opacity-0',
                ].join(' ')}
              >
                <CharacterSprite
                  imageKey={seat.imageKey}
                  size={220}
                  state="studying"
                  style={seat.enabled ? undefined : { filter: 'grayscale(1)', opacity: 0.55 }}
                />
                <div className="t-section text-strong">{seat.name}</div>
                <div className="t-help">
                  {seat.slotNo}번 자리 · {preset ? preset.archetype : '커스텀'}
                </div>
                <div
                  className={[
                    'mt-1 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 t-caption',
                    seat.enabled
                      ? 'border-hairline bg-surface text-subtle'
                      : 'border-[var(--danger)] bg-danger-bg text-danger',
                  ].join(' ')}
                >
                  {seat.enabled ? (
                    <Users size={13} aria-hidden="true" />
                  ) : (
                    <AlertTriangle size={13} aria-hidden="true" />
                  )}
                  {seat.enabled ? '함께 들어갑니다' : '참여 꺼짐 — 빈 자리로 표시돼요'}
                </div>
              </div>
            )
          })}

          {/* 빠른 토글 — 어느 자리를 보고 있든 내 장치 상태를 바꾼다 (§6-2, §12-3 2·7) */}
          <div className="absolute right-4 top-4 flex items-center gap-2">
            <IconBtn
              label={!micLive ? '마이크를 사용할 수 없음' : device.micOn ? '마이크 끄기' : '마이크 켜기'}
              aria-pressed={device.micOn}
              tone={device.micOn ? 'glassDark' : 'danger'}
              onClick={toggleMic}
              disabled={!micLive}
              style={{ height: 44, width: 44 }}
            >
              {device.micOn ? <Mic size={19} /> : <MicOff size={19} />}
            </IconBtn>
            <IconBtn
              label={!camLive ? '카메라를 사용할 수 없음' : device.cameraOn ? '카메라 끄기' : '카메라 켜기'}
              aria-pressed={device.cameraOn}
              tone={device.cameraOn ? 'glassDark' : 'danger'}
              onClick={toggleCam}
              disabled={!camLive}
              style={{ height: 44, width: 44 }}
            >
              {device.cameraOn ? <Video size={19} /> : <VideoOff size={19} />}
            </IconBtn>
          </div>

          {/* 마이크 입력 레벨 (§6-2) */}
          {/* 뒤에 깔린 면이 영상(어두움)인지 캐릭터 카드(밝음)인지에 따라 유리 톤을 바꾼다.
              한쪽으로 고정하면 반대 배경에서 글자 대비가 무너진다 (§11) */}
          <div
            className={[
              'absolute bottom-4 left-4 flex items-center gap-3 rounded-full px-4 py-2',
              isMe ? 'glass-dark' : 'glass',
            ].join(' ')}
          >
            {device.micOn && micLive ? (
              <Mic size={16} className={isMe ? 'text-[var(--bg-warm)]' : 'text-ink'} aria-hidden="true" />
            ) : (
              <MicOff size={16} className={isMe ? 'text-[var(--bg-warm)]' : 'text-ink'} aria-hidden="true" />
            )}
            <div ref={barsRef} aria-hidden="true" className="flex h-4 items-center gap-[3px]">
              {Array.from({ length: BAR_COUNT }).map((_, i) => (
                <span
                  key={i}
                  className="h-4 w-[3px] rounded-full"
                  style={{
                    background: 'var(--chart-track)',
                    transformOrigin: 'center',
                    transform: 'scaleY(0.18)',
                  }}
                />
              ))}
            </div>
            <span className={['t-caption', isMe ? 'text-[var(--bg-warm)]' : 'text-ink'].join(' ')}>
              {!micLive ? '마이크 없음' : device.micOn ? '마이크 켜짐' : '마이크 꺼짐'}
            </span>
          </div>
        </section>

        {/* ── 우측 패널 ── */}
        <div className="flex w-[260px] sm:w-[300px] shrink-0 flex-col gap-4">
          {/* 오늘 뭘 할 거야? — 맨 위 고정 */}
          <div>
            <span className="t-caption text-muted">오늘 뭘 할 거야? (건너뛰어도 돼)</span>
            <input
              type="text"
              value={goal}
              maxLength={40}
              onChange={(e) => setGoal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing && !entering && online) enterRoom()
              }}
              placeholder="예: 자료구조 3장 끝내기"
              className="mt-2 border-hairline t-body bg-surface w-full rounded-2xl border px-4 py-3 outline-none transition-colors duration-200 focus:border-[var(--text-strong)]"
            />
          </div>

          {/* PDF 업로드 */}
          <div>
            <span className="t-caption text-muted">사전 학습자료</span>
            {uploadedFile ? (
              <div className="mt-2 flex items-center gap-2 rounded-2xl border border-hairline bg-[var(--hover-bg)] px-4 py-3">
                <Paperclip size={16} className="shrink-0 text-subtle" />
                <span className="t-body truncate flex-1">{uploadedFile.name}</span>
                {uploading && <span className="t-caption text-muted">읽는 중…</span>}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="mt-2 flex w-full items-center gap-2 rounded-2xl border border-dashed border-hairline px-4 py-3 t-body text-muted transition-colors hover:bg-[var(--hover-bg)] hover:text-ink"
              >
                <Paperclip size={16} />
                PDF 파일 업로드
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.txt,.md,.docx"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file) return
                setUploadedFile(file)
                setUploading(true)
                setPendingDoc(file)
                // 업로드 시뮬레이션 (실제로는 StudyRoomScreen 입장 시 processFile이 처리)
                setTimeout(() => {
                  setUploading(false)
                  toast('학습 자료 준비 완료. 입장하면 바로 요약을 시작해요.')
                }, 2000)
              }}
            />
          </div>

          {/* 캐릭터 이미지 — 랜덤 */}
          <div className="flex flex-1 items-center justify-center">
            <CharacterSprite imageKey={randomChar} size={120} state="studying" />
          </div>

          {/* 입장하기 — 하단 고정, 작게. 업로드 중엔 비활성화 */}
          <Button
            variant="primary"
            onClick={enterRoom}
            disabled={entering || !online || uploading}
            aria-label={entering ? '입장 중' : '입장하기'}
            className="w-full py-3 text-[15px] font-semibold"
          >
            {entering ? '입장 중…' : uploading ? '자료 읽는 중…' : '입장하기'}
          </Button>
        </div>
      </div>

      {/* ── 커스텀 패널 — 항상 펼쳐져 있음. 접기/펼치기 없음 (§6-2) ── */}
      <section
        aria-label="자리 미리보기와 설정"
        className="glass glass-spec relative mx-auto mt-4 flex w-full max-w-6xl items-center gap-4 sm:gap-6 rounded-full px-6 sm:px-14 py-4 enter-up d3"
      >
        {/* 셀렉터 — 패널 안쪽 왼편을 넓게 차지 */}
        <div className="min-w-0 flex-1">
          <Selector
            items={items}
            value={previewTarget}
            onChange={setPreviewTarget}
            onDragEnd={() => {
              dragEndAtRef.current = Date.now()
            }}
          />
        </div>

        {/* 끌기 영역과 설정 버튼의 경계를 분명히 나눈다 (§6-2) */}
        <div className="h-14 w-px shrink-0 bg-white/70" aria-hidden="true" />

        {/* 설정 버튼 — 패널 안쪽 오른쪽 끝의 원형 버튼 (§6-2) */}
        <div className="flex w-[72px] sm:w-[92px] shrink-0 flex-col items-center gap-1">
          <button
            type="button"
            aria-label={`${targetLabel} 설정 열기`}
            onClick={openTargetSettings}
            className="glass flex h-14 w-14 items-center justify-center rounded-full text-ink transition-all duration-300 hover:-translate-y-0.5"
          >
            <Settings size={22} aria-hidden="true" />
          </button>
          <span className="t-caption text-center leading-tight">{targetLabel} 설정</span>
        </div>
      </section>

      {/* ── 안내 줄 ─────────────────────────────────────── */}
      <div className="relative mx-auto mt-3 flex w-full max-w-6xl px-4 sm:px-6 lg:px-0 flex-col gap-2">
        <p className="t-help">
          지점을 누르거나 좌우로 끌어서 자리를 살펴보세요. 방향키 ←·→ 로도 옮길 수 있어요. 캐릭터 자리를 봐도
          내 카메라·마이크는 그대로예요.
        </p>
        {noSeats && (
          <p className="inline-flex items-center gap-2 t-body text-danger">
            <AlertTriangle size={16} aria-hidden="true" />세 자리 모두 참여가 꺼져 있어요. 이대로 들어가면
            혼자 공부하게 됩니다.
          </p>
        )}
        {!online && (
          <p className="inline-flex items-center gap-2 t-body text-danger">
            <WifiOff size={16} aria-hidden="true" />
            인터넷 연결이 끊겼어요. 연결이 돌아오면 입장할 수 있어요.
          </p>
        )}
      </div>
    </main>
  )
}

/* ── 셀렉터 (§6-2 셀렉터 조작) ─────────────────────────────
   ① 직접 누르기 ② 마우스 드래그(Pointer Events) ③ 좌우 방향키 — 셋 다 된다.
   끄는 도중에도 미리보기가 실시간으로 바뀌고, 손을 떼면 가장 가까운 지점에 딱 붙는다. */
function Selector({ items, value, onChange, onDragEnd }) {
  const railRef = useRef(null)
  const dotRefs = useRef([])
  const draggingRef = useRef(false)
  const [dragging, setDragging] = useState(false)

  const n = items.length
  const idx = Math.max(
    0,
    items.findIndex((it) => it.key === value),
  )
  const [pos, setPos] = useState(idx)

  useEffect(() => {
    if (!draggingRef.current) setPos(idx)
  }, [idx])

  const posFromX = (clientX) => {
    const rail = railRef.current
    if (!rail) return idx
    const r = rail.getBoundingClientRect()
    const t = clamp((clientX - r.left) / Math.max(1, r.width), 0, 1)
    return t * (n - 1)
  }

  const down = (e) => {
    const p = posFromX(e.clientX)
    draggingRef.current = true
    setDragging(true)
    setPos(p)
    const snapped = Math.round(p)
    if (items[snapped].key !== value) onChange(items[snapped].key)
    if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId)
  }

  const move = (e) => {
    if (!draggingRef.current) return
    const p = posFromX(e.clientX)
    setPos(p)
    const snapped = Math.round(p) // 끄는 도중에도 미리보기가 실시간으로 바뀐다
    if (items[snapped].key !== value) onChange(items[snapped].key)
  }

  const up = (e) => {
    if (!draggingRef.current) return
    draggingRef.current = false
    setDragging(false)
    const snapped = Math.round(posFromX(e.clientX)) // 손을 떼면 가장 가까운 지점에 딱 붙는다
    setPos(snapped)
    if (items[snapped].key !== value) onChange(items[snapped].key)
    if (dotRefs.current[snapped]) dotRefs.current[snapped].focus()
    if (onDragEnd) onDragEnd()
  }

  const onKeyDown = (e) => {
    let next = null
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = clamp(idx - 1, 0, n - 1)
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = clamp(idx + 1, 0, n - 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = n - 1
    if (next === null) return
    e.preventDefault()
    onChange(items[next].key)
    if (dotRefs.current[next]) dotRefs.current[next].focus()
  }

  return (
    <div role="radiogroup" aria-label="미리보기 자리 선택" className="select-none">
      <div
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        className={['relative h-[84px] w-full', dragging ? 'cursor-grabbing' : 'cursor-grab'].join(' ')}
        style={{ touchAction: 'none' }}
      >
        <div ref={railRef} className="absolute left-7 right-7 top-[26px]">
          {/* 선 */}
          {/* 레일도 유리로 — 얇은 홈처럼 파인 느낌 */}
          <div
            className="h-[6px] w-full rounded-full border border-white/70 bg-white/40 shadow-[inset_0_1px_2px_rgba(41,37,36,.08)] backdrop-blur-sm"
            aria-hidden="true"
          />
          <div
            aria-hidden="true"
            className="glass-coral absolute left-0 top-0 h-[6px] rounded-full"
            style={{
              width: `${(pos / (n - 1)) * 100}%`,
              transition: dragging ? 'none' : 'width .28s var(--ease-soft)',
            }}
          />
          {/* 손잡이 — 끌면 늘어났다가 놓으면 되돌아온다 (리퀴드 글라스) */}
          <div
            aria-hidden="true"
            className={[
              'liquid-thumb pointer-events-none absolute top-1/2 h-8 w-8 rounded-full',
              dragging ? 'is-dragging' : '',
            ].join(' ')}
            style={{ left: `${(pos / (n - 1)) * 100}%` }}
          >
            <span
              className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--text-strong)]"
              aria-hidden="true"
            />
          </div>
          {/* 지점 4개 */}
          {items.map((it, i) => {
            const on = i === idx
            return (
              <button
                key={String(it.key)}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={it.aria}
                tabIndex={on ? 0 : -1}
                ref={(el) => {
                  dotRefs.current[i] = el
                }}
                onClick={() => onChange(it.key)}
                onKeyDown={onKeyDown}
                className="absolute top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full"
                style={{ left: `${(i / (n - 1)) * 100}%` }}
              >
                {/* 선택은 색만이 아니라 크기·테두리·이름표로도 구분된다 (§11) */}
                <span
                  className={[
                    'block rounded-full transition-all duration-300',
                    on ? 'h-3.5 w-3.5 bg-[var(--text-strong)]' : 'h-2.5 w-2.5',
                    on
                      ? ''
                      : it.dim
                        ? 'border border-dashed border-[var(--disabled)] bg-transparent'
                        : 'bg-[var(--disabled)]',
                    it.dim && !on ? 'opacity-70' : '',
                  ].join(' ')}
                />
              </button>
            )
          })}
          {/* 이름표 — 현재 고른 지점만 (§6-2) */}
          <div
            className="absolute top-[22px] -translate-x-1/2 whitespace-nowrap text-center"
            style={{ left: `${(idx / (n - 1)) * 100}%`, transition: 'left .28s var(--ease-soft)' }}
          >
            <span className="t-item">{items[idx].label}</span>
            {items[idx].dim && <span className="t-caption ml-2 text-danger">참여 꺼짐</span>}
          </div>
        </div>
      </div>
    </div>
  )
}
