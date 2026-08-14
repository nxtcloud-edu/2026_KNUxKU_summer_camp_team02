/**
 * 정적 파일이 **제대로** 나가는지 확인한다.
 *
 * 이 고장은 404 로 오지 않아서 알아채기 어렵다. 파일을 못 찾으면 SPA 폴백이 걸려
 * **200 + index.html** 이 이미지 자리에 나간다. 브라우저에는 깨진 이미지만 보이고
 * 개발자 도구에는 200 이 찍힌다.
 *
 * 실제로 그랬다 — 상점 이미지 15개와 로고가 전부 877바이트짜리 index.html 을 받고 있었다.
 * 폴더 이름이 "alongside 상점" 이라 공백이 하나 있었고, req.url 은 그걸 `%20` 으로 보내는데
 * 서버가 디코딩을 안 하고 그대로 디스크에서 찾았다.
 *
 * 그래서 이 검사는 상태 코드가 아니라 **Content-Type 과 크기**를 본다.
 *
 * 실행:  npm run build && node scripts/static-serve-test.mjs
 */
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(root, 'dist')
const PORT = 8123

if (!existsSync(DIST)) {
  console.log('  dist 가 없다. 먼저 npm run build 를 돌려라.')
  process.exit(1)
}

let pass = 0
const fails = []
const ok = (name, cond, extra = '') => {
  if (cond) pass += 1
  else fails.push(`${name}${extra ? ` — ${extra}` : ''}`)
}

const srv = spawn('node', [join(root, 'server', 'index.mjs')], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
})
const stop = () => srv.kill()
process.on('exit', stop)

/** 서버가 뜰 때까지 기다린다 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let up = false
for (let i = 0; i < 40 && !up; i++) {
  await sleep(250)
  up = await fetch(`http://127.0.0.1:${PORT}/`)
    .then((r) => r.ok)
    .catch(() => false)
}
if (!up) {
  console.log('  서버가 뜨지 않았다.')
  stop()
  process.exit(1)
}

const get = async (p) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${encodeURI(p)}`)
  const buf = Buffer.from(await r.arrayBuffer())
  return { status: r.status, type: r.headers.get('content-type') || '', size: buf.length, buf }
}

/* ══ 1. 이름에 공백·한글이 든 파일 ═══════════════════════ */
{
  // 이 폴더 이름에 공백이 있다. 그래서 이게 이 검사의 핵심이다
  const dir = join(DIST, 'alongside 상점')
  const imgs = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.png')) : []
  ok('상점 이미지가 빌드에 들어 있다', imgs.length > 0, `${imgs.length}개`)

  for (const f of imgs.slice(0, 3)) {
    const r = await get(`/alongside 상점/${f}`)
    ok(`"${f}" 가 이미지로 나간다`, r.type.startsWith('image/'), `${r.status} ${r.type} ${r.size}B`)
    // index.html 은 1KB 안팎이다. 이미지가 그 크기면 폴백이 나간 것이다
    ok(`  ↳ 내용이 index.html 이 아니다`, !r.buf.slice(0, 200).includes('<!doctype'), `${r.size}B`)
  }
}

/* ══ 2. 공백 없는 경로는 원래대로 ════════════════════════ */
{
  const r = await get('/characters/persona1/idle-open.png')
  ok('공백 없는 이미지도 그대로 나간다', r.type.startsWith('image/'), `${r.status} ${r.type}`)
}

/* ══ 3. SPA 폴백은 살아 있어야 한다 ══════════════════════ */
{
  const a = await get('/')
  ok('루트는 html', a.type.includes('text/html'))
  const b = await get('/lobby') // 확장자 없는 경로 = 화면 라우트
  ok('화면 경로는 index.html 로 폴백', b.status === 200 && b.type.includes('text/html'))
}

/* ══ 4. 디코딩을 열어 준 대가 — 경로 탈출 ═══════════════ */
{
  // %2e%2e 는 디코딩되면 .. 가 된다. 디코딩 전에는 없던 공격면이다
  const r = await fetch(`http://127.0.0.1:${PORT}/%2e%2e%2f%2e%2e%2fpackage.json`)
  const t = await r.text()
  ok('상위 폴더로 못 나간다', !t.includes('"dependencies"'), 'package.json 이 그대로 나갔다')

  const r2 = await fetch(`http://127.0.0.1:${PORT}/%2e%2e%2fserver%2fchat.mjs`)
  const t2 = await r2.text()
  ok('서버 소스도 못 가져간다', !t2.includes('handleChat'), 'chat.mjs 가 그대로 나갔다')

  // 깨진 인코딩에 서버가 죽으면 안 된다
  const r3 = await fetch(`http://127.0.0.1:${PORT}/%zz`).catch(() => null)
  ok('잘못된 인코딩에도 안 죽는다', !!r3)
}

stop()
console.log(`\n정적 파일 ${pass}/${pass + fails.length} 통과`)
if (fails.length) {
  console.log('\n실패:')
  for (const f of fails) console.log('  ✗ ' + f)
  process.exit(1)
}
