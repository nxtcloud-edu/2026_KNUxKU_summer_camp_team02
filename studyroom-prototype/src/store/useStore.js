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
import { defaultSeats, freshName } from '../lib/presets'
import { DEFAULT_OWNER, validateOwner } from '../lib/agent/functions'
import { toneOf } from '../lib/agent/tone'
import { GUEST, accountKeyOf, clearAccount, displayNameOf, loadAccount, saveAccount } from '../lib/auth'

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

  /**
   * 어느 캐릭터가 어느 기능을 맡는가. 값은 좌석 번호.
   *
   * 좌석 배열이 아니라 **방 전체의 맵 하나**에 둔다. 맵이면 중복 배정과 미배정이
   * 자료 구조상 표현 불가능해지고, 세 좌석을 동시에 고칠 때 중간 상태가 저장되지 않는다.
   * 게다가 settings 에는 이미 마이그레이션(mergeSettings)이 있어 기존 사용자가
   * 기본 배정을 공짜로 받는다.
   */
  functionOwner: { ...DEFAULT_OWNER },

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
  // db 는 모듈이 로드될 때 이미 저장된 계정의 칸을 열어 둔다 (db.js 의 accountKey)
  db.init()
  db.reconcileOpenSessions()
  return { account: loadAccount(), ...configOf() }
}

/**
 * 지금 열려 있는 칸의 설정을 읽는다.
 *
 * 계정을 갈아탈 때마다 이걸 다시 불러야 한다. 스토어는 모듈 로드 시점에 한 번만
 * 읽으므로, 이 함수 없이 계정만 바꾸면 **앞 계정의 캐릭터 설정이 그대로 남는다.**
 */
function configOf() {
  const saved = db.loadConfig()
  return {
    seats: saved.seats?.length === 3 ? saved.seats.map(mergeSeat) : defaultSeats(),
    settings: saved.settings ? mergeSettings(saved.settings) : DEFAULT_SETTINGS,
    /**
     * **이름도 여기서 읽는다.**
     *
     * setDisplayName 은 db 에 잘 쓰고 있었는데 다시 읽는 길이 없었다.
     * 부팅할 때마다 구글 프로필 이름으로 되돌아가서, 사용자에게는
     * "이름 설정이 저장이 안 된다"로 보였다. 쓰기만 있고 읽기가 없던 것이다.
     */
    displayName: db.getUser()?.display_name || displayNameOf(loadAccount()),
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
    // 배정이 규칙을 어기면(옛 저장값·손댄 값) 기본으로 되돌린다.
    // 어긋난 배정으로 도는 것보다 기본값이 낫다 — 기능 하나가 조용히 사라지는 게 제일 나쁘다
    functionOwner: validateOwner(s.functionOwner).length
      ? { ...DEFAULT_OWNER }
      : { ...DEFAULT_OWNER, ...(s.functionOwner || {}) },
  }
}

/**
 * 좌석 마이그레이션.
 *
 * settings 와 달리 좌석에는 마이그레이션이 없었다 — 개수만 3개인지 보고 통과시켰다.
 * 그래서 축을 바꾸면 **이미 저장된 브라우저**의 좌석에 tone 이 없는 채로 들어온다.
 * toneOf 가 옛 traits 에서 말투를 유추해 주므로 그걸 한 번 확정해 둔다.
 */
function mergeSeat(seat, i) {
  const base = defaultSeats()[i] || {}
  const { traits, explainStyle, proactivity, ...rest } = seat || {}
  const merged = { ...base, ...rest, tone: seat?.tone || toneOf(seat) || base.tone }
  /**
   * 저장된 이름이 **한때 기본값이었던 것**이면 지금 기본값으로 올린다.
   *
   * 이름을 한글로 바꿨는데 이미 저장된 설정은 옛 이름(Mina·Theo·Juno)을 붙들고 있어서,
   * 랜딩(PRESETS 직독)에는 새 이름이 뜨고 설정창·로비·스터디룸(저장된 좌석)에는
   * 옛 이름이 떴다. 한 화면 안에서 이름이 갈리는 것만큼 어설퍼 보이는 게 없다.
   * 직접 지은 이름은 그대로 둔다 (presets.js 의 freshName).
   */
  merged.name = freshName(merged.preset || base.preset, merged.name)
  return merged
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

  /* 계정 — 데이터 칸을 가르는 이름표 (lib/auth.js) */
  account: boot.account,

  /**
   * 로그인. 칸을 갈아타고 그 칸의 설정을 다시 읽는다.
   *
   * 진행 중인 세션 id 는 앞 계정 것이라 반드시 버린다. 남겨 두면 새 계정의 db 에
   * 없는 세션에 대고 heartbeat 를 쏘게 된다.
   */
  signIn: (profile) => {
    saveAccount(profile)
    db.useAccount(accountKeyOf(profile))
    db.setUser({
      /**
       * 이미 정해 둔 이름이 있으면 **건드리지 않는다.**
       * 매번 구글 이름으로 덮어쓰면 다시 로그인할 때마다 바꿔 둔 이름이 사라진다.
       */
      display_name: db.getUser()?.display_name || displayNameOf(profile),
      avatar_url: profile.picture || null,
      email: profile.email || '',
      provider: profile.provider,
    })
    set({
      account: profile,
      sessionId: null,
      lastSessionId: null,
      ...configOf(),
    })
  },

  signOut: () => {
    clearAccount()
    db.useAccount('guest')
    set({
      account: { ...GUEST },
      displayName: '나',
      sessionId: null,
      lastSessionId: null,
      route: 'landing',
      ...configOf(),
    })
  },

  /* roomConfig — 영속 */
  displayName: boot.displayName,
  setDisplayName: (v) => {
    set({ displayName: v })
    db.setUser({ display_name: v })
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

  /**
   * 로비에서 미리 올린 자료 — 입장하면 방이 받아 간다.
   *
   * 두 가지 모양이 온다.
   *   { name, body }  로비에서 **다 읽었다.** 방은 그대로 붙이기만 한다
   *   { name, file }  아직 읽는 중에 입장했다. 방이 이어서 읽는다
   *
   * 이 값을 두는 이유는 22쪽 논문이 28초쯤 걸리기 때문이다. 방에 들어가서 읽으면
   * 빈 화면을 그만큼 본다. 로비에서 읽으면 그 시간이 카메라·마이크 점검에 묻힌다.
   * (한 번 쓰고 비운다 — 남겨 두면 다음 세션에 옛 자료가 딸려 들어간다)
   */
  pendingDoc: null,
  setPendingDoc: (d) => set({ pendingDoc: d }),

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
