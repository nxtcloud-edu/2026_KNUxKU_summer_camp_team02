/**
 * 판정 로직 — 순수 함수와 상태 기계만. MediaPipe에 의존하지 않는다.
 *
 * 입력: 표본 { t, hasFace, yaw, pitch, eyeClosedness? }
 * 출력: { state, drowsy, nods, ... }
 *
 * MediaPipe를 다른 모델로 바꿔도 이 파일은 그대로 쓸 수 있다.
 */

import { POSE, NOD, EYE, HYSTERESIS, USE_EYE_SIGNAL } from './constants'

const DEG = 180 / Math.PI

/* ── 머리 자세 ────────────────────────────────────────────────
   MediaPipe의 facialTransformationMatrixes[0] 는 4×4 변환 행렬이고
   data는 평탄화된 16개 배열이다.

   ⚠️ 행 우선인지 열 우선인지가 문서에 명확하지 않다.
      그래픽 관례를 따라 열 우선을 기본으로 두되 양쪽을 모두 노출해
      /bench 에서 눈으로 확인할 수 있게 한다.
      고개를 오른쪽으로 돌렸을 때 yaw가 한 방향으로 커지는 쪽이 맞는 것이다. */

export function rotationFromMatrix(data, columnMajor = true) {
  const at = columnMajor ? (r, c) => data[c * 4 + r] : (r, c) => data[r * 4 + c]
  return [
    [at(0, 0), at(0, 1), at(0, 2)],
    [at(1, 0), at(1, 1), at(1, 2)],
    [at(2, 0), at(2, 1), at(2, 2)],
  ]
}

/** 회전행렬 → yaw/pitch/roll (도). ZYX(요-피치-롤) 분해 */
export function eulerFromRotation(R) {
  const sy = Math.sqrt(R[2][1] * R[2][1] + R[2][2] * R[2][2])
  const singular = sy < 1e-6
  let yaw, pitch, roll
  if (!singular) {
    yaw = Math.atan2(R[1][0], R[0][0])
    pitch = Math.atan2(-R[2][0], sy)
    roll = Math.atan2(R[2][1], R[2][2])
  } else {
    yaw = 0
    pitch = Math.atan2(-R[2][0], sy)
    roll = Math.atan2(-R[1][2], R[1][1])
  }
  return { yaw: yaw * DEG, pitch: pitch * DEG, roll: roll * DEG }
}

export function poseFromMatrix(matrix, columnMajor = true) {
  if (!matrix || !matrix.data || matrix.data.length < 16) return null
  return eulerFromRotation(rotationFromMatrix(matrix.data, columnMajor))
}

/** 화면을 보고 있다고 인정할 각도 범위인가 */
export function isLookingAtScreen({ yaw, pitch }) {
  if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return false
  if (Math.abs(yaw) > POSE.yawLimit) return false
  if (pitch > POSE.pitchUpLimit) return false
  if (pitch < -POSE.pitchDownLimit) return false
  return true
}

/** blendshape 배열에서 눈 감김 정도(0~1). USE_EYE_SIGNAL일 때만 쓴다 */
export function eyeClosednessFromBlendshapes(categories) {
  if (!categories || !categories.length) return null
  let l = null
  let r = null
  for (const c of categories) {
    if (c.categoryName === 'eyeBlinkLeft') l = c.score
    else if (c.categoryName === 'eyeBlinkRight') r = c.score
  }
  if (l == null && r == null) return null
  if (l == null) return r
  if (r == null) return l
  return (l + r) / 2
}

/* ── 고개 끄덕임 검출 ─────────────────────────────────────────
   핵심은 "고개가 숙여졌는가"가 아니라 "고개가 오르내리는가"다.

     필기 → 아래로 내려가서 **머문다**. 방향 전환이 거의 없다.
     졸음 → 내려갔다 올라오기를 **반복한다**. 방향 전환이 잦다.

   그래서 pitch의 국소 골(valley)과 마루(peak)를 찾아
   진폭과 주기가 조건을 만족하는 오르내림만 1회로 센다. */

export class NodDetector {
  constructor(cfg = {}) {
    this.cfg = { ...NOD, ...cfg }
    this.reset()
  }

  reset() {
    this.dir = 0 // 현재 진행 방향: +1 위로, -1 아래로, 0 미정
    this.pending = null // 지금 방향으로 가장 멀리 간 지점 (아직 반환점으로 확정 전)
    this.lastExtreme = null // 직전에 확정된 반환점 (마루 또는 골)
    this.last = null // 직전 표본
    this.nods = [] // 최근 창 안의 끄덕임 시각들
  }

  /**
   * @param {number} t  ms
   * @param {number} pitch 도
   * @returns {boolean} 이 표본에서 끄덕임 1회가 확정됐는가
   */
  push(t, pitch) {
    if (!Number.isFinite(pitch)) return false

    if (this.last == null) {
      this.last = { t, pitch }
      this.pending = { t, pitch }
      return false
    }

    const delta = pitch - this.last.pitch
    this.last = { t, pitch }

    // 잡음 구간은 방향으로 치지 않는다
    if (Math.abs(delta) < 0.2) return false

    const newDir = delta > 0 ? 1 : -1
    let counted = false

    if (this.dir === 0) {
      this.dir = newDir
      this.pending = { t, pitch }
      return false
    }

    if (newDir === this.dir) {
      // 같은 방향으로 더 갔다 — 반환점 후보를 갱신
      if ((this.dir > 0 && pitch > this.pending.pitch) || (this.dir < 0 && pitch < this.pending.pitch)) {
        this.pending = { t, pitch }
      }
      return false
    }

    // ── 방향이 바뀌었다 ──
    // 잡음으로 한 표본 튄 것과 진짜 반환을 가른다
    if (Math.abs(pitch - this.pending.pitch) < this.cfg.hysteresisDeg) return false

    // pending이 반환점(마루 또는 골)으로 확정됐다.
    // ⚠️ 진폭은 "직전 반환점 → 이번 반환점" 사이로 재야 한다 (마루-골 거리).
    //    반환점에서 현재 표본까지로 재면 한 표본 간격밖에 안 돼서 늘 0에 가깝다.
    if (this.lastExtreme) {
      const amp = Math.abs(this.pending.pitch - this.lastExtreme.pitch)
      const dur = this.pending.t - this.lastExtreme.t
      if (
        this.dir === -1 && // 내려가던 중이었다 → pending은 골이다 = 끄덕임 1회
        amp >= this.cfg.minAmplitudeDeg &&
        dur >= this.cfg.minPeriodMs &&
        dur <= this.cfg.maxPeriodMs
      ) {
        this.nods.push(this.pending.t)
        counted = true
      }
    }

    this.lastExtreme = this.pending
    this.pending = { t, pitch }
    this.dir = newDir

    const cutoff = t - this.cfg.windowMs
    while (this.nods.length && this.nods[0] < cutoff) this.nods.shift()

    return counted
  }

  count() {
    return this.nods.length
  }

  isDrowsy() {
    return this.nods.length >= this.cfg.countThreshold
  }

  clear() {
    this.nods = []
  }
}

/* ── 상태 기계 ───────────────────────────────────────────────── */

export const STATE = {
  FOCUSED: 'focused',
  AWAY: 'away',
  NO_FACE: 'no_face',
  UNKNOWN: 'unknown',
}

export const STATE_LABEL = {
  focused: '화면을 보고 있어요',
  away: '다른 곳을 보고 있어요',
  no_face: '얼굴이 보이지 않아요',
  unknown: '확인 중이에요',
}

export class AttentionAnalyzer {
  constructor(opts = {}) {
    this.hys = { ...HYSTERESIS, ...(opts.hysteresis || {}) }
    this.eye = { ...EYE, ...(opts.eye || {}) }
    this.useEye = opts.useEye ?? USE_EYE_SIGNAL
    this.nod = new NodDetector(opts.nod)
    this.reset()
  }

  reset() {
    this.state = STATE.UNKNOWN
    this._votes = 0
    this._candidate = null

    this.nod.reset()
    this.closedSince = null
    this.longClosures = []
    this.drowsy = false
    this.lastNodAt = null
  }

  /** @param {{t:number, hasFace:boolean, yaw?:number, pitch?:number, eyeClosedness?:number|null}} s */
  push(s) {
    const t = s.t
    const raw = !s.hasFace ? STATE.NO_FACE : isLookingAtScreen(s) ? STATE.FOCUSED : STATE.AWAY
    this._applyHysteresis(raw)

    if (s.hasFace && Number.isFinite(s.pitch)) {
      if (this.nod.push(t, s.pitch)) this.lastNodAt = t
    } else {
      // 얼굴이 사라지면 진행 방향 추적을 끊는다 (되돌아왔을 때 가짜 끄덕임 방지)
      this.nod.dir = 0
      this.nod.last = null
      this.nod.pending = null
      this.nod.lastExtreme = null
    }

    if (this.useEye) this._trackEyes(t, s.hasFace ? s.eyeClosedness : null)

    this.drowsy =
      this.nod.isDrowsy() || (this.useEye && this.longClosures.length >= this.eye.longClosureCount)

    return this.snapshot()
  }

  _applyHysteresis(raw) {
    if (raw === this.state) {
      this._votes = 0
      this._candidate = null
      return
    }
    if (raw !== this._candidate) {
      this._candidate = raw
      this._votes = 1
      return
    }
    this._votes += 1
    const need =
      raw === STATE.NO_FACE ? this.hys.toNoFace : raw === STATE.FOCUSED ? this.hys.toFocused : this.hys.toAway
    if (this._votes >= need) {
      this.state = raw
      this._votes = 0
      this._candidate = null
    }
  }

  _trackEyes(t, closedness) {
    const closed = closedness != null && closedness > this.eye.closedThreshold
    if (closed && this.closedSince == null) {
      this.closedSince = t
    } else if (!closed && this.closedSince != null) {
      const dur = t - this.closedSince
      this.closedSince = null
      if (dur >= this.eye.longClosureMs) this.longClosures.push(t)
    }
    const cutoff = t - this.eye.windowMs
    this.longClosures = this.longClosures.filter((x) => x >= cutoff)
  }

  /** 졸음 경보를 한 번 소비한다 (같은 졸음으로 계속 알리지 않도록) */
  consumeDrowsy() {
    const was = this.drowsy
    this.nod.clear()
    this.longClosures = []
    this.drowsy = false
    return was
  }

  snapshot() {
    return {
      state: this.state,
      lookingAtScreen: this.state === STATE.FOCUSED,
      drowsy: this.drowsy,
      nodCount: this.nod.count(),
      lastNodAt: this.lastNodAt,
      longClosures: this.longClosures.length,
      closedNow: this.closedSince != null,
    }
  }
}

/* ── 폰 ───────────────────────────────────────────────────────── */

export class PhoneTracker {
  /** @param {{candidates:Array<{name:string,minScore:number}>, confirmCount:number}} cfg */
  constructor(cfg) {
    this.candidates = cfg.candidates
    this.confirmCount = cfg.confirmCount
    this.hits = 0
    this.visible = false
    this.lastScore = 0
    this.lastName = '' // 어떤 클래스로 잡혔는지 — 화면에 그대로 보여준다
  }

  /**
   * 후보 클래스 중 하나라도 자기 문턱을 넘으면 히트로 센다.
   * 손에 든 폰이 'remote'로 잡히는 게 실측으로 확인됐기 때문이다.
   */
  push(detections) {
    let best = { name: '', score: 0, over: false }
    for (const d of detections || []) {
      for (const c of d.categories || []) {
        const cand = this.candidates.find((x) => x.name === c.categoryName)
        if (!cand) continue
        const over = c.score >= cand.minScore
        // 문턱을 넘은 것을 우선하고, 그 안에서 점수가 높은 것을 고른다
        if ((over && !best.over) || (over === best.over && c.score > best.score)) {
          best = { name: c.categoryName, score: c.score, over }
        }
      }
    }

    this.lastScore = best.score
    this.lastName = best.name
    if (best.over) this.hits = Math.min(this.confirmCount, this.hits + 1)
    else this.hits = Math.max(0, this.hits - 1)
    this.visible = this.hits >= this.confirmCount
    return this.visible
  }

  reset() {
    this.hits = 0
    this.visible = false
    this.lastScore = 0
    this.lastName = ''
  }
}
