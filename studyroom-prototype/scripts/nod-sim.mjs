/**
 * 판정 로직 자체 점검 — 카메라 없이 돌린다.
 *   npm run sim
 *
 * 합성 pitch 파형을 흘려 넣어 끄덕임 검출과 상태 전이가 실제로 동작하는지 본다.
 * 임계값을 바꾸면 반드시 이걸 돌려 확인할 것.
 */
import { NodDetector, AttentionAnalyzer, STATE } from '../src/lib/vision/attention.js'
import { NOD, RATES, HYSTERESIS } from '../src/lib/vision/constants.js'

const mulberry = (seed) => () => {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

function nodWave({ rateMs, periodMs, ampDeg, noiseDeg, durationMs, seed = 7 }) {
  const rnd = mulberry(seed)
  const det = new NodDetector()
  for (let t = 0; t <= durationMs; t += rateMs) {
    const pitch = -10 + (ampDeg / 2) * Math.sin((2 * Math.PI * t) / periodMs) + (rnd() * 2 - 1) * noiseDeg
    det.push(t, pitch)
  }
  return det.count()
}

let fail = 0
const check = (name, got, pass, note = '') => {
  const mark = pass ? '✓' : '✗'
  if (!pass) fail++
  console.log(`  ${mark} ${name.padEnd(34)} ${String(got).padStart(3)}  ${note}`)
}

console.log(`설정: ${1000 / RATES.faceMs}fps · 진폭 ${NOD.minAmplitudeDeg}° · 반주기 ${NOD.minPeriodMs}~${NOD.maxPeriodMs}ms · 임계 ${NOD.countThreshold}회\n`)

console.log('[1] 끄덕임 검출 — 20초 파형')
for (const rateMs of [RATES.faceMs, 100]) {
  console.log(` ${1000 / rateMs}fps`)
  const base = { rateMs, durationMs: 20000, noiseDeg: 1.5 }
  check('졸음: 2.0초 주기 18도', nodWave({ ...base, periodMs: 2000, ampDeg: 18 }), nodWave({ ...base, periodMs: 2000, ampDeg: 18 }) >= NOD.countThreshold, '→ 졸음이어야 함')
  check('졸음: 1.2초 주기 14도', nodWave({ ...base, periodMs: 1200, ampDeg: 14 }), nodWave({ ...base, periodMs: 1200, ampDeg: 14 }) >= NOD.countThreshold, '→ 졸음이어야 함')
  check('정상: 미세 흔들림 3도', nodWave({ ...base, periodMs: 1200, ampDeg: 3 }), nodWave({ ...base, periodMs: 1200, ampDeg: 3 }) < NOD.countThreshold, '→ 졸음 아니어야 함')
  check('정상: 아주 느림 8초 주기', nodWave({ ...base, periodMs: 8000, ampDeg: 20 }), nodWave({ ...base, periodMs: 8000, ampDeg: 20 }) < NOD.countThreshold, '→ 자세 변경, 졸음 아님')
}

console.log('\n[2] 필기 흉내 — 고개를 숙인 채 유지 (오탐 1위)')
{
  const det = new NodDetector()
  const rnd = mulberry(3)
  for (let t = 0; t <= 20000; t += RATES.faceMs) {
    // -22도에 머물면서 손 움직임에 따른 ±2도 잡음만
    det.push(t, -22 + (rnd() * 2 - 1) * 2)
  }
  check('숙인 채 유지', det.count(), det.count() < NOD.countThreshold, '→ 졸음 아니어야 함')
}

console.log('\n[3] 상태 전이 — FOCUSED / AWAY / NO_FACE')
{
  const a = new AttentionAnalyzer({ useEye: false })
  const feed = (n, s) => { let out; for (let i = 0; i < n; i++) out = a.push({ t: i * RATES.faceMs + (s.t0 || 0), ...s }); return out }
  let r = feed(HYSTERESIS.toFocused + 1, { hasFace: true, yaw: 0, pitch: 0 })
  check('정면 → focused', r.state, r.state === STATE.FOCUSED)
  r = feed(HYSTERESIS.toAway + 1, { hasFace: true, yaw: 60, pitch: 0, t0: 5000 })
  check('고개 60도 → away', r.state, r.state === STATE.AWAY)
  r = feed(HYSTERESIS.toNoFace + 1, { hasFace: false, t0: 10000 })
  check('얼굴 없음 → no_face', r.state, r.state === STATE.NO_FACE)
  r = feed(HYSTERESIS.toFocused + 1, { hasFace: true, yaw: 0, pitch: 0, t0: 20000 })
  check('복귀 → focused', r.state, r.state === STATE.FOCUSED)
  r = feed(1, { hasFace: true, yaw: 40, pitch: 0, t0: 30000 })
  check('한 표본만 튐 → 유지', r.state, r.state === STATE.FOCUSED, '→ 히스테리시스')
}

console.log(fail === 0 ? '\n전부 통과' : `\n실패 ${fail}건`)
process.exit(fail === 0 ? 0 : 1)
