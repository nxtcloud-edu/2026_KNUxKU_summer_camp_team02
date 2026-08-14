/**
 * 내려받는 요약 문서 검사.
 *
 * 여기서 확인하는 것은 "떨어지는가"가 아니라 **"화면에 있는 게 파일에도 있는가"** 다.
 * 예전 고장이 딱 그거였다 — 화면에는 개념 해설이 다 있는데 파일에는 한 문단만 있었다.
 * 그건 빌드도 린트도 못 잡는다. 둘 다 통과하면서 내용만 빈다.
 *
 * 실행:  node scripts/summary-doc-test.mjs
 * (src/ 는 확장자 없는 import 를 쓰므로 esbuild 로 한 덩어리로 묶어서 불러온다)
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tmp = mkdtempSync(join(tmpdir(), 'sumdoc-'))
const bundle = join(tmp, 'summaryDoc.mjs')
execFileSync(
  join(root, 'node_modules', '.bin', 'esbuild'),
  [join(root, 'src', 'lib', 'summaryDoc.js'), '--bundle', '--format=esm', `--outfile=${bundle}`],
  { stdio: 'pipe' },
)
const M = await import(bundle)

let pass = 0
const fails = []
const ok = (name, cond, extra = '') => {
  if (cond) pass += 1
  else fails.push(`${name}${extra ? ` — ${extra}` : ''}`)
}

/* ── 표본: 실제 모델이 내놓는 모양 그대로 ────────────────── */
const REVIEW = {
  conceptGroups: [
    {
      domain: 'ai',
      label: '인공지능',
      concepts: [
        {
          title: 'SISA (Importance-Aware Attention)',
          markdown:
            '### 모델의 개념\n어텐션 연산 **내부에** 상태 공간 모델(SSM)의 중요도 신호를 직접 결합한 연산 방식이다.\n\n### 파이프라인\n- 입력 데이터\n- SSM 중요도 신호 계산 및 어텐션 점수 결합\n- 최종 결과\n\n### 점수식\n`score = softmax(QK^T / sqrt(d) + log s)`\n',
        },
        {
          title: '상태 공간 모델(SSM)',
          markdown: '긴 문맥을 선형 시간으로 훑는 계열이다.\n\n- 장점: 길이에 선형\n- 단점: 정밀 탐색이 약하다\n',
        },
      ],
    },
    {
      domain: 'general_cs',
      label: '컴퓨터 일반',
      concepts: [{ title: '해시 충돌', markdown: '서로 다른 키가 같은 칸에 배정되는 상황이다.\n' }],
    },
  ],
  deepeningPoints: [
    {
      title: '상태 공간 모델(SSM)과의 결합 방식',
      body: '어텐션의 탐색 능력과 SSM의 정보 선별 능력이 점수 계산식 내에서 어떻게 합성되는지 살펴볼 수 있어.',
    },
  ],
  trueFalseQuizzes: [
    {
      statement: 'SISA는 기존 어텐션 구조 외에 별도의 SSM 레이어를 후단에 추가하는 방식으로 동작한다.',
      answer: false,
      explanation: 'SISA는 레이어를 따로 두는 것이 아니라 어텐션 점수 계산식 내부에 SSM 중요도 신호를 직접 결합한다.',
    },
  ],
  summaryText: '오늘은 어텐션에 중요도 신호를 결합하는 방식을 살펴봤어요.',
}

const FACTS = [
  { label: '날짜', value: '8월 14일 21:30' },
  { label: '주제', value: '어텐션 구조' },
  { label: '집중 시간', value: '1시간 12분' },
]

const sections = M.buildSections(REVIEW)
const md = M.buildMarkdown({ facts: FACTS, sections })
const html = M.buildPrintHtml({ title: '오늘의 공부 요약', facts: FACTS, sections })

/* ── 1. 뼈대 ─────────────────────────────────────────────── */
ok('섹션 4종', sections.length === 4, sections.map((s) => s.title).join('/'))
ok('개념 3개가 평평하게 펴짐', sections[0].items.length === 3)

/* ── 2. 화면에 있는 게 파일에도 있는가 ───────────────────── */
// 이게 이 검사의 존재 이유다. 개념 제목·본문·목록·공식이 전부 살아 있어야 한다
const everyConcept = REVIEW.conceptGroups.flatMap((g) => g.concepts)
for (const c of everyConcept) {
  ok(`md: 개념 "${c.title}"`, md.includes(c.title))
  ok(`html: 개념 "${c.title}"`, html.includes(c.title))
}
ok('md: 본문 문장', md.includes('상태 공간 모델(SSM)의 중요도 신호를 직접 결합'))
ok('html: 본문 문장', html.includes('상태 공간 모델(SSM)의 중요도 신호를 직접 결합'))
ok('md: 심화 포인트', md.includes('어텐션의 탐색 능력과 SSM의 정보 선별'))
ok('html: 심화 포인트', html.includes('어텐션의 탐색 능력과 SSM의 정보 선별'))
ok('md: 퀴즈 지문', md.includes('별도의 SSM 레이어를 후단에'))
ok('html: 퀴즈 지문', html.includes('별도의 SSM 레이어를 후단에'))
ok('md: 퀴즈 정답', md.includes('X (거짓)'))
ok('html: 퀴즈 정답', html.includes('정답: 거짓'))
ok('md: 맺음말', md.includes(REVIEW.summaryText))
ok('html: 맺음말', html.includes(REVIEW.summaryText))
ok('facts 3개', FACTS.every((f) => md.includes(f.value) && html.includes(f.value)))

/* ── 3. 예전 고장: 요약 한 문단만 담기 ───────────────────── */
/*
 * 임의의 글자수 문턱은 뜻이 없다. 표본이 작으면 잘 돌아도 걸리고, 크면 빠져도 통과한다.
 * 대신 두 가지를 본다.
 *   ① 개념 본문이 **한 줄도 빠짐없이** 들어갔는가
 *   ② 옛 형식(머리말 + 요약 한 문단)보다 실제로 얼마나 더 담았는가
 */
const bodyLines = everyConcept.flatMap((c) =>
  c.markdown
    .split('\n')
    .map((l) => l.replace(/^###\s+/, '').trim())
    .filter((l) => l && !l.startsWith('- ') && !l.startsWith('`')),
)
const missing = bodyLines.filter((l) => !md.includes(l))
ok('개념 본문이 한 줄도 안 빠짐', missing.length === 0, missing.join(' | '))

const oldFormat = ['오늘의 공부 요약', `날짜: ${FACTS[0].value}`, `주제: ${FACTS[1].value}`, '', REVIEW.summaryText].join('\n')
ok('옛 형식보다 훨씬 많이 담김', md.length > oldFormat.length * 5, `${oldFormat.length}자 → ${md.length}자`)

/* ── 4. 마크다운 문법 ────────────────────────────────────── */
ok('개념 제목은 ###', /^### SISA/m.test(md))
// 개념 본문이 스스로 ### 를 쓴다. 안 내리면 개념 제목과 같은 층이 되어 목차가 엉킨다
ok('본문 ### 는 #### 로 내려감', /^#### 모델의 개념/m.test(md))
ok('본문에 ### 가 남지 않음', !/^### 모델의 개념/m.test(md))
ok('빈 줄 3개 이상 없음', !/\n{3}/.test(md))
ok('목록 유지', md.includes('- 장점: 길이에 선형'))

/* ── 5. HTML 안전성 ──────────────────────────────────────── */
const danger = {
  conceptGroups: [
    {
      domain: 'x',
      label: '<b>라벨</b>',
      concepts: [
        {
          title: '<script>alert(1)</script>',
          markdown: '본문 <img src=x onerror=alert(2)> 과 **굵게** 와 `코드<>` 입니다.\n',
        },
      ],
    },
  ],
  deepeningPoints: [],
  trueFalseQuizzes: [],
  summaryText: '',
}
const dHtml = M.buildPrintHtml({ facts: [], sections: M.buildSections(danger) })
ok('script 태그가 그대로 안 나감', !dHtml.includes('<script>alert(1)'))
ok('script 가 글자로 이스케이프됨', dHtml.includes('&lt;script&gt;alert(1)'))
ok('img onerror 이스케이프됨', !dHtml.includes('<img src=x'))
ok('굵게는 살아 있음', dHtml.includes('<strong>굵게</strong>'))
ok('코드 안의 꺾쇠도 이스케이프됨', dHtml.includes('<code>코드&lt;&gt;</code>'))
ok('라벨도 이스케이프됨', !dHtml.includes('<b>라벨</b>'))

/* ── 6. 빈 세션 ──────────────────────────────────────────── */
const empty = M.buildSections({ conceptGroups: [], deepeningPoints: [], trueFalseQuizzes: [], summaryText: '' })
ok('빈 요약은 섹션 0개', empty.length === 0)
const emptyMd = M.buildMarkdown({ facts: [], sections: empty })
ok('빈 요약도 안 터짐', typeof emptyMd === 'string' && emptyMd.includes('오늘의 공부 요약'))
ok('빈 요약 HTML도 안 터짐', M.buildPrintHtml({ facts: [], sections: empty }).includes('</html>'))
ok('null 도 안 터짐', M.buildSections(null).length === 0)

/* ── 7. HTML 이 온전한 문서인가 ──────────────────────────── */
ok('doctype', html.startsWith('<!doctype html>'))
ok('utf-8', html.includes('charset="utf-8"') || html.includes('charset=utf-8'))
ok('A4 인쇄 규격', html.includes('@page') && html.includes('A4'))
ok('한글 글꼴 지정', html.includes('Apple SD Gothic Neo') && html.includes('Malgun Gothic'))
// 바탕을 안 칠하면 다크 모드에서 검은 바탕에 검은 글씨가 된다 — 실제로 겪은 고장이다
ok('바탕을 직접 칠한다', /html\s*\{[^}]*background:\s*#ffffff/.test(html))
ok('색 반전 차단', html.includes('color-scheme: light'))
ok('웹폰트를 안 받는다', !/@import|fonts\.googleapis|https?:\/\/[^"']*\.woff/.test(html))
ok('개념이 장 사이에서 안 잘림', html.includes('page-break-inside: avoid'))
const tags = html.match(/<(\w+)[^>]*>/g) || []
ok('열린 태그 수가 정상 범위', tags.length > 30)
ok('공식 박스', html.includes('class="formula"') && html.includes('score = softmax'))

rmSync(tmp, { recursive: true, force: true })

console.log(`\n요약 문서 ${pass}/${pass + fails.length} 통과`)
if (fails.length) {
  console.log('\n실패:')
  for (const f of fails) console.log('  ✗ ' + f)
  process.exit(1)
}
console.log(`  마크다운 ${md.length}자 · 인쇄 HTML ${html.length}자`)
