/**
 * 자리비움·졸음 판정 검사.
 *
 * 사용자가 겪은 증상 셋을 그대로 재현해 본다.
 *   ① 옆을 보기만 해도 '자리 비움'
 *   ② 조는 게 아닌데 졸음 개입
 *   ③ 빨간 표시는 늘 '자리 비움'
 *
 * 셋의 뿌리는 하나였다 — **오일러 축 이름이 한 칸 밀려 있었다.**
 * 항공 관례(ZYX)는 Z축이 위인 좌표계의 이름인데 MediaPipe 얼굴 좌표계는 Y축이 위다.
 * 그래서 코드가 `pitch`(위아래)라고 부른 값이 실제로는 **좌우 돌림**이었고,
 * 그 값이 그대로 끄덕임 검출기에 들어갔다. 옆을 세 번 보면 졸음이었다.
 *
 * 실행:  node scripts/attention-test.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tmp = mkdtempSync(join(tmpdir(), 'att-'))
const tmp2 = tmp
const bundle = join(tmp, 'attention.mjs')
execFileSync(
  join(root, 'node_modules', '.bin', 'esbuild'),
  [join(root, 'src', 'lib', 'vision', 'attention.js'), '--bundle', '--format=esm', `--outfile=${bundle}`],
  { stdio: 'pipe' },
)
const A = await import(bundle)
const cbundle = join(tmp, 'constants.mjs')
execFileSync(
  join(root, 'node_modules', '.bin', 'esbuild'),
  [join(root, 'src', 'lib', 'vision', 'constants.js'), '--bundle', '--format=esm', `--outfile=${cbundle}`],
  { stdio: 'pipe' },
)
const C = await import(cbundle)

let pass = 0
const fails = []
const ok = (name, cond, extra = '') => {
  if (cond) pass += 1
  else fails.push(`${name}${extra ? ` — ${extra}` : ''}`)
}

/* ── 회전행렬 도구 ───────────────────────────────────────── */
const D = Math.PI / 180
const Rx = (a) => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]]
const Ry = (a) => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]]
const Rz = (a) => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]]
const mul = (X, Y) => X.map((r) => Y[0].map((_, j) => r.reduce((s, v, k) => s + v * Y[k][j], 0)))
/** 3×3 → MediaPipe 가 주는 모양(4×4 평탄배열, 열 우선) */
const asMatrix = (R) => {
  const d = new Array(16).fill(0)
  d[15] = 1
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) d[c * 4 + r] = R[r][c]
  return { data: d }
}
/** MediaPipe 얼굴 좌표계: X 오른쪽 · Y 위 · Z 얼굴 앞 */
const TURN = (deg) => asMatrix(Ry(deg * D)) // 도리도리
const NODM = (deg) => asMatrix(Rx(deg * D)) // 끄덕
const TILT = (deg) => asMatrix(Rz(deg * D)) // 갸웃

/* ══ 1. 축 이름이 실제 동작을 가리키는가 ══════════════════ */
{
  const t = A.poseFromMatrix(TURN(30))
  const n = A.poseFromMatrix(NODM(30))
  const l = A.poseFromMatrix(TILT(30))
  const near = (a, b) => Math.abs(a - b) < 0.5
  ok('좌우 돌림 → turn 에만 나온다', near(Math.abs(t.turn), 30) && near(t.nod, 0) && near(t.tilt, 0),
    `turn=${t.turn.toFixed(1)} nod=${t.nod.toFixed(1)} tilt=${t.tilt.toFixed(1)}`)
  ok('끄덕임 → nod 에만 나온다', near(Math.abs(n.nod), 30) && near(n.turn, 0) && near(n.tilt, 0),
    `turn=${n.turn.toFixed(1)} nod=${n.nod.toFixed(1)} tilt=${n.tilt.toFixed(1)}`)
  ok('갸웃 → tilt 에만 나온다', near(Math.abs(l.tilt), 30) && near(l.turn, 0) && near(l.nod, 0),
    `turn=${l.turn.toFixed(1)} nod=${l.nod.toFixed(1)} tilt=${l.tilt.toFixed(1)}`)
  // 예전 고장의 정체: 수학 이름 그대로 쓰면 좌우가 pitch 로 나온다
  ok('예전 이름은 실제로 밀려 있었다 (회귀 감시)', Math.abs(t.raw.pitch) > 29 && Math.abs(t.raw.yaw) < 0.5,
    `좌우 30도 → raw.pitch=${t.raw.pitch.toFixed(1)}`)
}

/* ══ 2. isLookingAtScreen 이 옳은 축을 보는가 ═════════════ */
{
  const look = (m) => A.isLookingAtScreen(A.poseFromMatrix(m))
  ok('정면은 집중', look(TURN(0)))
  ok(`좌우 ${C.POSE.turnLimit - 5}도는 집중`, look(TURN(C.POSE.turnLimit - 5)))
  ok(`좌우 ${C.POSE.turnLimit + 10}도는 이탈`, !look(TURN(C.POSE.turnLimit + 10)))
  ok('반대쪽도 대칭', !look(TURN(-(C.POSE.turnLimit + 10))))
  ok(`숙임 ${C.POSE.nodLimit + 15}도는 이탈`, !look(NODM(C.POSE.nodLimit + 15)))
  // 예전에는 아무리 숙여도 늘 '집중'이었다 — nod 축을 아무도 안 봤기 때문이다
  ok('예전 고장: 크게 숙였는데 집중 (회귀 감시)', !look(NODM(50)), '50도 숙였는데 집중으로 나온다')
}

/* ══ 3. 끄덕임 검출기가 옆을 보는 걸 세지 않는가 ══════════ */
const RATE = 200
function feed(poses, opts = {}) {
  const an = new A.AttentionAnalyzer({ useEye: false, ...opts })
  let t = 0
  let maxNods = 0
  let drowsyAt = null
  for (const m of poses) {
    const p = m ? A.poseFromMatrix(m) : null
    const s = an.push({ t, hasFace: !!m, turn: p?.turn, nod: p?.nod, eyeClosedness: null })
    if (s.nodCount > maxNods) maxNods = s.nodCount
    if (s.drowsy && drowsyAt == null) drowsyAt = t
    t += RATE
  }
  return { maxNods, drowsyAt, state: an.state }
}
/** 두 자세를 오가는 궤적 */
function oscillate(make, a, b, halfMs, totalMs) {
  const out = []
  for (let t = 0; t < totalMs; t += RATE) {
    const s = (t % (halfMs * 2)) / (halfMs * 2)
    out.push(make(s < 0.5 ? a + (b - a) * (s * 2) : b + (a - b) * ((s - 0.5) * 2)))
  }
  return out
}
{
  // 사용자가 실제로 한 것: 노트북 옆의 책·모니터를 본다
  const side = feed(oscillate(TURN, 0, 30, 1500, 60000))
  ok('옆을 봐도 끄덕임으로 안 센다', side.maxNods === 0, `${side.maxNods}회 셌다`)
  ok('옆을 봐도 졸음이 안 뜬다', side.drowsyAt == null, `${side.drowsyAt / 1000}초에 떴다`)

  // 진짜 끄덕임은 보인다 (화면을 보는 범위 안에서)
  const real = feed(oscillate(NODM, 0, 22, 1200, 60000))
  ok('진짜 끄덕임은 센다', real.maxNods >= 3, `${real.maxNods}회`)
}

/* ══ 4. 눈을 함께 봐야 졸음이 된다 ════════════════════════ */
{
  const nodOnly = new A.AttentionAnalyzer({ useEye: true })
  let t = 0
  for (const m of oscillate(NODM, 0, 22, 1200, 60000)) {
    const p = A.poseFromMatrix(m)
    nodOnly.push({ t, hasFace: true, turn: p.turn, nod: p.nod, eyeClosedness: 0.05 })
    t += RATE
  }
  ok('끄덕임만으로는 졸음이 아니다 (눈 신호 켠 상태)', !nodOnly.drowsy, `끄덕임 ${nodOnly.nod.count()}회인데 졸음`)
  ok('  ↳ 끄덕임 자체는 세고 있다', nodOnly.nod.count() >= 3)

  // 끄덕이면서 눈도 오래 감으면 졸음
  const both = new A.AttentionAnalyzer({ useEye: true })
  t = 0
  for (const [i, m] of oscillate(NODM, 0, 22, 1200, 60000).entries()) {
    const p = A.poseFromMatrix(m)
    // 12초에 한 번 2초씩 눈을 감는다
    const closed = i % 60 < 10 ? 0.9 : 0.05
    both.push({ t, hasFace: true, turn: p.turn, nod: p.nod, eyeClosedness: closed })
    t += RATE
  }
  ok('끄덕임 + 긴 눈감김이면 졸음', both.drowsy, `끄덕임 ${both.nod.count()} 눈감김 ${both.longClosures.length}`)
}

/* ══ 5. 사람 검출기 — 깜빡임과 산발적 오탐 둘 다 견디는가 ══ */
const frame = 640 * 480
const personDet = (score, areaRatio = 0.4) => [
  {
    categories: [{ categoryName: 'person', score }],
    boundingBox: { width: 640 * Math.sqrt(areaRatio), height: 480 * Math.sqrt(areaRatio) },
  },
]
function runPerson(pattern) {
  const p = new A.PersonTracker(C.PERSON)
  const out = []
  for (const seen of pattern) out.push(p.push(seen ? personDet(0.8) : [], frame))
  return out
}
{
  const steady = runPerson(Array(40).fill(true))
  ok('사람이 계속 보이면 있음', steady.at(-1) === true)
  ok('  ↳ 표본이 모일 때까지 성급히 판정 안 함', steady.slice(0, C.PERSON.minSteps - 1).every((x) => x === false))

  // 한두 프레임 놓치는 건 흔하다 — 그때마다 풀리면 자리비움이 깜빡인다
  const flicker = runPerson(Array.from({ length: 60 }, (_, i) => i % 5 !== 0))
  ok('한 프레임씩 놓쳐도 안 풀린다', flicker.at(-1) === true)

  // 반대: 의자에 걸린 옷이 이따금 사람으로 잡히는 경우
  const spurious = runPerson([...Array(20).fill(true), ...Array.from({ length: 60 }, (_, i) => i % 8 === 0)])
  ok('산발적 오탐으로는 계속 있음이 유지되지 않는다', spurious.at(-1) === false,
    '의자에 걸린 옷 때문에 자리비움이 영영 안 뜬다')

  // 사람이 나가면 없음
  const left = runPerson([...Array(20).fill(true), ...Array(30).fill(false)])
  ok('사람이 나가면 없음', left.at(-1) === false)

  // 작게 잡히는 것(벽 포스터)은 무시
  const poster = new A.PersonTracker(C.PERSON)
  let last = false
  for (let i = 0; i < 40; i++) last = poster.push(personDet(0.9, 0.005), frame)
  ok('아주 작게 잡힌 사람은 무시한다 (포스터·모니터 속 사람)', last === false)

  // 카메라가 멀어 상반신이 작게 잡히는 진짜 사용자는 살려야 한다
  const farUser = new A.PersonTracker(C.PERSON)
  for (let i = 0; i < 40; i++) last = farUser.push(personDet(0.7, 0.06), frame)
  ok('멀리 앉은 사용자는 살린다', last === true, '면적 문턱이 진짜 사용자를 걸러낸다')
}

/* ══ 6. 상수 위생 ═════════════════════════════════════════ */
ok('눈 신호가 켜져 있다', C.USE_EYE_SIGNAL === true)
ok('끄덕임 진폭 문턱이 잡음 위로 올라갔다', C.NOD.minAmplitudeDeg >= 14, `${C.NOD.minAmplitudeDeg}도`)
ok('느린 끄덕임을 버리지 않는다', C.NOD.maxPeriodMs >= 4000, `${C.NOD.maxPeriodMs}ms`)
ok('빠른 흔들림을 끄덕임으로 안 센다', C.NOD.minPeriodMs >= 600, `${C.NOD.minPeriodMs}ms`)
ok('POSE 가 물리 이름을 쓴다', 'turnLimit' in C.POSE && 'nodLimit' in C.POSE)
ok('예전 이름이 남아 있지 않다', !('yawLimit' in C.POSE) && !('pitchUpLimit' in C.POSE))

/* ══ 7. 자리 비움 판정 — 증거가 하나라도 있으면 자리에 있다 ══ */
{
  const shimPath = join(tmp2, 'react-shim.mjs')
  writeFileSync(shimPath, 'const noop = () => {}\nexport const useEffect = noop\nexport const useRef = () => ({ current: null })\nexport const useState = (v) => [v, noop]\nexport default { useEffect, useRef, useState }\n')
  const vbundle = join(tmp2, 'useVision.mjs')
  execFileSync(
    join(root, 'node_modules', '.bin', 'esbuild'),
    [
      join(root, 'src', 'lib', 'vision', 'useVision.js'),
      '--bundle',
      '--format=esm',
      // react 는 판정 함수와 무관하다. 빈 껍데기로 갈아 끼워 번들만 만든다
      `--alias:react=${shimPath}`,
      `--outfile=${vbundle}`,
    ],
    { stdio: 'pipe' },
  )
  const V = await import(vbundle)
  const j = (o) => V.judgePresence({ state: 'focused', personVisible: false, phoneVisible: false, ...o })

  ok('얼굴이 보이면 자리에 있다', j({}).someone)
  // 사용자가 겪은 그 상황: 옆을 봐서 얼굴이 사라졌지만 사람은 있다
  ok('얼굴이 없어도 사람이 보이면 자리에 있다', j({ state: 'no_face', personVisible: true }).someone)
  ok('폰이 보여도 자리에 있다', j({ state: 'no_face', phoneVisible: true }).someone)
  ok('셋 다 없어야 자리 비움', !j({ state: 'no_face' }).someone)

  // 예전에는 이 한 줄이 전부였다 — 얼굴이 없으면 곧장 자리 비움
  ok('예전 고장: 얼굴만으로 판정 (회귀 감시)', j({ state: 'no_face', personVisible: true }).why === 'person')

  // 검출기가 죽으면 근거가 얼굴 하나로 줄어든다 → 더 오래 본다
  const sure = j({ state: 'no_face' })
  const unsure = j({ state: 'no_face', personVisible: null })
  ok('검출기가 조용하면 확인 시간이 길어진다', unsure.needMs > sure.needMs, `${sure.needMs} vs ${unsure.needMs}`)
  ok('  ↳ 모름을 있음으로 대접하지 않는다', !unsure.someone, '검출기 사망이 자리비움을 영영 막으면 안 된다')
  ok('  ↳ 확인 시간이 실제로 길다', unsure.needMs >= 8000, `${unsure.needMs}ms`)
  ok('사람이 보이는 동안은 확인 시간이 무의미하다', j({ personVisible: true }).someone)
}

rmSync(tmp, { recursive: true, force: true })

console.log(`\n판정 로직 ${pass}/${pass + fails.length} 통과`)
if (fails.length) {
  console.log('\n실패:')
  for (const f of fails) console.log('  ✗ ' + f)
  process.exit(1)
}
