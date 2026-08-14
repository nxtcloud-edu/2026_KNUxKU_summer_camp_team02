/**
 * 비전 강등이 정말 꺼져 있는지 확인한다.
 *
 * 왜 굳이 검사를 두는가 — 이 고장이 **두 번** 났기 때문이다.
 * 처음엔 얼굴 판정 문턱을 절대 ms 에서 점유율로 고쳤는데, 그 아래에 `p95 > 25ms` 짜리
 * 절대 문턱이 하나 더 남아 있었다. 둘은 OR 로 걸리니 고친 쪽은 아무 소용이 없었다.
 * 빌드도 린트도 이런 걸 못 잡는다. 사용자만 "자꾸 강제로 강하된다"로 겪는다.
 *
 * 그래서 문턱값을 검사하지 않는다. **주기를 바꾸는 모든 줄이 가드 뒤에 있는가**를 본다.
 * 새 강등 경로가 하나 더 생기면 여기서 걸린다.
 *
 * 실행:  node scripts/vision-degrade-test.mjs
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const engine = readFileSync(join(root, 'src', 'lib', 'vision', 'visionEngine.js'), 'utf8')
const consts = readFileSync(join(root, 'src', 'lib', 'vision', 'constants.js'), 'utf8')
const bench = readFileSync(join(root, 'src', 'screens', 'BenchScreen.jsx'), 'utf8')

let pass = 0
const fails = []
const ok = (name, cond, extra = '') => {
  if (cond) pass += 1
  else fails.push(`${name}${extra ? ` — ${extra}` : ''}`)
}

const lines = engine.split('\n')
/** 함수 본문의 줄 범위 (들여쓰기 2칸 기준) */
function body(name) {
  const s = lines.findIndex((l) => l.includes(`function ${name}(`))
  if (s < 0) return null
  const e = lines.findIndex((l, i) => i > s && l === '  }')
  return { s, e, lines: lines.slice(s, e + 1) }
}

/* ── 1. 기본값 ───────────────────────────────────────────── */
ok('autoDegrade 기본이 꺼짐', /autoDegrade = false/.test(engine))
ok('/bench 기본도 꺼짐 (방과 같은 조건에서 재야 한다)', /useState\(false\)\s*$/m.test(
  bench.split('autoDegrade')[1]?.split('\n')[0] + '\n' + bench.match(/const \[autoDegrade[\s\S]{0,80}/)?.[0] || '',
) || /const \[autoDegrade, setAutoDegrade\] = useState\(false\)/.test(bench))

/* ── 2. 주기를 바꾸는 모든 줄이 가드 뒤에 있는가 ──────────── */
for (const [fn, guardRe, varName] of [
  ['maybeDegrade', /if \(!autoDegrade/, 'faceInterval'],
  ['stepPhone', /autoDegrade &&/, 'phoneInterval'],
]) {
  const b = body(fn)
  ok(`${fn} 를 찾음`, !!b)
  if (!b) continue
  const guard = b.lines.findIndex((l) => guardRe.test(l))
  const muts = b.lines
    .map((l, i) => (new RegExp(`\\b${varName} = `).test(l) ? i : -1))
    .filter((i) => i >= 0)
  ok(`${fn}: 가드가 있다`, guard >= 0)
  ok(`${fn}: 주기를 바꾸는 줄이 있다`, muts.length > 0)
  ok(
    `${fn}: 주기 변경이 전부 가드 뒤 (${muts.length}곳)`,
    guard >= 0 && muts.every((m) => m > guard),
    `가드 ${b.s + guard + 1}행, 변경 ${muts.map((m) => b.s + m + 1).join(',')}행`,
  )
}

/* ── 3. 재는 것은 안 껐는가 ──────────────────────────────── */
// 강등을 안 하는 것과 상태를 안 보는 것은 다르다. p95 는 계속 올라가야 한다
const md = body('maybeDegrade')
const pIdx = md.lines.findIndex((l) => /diag\.p95 = p95/.test(l))
const gIdx = md.lines.findIndex((l) => /if \(!autoDegrade/.test(l))
ok('p95 측정이 가드보다 앞', pIdx >= 0 && gIdx >= 0 && pIdx < gIdx, `측정 ${pIdx} / 가드 ${gIdx}`)

/* ── 4. 되살아난 절대 문턱이 없는가 ──────────────────────── */
// 이번에 지운 게 `p95 > DEGRADE.slowMs` 였다. 상수도 같이 지웠으니 이름이 돌아오면 실수다
// 주석 속 언급은 둔다 — 왜 지웠는지가 기록이다. 살아 있는 **선언과 참조**만 본다
const declared = (name) => new RegExp(`^\\s*${name}:`, 'm').test(consts)
const referenced = (name) => new RegExp(`DEGRADE\\.${name}`).test(engine)
ok('slowMs 선언이 사라짐', !declared('slowMs'), '절대 ms 문턱이 되살아났다')
ok('slowMs 참조도 없음', !referenced('slowMs'))
ok('unusableMs 선언 없음', !declared('unusableMs'))
ok('unusableMs 참조 없음', !referenced('unusableMs'))

/* ── 5. 밀려 쌓이지 않는 구조가 그대로인가 ──────────────── */
// 강등을 끄고도 안전한 근거가 이 가드다. 이게 없어지면 강등을 끈 판단이 무너진다
ok('구동기에 busy 가드가 있다', /if \(busy\) return/.test(engine))
ok('busy 는 추론 전에 켜진다', /busy = true/.test(engine))
ok('추론 끝나면 풀린다', /busy = false/.test(engine))
ok('프레임 콜백으로 돈다', /requestVideoFrameCallback/.test(engine))

/* ── 6. 기능을 끄는 길이 없는가 ──────────────────────────── */
// 느린 판정이 없는 판정보다 낫다. stop() 으로 자기를 죽이는 경로가 있으면 안 된다
const selfStop = md.lines.filter((l) => /\bstop\(\)/.test(l))
ok('강등이 기능을 끄지 않는다', selfStop.length === 0, selfStop.join(' | '))

console.log(`\n비전 강등 ${pass}/${pass + fails.length} 통과`)
if (fails.length) {
  console.log('\n실패:')
  for (const f of fails) console.log('  ✗ ' + f)
  process.exit(1)
}
console.log('  주기는 얼굴 200ms · 폰 250ms 로 고정. 버거우면 구동기가 프레임을 건너뛴다')
