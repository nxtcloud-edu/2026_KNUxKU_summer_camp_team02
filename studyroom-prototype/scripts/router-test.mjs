/**
 * 배분 라우터 검사 — 어떤 말이 어느 모델로 가는가.
 *
 * 판단은 전부 코드가 한다(정규식 + 낱말 겹침 점수). 모델은 이 경로에 안 불린다.
 * 그래서 검사도 코드로 끝난다 — 모델 호출 없이 전부 돈다.
 *
 * ⚠️ 일상 대화 목록은 **내려보내는** 목록이다. 자료 첨부에 쓰던 목록과 방향이 반대라,
 *    못 맞혀도 상위 모델이 그대로 유지된다(답이 안 나빠진다). 그래서 목록을 써도 된다.
 *    대신 **잘못 내려보내는 것**은 답을 깎으므로, 아래 두 번째 묶음이 진짜 방어선이다.
 *
 * 실행:  node scripts/router-test.mjs
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { isSmallTalk, routeFunction, effectiveSpec } = await import(join(root, 'src/lib/agent/functions.js'))
const { search } = await import(join(root, 'server/retrieve.mjs'))
const BANK = join(root, 'src/data/csbank')

let pass = 0
const fails = []
const ok = (name, cond, extra = '') => {
  if (cond) pass += 1
  else fails.push(`${name}${extra ? ` — ${extra}` : ''}`)
}

/** 서버(chat.mjs)의 판단을 그대로 재현한다 */
function route(text) {
  const { funcId } = routeFunction(text, {})
  const spec = effectiveSpec(funcId, {})
  const hits = spec.useKnowledge ? search(text, BANK) : []
  const chitchat = funcId === 'F1' && hits.length === 0 && isSmallTalk(text)
  return { funcId, hits: hits.length, pro: !chitchat && (hits.length > 0 || spec.wantsPro) }
}

/* ══ 1. 일상 대화는 값싼 모델로 ═══════════════════════════ */
for (const t of ['안녕', '하이', 'ㅎㅇ', '고마워', '오케이', '알겠어', '넵', '응', '어', '잘가',
                 '아 배고파', '졸려', '오늘 날씨 좋다', '점심 뭐 먹지', '커피 마시고 올게', 'ㅋㅋㅋ', '헐']) {
  ok(`일상: ${t}`, !route(t).pro, '상위 모델로 갔다')
}

/* ══ 2. 학습 질문은 절대 안 내려간다 ══════════════════════ */
// 여기가 진짜 방어선이다. 하나라도 뚫리면 사용자가 값싼 답을 받는다
for (const t of [
  '해시 충돌이 뭐야', '오버피팅 어떻게 막아', '정렬 알고리즘 비교해줘', '데드락 조건 네 가지',
  '인덱스는 왜 빨라', '트랜잭션 격리수준', 'TCP 3-way handshake', '미적분 미분 공식 알려줘',
  '아까 그거 더 자세히',
  // ↓ 인사말이 앞에 붙은 질문. 접두사만 보면 일상으로 샌다
  '안녕 그런데 힙이 뭐야', '고마워 근데 B트리는?', '응 그럼 캐시는 어떻게 동작해',
  // ↓ 한국어에 낱말 경계가 없어서 짧은 인사말에 삼켜지는 것들
  '그래프 탐색이 뭐야', '응용 계층 설명해줘', '어텐션 원리 알려줘', '와이파이 프로토콜',
  '네트워크 계층 설명해줘', '대박 알고리즘이 뭔데', '헐리우드 원칙이 뭐야',
]) {
  ok(`학습: ${t}`, route(t).pro, '값싼 모델로 내려갔다')
}

/* ══ 3. 판정 함수 자체 ════════════════════════════════════ */
ok('빈 입력은 일상 아님', !isSmallTalk('') && !isSmallTalk(null))
ok('긴 말은 일상 아님', !isSmallTalk('안녕 ' + '가'.repeat(30)))
ok('묻고 있으면 일상 아님', !isSmallTalk('안녕 이거 왜 이래?'))
ok('짧은 인사말이 다른 말을 안 삼킨다', !isSmallTalk('응용') && !isSmallTalk('어텐션') && !isSmallTalk('그래프'))
ok('어미가 붙어도 잡는다', isSmallTalk('알겠어') && isSmallTalk('고마워'))

/* ══ 4. 넘김 표시 ═════════════════════════════════════════ */
{
  const src = (await import('node:fs')).readFileSync(join(root, 'server/chat.mjs'), 'utf8')
  ok('값싼 모델에게 넘길 길을 준다', /HANDOFF_RULE/.test(src))
  ok('넘김 표시가 오면 상위 모델로 다시 부른다', /HANDOFF_RE\.test\(out\.text\)/.test(src))
  // 상위 모델까지 막히면 표시가 화면에 뜬다 — 우리 속사정이지 답이 아니다
  ok('상위까지 막히면 표시를 지운다', /out\.text\.replace\(HANDOFF_RE/.test(src))
  ok('개입 턴은 일상 판정을 안 탄다', /funcId === 'F1' &&/.test(src))
}

console.log(`\n배분 라우터 ${pass}/${pass + fails.length} 통과`)
if (fails.length) {
  console.log('\n실패:')
  for (const f of fails) console.log('  ✗ ' + f)
  process.exit(1)
}
