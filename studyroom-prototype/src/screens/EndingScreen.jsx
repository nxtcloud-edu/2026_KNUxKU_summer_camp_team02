/**
 * 엔딩 페이지 — 통합 설계서 §6-4 (지표 §8-1 / 폴백 §8-3 / 점수 §8-4)
 *
 * [UI 재구성 v4] "공부 내용 요약" 모달을 데모데이터(demoSessionReview) 기반 UI 렌더링 테스트로 재구성.
 *   - 메인 화면(캐릭터 인사 · 이번 학습시간 · 지난 기록 비교)은 이전 버전과 동일하다.
 *   - 모달 왼쪽: 분야별 그룹(conceptGroups) → 개념 토글 → Markdown Viewer
 *   - 모달 오른쪽: 심화 학습 포인트(deepeningPoints) · T/F 퀴즈(trueFalseQuizzes) · 내용 요약(summaryText)
 *
 *   §주의: 이번 작업은 실제 기능 개발이 아니라 UI 렌더링 테스트다.
 *   demoSessionReview는 고정된 mock 데이터이며, 실제 RAG·AI 호출·채팅 분석·DB 스키마와는 무관하다.
 *   Markdown Viewer도 새 라이브러리를 추가하지 않고 최소 문법(###, 문단, 목록, 인라인 코드, 코드블록,
 *   공식처럼 보이는 한 줄)만 직접 파싱해서 보여준다.
 */

import { useCallback, useMemo, useState, useEffect } from 'react'
import {
  Settings,
  Timer,
  DoorOpen,
  Lightbulb,
  Info,
  Calendar,
  Users,
  Sparkles,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Download,
  Flame,
  BookOpen,
  FileText,
  HelpCircle,
  Search,
} from 'lucide-react'

import { useStore, activeSeats } from '../store/useStore'
import { db, daysAgoKey } from '../store/db'
import { PRESETS } from '../lib/presets'
import { computeScore, commentTone, fmtHuman, fmtShort } from '../lib/metrics'
import { Button, IconBtn, Dialog, CharacterSprite } from '../components/ui'

/* ── 스터디 메이트의 한마디 (§6-4 ④) ────────────────────────
   §1-3 "평가자가 아니라 동료" — 점수가 낮아도 질책하지 않는다. */
const MATE_LINES = {
  praise: {
    mina: '오늘 집중 흐름이 정말 좋았어요. 이 리듬, 다음에도 그대로 가져가요.',
    theo: '와 오늘 진짜 잘했다! 나도 옆에서 같이 달린 기분이야.',
    juno: '오늘은 꽤 괜찮았어. 이 정도면 나도 인정.',
  },
  advice: {
    mina: '중간에 흐름이 몇 번 끊겼지만, 다시 돌아온 게 더 중요해요. 다음엔 25분씩 끊어볼까요?',
    theo: '오늘도 끝까지 앉아있었잖아! 다음엔 딱 10분만 더 같이 가보자.',
    juno: '나쁘지 않았어. 시작 전에 뭘 할지만 정해두면 다음엔 더 수월할걸.',
  },
  warn: {
    mina: '오늘은 자리를 자주 비우게 됐네요. 컨디션 탓일 수도 있으니, 다음엔 짧게라도 같이 앉아봐요.',
    theo: '오늘은 좀 붕 떴지? 나도 그런 날 많아. 내일은 가볍게 시작하자!',
    juno: '오늘은 흐름이 잘 안 잡혔네. 그런 날도 있지. 내일 다시 하면 돼.',
  },
  neutral: {
    mina: '오늘은 집중 측정이 꺼져 있어 시간만 기록했어요. 그래도 함께한 시간은 그대로 남아요.',
    theo: '오늘은 시간만 기록됐네! 그래도 같이 있었던 건 확실하지.',
    juno: '측정은 꺼져 있었지만, 앉아있었던 건 사실이잖아.',
  },
}

const WEEKDAY = ['월', '화', '수', '목', '금', '토', '일']

/* ── 공부 내용 요약 모달용 데모데이터 (§UI 렌더링 테스트 전용) ─────
   실제 세션 데이터가 아니라, 모달 레이아웃과 Markdown 렌더링을 한 번에
   확인하기 위해 고정해 둔 mock 데이터다. */
const DEMO_SESSION_REVIEW = {
  contentScale: 'normal',

  conceptGroups: [
    {
      domain: 'computer_math',
      label: '컴퓨터 수학',
      concepts: [
        {
          title: '조건부 확률',
          markdown: `
### 개념 설명
조건부 확률은 어떤 사건 B가 이미 일어났다는 조건 아래에서, 다른 사건 A가 일어날 확률이에요.

### 공식
\`P(A|B) = P(A∩B) / P(B)\`

### 변수 의미
- \`A\`: 알고 싶은 사건
- \`B\`: 이미 일어났다고 가정하는 조건 사건
- \`P(A∩B)\`: A와 B가 동시에 일어날 확률
- \`P(B)\`: 조건 사건 B가 일어날 확률

### 예시
주사위를 던져 짝수가 나왔다는 조건에서, 그 수가 4일 확률은 \`1/3\`이에요.

### 자주 헷갈리는 점
\`P(A|B)\`와 \`P(B|A)\`는 서로 다른 확률이에요.
`,
        },
        {
          title: '베이즈 정리',
          markdown: `
### 개념 설명
베이즈 정리는 관찰된 결과를 바탕으로 원인의 확률을 다시 계산하는 방법이에요.

### 공식
\`P(A|B) = P(B|A)P(A) / P(B)\`

### 활용 흐름
1. 사전 확률 \`P(A)\`를 정해요.
2. 관찰된 증거 \`B\`가 주어져요.
3. \`P(B|A)\`를 이용해 가능성을 갱신해요.
4. 최종적으로 \`P(A|B)\`를 구해요.

### 예시
검사 결과가 양성일 때 실제로 병이 있을 확률을 계산할 때 사용할 수 있어요.
`,
        },
      ],
    },
    {
      domain: 'operating_system',
      label: '운영체제',
      concepts: [
        {
          title: '프로세스 상태 전이',
          markdown: `
### 개념 설명
프로세스 상태 전이는 프로그램이 실행되는 동안 상태가 바뀌는 흐름이에요.

### 주요 상태
- New: 프로세스가 생성됨
- Ready: CPU 할당을 기다림
- Running: CPU를 받아 실행 중
- Waiting: 입출력 같은 이벤트를 기다림
- Terminated: 실행 종료

### 동작 흐름
\`\`\`
New → Ready → Running → Waiting → Ready → Running → Terminated
\`\`\`

### 예시
파일을 읽는 프로그램은 CPU에서 실행되다가 디스크 입출력이 필요하면 Waiting 상태로 이동해요.
입출력이 끝나면 다시 Ready 상태가 됩니다.
`,
        },
        {
          title: 'CPU 스케줄링',
          markdown: `
### 개념 설명
CPU 스케줄링은 Ready 상태의 프로세스 중 어떤 프로세스에게 CPU를 줄지 결정하는 방식이에요.

### 주요 기준
- 응답 시간
- 대기 시간
- 처리량
- 공정성

### 대표 알고리즘
1. FCFS: 먼저 온 프로세스를 먼저 실행
2. SJF: 실행 시간이 짧은 프로세스를 먼저 실행
3. Round Robin: 정해진 시간 단위로 번갈아 실행

### 예시
화상회의, 음악 재생, 문서 편집이 동시에 실행될 때 운영체제는 짧은 시간 단위로 CPU를 나누어 배분해요.
`,
        },
      ],
    },
    {
      domain: 'network',
      label: '네트워크',
      concepts: [
        {
          title: 'TCP 3-Way Handshake',
          markdown: `
### 개념 설명
TCP 3-Way Handshake는 클라이언트와 서버가 안정적인 연결을 만들기 위해 세 번의 메시지를 주고받는 과정이에요.

### 단계
1. SYN: 클라이언트가 연결 요청
2. SYN-ACK: 서버가 요청 수락과 응답
3. ACK: 클라이언트가 최종 확인

### 왜 필요한가
양쪽이 서로 통신 가능한 상태인지 확인하고, 패킷 순서와 연결 정보를 맞추기 위해 필요해요.

### 흐름
\`\`\`
Client → SYN → Server
Client ← SYN-ACK ← Server
Client → ACK → Server
\`\`\`

### 예시
브라우저가 웹 서버에 접속할 때 HTTP 요청을 보내기 전에 TCP 연결이 먼저 만들어져요.
`,
        },
      ],
    },
    {
      domain: 'algorithm',
      label: '자료구조/알고리즘',
      concepts: [
        {
          title: 'BFS와 DFS',
          markdown: `
### 개념 설명
BFS와 DFS는 그래프나 트리를 탐색하는 대표 알고리즘이에요.

### BFS
가까운 노드부터 넓게 탐색해요. Queue를 사용합니다.

### DFS
한 방향으로 깊게 들어가며 탐색해요. Stack 또는 재귀를 사용합니다.

### 사용 예시
- BFS: 최단 거리 탐색
- DFS: 모든 경로 탐색, 백트래킹

### 간단한 의사코드
\`\`\`
BFS(start):
  queue.push(start)
  visited.add(start)

  while queue is not empty:
    node = queue.pop()
    for next in node.neighbors:
      if next not visited:
        queue.push(next)
\`\`\`
`,
        },
      ],
    },
    {
      domain: 'artificial_intelligence',
      label: '인공지능',
      concepts: [
        {
          title: 'Transformer 모델',
          markdown: `
### 모델의 개념
Transformer는 Attention Mechanism을 기반으로 입력 토큰 간의 관계를 학습하는 딥러닝 모델 구조예요.

### 특징
- 문장 전체의 관계를 한 번에 계산
- 병렬 처리에 유리함
- 긴 문맥 처리에 강함
- 대규모 언어 모델의 기반 구조로 사용됨

### 기본 파이프라인
\`\`\`
입력 토큰 → 임베딩 → Self-Attention → Feed Forward Network → 출력
\`\`\`

### 활용 예시
번역, 요약, 질의응답, 코드 생성 같은 작업에서 Transformer 기반 모델이 사용돼요.
`,
        },
      ],
    },
  ],

  deepeningPoints: [
    {
      title: '베이즈 정리',
      body: '조건부 확률의 방향을 뒤집어 결과로부터 원인의 확률을 구하는 방법이에요.',
    },
    {
      title: '문맥 교환',
      body: 'CPU가 실행 중인 프로세스를 바꿀 때 저장하고 복원해야 하는 상태 정보와 관련된 개념이에요.',
    },
    {
      title: 'Attention Mechanism',
      body: 'Transformer를 이해하려면 입력 토큰들이 서로 얼마나 관련 있는지 계산하는 Attention 구조를 함께 보는 게 좋아요.',
    },
  ],

  trueFalseQuizzes: [
    {
      statement: '조건부 확률 P(A|B)는 B가 일어난 조건에서 A가 일어날 확률이다.',
      answer: true,
      explanation: '맞아요. 조건부 확률은 특정 조건이 주어진 상황에서의 확률을 의미해요.',
    },
    {
      statement: 'Ready 상태의 프로세스는 입출력 작업이 끝나기를 기다리는 상태다.',
      answer: false,
      explanation: '아니에요. Ready 상태는 CPU 할당을 기다리는 상태이고, 입출력을 기다리는 상태는 Waiting이에요.',
    },
    {
      statement: 'TCP 3-Way Handshake는 SYN, SYN-ACK, ACK 순서로 진행된다.',
      answer: true,
      explanation: '맞아요. TCP 연결을 만들 때 세 단계 확인 과정을 거쳐요.',
    },
    {
      statement: 'DFS는 일반적으로 Queue를 사용해 가까운 노드부터 탐색한다.',
      answer: false,
      explanation: '아니에요. Queue를 사용하는 넓이 우선 탐색은 BFS이고, DFS는 Stack 또는 재귀를 사용해요.',
    },
  ],

  summaryText:
    '오늘은 조건부 확률과 베이즈 정리 같은 컴퓨터 수학 개념, 프로세스 상태 전이와 CPU 스케줄링 같은 운영체제 개념, TCP 연결 과정, 그래프 탐색, Transformer 구조를 함께 정리했어요.',
}

/** conceptGroups를 평평하게 펼친 검색 대상 목록 — 분야 라벨을 함께 들고 있는다 */
const ALL_CONCEPTS = DEMO_SESSION_REVIEW.conceptGroups.flatMap((group) =>
  group.concepts.map((concept) => ({
    key: `${group.domain}::${concept.title}`,
    title: concept.title,
    markdown: concept.markdown,
    groupLabel: group.label,
  })),
)

/** 미리보기 입력창 아래에 보여줄 예시 주제 몇 개 */
const SAMPLE_TOPICS = ALL_CONCEPTS.slice(0, 4).map((c) => c.title)

/** 입력한 주제명과 데모 개념 제목을 부분 일치로 매칭한다 (공백·대소문자 무시) */
function findDemoConcept(query) {
  const q = query.replace(/\s/g, '').toLowerCase()
  if (!q) return null
  return (
    ALL_CONCEPTS.find((c) => {
      const t = c.title.replace(/\s/g, '').toLowerCase()
      return t.includes(q) || q.includes(t)
    }) || null
  )
}

/* ── Markdown Viewer (최소 지원) ─────────────────────────────
   지원: ### 제목 · 문단 · - 목록 · 1. 번호 목록 · 인라인 코드 · 코드블록 ·
         공식처럼 보이는 한 줄(문단 전체가 `...`로만 되어 있으면 공식 박스로) · 빈 줄 기준 문단 분리 */
function parseMarkdownBlocks(md) {
  const lines = (md || '').replace(/\r\n/g, '\n').split('\n')
  const blocks = []
  let i = 0

  const isFence = (l) => l.trim().startsWith('```')
  const isHeading = (l) => /^###\s+/.test(l)
  const isBullet = (l) => /^[-*]\s+/.test(l)
  const isNumbered = (l) => /^\d+\.\s+/.test(l)

  while (i < lines.length) {
    const line = lines[i]

    if (line.trim() === '') {
      i++
      continue
    }

    if (isFence(line)) {
      const codeLines = []
      i++
      while (i < lines.length && !isFence(lines[i])) {
        codeLines.push(lines[i])
        i++
      }
      i++ // 닫는 펜스 건너뛰기
      blocks.push({ type: 'code', content: codeLines.join('\n') })
      continue
    }

    if (isHeading(line)) {
      blocks.push({ type: 'h3', content: line.replace(/^###\s+/, '') })
      i++
      continue
    }

    if (isBullet(line)) {
      const items = []
      while (i < lines.length && isBullet(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ''))
        i++
      }
      blocks.push({ type: 'ul', items })
      continue
    }

    if (isNumbered(line)) {
      const items = []
      while (i < lines.length && isNumbered(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''))
        i++
      }
      blocks.push({ type: 'ol', items })
      continue
    }

    // 문단 — 빈 줄이나 다음 블록 시작 전까지 이어붙인다
    const paraLines = []
    while (i < lines.length && lines[i].trim() !== '' && !isFence(lines[i]) && !isHeading(lines[i]) && !isBullet(lines[i]) && !isNumbered(lines[i])) {
      paraLines.push(lines[i].trim())
      i++
    }
    const joined = paraLines.join(' ')
    if (/^`[^`]+`$/.test(joined)) {
      blocks.push({ type: 'formula', content: joined.slice(1, -1) })
    } else {
      blocks.push({ type: 'p', content: joined })
    }
  }

  return blocks
}

/** 인라인 `코드` 표기를 <code>로 바꿔서 렌더링한다 */
function renderInline(text) {
  const parts = String(text).split(/`([^`]+)`/g)
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <code key={i} className="rounded-sm bg-[var(--hover-bg)] border border-hairline px-1.5 py-0.5 t-caption tnum">
        {part}
      </code>
    ) : (
      part
    ),
  )
}

function MarkdownViewer({ markdown }) {
  const blocks = useMemo(() => parseMarkdownBlocks(markdown), [markdown])
  return (
    <div className="space-y-2.5">
      {blocks.map((b, i) => {
        if (b.type === 'h3') {
          return (
            <h4 key={i} className={`t-item font-semibold ${i === 0 ? '' : 'pt-1.5'}`}>
              {b.content}
            </h4>
          )
        }
        if (b.type === 'ul') {
          return (
            <ul key={i} className="list-disc pl-5 space-y-1">
              {b.items.map((it, j) => (
                <li key={j} className="t-body break-words">
                  {renderInline(it)}
                </li>
              ))}
            </ul>
          )
        }
        if (b.type === 'ol') {
          return (
            <ol key={i} className="list-decimal pl-5 space-y-1">
              {b.items.map((it, j) => (
                <li key={j} className="t-body break-words">
                  {renderInline(it)}
                </li>
              ))}
            </ol>
          )
        }
        if (b.type === 'code') {
          return (
            <pre key={i} className="rounded-sm bg-surface-dark px-3.5 py-3 overflow-x-auto">
              <code className="t-caption tnum text-[var(--bg-warm)] whitespace-pre">{b.content}</code>
            </pre>
          )
        }
        if (b.type === 'formula') {
          return (
            <p key={i} className="rounded-sm bg-lavender border border-hairline px-3 py-2 t-body tnum break-words">
              {b.content}
            </p>
          )
        }
        return (
          <p key={i} className="t-body break-words" style={{ lineHeight: 1.7 }}>
            {renderInline(b.content)}
          </p>
        )
      })}
    </div>
  )
}

/* ── T/F 퀴즈 캐러셀 — 한 번에 한 문제씩, 화살표/도트로 옆으로 넘긴다 ──── */
function TrueFalseQuizCarousel({ quizzes }) {
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState({}) // index -> boolean

  const total = quizzes.length
  const q = quizzes[index]
  const selected = answers[index]
  const answered = selected !== undefined
  const isCorrect = answered && selected === q.answer

  const go = (dir) => setIndex((i) => (i + dir + total) % total)

  return (
    <div className="rounded-md border border-hairline bg-white/70 p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="t-caption text-muted">
          {index + 1} / {total}
        </span>
        <div className="flex items-center gap-1.5">
          <IconBtn label="이전 퀴즈" tone="plain" onClick={() => go(-1)} disabled={total <= 1}>
            <ChevronLeft size={16} aria-hidden="true" />
          </IconBtn>
          <IconBtn label="다음 퀴즈" tone="plain" onClick={() => go(1)} disabled={total <= 1}>
            <ChevronRight size={16} aria-hidden="true" />
          </IconBtn>
        </div>
      </div>

      <div key={index} className="fade-in">
        <p className="t-body break-words min-h-[48px]">{q.statement}</p>
        <div className="mt-3 flex gap-2">
          {[true, false].map((v) => {
            const isSel = selected === v
            const isRight = q.answer === v
            return (
              <button
                key={String(v)}
                type="button"
                onClick={() => setAnswers((a) => ({ ...a, [index]: v }))}
                disabled={answered}
                className={[
                  'flex-1 rounded-full border px-4 py-1.5 t-item transition-colors duration-300',
                  answered && isRight
                    ? 'bg-sage border-[var(--text-dark)] font-semibold'
                    : answered && isSel
                      ? 'bg-peach border-[var(--danger)]'
                      : 'bg-white border-hairline hover:bg-[var(--hover-bg)]',
                ].join(' ')}
              >
                {v ? 'True' : 'False'}
              </button>
            )
          })}
        </div>
        {answered && (
          <p className="t-help mt-2.5 fade-in">
            <span className={isCorrect ? 'font-semibold' : 'font-semibold text-[var(--danger)]'}>
              {isCorrect ? '정답이에요.' : '다시 확인해봐요.'}
            </span>{' '}
            {q.explanation}
          </p>
        )}
      </div>

      {/* 도트 인디케이터 — 원하는 문제로 바로 이동 */}
      <div className="mt-4 flex justify-center gap-1.5">
        {quizzes.map((_, i) => (
          <button
            key={i}
            type="button"
            aria-label={`퀴즈 ${i + 1}번으로 이동`}
            onClick={() => setIndex(i)}
            className={[
              'h-1.5 rounded-full transition-all duration-300',
              i === index ? 'w-5 bg-[var(--text-strong)]' : 'w-1.5 bg-[var(--disabled)]',
            ].join(' ')}
          />
        ))}
      </div>
    </div>
  )
}

/** 개념 아코디언 한 줄 — 안 누르면 개념명만, 누르면 Markdown Viewer가 펼쳐진다 */
function ConceptToggle({ title, markdown, open, onToggle }) {
  return (
    <div className="rounded-md border border-hairline bg-white/70 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--hover-bg)] transition-colors duration-300"
      >
        <span
          className={[
            'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors duration-300',
            open ? 'bg-[var(--text-strong)] border-[var(--text-strong)] text-[var(--bg-warm)]' : 'border-hairline text-subtle',
          ].join(' ')}
        >
          {open ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
        </span>
        <span className="t-item min-w-0 truncate">{title}</span>
      </button>
      {open && (
        <div className="border-t border-hairline px-4 py-4 fade-in max-h-[320px] overflow-y-auto scroll-soft">
          <MarkdownViewer markdown={markdown} />
        </div>
      )}
    </div>
  )
}

/* ── 지역 헬퍼 (§규칙 3: 새 의존 파일을 만들지 않는다) ────── */

function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** 최근 7일(오래된 → 최신) 키 */
const recent7Keys = () => Array.from({ length: 7 }, (_, i) => daysAgoKey(6 - i))

/** ① 주제의 원천 — 세 갈래 분기 (§6-4 [판단]) — 기존 로직 그대로 */
function resolveTopic(session, messages) {
  const topics = Array.isArray(session.topics)
    ? session.topics.filter(Boolean)
    : session.topic
      ? [session.topic]
      : []

  if (topics.length) {
    const head = topics.slice(0, 2).join(' · ')
    const rest = topics.length - 2
    return { kind: 'topic', title: rest > 0 ? `${head} 외 ${rest}건` : head }
  }

  const files = messages.filter((m) => m.kind === 'file' && m.body).map((m) => m.body)
  if (files.length || session.topic_source === 'document') {
    const head = files.slice(0, 2).join(' · ') || '업로드한 자료'
    const rest = files.length - 2
    return { kind: 'file', title: rest > 0 ? `${head} 외 ${rest}건` : head }
  }

  return { kind: 'none', title: '오늘의 공부' }
}

/** [판단] 표시 캐릭터 — 이번 세션에서 가장 많이 상호작용한 메이트 — 기존 로직 그대로 */
function pickMate(seats, messages) {
  const count = new Map()
  messages.forEach((m) => {
    if (m.sender_type !== 'mate') return
    const key = String(m.sender_id)
    count.set(key, (count.get(key) || 0) + 1)
  })
  let best = null
  let bestN = -1
  seats.forEach((s) => {
    const n = (count.get(String(s.slotNo)) || 0) + (count.get(String(s.name)) || 0)
    if (n > bestN) {
      bestN = n
      best = s
    }
  })
  if (bestN > 0 && best) return best
  return seats.find((s) => s.enabled) || seats[0]
}

/** 이탈 횟수를 시각적으로 나눈 흐름 구간 — 정확한 타임라인이 아니라 비율 기반 근사치 */
function buildFlowSegments(focusSec, awaySec, awayCount) {
  if (!awayCount || awaySec <= 0) return [{ type: 'focus', pct: 100 }]
  const gaps = awayCount + 1
  const focusPer = focusSec / gaps
  const awayPer = awaySec / awayCount
  const raw = []
  for (let i = 0; i < awayCount; i++) {
    raw.push({ type: 'focus', sec: focusPer })
    raw.push({ type: 'away', sec: awayPer })
  }
  raw.push({ type: 'focus', sec: focusPer })
  const total = raw.reduce((a, s) => a + s.sec, 0) || 1
  return raw.map((s) => ({ ...s, pct: (s.sec / total) * 100 }))
}

/** 다운로드용 평문 요약 — 모달의 "내용 요약" 텍스트 그대로 내려받는다 */
function buildSummaryDownloadText({ startedLabel, topic, summaryText }) {
  return [`오늘의 공부 요약`, `날짜: ${startedLabel}`, `주제: ${topic.title}`, '', summaryText].join('\n')
}

/* ── 작은 부품들 ──────────────────────────────────────────── */

function SummaryCard({ icon, label, value, unit, hint, muted, delay = '' }) {
  return (
    <div className={`glass-read enter-up ${delay} rounded-md p-5 min-w-0`}>
      <div className="flex items-center gap-2 text-subtle">
        <span aria-hidden="true">{icon}</span>
        <span className="t-item truncate">{label}</span>
      </div>
      <div
        className={muted ? 't-section text-muted mt-2' : 'mt-2 tnum font-semibold'}
        style={muted ? undefined : { fontSize: 34, letterSpacing: '-0.02em', color: 'var(--text-strong)' }}
      >
        {value}
        {unit && !muted && <span className="t-body ml-1 font-semibold text-subtle">{unit}</span>}
      </div>
      {hint && <p className="t-help mt-2 truncate">{hint}</p>}
    </div>
  )
}

/** 흐름 바 — 집중(초록) / 이탈(코랄) 구간을 이어붙인 막대 */
function FlowBar({ segments, on }) {
  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full bg-chart-track">
      {segments.map((s, i) => (
        <div
          key={i}
          className="h-full"
          style={{
            width: `${on ? s.pct : 0}%`,
            background: s.type === 'away' ? 'var(--accent-coral)' : 'var(--chart-focus)',
            transition: `width 900ms var(--ease-soft) ${i * 40}ms`,
          }}
        />
      ))}
    </div>
  )
}

/** 지난 기록 비교용 작은 박스 */
function MiniStat({ icon, label, value, note }) {
  return (
    <div className="rounded-md border border-hairline bg-white/70 px-4 py-3.5 min-w-0">
      <div className="flex items-center gap-2 text-subtle">
        <span aria-hidden="true">{icon}</span>
        <span className="t-caption">{label}</span>
      </div>
      <div className="t-section tnum mt-1">{value}</div>
      {note && <p className="t-help mt-0.5 truncate">{note}</p>}
    </div>
  )
}

/** 최근 7일 집중시간 막대 그래프 — 홈 화면 추이 그래프와 같은 톤 */
function WeekBars({ days }) {
  const max = Math.max(1, ...days.map((d) => d.focusSec))
  return (
    <div className="flex items-end gap-2.5 h-20">
      {days.map((d) => (
        <div key={d.key} className="flex flex-1 flex-col items-center gap-1.5">
          <div className="flex h-14 w-full items-end">
            <div
              className="w-full rounded-t-sm bg-chart-focus"
              style={{
                height: d.focusSec ? `${Math.max(6, (d.focusSec / max) * 100)}%` : '2px',
                opacity: d.isToday ? 1 : 0.55,
                transition: 'height 700ms var(--ease-soft)',
              }}
            />
          </div>
          <span className={`t-caption ${d.isToday ? 'font-semibold text-strong' : 'text-muted'}`}>{d.weekday}</span>
        </div>
      ))}
    </div>
  )
}

/* ── 본체 ────────────────────────────────────────────────── */

export default function EndingScreen() {
  const go = useStore((s) => s.go)
  const seats = useStore((s) => s.seats)
  const lastSessionId = useStore((s) => s.lastSessionId)
  const openSettings = useStore((s) => s.openSettings)

  const [barOn, setBarOn] = useState(false) // 진입 후 진행 막대를 채운다 (존 A)
  const [countdown, setCountdown] = useState(5)
  const [summaryOpen, setSummaryOpen] = useState(false) // "공부 내용 요약" 오버레이
  const [openConceptKey, setOpenConceptKey] = useState(null) // 처음엔 입력창만 보이고, 검색 결과가 열리면서 채워진다
  const [topicInput, setTopicInput] = useState('')
  const [foundConcepts, setFoundConcepts] = useState([]) // 검색해서 찾은 데모 개념들 — 검색할 때마다 쌓인다
  const [notFoundQuery, setNotFoundQuery] = useState(null) // 데모 데이터에 없는 주제를 검색했을 때

  /* 세션 로드 — 기존 db·계산 로직 재사용 (메인 화면용) */
  const data = useMemo(() => {
    const session = lastSessionId ? db.getSession(lastSessionId) : null
    if (!session) return null

    const messages = db.getMessages(session.id)
    const topic = resolveTopic(session, messages)
    const mate = pickMate(seats, messages)

    // §8-3 폴백 — 감지가 꺼져 있으면 집중 지표가 null이고 점수는 time-only
    const measured = session.score_mode !== 'time-only' && session.focus_sec != null
    const snapshot = {
      studySec: session.study_sec || 0,
      focusSec: measured ? session.focus_sec || 0 : null,
      awaySec: measured ? session.away_sec || 0 : null,
      awayCount: measured ? session.away_count || 0 : null,
      bestStreakSec: measured ? session.best_streak_sec || 0 : null,
    }
    const score = session.score ?? computeScore(snapshot)
    const tone = commentTone(score, snapshot)

    // 지난 기록 비교 — 최근 7일 (오늘 포함, §8-4와 같은 로컬 기준)
    const byDate = new Map(db.getDailyStats().map((r) => [r.date, r]))
    const todayK = daysAgoKey(0)
    const week = recent7Keys().map((k) => ({
      key: k,
      weekday: WEEKDAY[(parseKey(k).getDay() + 6) % 7],
      isToday: k === todayK,
      focusSec: k === todayK ? measured ? snapshot.focusSec || 0 : 0 : byDate.get(k)?.total_focus_sec || 0,
    }))
    const daysWithStudy = week.filter((d) => d.focusSec > 0)
    const avgFocusSec = daysWithStudy.length
      ? Math.round(daysWithStudy.reduce((a, d) => a + d.focusSec, 0) / daysWithStudy.length)
      : 0

    return {
      session,
      topic,
      mate,
      measured,
      snapshot,
      score,
      tone,
      week,
      avgFocusSec,
      streak: db.streakDays(),
      relaxed: session.integrity === 'relaxed',
    }
  }, [lastSessionId, seats])

  /* 세션이 없을 때 — 안내 후 자동으로 홈 (§3-3) — 기존 로직 그대로 */
  useEffect(() => {
    if (data) return
    if (countdown <= 0) {
      go('home')
      return
    }
    const t = setTimeout(() => setCountdown((n) => n - 1), 1000)
    return () => clearTimeout(t)
  }, [data, countdown, go])

  /* 진행 막대 진입 애니메이션 */
  useEffect(() => {
    const t = setTimeout(() => setBarOn(true), 420)
    return () => clearTimeout(t)
  }, [])

  // Dialog 내부 effect가 onClose를 의존성으로 재실행되기 때문에, 렌더마다 새로 만들어지는
  // 함수를 넘기면 타이핑 중 매 keystroke마다 포커스가 튕겨 나간다. useCallback으로 고정한다.
  const closeSummary = useCallback(() => {
    setSummaryOpen(false)
    setOpenConceptKey(null)
    setTopicInput('')
    setFoundConcepts([])
    setNotFoundQuery(null)
  }, [])

  const runTopicSearch = () => {
    const query = topicInput.trim()
    if (!query) return
    const found = findDemoConcept(query)
    if (!found) {
      setNotFoundQuery(query)
      setTopicInput('')
      return
    }
    setNotFoundQuery(null)
    setFoundConcepts((prev) => (prev.some((c) => c.key === found.key) ? prev : [...prev, found]))
    setOpenConceptKey(found.key)
    setTopicInput('')
  }

  /* ── 세션 없음 ─────────────────────────────────────────── */
  if (!data) {
    return (
      <div className="relative h-full w-full overflow-hidden bg-warm">
        <div className="blob bg-sage" style={{ width: 460, height: 460, left: '8%', top: '12%' }} />
        <div
          className="blob blob-delayed bg-peach"
          style={{ width: 420, height: 420, right: '10%', bottom: '8%' }}
        />
        <div className="relative flex h-full items-center justify-center">
          <div className="glass-read enter-up w-[520px] rounded-md p-9 text-center">
            <h1 className="t-section">보여드릴 학습 기록이 없어요</h1>
            <p className="t-body text-subtle mt-2">
              이번에 마친 세션을 찾지 못했어요. 홈 화면에서 다시 시작할 수 있어요.
            </p>
            <p className="t-help mt-1 tnum">{countdown}초 뒤 홈 화면으로 돌아갑니다.</p>
            <div className="mt-6 flex justify-center">
              <Button variant="primary" onClick={() => go('home')} data-autofocus>
                홈 화면으로 돌아가기
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const { session, topic, mate, measured, snapshot, score, tone, week, avgFocusSec, streak, relaxed } = data
  const preset = PRESETS[mate?.preset] ? mate.preset : 'mina'
  const mateName = mate?.name || PRESETS[preset].name
  const studySec = snapshot.studySec
  const focusSec = snapshot.focusSec
  const focusPct = measured && studySec > 0 ? Math.round((focusSec / studySec) * 100) : 0
  const mateLine = (MATE_LINES[tone] || MATE_LINES.neutral)[preset] || MATE_LINES.neutral.mina
  const mates = activeSeats(seats)
  const startedLabel = new Date(session.started_at).toLocaleString('ko-KR', {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  const flowSegments = measured ? buildFlowSegments(focusSec, snapshot.awaySec || 0, snapshot.awayCount || 0) : null

  const handleDownload = () => {
    const text = buildSummaryDownloadText({ startedLabel, topic, summaryText: DEMO_SESSION_REVIEW.summaryText })
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `study-summary-${session.id}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="relative min-h-full overflow-hidden bg-warm">
      {/* 존 A 배경 블롭 — 홈·엔딩만 허용 (§4-3) */}
      <div className="blob bg-sage" style={{ width: 520, height: 520, top: -190, left: -140 }} />
      <div
        className="blob blob-delayed bg-lavender"
        style={{ width: 460, height: 460, top: 260, right: -160 }}
      />

      <div className="relative mx-auto w-[1100px] px-10 pb-16 pt-10">
        {/* ══ 상단 — 캐릭터 + 말풍선, 오늘의 공부 자료 ══ */}
        <section
          aria-label="오늘의 공부"
          className="glass-read glass-spec enter-up rounded-lg overflow-hidden"
        >
          <div className="flex items-stretch gap-8 p-9">
            <div className="shrink-0 flex flex-col items-center justify-end gap-2">
              <CharacterSprite imageKey={mate?.imageKey || PRESETS[preset].imageKey} size={172} state="studying" />
              <span className="t-caption rounded-full bg-surface border border-hairline px-3 py-1">
                {mateName}
              </span>
            </div>

            <div className="min-w-0 flex-1">
              <h1 className="t-screen fade-in d1">오늘의 공부</h1>
              <div className="fade-in d2 mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 t-help">
                <span className="inline-flex items-center gap-1.5">
                  <Calendar size={14} aria-hidden="true" /> {startedLabel}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Timer size={14} aria-hidden="true" /> {fmtShort(studySec)} 함께함
                </span>
                {mates.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 min-w-0">
                    <Users size={14} aria-hidden="true" className="shrink-0" />
                    <span className="truncate">{mates.map((m) => m.name).join(', ')}와 함께</span>
                  </span>
                )}
              </div>

              <div className="fade-in d3 mt-3 min-w-0">
                <span className="t-caption text-muted">자료</span>
                <p className="t-item mt-0.5 truncate">{topic.title}</p>
              </div>

              <div className="fade-in d4 relative mt-4 max-w-[600px] rounded-md bg-peach border border-hairline px-5 py-4">
                <span
                  aria-hidden="true"
                  className="absolute -left-2 top-6 h-4 w-4 rotate-45 bg-peach border-l border-b border-hairline"
                />
                <p className="t-body relative">{mateLine}</p>
              </div>
            </div>
          </div>
        </section>

        {/* ══ 이번 학습시간 ══ */}
        <section aria-label="이번 학습시간" className="glass-read enter-up d1 mt-6 rounded-md p-6">
          <span className="t-item">이번 학습시간</span>

          <div className="mt-4 grid grid-cols-3 gap-5">
            <SummaryCard
              icon={<Timer size={16} aria-hidden="true" />}
              label="공부 시간"
              value={fmtShort(studySec)}
              hint={fmtHuman(studySec)}
            />
            <SummaryCard
              icon={<Sparkles size={16} aria-hidden="true" />}
              label="집중 시간"
              value={measured ? fmtShort(focusSec) : '측정 안 함'}
              muted={!measured}
              hint={measured ? `전체 시간의 ${focusPct}%` : '집중 감지가 꺼져 있었어요'}
            />
            <SummaryCard
              icon={<Sparkles size={16} aria-hidden="true" />}
              label="오늘의 학습 점수"
              value={score}
              unit="점"
              hint={measured ? undefined : '공부 시간만으로 계산했어요'}
            />
          </div>

          {/* 집중 흐름 바 — 초록 집중 / 코랄 이탈 구간 (비율 기반 근사치) */}
          {measured ? (
            <div className="mt-5">
              <FlowBar segments={flowSegments} on={barOn} />
              <div className="mt-2 flex items-center gap-5 t-caption">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-chart-focus" aria-hidden="true" />
                  집중 구간
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-coral" aria-hidden="true" />
                  이탈 구간
                </span>
                {relaxed && <span className="rounded-full border border-hairline px-2.5 py-0.5">완화 모드</span>}
              </div>
            </div>
          ) : (
            <div className="mt-5 flex items-center gap-4 rounded-sm bg-peach border border-hairline px-4 py-3">
              <Info size={18} className="shrink-0 text-subtle" aria-hidden="true" />
              <p className="t-body flex-1">집중 측정이 꺼져 있어 이번에는 공부 시간만 기록했어요.</p>
              <Button variant="secondary" onClick={() => openSettings('me')}>
                <Settings size={15} aria-hidden="true" />
                설정 열기
              </Button>
            </div>
          )}
        </section>

        {/* ══ 지난 기록 비교 ══ */}
        <section aria-label="지난 기록 비교" className="glass-read enter-up d2 mt-6 rounded-md p-6">
          <span className="t-item">지난 기록 비교</span>

          <div className="mt-4 grid grid-cols-[1fr_1fr_1.4fr] gap-5">
            <MiniStat
              icon={<Timer size={15} aria-hidden="true" />}
              label="최장 집중 시간"
              value={measured ? fmtShort(snapshot.bestStreakSec || 0) : '측정 안 함'}
              note={measured ? '이탈로 끊기지 않은 가장 긴 구간' : '집중 감지가 꺼져 있었어요'}
            />
            <MiniStat
              icon={<DoorOpen size={15} aria-hidden="true" />}
              label="집중 이탈 횟수"
              value={measured ? `${snapshot.awayCount || 0}회` : '측정 안 함'}
              note={measured ? '60초 이상 자리를 비운 경우만' : '집중 감지가 꺼져 있었어요'}
            />
            <div className="rounded-md border border-hairline bg-white/70 px-4 py-3.5">
              <div className="flex items-center justify-between gap-3">
                <span className="t-caption text-subtle">최근 7일 집중 시간</span>
                <div className="flex items-center gap-2">
                  <span className="t-caption rounded-full bg-sage border border-hairline px-2.5 py-1 inline-flex items-center gap-1">
                    <Flame size={12} aria-hidden="true" /> 연속 {streak}일
                  </span>
                  <span className="t-caption rounded-full bg-lavender border border-hairline px-2.5 py-1">
                    평균 {fmtShort(avgFocusSec)}
                  </span>
                </div>
              </div>
              <div className="mt-3">
                <WeekBars days={week} />
              </div>
            </div>
          </div>
        </section>

        {/* ══ 공부 내용 요약 진입 ══ */}
        <div className="mt-6 flex justify-center">
          <Button variant="secondary" onClick={() => setSummaryOpen(true)}>
            <BookOpen size={16} aria-hidden="true" />
            공부 내용 요약 보기
          </Button>
        </div>

        {/* ══ 하단 CTA ══ */}
        <div className="mt-6 flex justify-center gap-3">
          <Button variant="secondary" onClick={() => go('lobby')}>
            다시 공부하기
          </Button>
          <Button variant="primary" onClick={() => go('home')}>
            홈 화면으로 돌아가기
          </Button>
        </div>
      </div>

      {/* ══ "공부 내용 요약" 모달 — demoSessionReview 기반 UI 렌더링 테스트 ══
          왼쪽: 분야 그룹 → 개념 토글 → Markdown Viewer
          오른쪽: 심화 학습 포인트 · T/F 퀴즈 · 내용 요약 */}
      <Dialog open={summaryOpen} onClose={closeSummary} title="공부 내용 요약" width={1080} height={680}>
        <div className="flex h-full flex-col">
          <header className="flex items-center justify-between px-8 py-5 border-b border-hairline">
            <h2 className="t-section">공부 내용 요약</h2>
            <IconBtn label="닫기 (ESC)" tone="plain" onClick={closeSummary}>
              <span className="t-caption">ESC</span>
            </IconBtn>
          </header>

          <div className="flex-1 overflow-y-auto scroll-soft px-8 py-6">
            <div className="grid grid-cols-2 gap-8">
              {/* ── 왼쪽: 공부한 개념 — 분야 그룹 + 개념 토글 + Markdown Viewer ── */}
              <div>
                <h3 className="t-item mb-3">공부한 개념</h3>

                {/* 원하는 주제를 입력하면, 데모 데이터(conceptGroups)에 있는 개념을 찾아 카드로 쌓아 보여준다.
                    처음엔 입력창만 있고, 검색할 때마다 결과가 아래에 하나씩 추가된다. */}
                <div className="rounded-md border border-dashed border-hairline bg-white/50 p-3.5 mb-4">
                  <p className="t-caption text-muted mb-2">공부한 주제를 입력해보세요</p>
                  <div className="flex items-center gap-2">
                    <input
                      aria-label="공부한 주제"
                      value={topicInput}
                      onChange={(e) => setTopicInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && runTopicSearch()}
                      placeholder="예: 조건부 확률, CPU 스케줄링, BFS..."
                      className="flex-1 rounded-full border border-hairline bg-white px-4 py-1.5 t-body focus:border-coral"
                    />
                    <Button variant="secondary" onClick={runTopicSearch}>
                      <Search size={14} aria-hidden="true" />
                      확인
                    </Button>
                  </div>
                  <p className="t-help mt-2">예시로 있는 주제: {SAMPLE_TOPICS.join(' · ')}</p>
                  {notFoundQuery && (
                    <p className="t-help mt-2 text-[var(--danger)] fade-in">
                      &ldquo;{notFoundQuery}&rdquo;은 이번 데모에 없는 주제예요. 위 예시 중 하나로 확인해보세요.
                    </p>
                  )}
                </div>

                {foundConcepts.length === 0 ? (
                  <p className="t-body text-subtle">주제를 입력하면 여기에 개념 카드가 쌓여요.</p>
                ) : (
                  <div className="space-y-3">
                    {foundConcepts.map((concept) => (
                      <div key={concept.key}>
                        <span className="t-caption rounded-full bg-sage border border-hairline px-2.5 py-1 inline-block mb-1.5">
                          {concept.groupLabel}
                        </span>
                        <ConceptToggle
                          title={concept.title}
                          markdown={concept.markdown}
                          open={openConceptKey === concept.key}
                          onToggle={() => setOpenConceptKey((cur) => (cur === concept.key ? null : concept.key))}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ── 오른쪽: 심화 학습 포인트 · T/F 퀴즈 · 내용 요약 ── */}
              <div className="space-y-6">
                <div>
                  <h3 className="t-item mb-1 flex items-center gap-2">
                    <Lightbulb size={16} className="text-subtle" aria-hidden="true" />
                    심화 학습 포인트
                  </h3>
                  <p className="t-help mb-3">오늘 공부한 개념과 이어지는 다른 개념들이에요.</p>
                  <ul className="space-y-2">
                    {DEMO_SESSION_REVIEW.deepeningPoints.map((p) => (
                      <li key={p.title} className="t-body flex items-start gap-2">
                        <span className="mt-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-coral" aria-hidden="true" />
                        <span className="min-w-0 break-words">
                          <span className="font-semibold">{p.title}</span> — {p.body}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h3 className="t-item mb-3 flex items-center gap-2">
                    <HelpCircle size={16} className="text-subtle" aria-hidden="true" />
                    T/F 퀴즈
                  </h3>
                  <TrueFalseQuizCarousel quizzes={DEMO_SESSION_REVIEW.trueFalseQuizzes} />
                </div>

                <div className="rounded-md border border-hairline bg-white/70 p-4">
                  <h3 className="t-item mb-2 flex items-center gap-2">
                    <FileText size={16} className="text-subtle" aria-hidden="true" />
                    내용 요약
                  </h3>
                  <p className="t-body break-words" style={{ lineHeight: 1.7 }}>
                    {DEMO_SESSION_REVIEW.summaryText}
                  </p>
                  <div className="mt-4 flex justify-center">
                    <Button variant="secondary" onClick={handleDownload}>
                      <Download size={15} aria-hidden="true" />
                      요약 다운로드
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Dialog>
    </div>
  )
}
