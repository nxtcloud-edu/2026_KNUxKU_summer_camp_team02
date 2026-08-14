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

/**
 * 머리 자세를 **물리적인 이름**으로 돌려준다.
 *
 * ⚠️ 여기가 이 파일에서 제일 중요한 열두 줄이다. 오래 틀려 있었다.
 *
 * eulerFromRotation 은 항공 관례(ZYX)를 따라 결과를 yaw/pitch/roll 로 부른다.
 * 그 관례는 **Z축이 위**인 좌표계의 것이다. 그런데 MediaPipe 얼굴 좌표계는 **Y축이 위**다.
 * Z축 관례를 Y축 데이터에 갖다 대면 이름이 한 칸씩 밀린다:
 *
 *     실제 동작            수학이 부르는 이름     ← 코드가 그동안 믿은 것
 *     고개 갸웃 (Z축)       yaw                  "좌우 돌림"    ✗
 *     고개 좌우 (Y축)       pitch                "위아래"       ✗
 *     고개 끄덕 (X축)       roll                 "기울기"       ✗ (그래서 버려졌다)
 *
 * 결과가 어땠는가.
 *  · NodDetector 는 pitch 를 받았다 = **좌우 돌림**. 옆을 세 번 보면 졸음이 확정됐다.
 *  · 진짜 끄덕임(roll)은 아무도 안 봤다. 조는 사람을 원리적으로 못 잡았다.
 *  · isLookingAtScreen 은 아무리 고개를 숙여도 "집중"이라고 했다.
 *
 * 수치로 확인했다. 실제 Y축 30도 회전 → {yaw:0, pitch:30, roll:0},
 * 실제 X축 30도 → {yaw:0, pitch:0, roll:30}, 실제 Z축 30도 → {yaw:30, pitch:0, roll:0}.
 * 행 우선으로 읽어도 **부호만** 뒤집히고 이름 대응은 같다 — 즉 이건 행/열 문제가 아니다.
 *
 * 그래서 각도에 물리적인 이름을 붙여 내보낸다. 부르는 쪽이 다시 헷갈릴 여지를 없앤다.
 * raw 는 /bench 진단용으로만 남긴다.
 *
 * @returns {{turn:number, nod:number, tilt:number, raw:object}|null}
 *   turn  좌우 돌림 (도리도리)
 *   nod   위아래 끄덕임
 *   tilt  갸웃 (어깨 쪽으로 기울임)
 */
export function poseFromMatrix(matrix, columnMajor = true) {
  if (!matrix || !matrix.data || matrix.data.length < 16) return null
  const e = eulerFromRotation(rotationFromMatrix(matrix.data, columnMajor))
  return { turn: e.pitch, nod: e.roll, tilt: e.yaw, raw: e }
}

/**
 * 화면을 보고 있다고 인정할 각도 범위인가.
 *
 * 위아래를 **대칭**으로 둔다. 부호(어느 쪽이 아래인가)는 기기·행렬 배치에 따라
 * 뒤집힐 수 있는데, 예전 코드는 그 부호를 확인하지 않은 채 위 22도·아래 28도로
 * 갈라 뒀다. 확인하지 않은 비대칭은 절반의 확률로 정반대로 작동한다.
 * 부호를 /bench 에서 확정하기 전까지는 대칭이 정직하다.
 */
export function isLookingAtScreen({ turn, nod }) {
  if (!Number.isFinite(turn) || !Number.isFinite(nod)) return false
  if (Math.abs(turn) > POSE.turnLimit) return false
  if (Math.abs(nod) > POSE.nodLimit) return false
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

  /** @param {{t:number, hasFace:boolean, turn?:number, nod?:number, eyeClosedness?:number|null}} s */
  push(s) {
    const t = s.t
    const raw = !s.hasFace ? STATE.NO_FACE : isLookingAtScreen(s) ? STATE.FOCUSED : STATE.AWAY
    this._applyHysteresis(raw)

    /**
     * 끄덕임은 **화면을 보고 있는 동안에만** 센다.
     *
     * 예전에는 얼굴만 잡히면 무조건 셌다. 그래서 옆을 보러 고개를 돌리는 동안의
     * 머리 움직임까지 졸음의 근거로 쌓였다. 딴 데 보는 사람은 조는 게 아니다.
     *
     * 각도 이름이 아니라 **상태**로 거는 게 중요하다. 각도로 걸면 축이 밀렸을 때
     * 조용히 무력해진다 — 실제로 그런 상태였다.
     */
    if (s.hasFace && this.state === STATE.FOCUSED && Number.isFinite(s.nod)) {
      if (this.nod.push(t, s.nod)) this.lastNodAt = t
    } else {
      // 추적을 끊는다 (되돌아왔을 때 그 사이의 간격이 가짜 끄덕임이 되지 않게)
      this.nod.dir = 0
      this.nod.last = null
      this.nod.pending = null
      this.nod.lastExtreme = null
    }

    if (this.useEye) this._trackEyes(t, s.hasFace ? s.eyeClosedness : null)

    /**
     * 졸음 = 끄덕임 **그리고** 긴 눈감김. 예전에는 `또는` 이었다.
     *
     * 끄덕임만으로는 원리적으로 못 가른다. 책을 내려다봤다 올려다보는 동작은
     * 조는 사람의 고개 떨어짐과 **물리적으로 같은 움직임**이다. 5fps 로는
     * 그 둘의 속도 차이도 분해되지 않는다. 문턱을 어떻게 조절해도 마찬가지다 —
     * 진폭·주기 조합 12가지를 전부 돌려 확인했고 전부 오탐이었다.
     *
     * 눈은 다르다. 1.2초 이상 감고 있는 것은 깜빡임(0.2초 안팎)이 아니고,
     * 책을 읽는 사람은 그렇게 오래 눈을 감지 않는다. 이게 유일하게 종류가 다른 증거다.
     * 둘 다 요구하면 놓치는 경우가 늘지만, 틀린 말로 공부를 끊는 것보다 낫다.
     */
    const nodding = this.nod.isDrowsy()
    const eyesHeavy = this.useEye && this.longClosures.length >= this.eye.longClosureCount
    this.drowsy = this.useEye ? nodding && eyesHeavy : nodding

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

/* ── 사람이 프레임 안에 있는가 ────────────────────────────────
   자리 비움 오탐의 뿌리는 **"얼굴이 안 보인다"를 "사람이 없다"로 읽은 것**이다.
   얼굴 랜드마커는 고개를 돌리거나 숙이거나, 역광이거나, 손으로 턱을 괴어도 놓친다.
   그때마다 사람은 자리에 있다.

   폰 검출에 이미 쓰고 있는 물체 검출기(EfficientDet-Lite2)의 COCO 90종 중
   **0번이 'person'** 이다. 모델 파일을 직접 열어 labels.txt 로 확인했다.
   같은 추론 결과를 이름만 다르게 읽는 것이라 **추가 비용이 0**이다. */

export class PersonTracker {
  /**
   * 횟수가 아니라 **최근 창의 검출 비율**로 판정한다.
   *
   * PhoneTracker 처럼 연속 횟수로 세면 두 방향으로 다 틀린다.
   *  · 한 프레임 놓칠 때마다 풀려서 자리 비움이 깜빡인다.
   *  · 반대로 의자에 걸린 옷이 이따금 사람으로 잡히면, 켜기 1회짜리 래치는
   *    그 한 번에 계속 되살아나 자리 비움이 영영 안 뜬다.
   * 비율은 둘 다 견딘다 — 산발적 오검출은 비율을 못 올리고, 한두 프레임 놓침은 못 내린다.
   */
  constructor(cfg) {
    this.cfg = cfg
    this.hist = [] // 최근 스텝들의 검출 여부
    this.visible = false
    this.lastScore = 0
    this.lastArea = 0
  }

  /**
   * @param {Array} detections 검출기 원본
   * @param {number} frameArea 영상 넓이 (px²). 0이면 면적 검사를 건너뛴다
   */
  push(detections, frameArea = 0) {
    let best = 0
    let area = 0
    for (const d of detections || []) {
      for (const c of d.categories || []) {
        if (c.categoryName !== 'person' || c.score < this.cfg.minScore) continue
        const b = d.boundingBox
        const a = b && frameArea ? (b.width * b.height) / frameArea : 1
        // 벽에 붙은 인물 포스터·모니터 속 화상통화처럼 아주 작게 잡히는 것은 뺀다.
        // 문턱을 아주 낮게 두는 건 의도적이다 — 이 검사가 진짜 사용자를 걸러 내면
        // 고치려던 문제가 그대로 돌아온다. 위조 방어는 여기가 아니라 무입력 쪽이 맡는다
        if (a < this.cfg.minAreaRatio) continue
        if (c.score > best) {
          best = c.score
          area = a
        }
      }
    }
    this.lastScore = best
    this.lastArea = area

    this.hist.push(best > 0)
    if (this.hist.length > this.cfg.windowSteps) this.hist.shift()

    // 표본이 모자라면 섣불리 "없다"고 하지 않는다
    if (this.hist.length < this.cfg.minSteps) return this.visible

    const ratio = this.hist.filter(Boolean).length / this.hist.length
    if (!this.visible && ratio >= this.cfg.onRatio) this.visible = true
    else if (this.visible && ratio <= this.cfg.offRatio) this.visible = false
    return this.visible
  }

  reset() {
    this.hist = []
    this.visible = false
    this.lastScore = 0
    this.lastArea = 0
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
