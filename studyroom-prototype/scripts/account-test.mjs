/**
 * 계정별 개인화가 실제로 되는가.
 *
 * 구글 로그인을 붙여 놓고 개인화가 안 되면 로그인을 붙인 의미가 없다.
 * 그래서 이 검사는 "칸이 갈리는가"만 보지 않고 **다시 켰을 때 돌아오는가**까지 본다.
 * 쓰기만 되고 읽기가 없으면 사용자에게는 "저장이 안 된다"로 보인다 — 실제로 그랬다.
 *
 * 브라우저 없이 돌린다. localStorage 를 흉내 내고 db 모듈을 새로 불러
 * **새로고침**까지 재현한다.
 *
 * 실행:  node scripts/account-test.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tmp = mkdtempSync(join(tmpdir(), 'acct-'))

/* ── 브라우저 흉내 — 이 저장소는 "새로고침" 사이에도 살아남는다 ── */
const disk = new Map()
globalThis.localStorage = {
  getItem: (k) => (disk.has(k) ? disk.get(k) : null),
  setItem: (k, v) => disk.set(k, String(v)),
  removeItem: (k) => disk.delete(k),
}
globalThis.window = { addEventListener() {}, removeEventListener() {} }
globalThis.document = { hidden: false, hasFocus: () => true, addEventListener() {}, removeEventListener() {} }

const base = join(tmp, 'db.mjs')
execFileSync(
  join(root, 'node_modules', '.bin', 'esbuild'),
  [join(root, 'src', 'store', 'db.js'), '--bundle', '--format=esm', `--outfile=${base}`],
  { stdio: 'pipe' },
)
const authBundle = join(tmp, 'auth.mjs')
execFileSync(
  join(root, 'node_modules', '.bin', 'esbuild'),
  [join(root, 'src', 'lib', 'auth.js'), '--bundle', '--format=esm', `--outfile=${authBundle}`],
  { stdio: 'pipe' },
)
const AUTH = await import(authBundle)

/** 새로고침 — 모듈을 처음부터 다시 읽는다 (모듈 최상단의 accountKey 계산까지 다시 돈다) */
let boots = 0
const reboot = async () => {
  const f = join(tmp, `db${++boots}.mjs`)
  copyFileSync(base, f)
  return (await import(f)).db
}

let pass = 0
const fails = []
const ok = (name, cond, extra = '') => {
  if (cond) pass += 1
  else fails.push(`${name}${extra ? ` — ${extra}` : ''}`)
}

const 지수 = { provider: 'google', sub: '111', name: '신지수', email: 'a@x.com' }
const 민호 = { provider: 'google', sub: '222', name: '박민호', email: 'b@x.com' }

/* ══ 1. 손님으로 쓴 기록 ═══════════════════════════════════ */
let db = await reboot()
ok('처음엔 손님 칸', db.accountKey() === 'guest', db.accountKey())
const guestSid = db.startSession?.() || null
db.setUser({ display_name: '손님이름' })
ok('손님 이름이 db 에 남는다', db.getUser()?.display_name === '손님이름')

/* ══ 2. 로그인하면 칸이 갈린다 ════════════════════════════ */
AUTH.saveAccount(지수)
db.useAccount(AUTH.accountKeyOf(지수))
ok('칸이 바뀐다', db.accountKey() === 'google_111', db.accountKey())
ok('손님 이름이 안 보인다', db.getUser()?.display_name !== '손님이름', db.getUser()?.display_name)

db.setUser({ display_name: '신지수', email: '지수@x.com' })
db.saveConfig([{ slotNo: 1, name: '미나' }], { replyLength: 'detailed' })

// 이 계정으로 세션 하나와 요약 하나
const sid = db.startSession()
const sessions = db.getSessions?.() || []
ok('세션을 만들 수 있다', !!sid, `sid=${sid}`)
const targetSid = sid || sessions[sessions.length - 1]?.id
if (targetSid) {
  db.saveReview(targetSid, { conceptGroups: [{ domain: 'ai', label: '인공지능', concepts: [{ title: '어텐션', markdown: '본문' }] }], summaryText: '지수의 요약' })
  ok('요약이 저장된다', db.getReview(targetSid)?.summaryText === '지수의 요약')
}

/* ══ 3. 다른 계정은 서로 안 보인다 ════════════════════════ */
AUTH.saveAccount(민호)
db.useAccount(AUTH.accountKeyOf(민호))
ok('민호 칸으로 이동', db.accountKey() === 'google_222')
ok('지수 이름이 안 보인다', db.getUser()?.display_name !== '신지수', db.getUser()?.display_name)
if (targetSid) ok('지수 요약이 안 보인다', !db.getReview(targetSid))
const 민호설정 = db.loadConfig()
ok('지수 설정이 안 보인다', 민호설정.settings?.replyLength !== 'detailed', JSON.stringify(민호설정.settings || {}).slice(0, 60))

/* ══ 4. 되돌아오면 그대로 있다 ════════════════════════════ */
AUTH.saveAccount(지수)
db.useAccount(AUTH.accountKeyOf(지수))
ok('지수 이름이 돌아온다', db.getUser()?.display_name === '신지수', db.getUser()?.display_name)
ok('지수 설정이 돌아온다', db.loadConfig().settings?.replyLength === 'detailed')
if (targetSid) ok('지수 요약이 돌아온다', db.getReview(targetSid)?.summaryText === '지수의 요약')

/* ══ 5. **새로고침** — 여기가 진짜 시험이다 ═══════════════ */
db = await reboot() // 모듈을 처음부터 다시 읽는다
ok('새로고침해도 지수 칸이 열린다', db.accountKey() === 'google_111', db.accountKey())
ok('새로고침해도 이름이 남아 있다', db.getUser()?.display_name === '신지수', db.getUser()?.display_name)
ok('새로고침해도 설정이 남아 있다', db.loadConfig().settings?.replyLength === 'detailed')
if (targetSid) ok('새로고침해도 요약이 남아 있다', db.getReview(targetSid)?.summaryText === '지수의 요약')

/* ══ 6. 화면이 그 이름을 실제로 쓰는가 ════════════════════ */
{
  // db 에 남아 있어도 화면이 안 읽으면 사용자에게는 "저장이 안 된다"로 보인다.
  // useStore 가 부팅할 때 무엇으로 displayName 을 정하는지 소스에서 확인한다
  const src = (await import('node:fs')).readFileSync(join(root, 'src', 'store', 'useStore.js'), 'utf8')
  const bootLine = /displayName:\s*([^\n,]+)/.exec(src)?.[1] || ''
  ok(
    '부팅 이름을 db 에서 읽는다',
    /getUser|display_name/.test(bootLine),
    `지금은 \`${bootLine.trim()}\` — 구글 프로필만 본다`,
  )
  const cfg = /function configOf\(\)[\s\S]{0,1400}?\n\}/.exec(src)?.[0] || ''
  ok('configOf 가 이름도 돌려준다', /displayName/.test(cfg), 'seats·settings 만 돌려준다')
}

rmSync(tmp, { recursive: true, force: true })

console.log(`\n계정별 개인화 ${pass}/${pass + fails.length} 통과`)
if (fails.length) {
  console.log('\n실패:')
  for (const f of fails) console.log('  ✗ ' + f)
  process.exit(1)
}
