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
/** 다른 창을 눌렀을 때 이만큼은 기다렸다가 이탈로 본다. 스치듯 누른 것은 이탈이 아니다 */
const BLUR_GRACE_MS = 5 * 1000
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
    this.blurAt = null // 다른 창으로 간 시각 (유예 중)
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

  /**
   * 지금 집중 시간이 멈춰 있는가, 그리고 왜.
   *
   * 순서는 **"얼마나 직접 본 것인가"** 다. 앞에 있는 하나만 화면에 뜨고 나머지는 버려지므로,
   * 근거가 구체적인 쪽이 앞에 와야 사용자가 원인을 안다.
   *
   * 예전엔 창 이탈(isAway)이 맨 앞이었다. 그건 카메라를 한 번도 보지 않은 신호인데
   * 가장 자주 걸려서, 한 번 다른 창을 누르면 그 뒤로 카메라가 무엇을 보든 화면에는
   * '자리 비움'만 떴다. 게다가 absent 와 **같은 라벨**이라 둘을 구분할 방법이 없었다.
   * 라벨을 가르고(StudyRoomScreen PAUSE_LABEL) 순서를 뒤집는다.
   */
  get pausedBy() {
    // 폰이 먼저다. 폰을 보려고 고개를 숙이면 얼굴이 사라지는데, 화면에 폰이 보인다는 건
    // 사람이 거기 있다는 뜻이다. 지금 유일하게 잘 도는 판정이기도 하다
    if (this.vision.phone) return 'phone'
    // 얼굴·사람·폰이 모두 없다는 합의. 카메라가 낼 수 있는 가장 강한 증거다
    if (this.vision.absent) return 'absent'
    if (this.vision.drowsy) return 'drowsy'
    if (this.isAway) return 'away'
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
    /**
     * 다른 창을 **스치듯** 눌렀다고 곧바로 이탈로 보지 않는다.
     *
     * 예전에는 blur 즉시 이탈이었다. 알림창을 닫거나 음악을 넘기려고 한 번 클릭해도
     * 그 순간부터 집중 시간이 깎였다. 카메라 판정에는 2초·0.75초씩 확인 절차를 뒀는데
     * 정작 제일 자주 걸리는 이 신호에는 아무 확인도 없었다.
     *
     * 유예를 두되 **이탈 시각은 blur 순간으로 소급**한다. 안 그러면 유예 시간만큼
     * 이탈이 짧게 기록돼, 75초 자리비움이 55초로 남고 이탈 횟수 문턱(60초)도 못 넘는다.
     */
    this._bound.blur = () => {
      if (this.blurAt == null) this.blurAt = Date.now()
    }
    this._bound.focus = () => {
      this.blurAt = null
      this._exitAway()
    }
    this._bound.input = () => {
      /**
       * **포커스가 없는 창 위를 지나간 마우스는 활동이 아니다.**
       *
       * 브라우저는 포커스가 없는 창에도 커서가 그 위를 지나가면 mousemove 를 보낸다.
       * 듀얼 모니터에서 왼쪽 유튜브를 보면서 커서만 스터디룸 창 위에 둬도
       * 계속 "활동 중"이 되어 무입력 판정이 영영 안 걸렸다.
       */
      if (!document.hasFocus()) return
      this.noteActivity()
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

  /**
   * 사용자가 뭔가를 했다. **말한 것도 여기 포함된다.**
   *
   * 예전에는 mousemove·keydown·wheel·pointerdown 만 들었다. 그런데 이 프로그램은
   * 말로 쓰는 물건이다 — 마이크에 대고 계속 이야기해도 마우스를 안 만지면
   * 10분 뒤 '자리 비움'이 됐고, 마우스를 움직이기 전까지 풀리지도 않았다.
   * 음성 입력이 들어오면 STT 쪽에서 이걸 부른다.
   */
  noteActivity() {
    this.lastInputAt = Date.now()
    if (this.isAway && !document.hidden) this._exitAway()
  }

  /** 사용자가 채팅으로 휴식을 알림 (§6-3) — 그 구간의 이탈은 "휴식"으로 분류 */
  setRestingHint(on) {
    this.restingHint = on
    db.logEvent(this.sessionId, on ? 'rest_start' : 'rest_end')
  }

  _onTick() {
    this.studySec += 1

    // 다른 창에 머문 지 유예 시간이 지났으면 그제서야 이탈로 본다 (시각은 소급)
    if (this.blurAt != null && !this.isAway && Date.now() - this.blurAt >= BLUR_GRACE_MS) {
      this._enterAway('window_blur', this.blurAt)
    }

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
      /**
       * 졸음은 **연속 집중을 끊지 않는다.**
       *
       * 졸음은 "자리에 없다"가 아니라 "있는데 주의가 떨어졌다"이다. 최장 연속 집중
       * 20점은 자리를 뜨는 것을 벌하라고 만든 항이지, 한 번 꾸벅한 것을 벌하라고
       * 만든 게 아니다. 90분을 앉아 있다가 30분 지점에 한 번 졸면 최장 연속이
       * 90분에서 60분으로 잘려 점수가 크게 깎인다 — 그건 측정이 아니라 처벌이다.
       * 집중 시간에서 그 초를 빼는 것으로 충분하다.
       */
      if (paused !== 'drowsy') this.currentStreakSec = 0
      if (paused !== 'away') this.visionSec[paused] += 1
    } else {
      this.currentStreakSec += 1
      if (this.currentStreakSec > this.bestStreakSec) this.bestStreakSec = this.currentStreakSec
    }
    this._emit()
  }

  /** @param {number} [startedAt] 이탈이 실제로 시작된 시각. 유예를 둔 경우 소급해서 넘긴다 */
  _enterAway(reason, startedAt) {
    // 완화 모드(종이책·강의·자료 탐색)에서는 창 이탈을 이탈로 보지 않는다 (§8-2)
    if (this.opts.relaxed && reason !== 'idle') return
    if (!this.opts.awayDetect && reason !== 'idle') return
    if (this.isAway) return
    this.isAway = true
    this.awayStartedAt = startedAt || Date.now()
    db.logEvent(this.sessionId, 'away_start', { reason })
  }

  _exitAway() {
    if (!this.isAway) return
    const dur = Date.now() - (this.awayStartedAt || Date.now())
    this.isAway = false
    this.awayStartedAt = null
    this.blurAt = null
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
