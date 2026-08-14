/**
 * 멈춤 사유 판정 검사 — 무엇이 화면에 뜨는가.
 *
 * 사용자 증상 ③ "빨간 표시는 늘 '자리 비움'만 뜬다" 의 정체는 두 가지였다.
 *   · 창 이탈(isAway)이 **최우선**이라 카메라 판정 셋을 전부 가렸다.
 *   · away 와 absent 가 **같은 라벨**('자리 비움')이라 둘을 구분할 수도 없었다.
 * 그래서 다른 창을 한 번 누르면 그 뒤로 카메라가 무엇을 보든 '자리 비움'이었다.
 *
 * 실행:  node scripts/metrics-pause-test.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/* 브라우저 물건 흉내 — metrics 는 document·window 를 듣는다 */
const listeners = {}
globalThis.document = {
  hidden: false,
  _focus: true,
  hasFocus: () => globalThis.document._focus,
  addEventListener: (k, f) => (listeners[k] = f),
  removeEventListener: () => {},
}
globalThis.window = {
  addEventListener: (k, f) => (listeners[k] = f),
  removeEventListener: () => {},
}
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, v),
  removeItem: (k) => store.delete(k),
}

const tmp = mkdtempSync(join(tmpdir(), 'met-'))
const bundle = join(tmp, 'metrics.mjs')
execFileSync(
  join(root, 'node_modules', '.bin', 'esbuild'),
  [join(root, 'src', 'lib', 'metrics.js'), '--bundle', '--format=esm', `--outfile=${bundle}`],
  { stdio: 'pipe' },
)
const M = await import(bundle)

let pass = 0
const fails = []
const ok = (name, cond, extra = '') => {
  if (cond) pass += 1
  else fails.push(`${name}${extra ? ` — ${extra}` : ''}`)
}

const mk = (opts = {}) =>
  new M.MetricsTracker('s1', { awayDetect: true, inputDetect: true, idleMin: 10, relaxed: false, ...opts })

/* ══ 1. 우선순위 — 무엇이 화면에 뜨는가 ═══════════════════ */
{
  const t = mk()
  t.visionActive = true

  t.isAway = true
  t.vision = { absent: false, phone: false, drowsy: false }
  ok('창 이탈만 있으면 away', t.pausedBy === 'away', t.pausedBy)

  t.vision = { absent: false, phone: true, drowsy: false }
  ok('창 이탈 + 폰 → 폰이 이긴다', t.pausedBy === 'phone', t.pausedBy)

  t.vision = { absent: true, phone: false, drowsy: false }
  ok('창 이탈 + 자리비움 → 자리비움이 이긴다', t.pausedBy === 'absent', t.pausedBy)

  // 이게 예전에 불가능했다. 조는 사람은 고개가 떨어져 얼굴이 사라지고,
  // absent 가 drowsy 보다 앞이라 '졸음' 라벨은 사실상 도달 불가였다
  t.vision = { absent: false, phone: false, drowsy: true }
  ok('졸음만 있으면 졸음이 뜬다', t.pausedBy === 'drowsy', t.pausedBy)

  t.isAway = false
  t.vision = { absent: true, phone: true, drowsy: true }
  ok('셋 다면 폰이 먼저', t.pausedBy === 'phone', t.pausedBy)

  t.vision = { absent: false, phone: false, drowsy: false }
  ok('아무것도 아니면 멈추지 않는다', t.pausedBy === null, String(t.pausedBy))
}

/* ══ 2. 창 이탈 — 스치듯 누른 것은 이탈이 아니다 ══════════ */
{
  const t = mk()
  const now = Date.now()
  t.blurAt = now - 2000 // 2초 전에 다른 창으로
  t._onTick()
  ok('2초는 아직 이탈이 아니다', !t.isAway)

  t.blurAt = now - 6000 // 6초 전
  t._onTick()
  ok('6초 지나면 이탈', t.isAway)
  ok('이탈 시각이 blur 순간으로 소급된다', Math.abs(t.awayStartedAt - (now - 6000)) < 50,
    `${t.awayStartedAt} vs ${now - 6000}`)

  // 소급이 없으면 75초 이탈이 55초로 기록돼 이탈 횟수 문턱(60초)을 못 넘는다
  t.awayStartedAt = Date.now() - 75000
  t._exitAway()
  ok('75초 이탈은 이탈 1회로 센다', t.awayCount === 1, `${t.awayCount}회`)
  ok('돌아오면 유예 상태도 지워진다', t.blurAt === null)
}

/* ══ 3. 말하는 것도 활동이다 ══════════════════════════════ */
{
  const t = mk({ idleMin: 1 }) // 1분 무입력이면 이탈
  t.lastInputAt = Date.now() - 90 * 1000
  t._onTick()
  ok('90초 아무 입력이 없으면 이탈', t.isAway)

  // 말하면 풀려야 한다 — 예전에는 마우스를 움직여야만 풀렸다
  t.noteActivity()
  ok('말하면(noteActivity) 이탈이 풀린다', !t.isAway)

  t.lastInputAt = Date.now() - 90 * 1000
  t.noteActivity()
  t._onTick()
  ok('계속 말하면 이탈이 안 걸린다', !t.isAway)
}

/* ══ 4. 포커스 없는 창 위의 마우스는 활동이 아니다 ════════ */
{
  const t = mk({ idleMin: 1 })
  t.start()
  const old = Date.now() - 90 * 1000
  t.lastInputAt = old

  globalThis.document._focus = false
  listeners.mousemove?.()
  ok('포커스 없으면 마우스가 활동으로 안 쳐진다', t.lastInputAt === old)

  globalThis.document._focus = true
  listeners.mousemove?.()
  ok('포커스 있으면 활동으로 쳐진다', t.lastInputAt > old)
  t.stop()
}

/* ══ 5. 라벨이 갈라져 있는가 (화면 쪽) ════════════════════ */
{
  const src = readFileSync(join(root, 'src', 'screens', 'StudyRoomScreen.jsx'), 'utf8')
  const block = src.slice(src.indexOf('const PAUSE_LABEL'), src.indexOf('const PAUSE_LABEL') + 300)
  const away = /away:\s*'([^']+)'/.exec(block)?.[1]
  const absent = /absent:\s*'([^']+)'/.exec(block)?.[1]
  ok('away 와 absent 의 라벨이 다르다', away && absent && away !== absent, `away='${away}' absent='${absent}'`)
  ok('  ↳ absent 는 자리 비움 그대로', absent === '자리 비움', absent)
  // 색과 글자가 같은 시점에 켜져야 깜빡임 방지가 제 일을 한다
  ok('빨간 색도 지연된 값을 쓴다', /pausedShown \? 'text-danger'/.test(src),
    "색이 pausedBy 로 즉시 켜지면 PAUSE_SHOW_MS 가 절반만 일한다")
}

rmSync(tmp, { recursive: true, force: true })

console.log(`\n멈춤 사유 ${pass}/${pass + fails.length} 통과`)
if (fails.length) {
  console.log('\n실패:')
  for (const f of fails) console.log('  ✗ ' + f)
  process.exit(1)
}
