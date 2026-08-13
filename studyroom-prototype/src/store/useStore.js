/**
 * 전역 상태 — 통합 설계서 §5-4
 *
 *  deviceState  방문 한정 · 영속화하지 않음 · 대기 화면이 만들어 룸으로 넘긴다
 *  roomConfig   사용자 단위 · 영속 · 대기 화면과 설정 창이 같은 것을 읽고 쓴다
 *
 * 화면마다 복사본을 두지 않는다. 모든 값은 이 스토어 하나를 바라본다.
 */

import { create } from 'zustand'
import { db } from './db'
import { defaultSeats } from '../lib/presets'

export const DEFAULT_SETTINGS = {
  // 집중 및 개입 (§6-5)
  interventionLevel: 'moderate', // quiet | moderate | lively | auto
  triggers: {
    idle: true,
    windowAway: true,
    restOver: true,
    longStudy: true,
    stuck: true,
    goalNear: false, // 목표 기능이 홈에 정의되어야 함 (§13-8)
    prevQuestion: true,
  },
  thresholds: {
    idleMin: 10,
    awayMin: 3,
    longStudyMin: 90,
    restOverMin: 15,
    cooldownMin: 10,
  },
  interventionStyles: { bubble: true, sound: false, animation: true, ask: true, cheer: true, rest: true },
  dnd: {
    focusSilence: true,
    paperMode: false,
    lectureMode: false,
    browseAllowed: false,
    quietEnabled: false,
    quietFrom: '23:00',
    quietTo: '07:00',
  },

  // 대화 운영 (§6-5)
  replyPolicy: 'auto', // primary | mention | auto
  primarySlotNo: 1,
  multiReply: 'one', // one | two | many
  crossTalk: false,
  crossTalkFreq: 'sometimes',
  noSupplement: false,
  replyLength: 'brief', // short | brief | detailed
  maxConsecutive: 2,
  noRepeat: true,

  // 기억 및 개인정보 (§6-5)
  memoryScope: 'session', // session | persistent | none  (§5-3에 따라 3단계)
  memoryFlags: {
    linkPrev: true,
    recheck: true,
    reviewBeforeEnd: true,
    continueNext: true,
    makeQuiz: true,
  },
  privacyFlags: {
    awayDetect: true,
    inputDetect: true,
    wipeOnEnd: false,
    // 카메라로 집중 상태를 본다. 판정은 전부 이 기기 안에서 돌고 영상은 나가지 않는다
    visionDetect: true,
    wakeOnDrowsy: true, // 졸음이면 소리로 깨운다
  },

  // 음성 — Web Speech API (§13-5b의 답)
  voice: { stt: true, tts: true },
}

const initial = () => {
  db.init()
  db.reconcileOpenSessions()
  const saved = db.loadConfig()
  return {
    seats: saved.seats?.length === 3 ? saved.seats : defaultSeats(),
    settings: saved.settings ? mergeSettings(saved.settings) : DEFAULT_SETTINGS,
  }
}

function mergeSettings(s) {
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    triggers: { ...DEFAULT_SETTINGS.triggers, ...(s.triggers || {}) },
    thresholds: { ...DEFAULT_SETTINGS.thresholds, ...(s.thresholds || {}) },
    interventionStyles: { ...DEFAULT_SETTINGS.interventionStyles, ...(s.interventionStyles || {}) },
    dnd: { ...DEFAULT_SETTINGS.dnd, ...(s.dnd || {}) },
    memoryFlags: { ...DEFAULT_SETTINGS.memoryFlags, ...(s.memoryFlags || {}) },
    privacyFlags: { ...DEFAULT_SETTINGS.privacyFlags, ...(s.privacyFlags || {}) },
    voice: { ...DEFAULT_SETTINGS.voice, ...(s.voice || {}) },
  }
}

const boot = initial()

export const useStore = create((set, get) => ({
  /* 라우팅 — 랜딩 → 홈 → 대기 → 스터디룸 → 엔딩 (§3-2, 랜딩 기획서 §8·§10) */
  route: 'landing',
  go: (route) => set({ route }),

  /* deviceState — 방문 한정, 영속화하지 않음 */
  device: {
    cameraOn: true,
    micOn: true,
    cameraDeviceId: '',
    micDeviceId: '',
    speakerDeviceId: '',
    mirror: true,
    background: 'none', // none | blur | image
    quality: 'auto',
    permission: 'unknown', // unknown | granted | denied | notfound | busy
  },
  setDevice: (patch) => set((s) => ({ device: { ...s.device, ...patch } })),

  /* MediaStream — 대기 화면에서 잡아 룸으로 그대로 넘긴다 (§5-4) */
  stream: null,
  setStream: (stream) => set({ stream }),

  /* roomConfig — 영속 */
  displayName: '나',
  setDisplayName: (v) => {
    set({ displayName: v })
    get().persist()
  },

  seats: boot.seats,
  settings: boot.settings,

  updateSeat: (slotNo, patch) => {
    set((s) => ({ seats: s.seats.map((x) => (x.slotNo === slotNo ? { ...x, ...patch } : x)) }))
    get().persist()
  },
  updateSettings: (patch) => {
    set((s) => ({ settings: deepMerge(s.settings, patch) }))
    get().persist()
  },
  resetSettings: () => {
    set({ settings: DEFAULT_SETTINGS, seats: defaultSeats() })
    get().persist()
  },
  persist: () => {
    const { seats, settings } = get()
    db.saveConfig(seats, settings)
  },

  /* 설정 창 (§6-5) — 진입점은 둘이지만 컴포넌트는 하나 */
  settingsOpen: false,
  settingsTarget: 'me', // 'me' | 1 | 2 | 3
  openSettings: (target = 'me') => set({ settingsOpen: true, settingsTarget: target }),
  closeSettings: () => set({ settingsOpen: false }),

  /* 대기 화면 셀렉터 — 어느 자리를 들여다보는 중인가 */
  previewTarget: 'me',
  setPreviewTarget: (t) => set({ previewTarget: t }),

  /* 세션 */
  sessionId: null,
  setSessionId: (id) => set({ sessionId: id }),
  lastSessionId: null,
  setLastSessionId: (id) => set({ lastSessionId: id }),

  /* 토스트 */
  toasts: [],
  toast: (msg, tone = 'info') => {
    const id = Math.random().toString(36).slice(2, 8)
    set((s) => ({ toasts: [...s.toasts, { id, msg, tone }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3200)
  },
}))

/* ── 파생 셀렉터 ──────────────────────────────────────────── */

/** 완화 모드가 하나라도 켜졌는가 (§8-2) — 켜지면 랭킹에서 제외 */
export const isRelaxed = (settings) =>
  settings.dnd.paperMode || settings.dnd.lectureMode || settings.dnd.browseAllowed

/** 참여 중인 자리 (§6-3) */
export const activeSeats = (seats) => seats.filter((s) => s.enabled)

/** 3자리 모두 참여 OFF → 경고 (§10 규칙 9) */
export const allSeatsOff = (seats) => seats.every((s) => !s.enabled)

function deepMerge(base, patch) {
  const out = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      base[k] &&
      typeof base[k] === 'object' &&
      !Array.isArray(base[k])
    ) {
      out[k] = deepMerge(base[k], v)
    } else {
      out[k] = v
    }
  }
  return out
}
