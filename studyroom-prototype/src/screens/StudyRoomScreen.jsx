/**
 * 스터디룸 — 통합 설계서 §6-3 (레이아웃·타일·채팅·휴식·하단바)
 *                        §7-3 (개입 우선순위) · §7-5 (기습 질문·심화 학습 포인트)
 *                        §8   (지표) · §10 (설정 충돌 우선순위)
 *
 * 모션 존 B (§4-3): 배경 블롭·그레인·카드 기울임 금지.
 *   전환/호버 애니메이션과 캐릭터 애니메이션만 허용하고, 영상 위에는 어떤 오버레이도 겹치지 않는다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Paperclip, Send, Mic, MicOff, Video, VideoOff, Settings, PhoneOff, FileText } from 'lucide-react'

import { useStore, isRelaxed, activeSeats, allSeatsOff } from '../store/useStore'
import { db } from '../store/db'
import { PRESETS } from '../lib/presets'
import { MetricsTracker, computeScore, fmtHMS } from '../lib/metrics'
import {
  nextAnimationState,
  stateInterval,
  canIntervene,
  pickInterventionSpeaker,
  interventionLine,
  routeReply,
  generateReply,
  makeQuiz,
  judgeQuiz,
  takeLastError,
} from '../lib/mockAgent'
import {
  ttsSupported,
  speakAndWait,
  cancelAll as stopSpeaking,
  isSpeaking,
  ttsExcerpt,
  recentSpoken,
} from '../lib/ttsQueue'
import { useListener, listenSupported } from '../lib/voice/useListener'
import { screenUtterance, looksComplete, joinVoice, WHY_LABEL } from '../lib/voice/gate'
import { requestSummary, requestReply } from '../lib/agent/client'
import { useVision } from '../lib/vision/useVision'
import { wakeChime } from '../lib/chime'
import { planDocument, toPrompt, asInlineFile } from '../lib/docReader'
import { Button, IconBtn, Confirm, CharacterSprite } from '../components/ui'

/* ── 지역 헬퍼 (새 의존 파일을 만들지 않는다) ─────────────────── */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rid = () => Math.random().toString(36).slice(2, 10)
const NAME_MAX = 12 // §7-2 이름 최대 12자
const ENGINE_TICK_MS = 15000 // 개입 엔진 판정 주기
const QUIZ_AFTER_SEC = 20 * 60 // §7-5 세션 20분 경과 후
const QUIZ_MAX = 3 // §7-5 세션당 최대 3회
const REST_HINT_MS = 5 * 60 * 1000 // §6-3 휴식 힌트 유지 시간
const REST_WORDS = /쉬|휴식|잠깐/ // §6-3 휴식 감지 키워드
const MAX_HISTORY_TURNS = 40 // 서버가 예산으로 또 자르지만, 전송량도 줄인다
const COMPACT_ABOVE_TURNS = 50 // 이보다 길어지면 앞부분을 요약으로 접는다
/** 말끝이 애매할 때, 이만큼 더 기다렸다가 그래도 안 이어지면 보낸다 */
const VOICE_IDLE_MS = 3000
/** 이만큼 끊기지 않고 집중해야 칭찬 한마디. 이유 없는 칭찬은 소음이다 */
const CHEER_AFTER_STREAK_SEC = 25 * 60

/** 시계가 멈춘 이유 — 색만으로는 알 수 없으니 글자로도 붙인다 */
/**
 * 시계가 멈춘 뒤 이만큼 지나야 빨갛게 만든다.
 *
 * **멈추는 건 즉시**다 — 집중 시간은 정확해야 하니까.
 * 다만 1초짜리 흔들림에 화면이 빨개졌다 돌아오면 눈에 거슬린다.
 * 측정과 표시를 갈라 두면 둘 다 만족한다.
 */
const PAUSE_SHOW_MS = 1200

/** 시계가 멈춘 이유 — 색만으로는 알 수 없으니 글자로도 붙인다 */
const PAUSE_LABEL = {
  away: '자리 비움',
  absent: '자리 비움',
  phone: '휴대폰',
  drowsy: '졸음',
}
/** 올린 자료를 가리키는 말 — 이럴 때만 본문을 같이 넘긴다 */
const DOC_REF_WORDS = /파일|자료|문서|pdf|이거|저거|방금|올린|첨부|요약|정리해|내용/i

/** 파일 크기 표기 */
function fmtBytes(n = 0) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** 입력창 커서 앞의 "@검색어"를 찾아낸다 (§6-3 @멘션 자동완성) */
function findMention(text, caret) {
  const before = text.slice(0, caret)
  const m = /(?:^|\s)@([^\s@]{0,12})$/.exec(before)
  if (!m) return null
  return { q: m[1], start: caret - m[1].length - 1, end: caret }
}

/** 이름 검증 — §5-1 즉시 반영 · §7-2 빈 값 불가 / 12자 / 중복 불가 */
function validateName(raw, others) {
  const v = raw.trim()
  if (!v) return '이름을 비워 둘 수 없어요.'
  if (v.length > NAME_MAX) return `이름은 ${NAME_MAX}자까지 쓸 수 있어요.`
  if (others.some((n) => n.trim().toLowerCase() === v.toLowerCase()))
    return '다른 자리와 같은 이름은 쓸 수 없어요. (@멘션이 헷갈려요)'
  return ''
}

/* ── 타일 ──────────────────────────────────────────────────── */

/** 자리1 — 나. 웹캠 스트림은 대기 화면에서 받은 것을 그대로 재사용한다 (§5-4) */
function SelfTile({ stream, cameraOn, micOn, mirror, name }) {
  const videoRef = useRef(null)

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    if (stream) {
      if (v.srcObject !== stream) v.srcObject = stream
    } else {
      v.srcObject = null
    }
  }, [stream, cameraOn])

  const showVideo = cameraOn && !!stream

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-md border border-hairline bg-surface shadow-soft">
      <div className="relative flex min-h-0 flex-1 items-center justify-center bg-surface-dark">
        {showVideo ? (
          // 영상 위에는 어떤 오버레이도 겹치지 않는다 (§4-3)
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            aria-label="내 카메라 화면"
            className="h-full w-full object-cover"
            style={{ transform: mirror ? 'scaleX(-1)' : 'none' }}
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-warm">
            <VideoOff size={28} aria-hidden="true" />
            <span className="t-body">카메라가 꺼져 있어요</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-hairline px-4 py-2.5">
        <span className="t-item truncate">{name}</span>
        <span className="t-caption rounded-full bg-peach px-2 py-0.5">나</span>
        <span className="ml-auto flex items-center gap-1.5 text-subtle">
          {/* ON/OFF는 색이 아니라 아이콘 모양(사선)과 글자로도 구분한다 (§4-5, §11) */}
          {cameraOn ? <Video size={15} aria-hidden="true" /> : <VideoOff size={15} aria-hidden="true" />}
          <span className="t-caption">{cameraOn ? '카메라 켜짐' : '카메라 꺼짐'}</span>
          {micOn ? <Mic size={15} aria-hidden="true" /> : <MicOff size={15} aria-hidden="true" />}
          <span className="t-caption">{micOn ? '마이크 켜짐' : '마이크 꺼짐'}</span>
        </span>
      </div>
    </div>
  )
}

/** 자리2~4 — 스터디 메이트. 카메라·마이크·음소거 아이콘을 표시하지 않는다 (§6-3, §10 규칙 2) */
function MateTile({ seat, state, tint, otherNames, onRename }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(seat.name)
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    if (!editing) setDraft(seat.name)
  }, [seat.name, editing])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const commit = () => {
    const msg = validateName(draft, otherNames)
    if (msg) {
      // 검증 실패 시 편집 모드를 유지한다 (§5-1)
      setError(msg)
      return
    }
    setError('')
    setEditing(false)
    onRename(draft.trim())
  }

  const cancel = () => {
    setDraft(seat.name)
    setError('')
    setEditing(false)
  }

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-md border border-hairline bg-surface shadow-soft">
      <div className={`flex min-h-0 flex-1 items-center justify-center ${tint}`}>
        {/* 상태를 텍스트로 표시하지 않는다. 애니메이션만 바뀐다 (§6-3) */}
        <CharacterSprite imageKey={seat.imageKey} state={state} size={148} />
      </div>
      <div className="border-t border-hairline px-4 py-2.5">
        {editing ? (
          <div>
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                value={draft}
                aria-label={`${seat.slotNo}번 자리 이름`}
                aria-invalid={!!error}
                onChange={(e) => {
                  setDraft(e.target.value)
                  if (error) setError('')
                }}
                onKeyDown={(e) => {
                  // 조합 중 Enter 는 무시한다 — 이름이 잘린 채 확정된다
                  if (e.nativeEvent?.isComposing || e.keyCode === 229) return
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commit()
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    cancel()
                  }
                }}
                onBlur={commit}
                className={[
                  'min-w-0 flex-1 rounded-full border bg-white px-3 py-1 t-body transition-colors duration-300',
                  error ? 'border-danger' : 'border-hairline',
                ].join(' ')}
              />
              <span className="t-caption tnum shrink-0">
                {draft.trim().length}/{NAME_MAX}
              </span>
            </div>
            {error && <div className="t-caption mt-1 text-danger">{error}</div>}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {/* 이름을 누르면 인라인 편집. 별도 Edit 버튼 없음 (§6-3) */}
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label={`${seat.name} 이름 바꾸기`}
              className="t-item truncate rounded-full px-2 py-0.5 -mx-2 text-left transition-colors duration-300 hover:bg-[var(--hover-bg)]"
            >
              {seat.name}
            </button>
            <span className="t-caption shrink-0 rounded-full bg-[var(--hover-bg)] px-2 py-0.5">
              {seat.slotNo}번 자리
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

/** 참여 OFF인 자리 — 빈 책상 느낌으로 옅게. 2×2 그리드는 유지한다 (§6-3) */
function EmptySeatTile({ seat, onOpenSettings }) {
  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-md border border-dashed border-hairline bg-[var(--hover-bg)]">
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-muted">
        <svg viewBox="0 0 140 96" width="150" height="103" aria-hidden="true" className="opacity-45">
          <rect x="20" y="52" width="100" height="8" rx="4" fill="currentColor" opacity="0.55" />
          <rect x="30" y="60" width="6" height="28" rx="3" fill="currentColor" opacity="0.35" />
          <rect x="104" y="60" width="6" height="28" rx="3" fill="currentColor" opacity="0.35" />
          <rect
            x="46"
            y="32"
            width="34"
            height="20"
            rx="3"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            opacity="0.5"
          />
          <path
            d="M52 39h22M52 45h14"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            opacity="0.4"
          />
          <path
            d="M92 40h12v10a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            opacity="0.45"
          />
        </svg>
        <span className="t-body">빈 자리</span>
      </div>
      <div className="flex items-center gap-2 border-t border-hairline px-4 py-2.5">
        <span className="t-item truncate text-muted">{seat.name}</span>
        <span className="t-caption shrink-0 rounded-full border border-hairline bg-white px-2 py-0.5">
          참여 꺼짐
        </span>
        <button
          type="button"
          onClick={onOpenSettings}
          className="ml-auto t-caption rounded-full px-2 py-0.5 underline transition-colors duration-300 hover:bg-white"
        >
          설정에서 켜기
        </button>
      </div>
    </div>
  )
}

/* ── 화면 ──────────────────────────────────────────────────── */

export default function StudyRoomScreen() {
  /* 셀렉터는 필드 단위로 하나씩 구독한다 (객체를 새로 만들면 무한 렌더) */
  const go = useStore((s) => s.go)
  const seats = useStore((s) => s.seats)
  const settings = useStore((s) => s.settings)
  const device = useStore((s) => s.device)
  const setDevice = useStore((s) => s.setDevice)
  const stream = useStore((s) => s.stream)
  const setStream = useStore((s) => s.setStream)
  const displayName = useStore((s) => s.displayName)
  const updateSeat = useStore((s) => s.updateSeat)
  const openSettings = useStore((s) => s.openSettings)
  const setSessionId = useStore((s) => s.setSessionId)
  const setLastSessionId = useStore((s) => s.setLastSessionId)
  const toast = useStore((s) => s.toast)

  const [snap, setSnap] = useState(null) // MetricsTracker 스냅샷 (§8)
  const [animStates, setAnimStates] = useState({ 1: 'studying', 2: 'reading', 3: 'studying' })
  const [messages, setMessages] = useState([])
  // 모델에 넘길 대화 이력. messages와 별도로 두는 이유는 파일 메시지·시스템 알림을 빼기 위해서다
  const historyRef = useRef([])
  const summaryRef = useRef('') // 압축해둔 앞부분 (§ memory.mjs)
  const compactingRef = useRef(false)
  const lastMetaRef = useRef(null) // 마지막 호출 메타(키·지연·근거) — 개발 확인용
  const mockNoticeRef = useRef(false) // 목업 안내는 한 번만
  const floorRef = useRef(0) // 발언권. 0보다 크면 누군가 말하는 중이라 개입을 미룬다
  /* 음성 입력 상태 — 언마운트 정리 effect 보다 위에 선언해야 한다 */
  const draftSourceRef = useRef(null) // 입력창 내용의 출처: 'voice' | 'typed' | null
  const lastSentRef = useRef(null) // 직전에 보낸 것 (중복 판정용)
  /**
   * 지금까지 음성으로 모아 둔 말.
   * 조각이 올 때마다 **이어 붙인다.** 예전에는 조각이 앞의 것을 덮어써서,
   * 잠깐 생각하고 이어 말하면 앞부분이 통째로 사라졌다.
   */
  const voiceBufRef = useRef('')
  const voiceIdleRef = useRef(null) // 말끝이 애매할 때 기다리는 타이머
  const docRef = useRef(null) // 마지막으로 올린 자료의 본문 — 이후 질문에 같이 넘긴다
  const replyChainRef = useRef(Promise.resolve()) // 답변 루프를 한 줄로 세운다
  const lastCheerStreakRef = useRef(0) // 마지막으로 칭찬한 집중 구간
  const [typingSlots, setTypingSlots] = useState([]) // 타이핑 인디케이터 (§6-3)
  const [readingDoc, setReadingDoc] = useState(null) // 자료를 읽는 중이면 파일 이름
  const [draft, setDraft] = useState('')
  const [mention, setMention] = useState(null) // {q, start, end}
  const [mentionIdx, setMentionIdx] = useState(0)
  const [confirmEnd, setConfirmEnd] = useState(false)

  const trackerRef = useRef(null)
  const sidRef = useRef(null)
  const [todayBase, setTodayBase] = useState(0)
  const aliveRef = useRef(true)
  const endedRef = useRef(false)

  const draftRef = useRef('')
  const lastKeyRef = useRef(0)
  const lastInterventionRef = useRef(null) // null = 아직 한 번도 개입하지 않음
  const interventionsRef = useRef([])
  const pendingAwayRef = useRef(false) // 이탈 복귀 대기
  const awayStartedRef = useRef(0)
  const prevAwayRef = useRef(false)
  const longStudyFiredRef = useRef(false)
  const restStartRef = useRef(null)
  const restTimerRef = useRef(null)
  const quizCountRef = useRef(0)
  const pendingQuizRef = useRef(null) // {quiz, slotNo}
  const fileRef = useRef(null)
  const inputRef = useRef(null)
  const listEndRef = useRef(null)

  const actives = useMemo(() => activeSeats(seats), [seats])
  const noMates = allSeatsOff(seats) // §10 규칙 9

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  /* ── 세션 · 지표 (§8, §9-3) ─────────────────────────────── */
  useEffect(() => {
    aliveRef.current = true
    let id = useStore.getState().sessionId
    if (!id) {
      id = db.startSession()
      useStore.getState().setSessionId(id)
    }
    sidRef.current = id

    // 오늘 누적 = 이미 저장된 오늘치 − 이 세션 몫 (하단바에서 실시간으로 더한다, §8-1)
    const row = db.getSession(id)
    setTodayBase(Math.max(0, db.todayFocusSec() - (row?.focus_sec || 0)))

    const st = useStore.getState().settings
    const tracker = new MetricsTracker(id, {
      awayDetect: st.privacyFlags.awayDetect,
      inputDetect: st.privacyFlags.inputDetect,
      idleMin: st.thresholds.idleMin,
      relaxed: isRelaxed(st), // §8-2 완화 모드 → integrity='relaxed'
    })
    trackerRef.current = tracker
    const off = tracker.onChange((s) => setSnap(s))
    tracker.start()
    setSnap(tracker.snapshot())

    return () => {
      aliveRef.current = false
      off()
      if (!endedRef.current) tracker.stop()
      trackerRef.current = null
      clearTimeout(restTimerRef.current)
      clearTimeout(voiceIdleRef.current)
      stopSpeaking() // 화면을 떠날 때 읽어주기 중단
    }
  }, [])

  /* 이탈 시작/복귀 감지 → 개입 kind 'away' 예약 (§7-3) */
  useEffect(() => {
    const away = !!snap?.isAway
    if (away && !prevAwayRef.current) awayStartedRef.current = Date.now()
    if (!away && prevAwayRef.current) {
      const sec = (Date.now() - (awayStartedRef.current || Date.now())) / 1000
      if (sec >= settings.thresholds.awayMin * 60) pendingAwayRef.current = true
    }
    prevAwayRef.current = away
  }, [snap?.isAway, settings.thresholds.awayMin])

  /* ── 채팅 기록 ─────────────────────────────────────────── */

  const pushMsg = useCallback((m) => {
    const row = { id: rid(), at: Date.now(), ...m }
    setMessages((prev) => [...prev, row])
    // 파일 메시지는 모델 이력에 넣지 않는다 (본문이 파일명뿐이라 맥락에 도움이 안 된다)
    if (m.kind !== 'file' && m.body) {
      historyRef.current.push({ role: m.senderType === 'me' ? 'user' : 'model', text: m.body })
    }
    if (sidRef.current) {
      // §9-2 message(sender_type: me|mate, kind: text|file)
      db.addMessage(sidRef.current, {
        sender_type: m.senderType,
        sender_id: m.seat ?? null,
        body: m.body,
        kind: m.kind === 'file' ? 'file' : 'text',
      })
    }
    return row
  }, [])

  /**
   * 대화가 길어지면 앞부분을 요약으로 접는다.
   *
   * 답변을 만든 **직후**에 백그라운드로 돈다. 사용자 입력 직후에 하면 그 지연이 그대로 체감된다.
   * 그리고 원문은 지우지 않는다 — db.message 에 그대로 남는다. 압축은 프롬프트 조립 문제다.
   */
  const compactIfNeeded = useCallback(async () => {
    if (compactingRef.current) return
    if (historyRef.current.length <= COMPACT_ABOVE_TURNS) return
    compactingRef.current = true
    try {
      const r = await requestSummary({
        turns: historyRef.current,
        previousSummary: summaryRef.current,
      })
      if (r?.changed && r.summary) {
        summaryRef.current = r.summary
        // 요약에 들어간 앞부분은 이력에서 뺀다. 최근 것만 원문으로 남긴다
        historyRef.current = historyRef.current.slice(-25)
      }
    } catch (e) {
      console.warn('[agent] 압축 실패 — 다음 턴에 다시 시도합니다', e.message)
    } finally {
      compactingRef.current = false
    }
  }, [])

  /**
   * ① 타이핑 인디케이터 → ② 생성 → ③ 말풍선 → ④ 읽어주기 (§6-3)
   *
   * **한 번에 한 명만 말한다.** 예전에는 읽어주기를 던져만 두고 곧바로 다음 캐릭터로 넘어가서,
   * 화면에는 셋이 동시에 말하는데 소리는 수십 초 뒤처졌다. 이제 재생이 끝나야 반환한다.
   * 답변자 셋이면 순서대로 말하고, 그동안 개입 엔진은 끼어들지 않는다(floorRef).
   */
  const mateSay = useCallback(
    async (seat, produce, kind = 'text') => {
      if (!aliveRef.current) return
      floorRef.current += 1
      setTypingSlots((t) => (t.includes(seat.slotNo) ? t : [...t, seat.slotNo]))
      try {
        const out = await produce()
        const body = typeof out === 'string' ? out : out?.text
        if (!aliveRef.current || !body) return
        if (out?.meta && !out.meta.mock) lastMetaRef.current = out.meta
        // 목업으로 떨어졌으면 반드시 알린다.
        // 조용히 가짜 답을 내보내면 "모델이 이상하다"로 오해하게 된다 — 실제로 그랬다
        if (out?.meta?.mock && !mockNoticeRef.current) {
          mockNoticeRef.current = true
          const why = takeLastError()
          toast(`서버에 연결하지 못해 임시 답변으로 대신하고 있어요.${why ? ` (${why})` : ''}`, 'danger')
        }
        pushMsg({ senderType: 'mate', seat: seat.slotNo, body, kind })
        setTypingSlots((t) => t.filter((x) => x !== seat.slotNo))
        const st = useStore.getState().settings
        // 재생이 실제로 끝날 때까지 기다린다 — 이 동안 발언권을 쥐고 있다
        if (st.voice.tts && ttsSupported) await speakAndWait(ttsExcerpt(body), PRESETS[seat.preset]?.voice)
      } catch {
        if (aliveRef.current) toast('답변을 만들지 못했어요. 다시 물어봐 주세요.', 'danger')
      } finally {
        floorRef.current = Math.max(0, floorRef.current - 1)
        setTypingSlots((t) => t.filter((x) => x !== seat.slotNo))
      }
    },
    [pushMsg, toast],
  )

  /* ── 카메라 판정 (자리 비움 · 휴대폰 · 졸음) ──────────────────
     판정은 전부 이 기기 안에서 돈다. 영상은 어디로도 나가지 않는다.
     총 시간은 계속 세고, 여기서 걸린 구간은 **집중 시간에서만** 빠진다. */
  const visionOn = settings.privacyFlags.visionDetect && device.cameraOn && !!stream

  useEffect(() => {
    trackerRef.current?.setVisionActive(visionOn)
  }, [visionOn])

  const onVisionSignal = useCallback((sig) => {
    trackerRef.current?.setVisionSignal(sig)
  }, [])

  /** 졸음·휴대폰이 확인되면 캐릭터가 말을 건다. 졸음은 소리로도 깨운다 */
  const onVisionAlert = useCallback(
    (kind) => {
      if (!aliveRef.current) return
      const st = useStore.getState().settings
      // 조는 사람은 말풍선으로 못 깨운다. 눈을 감고 있으니까
      if (kind === 'drowsy' && st.privacyFlags.wakeOnDrowsy) wakeChime()
      // 누가 말하는 중이면 겹치지 않게 미룬다
      if (floorRef.current > 0 || isSpeaking()) return
      const speaker = pickInterventionSpeaker(useStore.getState().seats)
      if (!speaker) return
      db.logEvent(sidRef.current, 'intervention', { kind, slot_no: speaker.slotNo, source: 'vision' })
      mateSay(speaker, async () => {
        await sleep(400)
        return interventionLine(speaker, kind)
      })
    },
    [mateSay],
  )

  const vision = useVision({
    stream,
    enabled: visionOn,
    onSignal: onVisionSignal,
    onAlert: onVisionAlert,
    // 느려서 판정이 굼떠지면 알린다. 조용히 두면 "인식을 못 한다"로만 보인다
    onDegrade: (info) => {
      // 회복은 조용히 넘어간다. 좋아진 걸 굳이 알릴 필요는 없다
      if (info?.kind === 'recover' || info?.kind === 'phoneRecover') return
      toast(
        info?.kind === 'off'
          ? '이 기기에서 집중 감지가 버거워서 껐어요.'
          : `집중 감지가 느려서 주기를 ${info?.intervalMs ?? ''}ms로 늘렸어요.`,
        'danger',
      )
    },
  })

  /* ── 자율 행동 (§7-3 3순위) ──────────────────────────────
     ambient random은 animationState만 바꾸고 발화하지 않는다 (§10 규칙 12) */
  useEffect(() => {
    const timers = seats.map((seat) => {
      if (!seat.enabled) return null
      return setInterval(() => {
        setAnimStates((prev) => ({
          ...prev,
          [seat.slotNo]: nextAnimationState(seat, prev[seat.slotNo]),
        }))
      }, stateInterval(seat))
    })
    return () => timers.forEach((t) => t && clearInterval(t))
  }, [seats])

  /* ── 휴식 감지 (§6-3) ───────────────────────────────────── */
  const startRest = useCallback(() => {
    const tracker = trackerRef.current
    if (!tracker) return
    tracker.setRestingHint(true)
    restStartRef.current = Date.now()
    clearTimeout(restTimerRef.current)
    restTimerRef.current = setTimeout(() => {
      trackerRef.current?.setRestingHint(false)
    }, REST_HINT_MS)
  }, [])

  /* ── 개입 엔진 (§7-3) + 기습 질문 (§7-5) ────────────────── */
  useEffect(() => {
    const markIntervention = (now) => {
      lastInterventionRef.current = now
      interventionsRef.current = interventionsRef.current.filter((t) => now - t < 3600000)
      interventionsRef.current.push(now)
    }

    const tick = () => {
      const tracker = trackerRef.current
      const sid = sidRef.current
      if (!tracker || !sid || !aliveRef.current) return
      // 누가 말하는 중이면 이번 판정은 건너뛴다. 개입은 미루는 게 맞지 겹치면 안 된다 (§7-3 1순위)
      if (floorRef.current > 0 || isSpeaking()) return

      const st = useStore.getState().settings
      const allSeats = useStore.getState().seats
      if (!activeSeats(allSeats).length) return // §10 규칙 2

      const now = Date.now()
      const s = tracker.snapshot()

      // 상황 판정 — settings.triggers가 꺼진 상황은 건너뛴다 (§7-3, §10 규칙 6)
      /**
       * 무슨 일이 있어야 말을 건다.
       *
       * 예전에는 `cheer` 가 기본값이라 **아무 상황도 해당 안 되면 그냥 칭찬을 던졌다.**
       * 파일을 올리자마자 "오늘 진짜 잘하고 있는데?!" 가 튀어나온 게 그것이다.
       * 이유 없는 말 걸기는 존재감이 아니라 소음이다.
       *
       * 이제 아래 상황 중 하나여야 말한다. 아무것도 아니면 조용히 있는다.
       */
      let kind = null
      if (pendingAwayRef.current && st.triggers.windowAway && st.privacyFlags.awayDetect) {
        kind = 'away'
      } else if (
        st.triggers.restOver &&
        restStartRef.current &&
        (now - restStartRef.current) / 1000 >= st.thresholds.restOverMin * 60
      ) {
        kind = 'restOver'
      } else if (
        st.triggers.longStudy &&
        !longStudyFiredRef.current &&
        s.studySec >= st.thresholds.longStudyMin * 60
      ) {
        kind = 'longStudy'
      } else if (
        st.triggers.idle &&
        st.privacyFlags.inputDetect &&
        (now - tracker.lastInputAt) / 1000 >= st.thresholds.idleMin * 60
      ) {
        kind = 'idle'
      } else if (
        // 칭찬은 **끊기지 않고 오래 집중했을 때만.** 그것도 한 구간에 한 번만
        st.triggers.longStudy &&
        s.bestStreakSec >= CHEER_AFTER_STREAK_SEC &&
        s.bestStreakSec - lastCheerStreakRef.current >= CHEER_AFTER_STREAK_SEC
      ) {
        kind = 'cheer'
        lastCheerStreakRef.current = s.bestStreakSec
      }

      if (!kind) return // 말할 이유가 없으면 조용히 있는다

      // 1순위 방해 방지 · 전역 개입 빈도 상한 (§7-3, §10 규칙 10)
      const ctx = {
        userTyping: draftRef.current.trim().length > 0 || now - lastKeyRef.current < 8000,
        sinceLastInterventionSec:
          lastInterventionRef.current == null
            ? Number.MAX_SAFE_INTEGER
            : (now - lastInterventionRef.current) / 1000,
        interventionsThisHour: interventionsRef.current.filter((t) => now - t < 3600000).length,
      }
      if (!canIntervene(st, ctx).allowed) return

      const speaker = pickInterventionSpeaker(allSeats)
      if (!speaker) return

      // 기습 질문 — 세션 20분 경과 후 개입 상한 안에서 최대 3회 (§7-5)
      const quizReady =
        st.memoryFlags.makeQuiz &&
        st.interventionStyles.ask &&
        quizCountRef.current < QUIZ_MAX &&
        !pendingQuizRef.current &&
        s.studySec >= QUIZ_AFTER_SEC
      if (quizReady && Math.random() < 0.5) {
        const quiz = makeQuiz()
        pendingQuizRef.current = { quiz, slotNo: speaker.slotNo }
        quizCountRef.current += 1
        markIntervention(now)
        db.logEvent(sid, 'quiz', { question: quiz.q, slot_no: speaker.slotNo })
        mateSay(
          speaker,
          async () => {
            await sleep(700 + Math.random() * 700)
            return quiz.q
          },
          'quiz',
        )
        return
      }

      // 개입 방식이 꺼져 있으면 발화하지 않는다 (§6-5 interventionStyles)
      const styleOn = {
        cheer: st.interventionStyles.cheer,
        longStudy: st.interventionStyles.rest,
        restOver: st.interventionStyles.rest,
        idle: st.interventionStyles.bubble,
        away: st.interventionStyles.bubble,
      }[kind]
      if (!styleOn) return

      if (kind === 'away') pendingAwayRef.current = false
      if (kind === 'longStudy') longStudyFiredRef.current = true
      if (kind === 'restOver') restStartRef.current = null

      markIntervention(now)
      db.logEvent(sid, 'intervention', { kind, slot_no: speaker.slotNo })
      mateSay(speaker, async () => {
        await sleep(600 + Math.random() * 800)
        return interventionLine(speaker, kind)
      })
    }

    const id = setInterval(tick, ENGINE_TICK_MS)
    return () => clearInterval(id)
  }, [mateSay])

  /* ── 전송 ──────────────────────────────────────────────── */

  const send = useCallback(
    async (raw) => {
      const text = (raw ?? '').trim()
      if (!text) return
      setDraft('')
      setMention(null)
      pushMsg({ senderType: 'me', body: text, kind: 'text' })

      // 휴식 감지 (§6-3) — restingHint가 그 구간의 이탈을 "휴식"으로 분류한다 (§8-2)
      if (REST_WORDS.test(text)) startRest()
      else restStartRef.current = null

      // 기습 질문 채점 — 바로 다음 사용자 메시지를 채점한다 (§7-5)
      const pending = pendingQuizRef.current
      if (pending) {
        pendingQuizRef.current = null
        const correct = judgeQuiz(pending.quiz, text)
        db.addQuizResult(sidRef.current, {
          question: pending.quiz.q,
          user_answer: text,
          is_correct: correct,
        })
        const seat = useStore.getState().seats.find((x) => x.slotNo === pending.slotNo)
        if (seat) {
          await mateSay(seat, async () => {
            await sleep(600 + Math.random() * 600)
            return correct
              ? '맞아요. 그 부분은 확실히 잡은 것 같네요.'
              : '음, 조금 달라요. 그 부분은 이따 한 번 더 짚고 갈게요.'
          })
        }
        return
      }

      const st = useStore.getState().settings
      const allSeats = useStore.getState().seats
      const repliers = routeReply(text, allSeats, st) // §10 규칙 11 @멘션 > 답변 캐릭터 > 자동

      // 답변이 끝나기 전에 사용자가 또 보내면 루프 두 개가 겹친다.
      // 줄을 세워서 앞 대화가 끝난 뒤에 다음 답변이 시작되게 한다
      replyChainRef.current = replyChainRef.current
        .then(async () => {
          // 올린 자료를 가리키는 질문이면 본문을 같이 넘긴다.
          // 매번 넘기면 토큰이 낭비되고, 안 넘기면 "저 파일 요약해줘"에 엉뚱한 답이 나온다
          const wantsDoc = docRef.current && DOC_REF_WORDS.test(text)
          const docImages = wantsDoc ? docRef.current.images || [] : []
          const payload = wantsDoc && docRef.current.prompt ? `${docRef.current.prompt}\n\n${text}` : text

          for (const seat of repliers) {
            if (!aliveRef.current) return
            // 답변자마다 순차로: 타이핑 인디케이터 → 생성 → 말풍선 → 읽어주기
            await mateSay(seat, () =>
              generateReply({
                seat,
                text: payload,
                images: docImages,
                withDoc: wantsDoc, // 자료를 놓고 묻는 질문은 상위 모델로
                settings: st,
                // 방금 넣은 사용자 발화는 서버가 message로 따로 받으므로 뺀다
                history: historyRef.current.slice(0, -1).slice(-MAX_HISTORY_TURNS),
                summary: summaryRef.current,
              }),
            )
          }
          // 답변을 낸 뒤에 백그라운드로 접는다. 입력 직후에 하면 그 지연이 그대로 체감된다
          compactIfNeeded()
        })
        .catch((e) => console.warn('[reply] 답변 루프 실패', e))
      await replyChainRef.current
    },
    [mateSay, pushMsg, startRest, compactIfNeeded],
  )

  /* ── 문서 업로드 (§6-3, §7-5) ──────────────────────────── */

  const onPickFile = useCallback(
    async (e) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return
      const sid = sidRef.current

      pushMsg({
        senderType: 'me',
        kind: 'file',
        body: file.name,
        file: { name: file.name, size: file.size },
      })

      // 세션 주제를 파일명으로 기록 (§9-2 topics / topic_source)
      const topic = file.name.replace(/\.[^.]+$/, '').slice(0, 40)
      const prev = db.getSession(sid)?.topics || []
      db.heartbeat(sid, {
        topics: prev.includes(topic) ? prev : [...prev, topic],
        topic_source: 'document',
      })

      const plan = await planDocument(file)

      if (plan.mode === 'no') {
        // 못 읽으면 못 읽었다고 말한다. 지어내지 않는다
        const s2 = pickInterventionSpeaker(useStore.getState().seats)
        if (s2) {
          await mateSay(s2, async () => {
            await sleep(500)
            return `“${topic}” 열어봤는데 ${plan.reason}. 중요한 부분만 붙여넣어 주면 같이 볼게.`
          })
        }
        return
      }

      let body = plan.text

      // PDF 는 모델이 직접 읽는다. 우리가 글자를 뽑지 않는다 (docReader 주석 참고).
      // 한 번 글로 옮겨 두면 이후 질문은 값싼 글자 호출로 끝난다.
      if (plan.mode === 'model') {
        // 20초쯤 걸린다. 토스트는 사라지므로 채팅에 계속 남는 표시를 둔다.
        // 그동안 발언권을 쥐고 있어야 개입 엔진이 끼어들지 않는다 —
        // 자료를 기다리는데 "오늘 잘하고 있는데?!" 가 튀어나오면 안 된다
        setReadingDoc(file.name)
        floorRef.current += 1
        try {
          const got = await requestReply({
            mode: 'extract',
            settings: {},
            turns: [],
            images: [await asInlineFile(file)],
            message: `"${file.name}" 자료의 내용을 빠짐없이 글로 옮겨 적어줘.`,
          })
          if (!got?.text) throw new Error('빈 응답')
          body = got.text
        } catch (e) {
          console.warn('[doc] 자료 읽기 실패', e)
          toast(`자료를 읽지 못했어요. (${String(e?.message || e).slice(0, 60)})`, 'danger')
          return
        } finally {
          setReadingDoc(null)
          floorRef.current = Math.max(0, floorRef.current - 1)
        }
      }

      docRef.current = { name: file.name, prompt: toPrompt(file.name, body) }
      db.addStudyPoint(sid, `${file.name} 읽음 (${body.length.toLocaleString()}자)`, file.name)

      const speaker = pickInterventionSpeaker(useStore.getState().seats)
      if (speaker) {
        await mateSay(speaker, () =>
          generateReply({
            seat: speaker,
            text: `${docRef.current.prompt}\n\n위 자료를 방금 훑어본 사람처럼, 무엇에 대한 자료인지 두세 문장으로 말해줘. 없는 내용을 지어내지 않는다.`,
            withDoc: true,
            settings: { ...useStore.getState().settings, replyLength: 'brief' },
            history: [],
            summary: '',
          }),
        )
      }
    },
    [mateSay, pushMsg],
  )

  /* ── 상시 받아쓰기 ────────────────────────────────────────
     마이크를 계속 열어 두고, 받아적은 걸 **채팅 입력창에 그대로 쓴다.**
     무엇이 들렸는지 눈에 보여야 사용자가 믿고 쓸 수 있다.

     말이 끝나면(침묵 1.2초) 자동으로 보낸다. 단 **음성으로 적힌 것만** 그렇다 —
     손으로 타이핑하던 걸 마음대로 보내면 안 되니까. */

  /** 받아적는 중 — 아직 확정 전이라 보내지 않고 보여주기만 한다 */

  /** 모아 둔 걸 실제로 보낸다 */
  const flushVoice = useCallback(() => {
    clearTimeout(voiceIdleRef.current)
    voiceIdleRef.current = null
    const text = voiceBufRef.current.trim()
    voiceBufRef.current = ''
    if (!text) return
    draftSourceRef.current = null
    setDraft('')
    lastSentRef.current = { text, at: Date.now() }
    send(text)
  }, [send])

  /** 말이 더 안 이어지면 그때 보낸다 */
  const armVoiceIdle = useCallback(() => {
    clearTimeout(voiceIdleRef.current)
    voiceIdleRef.current = setTimeout(flushVoice, VOICE_IDLE_MS)
  }, [flushVoice])

  const onVoicePartial = useCallback((text) => {
    // 손으로 뭔가 쓰고 있으면 건드리지 않는다
    if (draftSourceRef.current === 'typed' && draftRef.current.trim()) return
    draftSourceRef.current = 'voice'
    // 모아 둔 것 + 지금 듣고 있는 것
    setDraft(joinVoice(voiceBufRef.current, text))
  }, [])

  /** 한 조각이 끝났다. 문장이 끝난 것과는 다르다 */
  const onVoiceUtterance = useCallback(
    (text) => {
      if (!aliveRef.current) return
      if (draftSourceRef.current === 'typed' && draftRef.current.trim()) return

      const verdict = screenUtterance(text, {
        recentTts: recentSpoken(),
        lastSent: lastSentRef.current,
      })

      if (!verdict.ok) {
        // 잡음이었을 뿐이다. **모아 둔 건 건드리지 않는다** —
        // 사용자가 방금까지 본 자기 말을 지워버리면 안 된다
        console.debug('[voice] 이 조각은 버림:', WHY_LABEL[verdict.why] || verdict.why, '—', text)
        setDraft(voiceBufRef.current)
        if (voiceBufRef.current) armVoiceIdle()
        return
      }

      voiceBufRef.current = joinVoice(voiceBufRef.current, verdict.text)
      setDraft(voiceBufRef.current)

      // 말끝을 보고 정한다. "…이랑" 처럼 이어질 말이면 더 기다린다
      if (looksComplete(verdict.text)) flushVoice()
      else armVoiceIdle()
    },
    [armVoiceIdle, flushVoice],
  )

  /**
   * 받아쓰기가 도는 조건.
   *
   * **하단바 마이크가 유일한 스위치다.** 예전에는 채팅창에도 마이크 버튼이 있어서
   * 하단바를 꺼도 받아쓰기가 계속됐다 — 인식기는 우리 stream 이 아니라 자기 마이크를
   * 따로 열기 때문에, 트랙을 꺼도 아무 소용이 없었다.
   * 마이크를 껐다고 믿는 동안 계속 받아적히는 건 있어서는 안 되는 일이다.
   */
  const voiceOn = device.micOn && settings.voice.stt && listenSupported

  const listener = useListener({
    enabled: voiceOn,
    onPartial: onVoicePartial,
    onUtterance: onVoiceUtterance,
    onState: (s) => {
      if (s.error === 'permission') {
        setDevice({ micOn: false }) // 실제로 못 듣고 있으므로 표시도 꺼진 상태로 맞춘다
        toast('마이크 권한이 꺼져 있어요. 주소창 왼쪽 자물쇠에서 허용해 주세요.', 'danger')
      }
    },
  })

  /* ── 기기 토글 · 종료 ───────────────────────────────────── */

  const toggleCam = () => {
    const on = !device.cameraOn
    setDevice({ cameraOn: on })
    stream?.getVideoTracks?.().forEach((t) => {
      t.enabled = on
    })
  }
  /**
   * 마이크 스위치. 이 하나가 받아쓰기까지 좌우한다 (voiceOn 참고).
   *
   * 트랙만 끄면 안 된다 — 인식기는 우리 stream 을 쓰지 않고 자기 마이크를 따로 연다.
   * 실제로 멈추는 건 voiceOn 이 false 가 되어 useListener 가 인식기를 정리하는 것이다.
   */
  const toggleMic = () => {
    const on = !device.micOn
    setDevice({ micOn: on })
    stream?.getAudioTracks?.().forEach((t) => {
      t.enabled = on
    })
    if (!on) {
      clearTimeout(voiceIdleRef.current)
      voiceIdleRef.current = null
      voiceBufRef.current = ''
      setDraft((d) => (draftSourceRef.current === 'voice' ? '' : d))
    }
  }

  /** 세션 마감 (§9-3 공부 종료) */
  const endStudy = () => {
    const tracker = trackerRef.current
    const sid = sidRef.current
    setConfirmEnd(false)
    if (!tracker || !sid) {
      go('ending')
      return
    }

    endedRef.current = true
    tracker.stop()
    const s = tracker.snapshot()
    const score = computeScore(s) // §8-4
    db.endSession(sid, {
      study_sec: s.studySec,
      focus_sec: s.focusSec ?? 0,
      away_sec: s.awaySec ?? 0,
      away_count: s.awayCount ?? 0,
      best_streak_sec: s.bestStreakSec ?? 0,
      score_mode: s.scoreMode,
      integrity: s.integrity,
      score,
    })
    db.logEvent(sid, 'end', { score })
    setLastSessionId(sid)
    setSessionId(null)

    stopSpeaking()
    // 스트림의 모든 track을 정지한다 (카메라 표시등이 남지 않도록)
    stream?.getTracks?.().forEach((t) => t.stop())
    setStream(null)

    go('ending')
  }

  /* ── 채팅 스크롤 ───────────────────────────────────────── */
  useEffect(() => {
    listEndRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, typingSlots, readingDoc])

  /* ── @멘션 자동완성 ─────────────────────────────────────── */

  const mentionList = useMemo(() => {
    if (!mention) return []
    const q = mention.q.toLowerCase()
    return actives.filter((s) => s.name.toLowerCase().startsWith(q))
  }, [mention, actives])

  const insertMention = (seat) => {
    const before = draft.slice(0, mention.start)
    const after = draft.slice(mention.end)
    const next = `${before}@${seat.name} ${after}`
    setDraft(next)
    setMention(null)
    const caret = before.length + seat.name.length + 2
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(caret, caret)
    })
  }

  const onDraftChange = (e) => {
    const v = e.target.value
    setDraft(v)
    // 손으로 고치는 순간 사용자가 주도권을 가져간다 — 이후로는 자동 전송하지 않는다
    draftSourceRef.current = v.trim() ? 'typed' : null
    clearTimeout(voiceIdleRef.current)
    voiceIdleRef.current = null
    voiceBufRef.current = ''
    lastKeyRef.current = Date.now()
    const found = findMention(v, e.target.selectionStart ?? v.length)
    setMention(found)
    setMentionIdx(0)
  }

  const onInputKeyDown = (e) => {
    lastKeyRef.current = Date.now()
    // 한글·일본어·중국어는 글자를 조합하는 중에도 keydown 이 온다.
    // 그때 Enter 를 처리하면 조합 중이던 글자가 전송 뒤에 입력창으로 되돌아와,
    // 다음 Enter 에 그 한 글자가 따로 전송된다. ("밥줘" 다음에 "쥐" 가 날아가던 버그)
    if (e.nativeEvent?.isComposing || e.keyCode === 229) return
    if (mention && mentionList.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIdx((i) => (i + 1) % mentionList.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIdx((i) => (i - 1 + mentionList.length) % mentionList.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insertMention(mentionList[mentionIdx] || mentionList[0])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMention(null)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(draft)
    }
  }

  /* ── 렌더 ──────────────────────────────────────────────── */

  const tints = { 1: 'bg-sage', 2: 'bg-lavender', 3: 'bg-peach' }
  /**
   * 화면의 시계는 **집중 시간**을 센다.
   *
   * 총 시간을 보여주면 자리를 비워도, 폰을 봐도 숫자가 계속 올라간다.
   * 그건 "화면 앞에 있던 시간"이지 공부한 시간이 아니다.
   * 집중이 끊기면 숫자가 멈추고 빨갛게 바뀌어, 왜 안 오르는지가 바로 보인다.
   */
  const todaySec = todayBase + (snap?.focusSec ?? snap?.studySec ?? 0)
  const pausedBy = snap?.pausedBy || null

  // 멈춤은 즉시 반영되고(위 todaySec), 빨간 표시만 조금 늦게 켜진다
  const [pausedShown, setPausedShown] = useState(null)
  useEffect(() => {
    if (!pausedBy) {
      setPausedShown(null)
      return
    }
    const t = setTimeout(() => setPausedShown(pausedBy), PAUSE_SHOW_MS)
    return () => clearTimeout(t)
  }, [pausedBy])
  const seatName = (no) => seats.find((s) => s.slotNo === no)?.name || `${no}번`

  return (
    <div className="flex h-full min-w-[1280px] flex-col bg-warm">
      <main className="flex min-h-0 flex-1">
        {/* ── 좌 72% 참가자 ── */}
        <section aria-label="참가자" className="min-w-0 p-6" style={{ width: '72%' }}>
          <div className="grid h-full grid-cols-2 grid-rows-2 gap-4">
            <SelfTile
              stream={stream}
              cameraOn={device.cameraOn}
              micOn={device.micOn}
              mirror={device.mirror}
              name={displayName}
            />
            {seats.map((seat) =>
              seat.enabled ? (
                <MateTile
                  key={seat.slotNo}
                  seat={seat}
                  tint={tints[seat.slotNo] || 'bg-sage'}
                  state={typingSlots.includes(seat.slotNo) ? 'typing' : animStates[seat.slotNo] || 'studying'}
                  otherNames={seats.filter((x) => x.slotNo !== seat.slotNo).map((x) => x.name)}
                  onRename={(name) => updateSeat(seat.slotNo, { name })}
                />
              ) : (
                <EmptySeatTile
                  key={seat.slotNo}
                  seat={seat}
                  onOpenSettings={() => openSettings(seat.slotNo)}
                />
              ),
            )}
          </div>
        </section>

        {/* ── 우 28% 채팅 — 항상 열려 있고 닫기 버튼이 없다 (§6-3) ── */}
        <aside
          aria-label="채팅"
          className="flex min-h-0 flex-col border-l border-hairline bg-surface"
          style={{ width: '28%', minWidth: 380 }}
        >
          <header className="flex items-baseline gap-2 border-b border-hairline px-5 py-4">
            <h2 className="t-section">채팅</h2>
            <span className="t-caption">참여 중 {actives.length}명</span>
          </header>

          <div className="scroll-soft flex-1 overflow-y-auto px-5 py-4" role="log" aria-live="polite">
            {noMates && (
              <p className="t-help rounded-sm border border-hairline bg-[var(--hover-bg)] px-4 py-3">
                참여 중인 스터디 메이트가 없어요. 설정에서 자리를 켜면 대화를 시작할 수 있어요.
              </p>
            )}
            {!noMates && messages.length === 0 && (
              <p className="t-help">
                무엇이든 물어보세요. <span className="tnum">@</span>로 특정 메이트를 부를 수 있어요.
              </p>
            )}

            <ul className="flex flex-col gap-3">
              {messages.map((m) => (
                <li key={m.id} className={m.senderType === 'me' ? 'flex justify-end' : ''}>
                  {m.senderType === 'me' ? (
                    <div className="max-w-[86%]">
                      {m.kind === 'file' ? (
                        <div className="flex items-center gap-3 rounded-sm border border-hairline bg-peach px-4 py-3">
                          <FileText size={18} aria-hidden="true" />
                          <div className="min-w-0">
                            <div className="t-item truncate">{m.file?.name}</div>
                            <div className="t-caption tnum">{fmtBytes(m.file?.size)}</div>
                          </div>
                        </div>
                      ) : (
                        <p className="rounded-sm bg-peach px-4 py-2.5 t-body whitespace-pre-wrap break-words">
                          {m.body}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="flex max-w-[92%] gap-2">
                      <span className="mt-0.5 shrink-0">
                        <CharacterSprite
                          imageKey={seats.find((s) => s.slotNo === m.seat)?.imageKey || 'bear'}
                          state="studying"
                          size={26}
                        />
                      </span>
                      <div className="min-w-0">
                        <div className="t-caption">
                          {seatName(m.seat)}
                          {m.kind === 'quiz' && (
                            <span className="ml-1.5 rounded-full bg-[var(--hover-bg)] px-2 py-0.5">
                              확인 질문
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 rounded-sm border border-hairline bg-white px-4 py-2.5 t-body whitespace-pre-wrap break-words">
                          {m.body}
                        </p>
                      </div>
                    </div>
                  )}
                </li>
              ))}

              {/* 자료 읽는 중 — 20초쯤 걸리므로 끝날 때까지 남아 있어야 한다 */}
              {readingDoc && (
                <li className="flex gap-2" aria-live="polite">
                  <span className="mt-0.5 shrink-0 flex h-[26px] w-[26px] items-center justify-center">
                    <FileText size={16} className="text-subtle" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <div className="t-caption">자료</div>
                    <div className="mt-0.5 inline-flex max-w-full items-center gap-2 rounded-sm border border-hairline bg-white px-4 py-3">
                      <span className="t-body truncate">“{readingDoc}” 읽는 중이에요</span>
                      <span className="inline-flex shrink-0 items-center gap-1">
                        <span className="dot h-1.5 w-1.5 rounded-full bg-[var(--text-muted)]" />
                        <span className="dot h-1.5 w-1.5 rounded-full bg-[var(--text-muted)]" />
                        <span className="dot h-1.5 w-1.5 rounded-full bg-[var(--text-muted)]" />
                      </span>
                    </div>
                  </div>
                </li>
              )}

              {/* 타이핑 인디케이터 — 로딩 스피너 금지 (§6-3) */}
              {typingSlots.map((no) => (
                <li key={`typing-${no}`} className="flex gap-2">
                  <span className="mt-0.5 shrink-0">
                    <CharacterSprite
                      imageKey={seats.find((s) => s.slotNo === no)?.imageKey || 'bear'}
                      state="typing"
                      size={26}
                    />
                  </span>
                  <div>
                    <div className="t-caption">{seatName(no)}</div>
                    <div
                      className="mt-0.5 inline-flex items-center gap-1 rounded-sm border border-hairline bg-white px-4 py-3"
                      aria-label={`${seatName(no)} 님이 입력 중`}
                    >
                      <span className="dot h-1.5 w-1.5 rounded-full bg-[var(--text-muted)]" />
                      <span className="dot h-1.5 w-1.5 rounded-full bg-[var(--text-muted)]" />
                      <span className="dot h-1.5 w-1.5 rounded-full bg-[var(--text-muted)]" />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <div ref={listEndRef} />
          </div>

          {/* 입력 영역 */}
          <div className="relative border-t border-hairline px-4 py-3">
            {mention && mentionList.length > 0 && (
              <ul
                id="mention-list"
                role="listbox"
                aria-label="스터디 메이트 멘션"
                className="absolute bottom-full left-4 mb-2 w-64 overflow-hidden rounded-sm border border-hairline bg-surface shadow-pop"
              >
                {mentionList.map((s, i) => (
                  <li
                    key={s.slotNo}
                    id={`mention-opt-${s.slotNo}`}
                    role="option"
                    aria-selected={i === mentionIdx}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      insertMention(s)
                    }}
                    className={[
                      'flex cursor-pointer items-center gap-2 px-4 py-2.5 transition-colors duration-300',
                      i === mentionIdx ? 'bg-peach font-semibold' : 'hover:bg-[var(--hover-bg)]',
                    ].join(' ')}
                  >
                    <CharacterSprite imageKey={s.imageKey} state="studying" size={22} />
                    <span className="t-item truncate">{s.name}</span>
                    <span className="t-caption ml-auto">{s.slotNo}번 자리</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                tabIndex={-1}
                aria-hidden="true"
                className="hidden"
                onChange={onPickFile}
              />
              <IconBtn label="문서 올리기" onClick={() => fileRef.current?.click()}>
                <Paperclip size={17} />
              </IconBtn>

              <input
                ref={inputRef}
                value={draft}
                onChange={onDraftChange}
                onKeyDown={onInputKeyDown}
                onClick={(e) => setMention(findMention(draft, e.target.selectionStart ?? draft.length))}
                aria-label="메시지 입력"
                aria-autocomplete="list"
                aria-expanded={!!(mention && mentionList.length)}
                aria-controls="mention-list"
                aria-activedescendant={
                  mention && mentionList.length
                    ? `mention-opt-${(mentionList[mentionIdx] || mentionList[0]).slotNo}`
                    : undefined
                }
                placeholder={
                  noMates
                    ? '참여 중인 메이트가 없어요'
                    : voiceOn
                      ? '말하면 여기에 적혀요 (직접 써도 돼요)'
                      : '메시지를 입력하세요 (@로 부르기)'
                }
                className="min-w-0 flex-1 rounded-full border border-hairline bg-white px-4 py-2.5 t-body transition-colors duration-300 focus:border-coral"
              />

              <IconBtn label="보내기" active onClick={() => send(draft)} disabled={!draft.trim()}>
                <Send size={17} />
              </IconBtn>
            </div>
            {voiceOn && (
              <p className="t-caption mt-2">
                {listener.mutedByTts
                  ? '메이트가 말하는 동안에는 잠시 듣지 않아요.'
                  : '듣고 있어요. 말이 끝나면 그대로 보내요.'}
              </p>
            )}
          </div>
        </aside>
      </main>

      {/* ── 하단 컨트롤 바 (§6-3) ── */}
      <footer className="glass glass-spec z-30 mx-4 mb-4 flex h-[76px] shrink-0 items-center rounded-full px-8">
        {/* 좌 — 오늘 누적 학습 시간 (§8-1). "Today"는 기조의 손글씨 액센트 (§4-2) */}
        <div className="flex w-[280px] items-baseline gap-2.5">
          <span className="font-hand text-[26px] leading-none text-subtle" aria-hidden="true">
            Today
          </span>
          <span
            className={['t-section tnum transition-colors duration-300', pausedBy ? 'text-danger' : ''].join(
              ' ',
            )}
            aria-label={`오늘 집중한 시간 ${fmtHMS(todaySec)}${pausedShown ? ` — ${PAUSE_LABEL[pausedShown]}라 멈춰 있어요` : ''}`}
          >
            {fmtHMS(todaySec)}
          </span>
          {/* 색만으로 알리지 않는다 (§4-5, §11). 왜 멈췄는지 글자로도 말한다 */}
          {pausedShown && (
            <span className="t-caption shrink-0 text-danger" aria-hidden="true">
              {PAUSE_LABEL[pausedShown]}
            </span>
          )}
        </div>

        {/* 중앙 — 공부 종료 */}
        <div className="flex flex-1 justify-center">
          <Button variant="danger" onClick={() => setConfirmEnd(true)} className="px-7">
            <PhoneOff size={17} aria-hidden="true" />
            공부 종료
          </Button>
        </div>

        {/* 우 — 카메라 → 마이크 → 설정 순서 고정 */}
        <div className="flex w-[280px] items-center justify-end gap-2">
          <IconBtn
            label={device.cameraOn ? '카메라 끄기' : '카메라 켜기'}
            aria-pressed={device.cameraOn}
            onClick={toggleCam}
            active={device.cameraOn}
          >
            {device.cameraOn ? <Video size={17} /> : <VideoOff size={17} />}
          </IconBtn>
          {/* 받아쓰기의 유일한 스위치. 채팅창에 또 두면 어느 쪽이 진짜인지 알 수 없다 */}
          <IconBtn
            label={device.micOn ? '마이크 끄기 (받아쓰는 중)' : '마이크 켜기 (말하면 받아써요)'}
            aria-pressed={device.micOn}
            onClick={toggleMic}
            active={device.micOn}
          >
            {device.micOn ? <Mic size={17} /> : <MicOff size={17} />}
          </IconBtn>
          <IconBtn label="설정 열기" onClick={() => openSettings('me')}>
            <Settings size={17} />
          </IconBtn>
        </div>
      </footer>

      <Confirm
        open={confirmEnd}
        title="공부를 끝낼까요?"
        body={`지금까지 ${fmtHMS(snap?.studySec || 0)} 공부했어요.\n종료하면 이번 세션이 저장되고 요약 화면으로 넘어가요.`}
        confirmLabel="공부 종료"
        tone="danger"
        onConfirm={endStudy}
        onCancel={() => setConfirmEnd(false)}
      />
    </div>
  )
}
