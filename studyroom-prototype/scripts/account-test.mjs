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

/* ══ 7. 설정·캐릭터·공부 시간·목표가 계정마다 따로인가 ═══════ */
{
  // 사용자가 실제로 궁금해하는 것: "설정도 다 개인화돼서 자동으로 불러와지나?
  // 이전에 공부한 시간이나 목표도 남나?" — 말이 아니라 검사로 답한다.
  const 쓰기 = (who, mark) => {
    AUTH.saveAccount(who)
    db.useAccount(AUTH.accountKeyOf(who))
    db.saveConfig(
      [{ slotNo: 1, name: `${mark}미나`, tone: 'T1' }, { slotNo: 2, name: '테오' }, { slotNo: 3, name: '유리' }],
      { replyLength: mark === 'A' ? 'detailed' : 'brief', idleMin: mark === 'A' ? 7 : 21 },
    )
    const id = db.startSession()
    db.setGoal(id, `${mark}의 목표 — 자료구조 3장`)
    db.heartbeat(id, { study_sec: mark === 'A' ? 3600 : 600, focus_sec: mark === 'A' ? 3000 : 500 })
    db.endSession(id, {})
    return id
  }
  const 읽기 = (who) => {
    AUTH.saveAccount(who)
    db.useAccount(AUTH.accountKeyOf(who))
    const cfg = db.loadConfig()
    // ⚠️ 총합을 보면 안 된다. 새 계정마다 seedIfEmpty() 가 27일치 **데모 기록**을 넣는다
    //    (db.js:129 "데모에서 통계가 비어 보이지 않도록"). 오늘 것만 봐야 진짜 기록이다.
    const 오늘 = (db.getDailyStats() || []).find((x) => x.date === new Date().toISOString().slice(0, 10))
    return {
      자리이름: cfg.seats?.[0]?.name,
      길이설정: cfg.settings?.replyLength,
      무입력분: cfg.settings?.idleMin,
      오늘초: 오늘?.total_study_sec || 0,
      목표: db.getSession(sidA)?.goal ?? null,
    }
  }

  const sidA = 쓰기(지수, 'A')
  const sidB = 쓰기(민호, 'B')

  const a = 읽기(지수)
  ok('설정이 계정마다 따로다', a.길이설정 === 'detailed' && a.무입력분 === 7, JSON.stringify(a))
  ok('캐릭터 이름도 따로다', a.자리이름 === 'A미나', a.자리이름)
  ok('공부 시간이 남는다', a.오늘초 >= 3600, `${a.오늘초}초`)
  ok('목표가 세션에 남는다', /A의 목표/.test(a.목표 || ''), String(a.목표))

  const b = 읽기(민호)
  ok('다른 계정의 설정이 안 섞인다', b.길이설정 === 'brief' && b.무입력분 === 21, JSON.stringify(b))
  ok('다른 계정의 시간이 안 섞인다', b.오늘초 === 600, `${b.오늘초}초`)
  ok('다른 계정의 목표가 안 보인다', b.목표 == null, String(b.목표))

  /* 새로고침해도 그대로인가 — 여기가 "자동으로 불러와지나"의 답이다 */
  db = await reboot()
  const a2 = 읽기(지수)
  ok('새로고침 뒤 설정이 돌아온다', a2.길이설정 === 'detailed' && a2.무입력분 === 7, JSON.stringify(a2))
  ok('새로고침 뒤 캐릭터 이름이 돌아온다', a2.자리이름 === 'A미나', a2.자리이름)
  ok('새로고침 뒤 공부 시간이 남아 있다', a2.오늘초 >= 3600, `${a2.오늘초}초`)
  ok('새로고침 뒤 목표가 남아 있다', /A의 목표/.test(a2.목표 || ''), String(a2.목표))
  ok('지난 기록을 날짜로 찾을 수 있다', typeof db.getReviewByDay === 'function')

  /**
   * ⚠️ 새 계정에는 **데모 기록 27일치**가 미리 들어간다 (db.js seedIfEmpty).
   * 통계 화면이 비어 보이지 않게 하려는 것이지만, 처음 로그인한 사람은
   * 자기가 공부한 적 없는 기록을 보게 된다. 지우려면 db.js:129~147 이다.
   * 여기서는 **그런 동작이라는 사실**을 못박아 둔다 — 모르고 있다가 놀라지 않게.
   */
  const 신규 = { provider: 'google', sub: '999', name: '새사람' }
  AUTH.saveAccount(신규)
  db.useAccount(AUTH.accountKeyOf(신규))
  const seeded = (db.getDailyStats() || []).length
  ok('새 계정에 데모 기록이 들어간다 (의도된 동작)', seeded > 10, `${seeded}일치`)
}

/* ══ 8. 옛 캐릭터 이름이 저장돼 있으면 지금 이름으로 올라오는가 ══ */
{
  /*
   * 이름을 한글로 바꾼 뒤(Mina·Theo·Juno → 강두리·고범수·신유연) 이미 저장된 설정은
   * 옛 이름을 붙들고 있었다. 랜딩은 PRESETS 를 직접 읽어 새 이름이 뜨는데
   * 설정창·로비·스터디룸은 저장된 좌석을 읽어서 옛 이름이 떴다 — 한 화면 안에서 갈렸다.
   * **직접 지은 이름은 건드리면 안 된다.** 그게 이 검사의 절반이다.
   */
  const P = join(tmp, 'presets.mjs')
  execFileSync(
    join(root, 'node_modules', '.bin', 'esbuild'),
    [join(root, 'src', 'lib', 'presets.js'), '--bundle', '--format=esm', `--outfile=${P}`],
    { stdio: 'pipe' },
  )
  const { freshName, PRESETS } = await import(P)

  ok('옛 이름 Mina → 지금 이름', freshName('mina', 'Mina') === PRESETS.mina.name, freshName('mina', 'Mina'))
  ok('옛 이름 Theo → 지금 이름', freshName('theo', 'Theo') === PRESETS.theo.name)
  ok('옛 이름 Juno → 지금 이름', freshName('juno', 'Juno') === PRESETS.juno.name)
  ok('직접 지은 이름은 그대로', freshName('juno', '내가지은이름') === '내가지은이름')
  ok('지금 이름은 그대로', freshName('mina', PRESETS.mina.name) === PRESETS.mina.name)
  ok('이름이 비면 기본값', freshName('mina', '') === PRESETS.mina.name)
  ok('모르는 preset 은 손대지 않는다', freshName('없는키', '아무이름') === '아무이름')
  // 다른 자리의 옛 이름을 잘못 가져오면 안 된다
  ok('preset 을 넘어서 바꾸지 않는다', freshName('mina', 'Theo') === 'Theo')
}

rmSync(tmp, { recursive: true, force: true })

console.log(`\n계정별 개인화 ${pass}/${pass + fails.length} 통과`)
if (fails.length) {
  console.log('\n실패:')
  for (const f of fails) console.log('  ✗ ' + f)
  process.exit(1)
}
