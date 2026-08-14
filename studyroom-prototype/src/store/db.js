/**
 * 임시 DB — 통합 설계서 §9 [결정 8]
 *
 * 스키마는 §9-2와 같은 모양이다. 지금은 localStorage에 얹혀 있지만,
 * 아래 db.* 함수 시그니처만 유지하면 SQLite/서버 REST로 그대로 갈아끼울 수 있다.
 * 화면 코드는 절대 localStorage를 직접 만지지 않는다.
 */

import { accountKeyOf, loadAccount } from '../lib/auth'

/**
 * 저장 칸은 **계정마다 하나씩**이다. `studyroom.db.v1:<계정키>`.
 *
 * 로그인 전에 공부한 기록은 `guest` 칸에 남는다. 로그인해도 그 칸을 지우지 않는다 —
 * 로그아웃하면 그대로 다시 보인다.
 *
 * 예전 버전은 접미사 없이 `studyroom.db.v1` 하나만 썼다. 이미 그 키로 쌓인 기록이
 * 있는 브라우저에서는 guest 칸으로 옮겨 준다(원본은 지우지 않는다 — 되돌릴 수 있게).
 */
const KEY_BASE = 'studyroom.db.v1'

let accountKey = accountKeyOf(loadAccount())

const storageKey = () => `${KEY_BASE}:${accountKey}`

function migrateLegacy() {
  if (typeof localStorage === 'undefined') return
  try {
    const legacy = localStorage.getItem(KEY_BASE)
    if (legacy && !localStorage.getItem(`${KEY_BASE}:guest`)) {
      localStorage.setItem(`${KEY_BASE}:guest`, legacy)
    }
  } catch (e) {
    console.warn('[db] 예전 기록 이전 실패', e)
  }
}
migrateLegacy()

const emptyDb = () => ({
  user: null,
  character_slot: [],
  room_settings: null,
  session: [],
  session_event: [],
  daily_stat: [],
  quiz_result: [],
  study_point: [],
  memory_item: [],
  /** 올린 자료의 글 본문. 계정별로 갈리므로 남의 자료가 섞이지 않는다 */
  document: [],
  friendship: [],
  message: [],
  peers: [], // 랭킹용 더미 이용자 (§9-4)
})

let cache = null

function read() {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(storageKey())
    cache = raw ? { ...emptyDb(), ...JSON.parse(raw) } : emptyDb()
  } catch {
    cache = emptyDb()
  }
  return cache
}

function write() {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(cache))
  } catch (e) {
    console.warn('[db] 저장 실패', e)
  }
}

const uid = () => Math.random().toString(36).slice(2, 10)

/* ── 날짜 유틸 (§5-3: 로컬 타임존, 주는 월요일 시작) ─────────── */
export const todayKey = (d = new Date()) => {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}

export function weekStart(d = new Date()) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  const dow = (x.getDay() + 6) % 7 // 월=0
  x.setDate(x.getDate() - dow)
  return x
}

export function daysAgoKey(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return todayKey(d)
}

/* ── seed (§9-4) ───────────────────────────────────────────── */
const PEER_NAMES = [
  '민서',
  '지후',
  '서연',
  '도윤',
  '하은',
  '주원',
  '수아',
  '건우',
  '지아',
  '시우',
  '예린',
  '태윤',
  '나은',
  '현우',
  '유진',
  '정민',
  '보라',
  '승현',
  '가온',
  '리아',
]

function seedIfEmpty() {
  const db = read()
  if (db.user) return db

  db.user = { id: uid(), display_name: '나', avatar_url: null, created_at: Date.now() }

  // 최근 28일치 내 기록 — 데모에서 통계/연속 학습일이 비어 보이지 않도록
  const mine = []
  for (let i = 27; i >= 1; i--) {
    // 최근 5일은 반드시 채워 연속 학습일이 보이게 한다
    const active = i <= 5 ? true : Math.random() > 0.35
    if (!active) continue
    const study = Math.round(40 * 60 + Math.random() * 130 * 60)
    const focus = Math.round(study * (0.62 + Math.random() * 0.3))
    mine.push({
      user_id: db.user.id,
      date: daysAgoKey(i),
      total_study_sec: study,
      total_focus_sec: focus,
      session_count: 1 + (Math.random() > 0.7 ? 1 : 0),
      score: Math.round(52 + (focus / study) * 40),
      streak_days: 0,
    })
  }
  db.daily_stat = mine

  // 더미 이용자 + 최근 4주 기록 → 상위 %, 친구 비교
  db.peers = PEER_NAMES.map((n, i) => {
    const weekly = Math.round(2 * 3600 + Math.random() * 16 * 3600)
    return {
      id: `peer-${i}`,
      name: n,
      is_friend: i < 4, // 친구 4명
      weekly_focus_sec: weekly,
      level: Math.round(30 + Math.random() * 65),
    }
  })

  write()
  return db
}

/* ── 공개 API ──────────────────────────────────────────────── */
export const db = {
  init() {
    return seedIfEmpty()
  },

  getUser() {
    return read().user
  },

  /** 지금 열려 있는 칸의 이름 */
  accountKey() {
    return accountKey
  },

  /**
   * 다른 계정의 칸으로 갈아탄다.
   *
   * 갈아타기 전에 지금 칸을 먼저 저장한다. 저장하지 않고 캐시를 버리면
   * 로그인 직전에 한 공부가 통째로 날아간다.
   *
   * @returns {boolean} 실제로 칸이 바뀌었는가
   */
  useAccount(key) {
    const next = key || 'guest'
    if (next === accountKey) return false
    if (cache) write()
    accountKey = next
    cache = null
    seedIfEmpty() // 새 칸이면 사용자 레코드와 데모 기록을 만든다
    return true
  },

  /** 로그인해서 알게 된 이름·사진을 사용자 레코드에 반영한다 */
  setUser(patch) {
    const d = read()
    d.user = { ...(d.user || {}), ...patch }
    write()
    return d.user
  },

  /* 설정 (roomConfig) */
  loadConfig() {
    const d = read()
    return { seats: d.character_slot, settings: d.room_settings }
  },
  saveConfig(seats, settings) {
    const d = read()
    d.character_slot = seats
    d.room_settings = settings
    write()
  },

  /* 세션 */
  startSession() {
    const d = read()
    const s = {
      id: uid(),
      user_id: d.user?.id,
      started_at: Date.now(),
      ended_at: null,
      study_sec: 0,
      focus_sec: 0,
      away_sec: 0,
      away_count: 0,
      best_streak_sec: 0,
      score: null,
      score_mode: 'full',
      integrity: 'strict',
      /**
       * 이번 세션에 하려는 것. 대기 화면에서 한 줄 받는다.
       *
       * 목표 추적(F4)이 **원문 그대로 인용**해야 해서 문자열을 그대로 보관한다.
       * 비어 있으면 F4 는 아예 발동하지 않는다 — 없는 목표를 지어내지 않는다.
       */
      goal: '',
      /** 사용자가 답한 진도. "2장까지 했어" 같은 원문 */
      goal_progress: '',
      goal_progress_at: null,
      topics: [],
      topic_source: 'none',
    }
    d.session.push(s)
    write()
    return s.id
  },

  /** 하트비트 — 30초마다 + visibilitychange/beforeunload (§9-3) */
  heartbeat(sessionId, patch) {
    const d = read()
    const s = d.session.find((x) => x.id === sessionId)
    if (!s) return
    Object.assign(s, patch)
    write()
  },

  endSession(sessionId, patch) {
    const d = read()
    const s = d.session.find((x) => x.id === sessionId)
    if (!s) return null
    Object.assign(s, patch, { ended_at: Date.now() })
    rollUpDaily(d, s)
    write()
    return s
  },

  getSession(sessionId) {
    return read().session.find((x) => x.id === sessionId) || null
  },

  /** 비정상 종료 복구 — ended_at이 없는 세션을 마지막 하트비트로 마감 (§9-3) */
  reconcileOpenSessions() {
    const d = read()
    let fixed = 0
    d.session.forEach((s) => {
      if (s.ended_at == null && Date.now() - s.started_at > 30 * 60 * 1000) {
        s.ended_at = s.started_at + s.study_sec * 1000
        rollUpDaily(d, s)
        fixed++
      }
    })
    if (fixed) write()
    return fixed
  },

  logEvent(sessionId, type, payload = {}) {
    const d = read()
    d.session_event.push({ id: uid(), session_id: sessionId, ts: Date.now(), type, payload })
    if (d.session_event.length > 2000) d.session_event.splice(0, 500)
    write()
  },

  /* 메시지 */
  addMessage(sessionId, m) {
    const d = read()
    const row = { id: uid(), session_id: sessionId, created_at: Date.now(), ...m }
    d.message.push(row)
    write()
    return row
  },
  getMessages(sessionId) {
    return read().message.filter((m) => m.session_id === sessionId)
  },

  /* 엔딩 2단계 원천 */
  addQuizResult(sessionId, r) {
    const d = read()
    d.quiz_result.push({ id: uid(), session_id: sessionId, ts: Date.now(), ...r })
    write()
  },
  getQuizResults(sessionId) {
    return read().quiz_result.filter((q) => q.session_id === sessionId)
  },
  /* 올린 자료 (§ 계정별 RAG) ────────────────────────────────
     localStorage 는 출처(origin) 전체를 다 합쳐 5MB 안팎이다. 계정 칸이 여러 개면
     그 5MB 를 나눠 쓴다. 그래서 자료는 **개수와 길이를 둘 다** 막는다.
     넘치면 오래된 것부터 버린다 — 방금 올린 자료를 못 쓰게 되는 게 제일 나쁘다. */
  MAX_DOCS: 30,
  MAX_DOC_CHARS: 20000,

  /**
   * 엔딩 요약. 세션당 한 번 만들고 그대로 둔다.
   *
   * 열 때마다 새로 만들면 **볼 때마다 내용이 달라진다.** 어제 정리한 걸 오늘 다시 봤는데
   * 개념이 바뀌어 있으면 기록으로서 쓸모가 없다.
   */
  saveReview(sessionId, review) {
    const s = read().session.find((x) => x.id === sessionId)
    if (!s) return
    s.review = review
    s.review_at = Date.now()
    write()
  },

  /**
   * 그날 남긴 요약을 찾는다 (yyyy-mm-dd).
   *
   * 요약은 세션에 붙어 있는데 홈 화면은 **날짜**로 기록을 보여준다. 그 사이를
   * 이어 줄 길이 없어서, 저장은 되는데 다시 볼 수가 없었다 — 사용자에게는
   * "요약이 저장이 안 된다"로 보인다.
   * 하루에 여러 번 공부했으면 **요약이 있는 마지막 세션**을 준다.
   */
  getReviewByDay(dayKey) {
    const list = (read().session || [])
      .filter((x) => x.review && todayKey(new Date(x.started_at)) === dayKey)
      .sort((a, b) => a.started_at - b.started_at)
    const s = list[list.length - 1]
    return s ? { review: s.review, session: s } : null
  },

  getReview(sessionId) {
    return read().session.find((x) => x.id === sessionId)?.review || null
  },

  /** 다시 만들기 — 실패했을 때만 */
  clearReview(sessionId) {
    const s = read().session.find((x) => x.id === sessionId)
    if (!s) return
    s.review = null
    s.review_at = null
    write()
  },

  addDocument({ name, text, sessionId = null }) {
    const body = String(text || '').slice(0, db.MAX_DOC_CHARS)
    if (!body.trim()) return null
    const d = read()
    // 같은 이름을 다시 올리면 덮어쓴다. 같은 자료가 두 벌 쌓이면 검색이 중복으로 나온다
    d.document = (d.document || []).filter((x) => x.name !== name)
    const doc = {
      id: uid(),
      name,
      text: body,
      chars: body.length,
      session_id: sessionId,
      added_at: Date.now(),
    }
    d.document.push(doc)
    if (d.document.length > db.MAX_DOCS) d.document = d.document.slice(-db.MAX_DOCS)
    try {
      write()
    } catch {
      // 저장 공간이 꽉 찼다. 절반을 버리고 한 번만 다시 시도한다
      d.document = d.document.slice(Math.floor(d.document.length / 2))
      write()
    }
    return doc
  },

  getDocuments() {
    return read().document || []
  },

  deleteDocument(id) {
    const d = read()
    d.document = (d.document || []).filter((x) => x.id !== id)
    write()
  },

  /** 세션 목표를 적어 둔다 (대기 화면에서 한 번) */
  setGoal(sessionId, text) {
    const s = read().session.find((x) => x.id === sessionId)
    if (!s) return
    s.goal = String(text || '').slice(0, 60)
    write()
  },

  /** 진도 응답을 기록한다. 다음 확인 때 이 지점부터 묻는다 */
  setProgress(sessionId, text) {
    const s = read().session.find((x) => x.id === sessionId)
    if (!s) return
    s.goal_progress = String(text || '').slice(0, 120)
    s.goal_progress_at = Date.now()
    write()
  },

  addStudyPoint(sessionId, text, sourceDoc = null) {
    const d = read()
    if (d.study_point.some((p) => p.session_id === sessionId && p.text === text)) return
    d.study_point.push({ id: uid(), session_id: sessionId, ts: Date.now(), text, source_doc: sourceDoc })
    write()
  },
  getStudyPoints(sessionId) {
    return read().study_point.filter((p) => p.session_id === sessionId)
  },

  /* 통계 */
  getDailyStats() {
    return read().daily_stat
  },
  getDaily(dateKey) {
    return read().daily_stat.find((s) => s.date === dateKey) || null
  },
  getPeers() {
    return read().peers
  },

  /** 오늘 누적 학습 시간 — 하단바 타이머 (§8-1) */
  todayTotalSec() {
    const d = read()
    const t = d.daily_stat.find((s) => s.date === todayKey())
    const persisted = t ? t.total_study_sec : 0
    const live = d.session
      .filter((s) => s.ended_at == null && todayKey(new Date(s.started_at)) === todayKey())
      .reduce((a, s) => a + s.study_sec, 0)
    return persisted + live
  },

  /**
   * 오늘 집중한 시간. 화면의 시계가 쓴다.
   * 총 시간은 화면 앞에 있던 시간이고, 이건 실제로 집중한 시간이다 (§8-2).
   */
  todayFocusSec() {
    const d = read()
    const t = d.daily_stat.find((s) => s.date === todayKey())
    const persisted = t ? t.total_focus_sec || 0 : 0
    const live = d.session
      .filter((s) => s.ended_at == null && todayKey(new Date(s.started_at)) === todayKey())
      .reduce((a, s) => a + (s.focus_sec || 0), 0)
    return persisted + live
  },

  /** 연속 학습일 — 하루 10분 이상 (§8-4) */
  streakDays() {
    const d = read()
    const map = new Map(d.daily_stat.map((s) => [s.date, s]))
    let n = 0
    for (let i = 0; i < 400; i++) {
      const row = map.get(daysAgoKey(i))
      if (row && row.total_study_sec >= 600) n++
      else if (i > 0) break
    }
    return n
  },

  /* 기억 · 개인정보 (§6-5) */
  addMemory(scope, content) {
    const d = read()
    d.memory_item.push({
      id: uid(),
      user_id: d.user?.id,
      scope,
      content,
      created_at: Date.now(),
      expires_at: null,
    })
    write()
  },
  getMemories() {
    return read().memory_item
  },
  deleteMemory(id) {
    const d = read()
    d.memory_item = d.memory_item.filter((m) => m.id !== id)
    write()
  },
  /** §6-5 [판단] 대화·기억만 지운다. 학습 통계(session/daily_stat)는 건드리지 않는다 */
  wipeConversationMemory() {
    const d = read()
    d.memory_item = []
    d.message = []
    write()
  },

  resetAll() {
    cache = emptyDb()
    write()
    seedIfEmpty()
  },
}

function rollUpDaily(d, s) {
  const key = todayKey(new Date(s.started_at))
  let row = d.daily_stat.find((x) => x.date === key)
  if (!row) {
    row = {
      user_id: d.user?.id,
      date: key,
      total_study_sec: 0,
      total_focus_sec: 0,
      session_count: 0,
      score: null,
      streak_days: 0,
    }
    d.daily_stat.push(row)
  }
  row.total_study_sec += s.study_sec
  row.total_focus_sec += s.focus_sec || 0
  row.session_count += 1
  row.score = s.score ?? row.score
}
