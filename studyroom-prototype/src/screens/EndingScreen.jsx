/**
 * 엔딩 페이지 — 통합 설계서 §6-4 (지표 §8-1 / 폴백 §8-3 / 점수 §8-4)
 *
 * "공부 내용 요약" 모달은 **이번 세션의 실제 대화·자료**로 만든다 (lib/review.js).
 *   - 메인 화면(캐릭터 인사 · 이번 학습시간 · 지난 기록 비교)은 이전 버전과 동일하다.
 *   - 모달 왼쪽: 분야별 그룹(conceptGroups) → 개념 토글 → Markdown Viewer
 *   - 모달 오른쪽: 심화 학습 포인트(deepeningPoints) · T/F 퀴즈(trueFalseQuizzes) · 내용 요약(summaryText)
 *
 *   §처음엔 고정된 표본을 보여줬다. 사용자가 뭘 공부했든 늘 같은 개념이 떴고, 그걸 본 사람은
 *   실제로 공부한 것으로 읽는다. 이제 기록에서 만들고, 만들 게 없으면 없다고 말한다.
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
import { ensureReview } from '../lib/review'
import { parseMarkdownBlocks } from '../lib/markdown'
import {
  buildSections,
  buildMarkdown,
  buildPrintHtml,
  printAsPdf,
  downloadMarkdown,
} from '../lib/summaryDoc'
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

/*
 * 여기 하드코딩된 표본이 있었다 — 조건부 확률·베이즈 정리·Attention…
 *
 * 사용자가 뭘 공부했든 늘 같은 개념이 떴다. 시연에서는 그럴듯해 보이지만,
 * 그 목록을 본 사람은 **실제로 공부한 것**으로 읽는다. 없는 걸 있다고 보여주는 셈이었다.
 * 이제 실제 대화·자료에서 만든다 (lib/review.js). 만들 게 없으면 없다고 말한다.
 */

/** conceptGroups를 평평하게 펼친다 — 분야 라벨을 함께 들고 있는다 */
const flattenConcepts = (groups = []) =>
  (groups || []).flatMap((group) =>
    group.concepts.map((concept) => ({
      key: `${group.domain}::${concept.title}`,
      title: concept.title,
      markdown: concept.markdown,
      groupLabel: group.label,
    })),
  )

/** 인라인 `코드` 표기를 <code>로 바꿔서 렌더링한다 */
/**
 * 인라인 마크다운 — 코드와 굵게.
 *
 * 굵게가 빠져 있었다. 표본 데이터에는 `**` 가 없어서 드러나지 않았는데, 실제 모델이
 * 쓰기 시작하니 별표가 글자로 그대로 보였다. 파서를 새로 들이지 않고 두 규칙만 처리한다.
 */
function renderInline(text) {
  // 코드가 먼저다 — 코드 안의 별표는 굵게가 아니라 글자다
  return String(text)
    .split(/`([^`]+)`/g)
    .flatMap((part, i) => {
      if (i % 2 === 1) {
        return [
          <code
            key={`c${i}`}
            className="rounded-sm bg-[var(--hover-bg)] border border-hairline px-1.5 py-0.5 t-caption tnum"
          >
            {part}
          </code>,
        ]
      }
      return part.split(/\*\*([^*]+)\*\*/g).map((seg, j) =>
        j % 2 === 1 ? (
          <strong key={`b${i}-${j}`} className="font-semibold">
            {seg}
          </strong>
        ) : (
          seg
        ),
      )
    })
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
            <p
              key={i}
              className="rounded-sm bg-lavender border border-hairline px-3 py-2 t-body tnum break-words"
            >
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
function TrueFalseQuizCarousel({ quizzes = [] }) {
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState({}) // index -> boolean

  const total = quizzes.length
  const q = quizzes[index]

  /**
   * 문제가 없으면 아무것도 그리지 않는다.
   *
   * 예전에는 표본이 늘 3~4문항이라 빈 배열이 올 일이 없었다. 이제 실제 대화에서 만드니
   * 얘기가 짧으면 0문항이 나올 수 있고, 그때 q.answer 를 읽다 **화면 전체가 하얘졌다.**
   */
  if (!q) return null
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
            open
              ? 'bg-[var(--text-strong)] border-[var(--text-strong)] text-[var(--bg-warm)]'
              : 'border-hairline text-subtle',
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

/**
 * 내려받을 문서의 재료.
 *
 * 예전에는 "내용 요약" 한 문단만 담았다. 화면 왼쪽의 개념 해설이 정작 이 세션의
 * 알맹이인데 파일에는 안 들어갔다. 이제 **화면에 있는 것을 전부** 담고,
 * 한 문단짜리 요약은 맨 뒤 맺음말로 내린다.
 */
function buildSummaryDoc({ startedLabel, topic, review, focusLabel }) {
  const facts = [
    { label: '날짜', value: startedLabel },
    { label: '주제', value: topic?.title || '—' },
  ]
  if (focusLabel) facts.push({ label: '집중 시간', value: focusLabel })
  return { facts, sections: buildSections(review) }
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
          <span className={`t-caption ${d.isToday ? 'font-semibold text-strong' : 'text-muted'}`}>
            {d.weekday}
          </span>
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
  /**
   * 오늘 공부한 것 정리. 실제 기록에서 만든다 (lib/review.js).
   * 만들 게 없으면 표본을 대신 보여주지 않고 없다고 말한다.
   */
  const [review, setReview] = useState(null)
  const [reviewState, setReviewState] = useState('idle') // idle · loading · ok · empty · error
  const [reviewWhy, setReviewWhy] = useState('')

  /**
   * 요약을 가져온다. 세션당 한 번 만들고 그 뒤로는 저장된 걸 준다 —
   * 볼 때마다 내용이 달라지면 기록으로서 쓸모가 없다.
   *
   * 화면에 들어오자마자 부르지 않는다. 사용자가 "공부 내용 요약 보기"를 누르기 전에는
   * 이 패널이 보이지도 않는데, 미리 부르면 안 볼 사람 몫까지 호출한다.
   */
  const loadReview = useCallback(
    async (force = false) => {
      if (!lastSessionId) return
      if (force) db.clearReview(lastSessionId)
      setReviewState('loading')
      const r = await ensureReview(lastSessionId, seats.find((x) => x.enabled) || seats[0])
      setReview(r.review || null)
      setReviewWhy(r.why || '')
      setReviewState(r.state)
    },
    [lastSessionId, seats],
  )

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
      focusSec: k === todayK ? (measured ? snapshot.focusSec || 0 : 0) : byDate.get(k)?.total_focus_sec || 0,
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
  }, [])

  /** 요약 패널을 연다. 이때 처음으로 정리를 만든다 */
  const openSummary = useCallback(() => {
    setSummaryOpen(true)
    if (reviewState === 'idle') loadReview()
  }, [reviewState, loadReview])

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
          <div className="glass-read enter-up w-full max-w-[520px] rounded-md p-9 text-center">
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
  const flowSegments = measured
    ? buildFlowSegments(focusSec, snapshot.awaySec || 0, snapshot.awayCount || 0)
    : null

  const docTitle = `오늘의 공부 요약 — ${startedLabel}`
  const summaryDoc = () =>
    buildSummaryDoc({
      startedLabel,
      topic,
      review,
      focusLabel: measured ? fmtHuman(focusSec) : '',
    })

  const handlePdf = () => {
    const { facts, sections } = summaryDoc()
    printAsPdf({
      html: buildPrintHtml({ title: '오늘의 공부 요약', facts, sections }),
      filename: docTitle,
    })
  }

  const handleMarkdown = () => {
    const { facts, sections } = summaryDoc()
    downloadMarkdown({
      markdown: buildMarkdown({ facts, sections }),
      filename: `study-summary-${session.id}.md`,
    })
  }

  return (
    <div className="relative min-h-full overflow-hidden bg-warm">
      {/* 존 A 배경 블롭 — 홈·엔딩만 허용 (§4-3) */}
      <div className="blob bg-sage" style={{ width: 520, height: 520, top: -190, left: -140 }} />
      <div
        className="blob blob-delayed bg-lavender"
        style={{ width: 460, height: 460, top: 260, right: -160 }}
      />

      <div className="relative mx-auto w-full max-w-[1100px] px-4 sm:px-6 lg:px-10 pb-16 pt-10">
        {/* ══ 상단 — 캐릭터 + 말풍선, 오늘의 공부 자료 ══ */}
        <section
          aria-label="오늘의 공부"
          className="glass-read glass-spec enter-up rounded-lg overflow-hidden"
        >
          <div className="flex items-stretch gap-8 p-9">
            <div className="shrink-0 flex flex-col items-center justify-end gap-12">
              <CharacterSprite
                imageKey={mate?.imageKey || PRESETS[preset].imageKey}
                size={172}
                state="studying"
              />
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

              <div className="fade-in d4 relative mt-4 max-w-full sm:max-w-[600px] rounded-md bg-peach border border-hairline px-5 py-4">
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
                {relaxed && (
                  <span className="rounded-full border border-hairline px-2.5 py-0.5">완화 모드</span>
                )}
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
          <Button variant="secondary" onClick={openSummary}>
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

          <div className="flex-1 overflow-y-auto scroll-soft px-4 sm:px-8 py-4 sm:py-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
              {/* ── 왼쪽: 공부한 개념 — 분야 그룹 + 개념 토글 + Markdown Viewer ── */}
              <div>
                <h3 className="t-item mb-3">공부한 개념</h3>

                {reviewState === 'loading' && (
                  <p className="t-body text-subtle">오늘 나눈 얘기를 정리하는 중이에요…</p>
                )}

                {reviewState === 'ok' &&
                  flattenConcepts(review.conceptGroups).map((concept) => (
                    <div key={concept.key} className="mb-3">
                      <span className="t-caption bg-sage border-hairline mb-1.5 inline-block rounded-full border px-2.5 py-1">
                        {concept.groupLabel}
                      </span>
                      <ConceptToggle
                        title={concept.title}
                        markdown={concept.markdown}
                        open={openConceptKey === concept.key}
                        onToggle={() =>
                          setOpenConceptKey((cur) => (cur === concept.key ? null : concept.key))
                        }
                      />
                    </div>
                  ))}

                {/* 없으면 없다고 말한다. 표본을 대신 보여주면 그걸 오늘 공부한 걸로 읽는다 */}
                {(reviewState === 'empty' || reviewState === 'error') && (
                  <div className="border-hairline rounded-md border border-dashed p-5">
                    <p className="t-body">{reviewWhy || '정리할 내용이 아직 없어요.'}</p>
                    <p className="t-help mt-2">
                      {reviewState === 'error'
                        ? '잠시 뒤에 다시 만들어 볼 수 있어요.'
                        : '메이트와 개념을 좀 더 이야기하거나 자료를 올리면 여기에 정리돼요.'}
                    </p>
                    {reviewState === 'error' && (
                      <Button variant="secondary" className="mt-3" onClick={() => loadReview(true)}>
                        다시 만들기
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {/* ── 오른쪽: 심화 학습 포인트 · T/F 퀴즈 · 내용 요약 ── */}
              {reviewState === 'ok' && (
                <div className="space-y-6">
                  <div>
                    <h3 className="t-item mb-1 flex items-center gap-2">
                      <Lightbulb size={16} className="text-subtle" aria-hidden="true" />
                      심화 학습 포인트
                    </h3>
                    <p className="t-help mb-3">오늘 공부한 개념과 이어지는 다른 개념들이에요.</p>
                    <ul className="space-y-2">
                      {(review?.deepeningPoints || []).map((p) => (
                        <li key={p.title} className="t-body flex items-start gap-2">
                          <span
                            className="mt-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-coral"
                            aria-hidden="true"
                          />
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
                    <TrueFalseQuizCarousel quizzes={review?.trueFalseQuizzes || []} />
                  </div>

                  <div className="rounded-md border border-hairline bg-white/70 p-4">
                    <h3 className="t-item mb-2 flex items-center gap-2">
                      <FileText size={16} className="text-subtle" aria-hidden="true" />
                      내용 요약
                    </h3>
                    <p className="t-body break-words" style={{ lineHeight: 1.7 }}>
                      {review?.summaryText || ''}
                    </p>
                    {/* 내려받는 건 이 한 문단이 아니라 **위의 개념 해설까지 전부**다.
                        버튼 밑에 그렇게 적어 둔다 — 안 그러면 이 문단만 받는 줄 안다 */}
                    <div className="mt-4 flex flex-col items-center gap-2">
                      <div className="flex items-center gap-2">
                        <Button variant="secondary" onClick={handlePdf}>
                          <Download size={15} aria-hidden="true" />
                          PDF로 저장
                        </Button>
                        <Button variant="ghost" onClick={handleMarkdown}>
                          <FileText size={15} aria-hidden="true" />
                          Markdown
                        </Button>
                      </div>
                      <p className="t-caption text-subtle text-center">
                        공부한 개념 · 심화 포인트 · 퀴즈까지 한 벌로 담깁니다.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </Dialog>
    </div>
  )
}
