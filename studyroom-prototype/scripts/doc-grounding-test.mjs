/**
 * 올린 자료를 근거로 답하는가.
 *
 * 실제로 이렇게 샜다. 논문을 올려놓고:
 *   "쉽고 자세하게 설명좀"        → 자료 **안 붙음** → 그럴듯한 추측으로 답
 *   "성능은? 빨라지는거 맞아?"     → 자료 **안 붙음** → "속도를 높였어" (논문은 정반대)
 *   "너가 문서에서 찾아봐"        → 자료 붙음 → 정확
 *
 * 붙는 조건이 "자료를 가리키는 낱말이 있는가"였기 때문이다. 세 번째 질문에만
 * '문서'가 들어 있었다. 낱말 목록을 두 번 늘렸고 두 번 다 샜다 —
 * 목록은 사람이 자기 자료를 뭐라고 부를지 맞히는 내기이고, 내기는 진다.
 *
 * 그래서 이 검사는 값이 아니라 **구조**를 본다: 붙이는 판단이 문장 내용에
 * 의존하지 않는가, 그리고 자료에 근거 규칙이 함께 실리는가.
 *
 * 실행:  node scripts/doc-grounding-test.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tmp = mkdtempSync(join(tmpdir(), 'doc-'))
const bundle = join(tmp, 'docReader.mjs')
execFileSync(
  join(root, 'node_modules', '.bin', 'esbuild'),
  [join(root, 'src', 'lib', 'docReader.js'), '--bundle', '--format=esm', `--outfile=${bundle}`],
  { stdio: 'pipe' },
)
const D = await import(bundle)
const screen = readFileSync(join(root, 'src', 'screens', 'StudyRoomScreen.jsx'), 'utf8')

let pass = 0
const fails = []
const ok = (name, cond, extra = '') => {
  if (cond) pass += 1
  else fails.push(`${name}${extra ? ` — ${extra}` : ''}`)
}

/* ══ 1. 붙이는 판단이 문장 내용에 안 기댄다 ═══════════════ */
{
  // 실제로 새어 나갔던 질문들. 이 중 하나라도 "낱말이 있어야 붙는" 구조면 또 샌다
  const asked = [
    '쉽고 자세하게 설명좀',
    '성능은 얼마나 더 좋아? 그리고 빨라지는거 맞아?',
    '그래서 결론이 뭔데',
    '너가 문서에서 정확한 성능 찾아봐',
  ]

  const decide = /const wantsDoc = ([^\n]+)/.exec(screen)?.[1] || ''
  ok('붙이는 판단이 한 줄로 남았다', !!decide, '찾지 못함')
  ok('자료 유무만 본다', /^!!docRef\.current$/.test(decide.trim()), decide.trim())
  // 아래 셋 중 무엇이라도 남아 있으면 문장에 따라 갈린다
  ok('낱말 목록에 안 기댄다', !/DOC_REF_WORDS/.test(decide))
  ok('제목 겹침에 안 기댄다', !/titleHit/.test(decide))
  ok('직전 턴에 안 기댄다', !/stillOnDoc/.test(decide))
  ok('낱말 목록 자체가 사라졌다', !/const DOC_REF_WORDS\s*=/.test(screen))
  ok('5분 창도 사라졌다', !/const DOC_STICKY_MS\s*=/.test(screen))
  // 판단이 문장을 아예 안 보므로, 어떤 문장이든 결과가 같다
  ok(
    `실제로 샜던 질문 ${asked.length}개가 전부 같은 결과`,
    /^!!docRef\.current$/.test(decide.trim()),
    '판단이 text 를 참조한다',
  )
}

/* ══ 2. 개입 턴에는 자료를 안 붙인다 ══════════════════════ */
{
  // F4/F5 는 사용자 질문이 아니라 상황 알림이다. 거기에 논문을 통째로 넣을 이유가 없다
  const inSend = screen.slice(screen.indexOf('const wantsDoc'), screen.indexOf('const wantsDoc') + 2500)
  ok('자료 첨부는 사용자 답변 턴 안에서만 계산된다', inSend.includes('withDoc: wantsDoc'))
  const interventions = [...screen.matchAll(/kind: 'intervention'[\s\S]{0,400}?\}/g)]
  ok('개입 턴 발견', interventions.length >= 2, `${interventions.length}곳`)
  ok(
    '개입 턴은 자료를 안 싣는다',
    interventions.every((m) => !/withDoc:\s*true/.test(m[0])),
    '개입에 자료가 실린다',
  )
}

/* ══ 3. 자료에 근거 규칙이 함께 실린다 ════════════════════ */
{
  const p = D.toPrompt('논문.pdf', '본문 내용입니다.')
  ok('자료 이름이 들어간다', p.includes('논문.pdf'))
  ok('본문이 들어간다', p.includes('본문 내용입니다.'))
  ok('자료 경계가 표시된다', p.includes('[자료 끝]'))

  // 규칙의 핵심 — 모른다고 말할 자리를 만들어 준다. 그 자리가 없으면 모델은 메운다
  ok('모른다고 말할 자리가 있다', /안 나와 있|확인 안 되|확인되지 않/.test(p), p.slice(-300))
  ok('숫자를 지어내지 말라고 한다', /숫자|성능|비교/.test(p) && /지어내/.test(p))
  ok('한계도 말하라고 한다', /한계|단점/.test(p))
  // 이게 없으면 "하이브리드는 대개 빠르다" 같은 상식이 자료를 이긴다 — 실제로 그랬다
  ok('상식보다 자료를 따르라고 한다', /자료를 따른다|자료가 우선/.test(p))

  // 본문이 비어도 터지지 않는다
  ok('빈 본문도 안 터진다', typeof D.toPrompt('x.pdf', '') === 'string')
}

/* ══ 4. PDF 추출본은 잘리지 않는다 ════════════════════════ */
{
  // fit() 은 글자 파일에만 쓴다. PDF 는 모델이 읽은 결과를 그대로 넘긴다 —
  // 22쪽 논문이 64,002자로 들어왔고 그 안에 Table 8(처리량)이 있었다
  const reader = readFileSync(join(root, 'src', 'lib', 'docReader.js'), 'utf8')
  const fitCalls = (reader.match(/\bfit\(/g) || []).length
  ok('fit() 은 한 곳에서만 쓴다 (글자 파일)', fitCalls === 2, `${fitCalls}곳 (정의 1 + 호출 1 이어야 한다)`)
  ok('toPrompt 는 본문을 안 자른다', !/slice\(0,\s*\d+\)/.test(/toPrompt[\s\S]{0,900}/.exec(reader)?.[0] || ''))
}

/* ══ 5. 긴 자료 나눠 읽기 ═════════════════════════════════ */
{
  // 빠르라고가 아니라 **안 잘리려고** 나눈다. 22쪽 논문이 출력 상한(24,000토큰)에
  // 딱 걸쳐서, 같은 파일이 한 번은 STOP 한 번은 MAX_TOKENS 로 끝났다
  ok('짧은 자료는 안 나눈다', D.planRanges(8).length === 1 || D.WHOLE_DOC_MAX_PAGES >= 8)
  const r22 = D.planRanges(22)
  ok('22쪽 → 4조각', r22.length === 4, JSON.stringify(r22))
  ok('  ↳ 1쪽부터 시작', r22[0][0] === 1)
  ok('  ↳ 마지막이 22쪽에서 끝', r22.at(-1)[1] === 22)
  ok('  ↳ 빈틈도 겹침도 없다', r22.every((x, i) => i === 0 || x[0] === r22[i - 1][1] + 1))
  ok('1쪽짜리도 안 터진다', D.planRanges(1).length === 1)
  ok('0쪽·NaN 은 빈 계획', D.planRanges(0).length === 0 && D.planRanges(NaN).length === 0)

  // 조각 지시는 쪽 표시를 반드시 요구해야 한다. 이게 병합의 열쇠다
  const rp = D.rangePrompt('논문.pdf', 7, 12)
  ok('범위를 명시한다', rp.includes('7쪽') && rp.includes('12쪽'))
  ok('쪽 표시를 요구한다', /\[p쪽번호\]|\[p7\]/.test(rp))
  ok('요약하지 말라고 한다', /요약하지 않는다/.test(rp))
  ok('범위 밖은 적지 말라고 한다', /범위 밖/.test(rp))

  // ── 병합 ──
  const A = '[p1]첫 쪽\n[p2]둘째 쪽'
  const B = '[p3]셋째 쪽\n[p4]넷째 쪽'
  ok('순서대로 합쳐진다', D.mergePages([A, B]) === '첫 쪽\n\n둘째 쪽\n\n셋째 쪽\n\n넷째 쪽')
  // 조각이 뒤바뀌어 도착해도 쪽 번호로 정렬된다 (Promise.all 순서는 지켜지지만 방어)
  ok('뒤바뀌어 와도 정렬된다', D.mergePages([B, A]).startsWith('첫 쪽'))
  // 쪽수를 잘못 세어 조각이 겹쳐도 한 벌로 모인다
  ok('겹친 쪽은 하나로', D.mergePages(['[p1]가\n[p2]나', '[p2]나\n[p3]다']) === '가\n\n나\n\n다')
  // 경계에서 한쪽이 잘렸으면 온전한 쪽이 이긴다
  ok('잘린 쪽보다 온전한 쪽', D.mergePages(['[p1]짧', '[p1]훨씬 더 긴 온전한 본문']) === '훨씬 더 긴 온전한 본문')
  ok('빈 조각은 건너뛴다', D.mergePages(['[p1]가', '', null, '[p2]나']) === '가\n\n나')
  // 모델이 표시를 안 붙이는 경우 — 없는 것보다 이어붙이는 게 낫다
  ok('표시가 없으면 순서대로 잇는다', D.mergePages(['가나다', '라마바']) === '가나다\n\n라마바')
  ok('전부 비면 빈 문자열', D.mergePages(['', '']) === '')

  // ── 쪽수 읽기 ──
  ok('숫자만', D.parsePageCount('22') === 22)
  ok('말이 섞여도', D.parsePageCount('이 자료는 22쪽입니다') === 22)
  ok('못 읽으면 null', D.parsePageCount('모르겠어') === null)
  ok('빈 값도 null', D.parsePageCount('') === null && D.parsePageCount(null) === null)
  ok('말도 안 되는 값은 null', D.parsePageCount('99999') === null)
}

rmSync(tmp, { recursive: true, force: true })

console.log(`\n자료 근거 ${pass}/${pass + fails.length} 통과`)
if (fails.length) {
  console.log('\n실패:')
  for (const f of fails) console.log('  ✗ ' + f)
  process.exit(1)
}
