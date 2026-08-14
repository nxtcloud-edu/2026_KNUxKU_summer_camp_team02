/**
 * 지표 측정 — 통합 설계서 §8 [결정 6: 둘 다]
 *
 *  todayTotalSec   오늘(00:00~23:59) 누적 — 하단바 · 홈 통계   [1장 §20]
 *  sessionStudySec 이번 세션 공부 시간 — 엔딩 ②                [3장]
 *  sessionFocusSec 이번 세션 집중 시간 = 공부 − 이탈            [3장]
 *
 * "책상 앞 착석"은 웹에서 측정 불가 → "스터디룸 화면에 머문 시간"으로 조작적 정의 (§8-2)
 */

import { db } from '../store/db'

const AWAY_MIN_MS = 60 * 1000 // 이탈 1회로 세는 최소 길이 (§8-2)
const TICK_MS = 1000
const HEARTBEAT_MS = 30 * 1000 // §9-3

export class MetricsTracker {
  /**
   * @param {string} sessionId
   * @param {{awayDetect:boolean, inputDetect:boolean, idleMin:number, relaxed:boolean}} opts
   */
  constructor(sessionId, opts) {
    this.sessionId = sessionId
    this.opts = opts

    this.studySec = 0
    this.awaySec = 0
    this.awayCount = 0
    this.bestStreakSec = 0
    this.currentStreakSec = 0

    this.isAway = false
    this.awayStartedAt = null
    this.lastInputAt = Date.now()
    this.restingHint = false // §6-3 채팅으로 휴식을 알린 구간

    /**
     * 카메라가 본 것. 총 시간은 계속 세고 **집중 시간에서만** 뺀다.
     * 화면 앞에 앉아 있던 시간은 사실이고, 그중 실제로 집중한 시간이 따로 있는 것이다.
     */
    this.vision = { absent: false, phone: false, drowsy: false }
    this.visionSec = { absent: 0, phone: 0, drowsy: 0 }
    this.visionActive = false

    this._listeners = new Set()
    this._tick = null
    this._hb = null
    this._bound = {}
  }

  /** 감지가 꺼져 있으면 집중 관련 지표를 산출하지 않는다 (§8-3) */
  get canMeasureFocus() {
    return this.opts.awayDetect || this.opts.inputDetect || this.visionActive
  }

  /** 카메라 판정이 실제로 돌고 있는지. 꺼져 있으면 집중 지표를 만들지 않는다 */
  setVisionActive(on) {
    this.visionActive = !!on
    if (!on) this.vision = { absent: false, phone: false, drowsy: false }
    this._emit()
  }

  onChange(fn) {
    this._listeners.add(fn)
    return () => this._listeners.delete(fn)
  }
  _emit() {
    const s = this.snapshot()
    this._listeners.forEach((f) => f(s))
  }

  /** 지금 집중 시간이 멈춰 있는가, 그리고 왜 */
  get pausedBy() {
    if (this.isAway) return 'away'
    /**
     * 폰이 먼저다.
     *
     * 예전엔 absent 를 먼저 봤다. 그런데 **폰을 보려고 고개를 숙이면 얼굴이 사라진다.**
     * 그래서 폰을 보는 내내 "자리 비움"으로 떴다 — 사용자는 자리에 있는데.
     * 화면에 폰이 보인다는 건 사람이 거기 있다는 뜻이므로, 폰 신호가 자리 비움보다 정확하다.
     */
    if (this.vision.phone) return 'phone'
    if (this.vision.absent) return 'absent'
    if (this.vision.drowsy) return 'drowsy'
    return null
  }

  snapshot() {
    const focusable = this.canMeasureFocus
    return {
      studySec: this.studySec,
      focusSec: focusable ? Math.max(0, this.studySec - this.awaySec) : null,
      awaySec: focusable ? this.awaySec : null,
      awayCount: focusable ? this.awayCount : null,
      bestStreakSec: focusable ? this.bestStreakSec : null,
      isAway: this.isAway,
      pausedBy: this.pausedBy,
      visionSec: { ...this.visionSec },
      scoreMode: focusable ? 'full' : 'time-only',
      integrity: this.opts.relaxed ? 'relaxed' : 'strict',
    }
  }

  /**
   * 카메라 판정을 받는다. 값이 바뀔 때만 부르면 되고, 매 프레임 불러도 안전하다.
   * 흔들림 제거(몇 초 이상 지속됐는지)는 **호출부가** 한다 — 여기서는 결과만 받는다.
   *
   * @param {{absent?:boolean, phone?:boolean, drowsy?:boolean}} v
   */
  setVisionSignal(v) {
    const before = this.pausedBy
    this.vision = { ...this.vision, ...v }
    const after = this.pausedBy
    if (before !== after) {
      db.logEvent(this.sessionId, 'focus_pause', { from: before, to: after })
      this._emit()
    }
  }

  start() {
    this._bound.vis = () => {
      if (document.hidden) this._enterAway('tab_hidden')
      else this._exitAway()
      this._flush()
    }
    this._bound.blur = () => this._enterAway('window_blur')
    this._bound.focus = () => this._exitAway()
    this._bound.input = () => {
      this.lastInputAt = Date.now()
      if (this.isAway && !document.hidden) this._exitAway()
    }
    this._bound.unload = () => this._flush()

    document.addEventListener('visibilitychange', this._bound.vis)
    window.addEventListener('blur', this._bound.blur)
    window.addEventListener('focus', this._bound.focus)
    window.addEventListener('beforeunload', this._bound.unload)
    ;['mousemove', 'keydown', 'wheel', 'pointerdown'].forEach((ev) =>
      window.addEventListener(ev, this._bound.input, { passive: true }),
    )

    this._tick = setInterval(() => this._onTick(), TICK_MS)
    this._hb = setInterval(() => this._flush(), HEARTBEAT_MS)
    db.logEvent(this.sessionId, 'enter')
  }

  stop() {
    clearInterval(this._tick)
    clearInterval(this._hb)
    document.removeEventListener('visibilitychange', this._bound.vis)
    window.removeEventListener('blur', this._bound.blur)
    window.removeEventListener('focus', this._bound.focus)
    window.removeEventListener('beforeunload', this._bound.unload)
    ;['mousemove', 'keydown', 'wheel', 'pointerdown'].forEach((ev) =>
      window.removeEventListener(ev, this._bound.input),
    )
    this._flush()
  }

  /** 사용자가 채팅으로 휴식을 알림 (§6-3) — 그 구간의 이탈은 "휴식"으로 분류 */
  setRestingHint(on) {
    this.restingHint = on
    db.logEvent(this.sessionId, on ? 'rest_start' : 'rest_end')
  }

  _onTick() {
    this.studySec += 1

    // 무입력 판정 — 입력 활동 감지가 켜져 있고 완화 모드가 아닐 때만
    if (this.opts.inputDetect && !this.opts.relaxed && !this.isAway) {
      const idleMs = Date.now() - this.lastInputAt
      if (idleMs > this.opts.idleMin * 60 * 1000) this._enterAway('idle')
    }

    // 총 시간(studySec)은 위에서 이미 늘렸다 — 화면 앞에 있던 시간은 사실이다.
    // 집중 시간은 studySec - awaySec 이므로, 여기서 빼는 건 전부 집중 시간에서만 빠진다.
    const paused = this.pausedBy
    if (paused) {
      this.awaySec += 1
      this.currentStreakSec = 0
      if (paused !== 'away') this.visionSec[paused] += 1
    } else {
      this.currentStreakSec += 1
      if (this.currentStreakSec > this.bestStreakSec) this.bestStreakSec = this.currentStreakSec
    }
    this._emit()
  }

  _enterAway(reason) {
    // 완화 모드(종이책·강의·자료 탐색)에서는 창 이탈을 이탈로 보지 않는다 (§8-2)
    if (this.opts.relaxed && reason !== 'idle') return
    if (!this.opts.awayDetect && reason !== 'idle') return
    if (this.isAway) return
    this.isAway = true
    this.awayStartedAt = Date.now()
    db.logEvent(this.sessionId, 'away_start', { reason })
  }

  _exitAway() {
    if (!this.isAway) return
    const dur = Date.now() - (this.awayStartedAt || Date.now())
    this.isAway = false
    this.awayStartedAt = null
    // 60초 미만의 짧은 탭 전환은 이탈 횟수로 세지 않는다 (§8-2)
    // 휴식을 미리 알린 구간도 이탈 횟수에서 제외한다 (§6-3)
    if (dur >= AWAY_MIN_MS && !this.restingHint) this.awayCount += 1
    db.logEvent(this.sessionId, 'away_end', { durMs: dur, counted: dur >= AWAY_MIN_MS && !this.restingHint })
    this.lastInputAt = Date.now()
  }

  _flush() {
    const s = this.snapshot()
    db.heartbeat(this.sessionId, {
      study_sec: s.studySec,
      focus_sec: s.focusSec ?? 0,
      away_sec: s.awaySec ?? 0,
      away_count: s.awayCount ?? 0,
      best_streak_sec: s.bestStreakSec ?? 0,
      score_mode: s.scoreMode,
      integrity: s.integrity,
    })
  }
}

/* ── 학습 점수 (§8-4) ──────────────────────────────────────── */

/**
 * 오늘의 집중 점수 — 3장 2-4의 5개 변수
 * 가중치는 [TBD] 정책 문서 확정 전까지의 잠정값이다.
 */
export function computeScore(s) {
  const study = s.studySec || 0
  if (study < 60) return 0

  if (s.focusSec == null) {
    // 감지 OFF 폴백 (§8-3) — 시간만으로 축소 산식
    const h = study / 3600
    return Math.max(0, Math.min(100, Math.round(28 + Math.min(h, 4) * 15)))
  }

  const ratio = s.focusSec / study // 집중 시간 비율
  const hours = Math.min(s.focusSec / 3600, 4)
  const streakMin = (s.bestStreakSec || 0) / 60
  const breaks = s.awayCount || 0

  const score =
    ratio * 42 + // 집중 시간 비율
    (hours / 4) * 30 + // 총 집중 시간
    Math.min(streakMin / 50, 1) * 20 + // 최장 연속 집중
    Math.max(0, 8 - breaks * 1.6) // 이탈 횟수 감점

  return Math.max(0, Math.min(100, Math.round(score)))
}

/** 엔딩 ④ 코멘트 유형 (§6-4) */
export function commentTone(score, s) {
  if (s.focusSec == null) return 'neutral'
  if (score >= 80) return 'praise'
  if (score >= 55) return 'advice'
  if ((s.awayCount || 0) >= 5) return 'warn'
  return 'advice'
}

/* ── 포맷 ──────────────────────────────────────────────────── */
export const fmtHMS = (sec = 0) => {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

export const fmtHuman = (sec = 0) => {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  return `${h}h ${String(m).padStart(2, '0')}m ${String(ss).padStart(2, '0')}s`
}

export const fmtShort = (sec = 0) => {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`
}
