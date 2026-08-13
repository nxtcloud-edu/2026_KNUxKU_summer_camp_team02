/**
 * 엔딩 페이지 — 통합 설계서 §6-4 (지표 §8-1 / 폴백 §8-3 / 점수 §8-4)
 *
 * 1단계 요약  : 좌측 하단 캐릭터 + 말풍선(4블록 + CTA)
 * 2단계 세부  : 화면 전체가 위로 슬라이드 (스크롤 아님) · 8개 항목 [결정 7 전부 채택]
 *
 * 모션 존 A(§4-3) — 홈·엔딩만 배경 블롭과 진입 애니메이션을 허용한다.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Settings,
  Timer,
  DoorOpen,
  TrendingUp,
  TrendingDown,
  Minus,
  Flame,
  Users,
  Trophy,
  HelpCircle,
  Lightbulb,
  Info,
} from 'lucide-react'

import { useStore } from '../store/useStore'
import { db, todayKey, daysAgoKey, weekStart } from '../store/db'
import { PRESETS } from '../lib/presets'
import { computeScore, commentTone, fmtHuman, fmtShort } from '../lib/metrics'
import { Button, CharacterSprite } from '../components/ui'

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

/* ── 지역 헬퍼 (§규칙 3: 새 의존 파일을 만들지 않는다) ────── */

/** ① 주제의 원천 — 세 갈래 분기 (§6-4 [판단]) */
function resolveTopic(session, messages) {
  const topics = Array.isArray(session.topics)
    ? session.topics.filter(Boolean)
    : session.topic
      ? [session.topic]
      : []

  // 업로드 O · 추출 성공 → 최대 2개 + "외 N건"
  if (topics.length) {
    const head = topics.slice(0, 2).join(' · ')
    const rest = topics.length - 2
    return { kind: 'topic', title: rest > 0 ? `${head} 외 ${rest}건` : head }
  }

  // 업로드 O · 추출 실패 → 파일명 그대로 (데모 단계 기본값)
  const files = messages.filter((m) => m.kind === 'file' && m.body).map((m) => m.body)
  if (files.length || session.topic_source === 'document') {
    const head = files.slice(0, 2).join(' · ') || '업로드한 자료'
    const rest = files.length - 2
    return { kind: 'file', title: rest > 0 ? `${head} 외 ${rest}건` : head }
  }

  // 업로드 X
  return { kind: 'none', title: '오늘의 공부' }
}

/** [판단] 표시 캐릭터 — 이번 세션에서 가장 많이 상호작용한 메이트, 동률이면 1번 자리 */
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

/** 이번 주(월요일 00:00 시작) 집중 시간 합계 (§8-4) */
function myWeeklyFocusSec() {
  const from = todayKey(weekStart())
  return db
    .getDailyStats()
    .filter((r) => r.date >= from)
    .reduce((a, r) => a + (r.total_focus_sec || 0), 0)
}

/* ── 2단계 카드 (§6-4 2단계) ────────────────────────────── */

function StatCard({ icon, label, period, badge, children, note, className = '', delay = '' }) {
  return (
    <div className={`glass-read enter-up ${delay} rounded-md p-5 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-subtle">
          <span aria-hidden="true">{icon}</span>
          <span className="t-item">{label}</span>
        </div>
        {badge && (
          <span className="shrink-0 rounded-full bg-lavender border border-hairline px-2.5 py-1 t-caption">
            {badge}
          </span>
        )}
      </div>
      {period && <div className="t-caption mt-1 text-muted">{period}</div>}
      <div className="mt-3">{children}</div>
      {note && <div className="t-help mt-3 pt-3 border-t border-hairline">{note}</div>}
    </div>
  )
}

/** 큰 수치 한 줄 — 값 대신 안내 문구가 들어갈 때는 크기를 줄인다 */
function Metric({ value, unit, muted }) {
  return (
    <div className={muted ? 't-section text-muted' : 't-metric tnum'}>
      {value}
      {unit && <span className="t-section ml-1 font-semibold">{unit}</span>}
    </div>
  )
}

/** 막대 하나 — 트랙 --chart-track / 채움 --chart-focus (§6-4 비교 바 색상 재정의) */
function Bar({ pct, strong }) {
  return (
    <div className="h-2.5 w-full rounded-full bg-chart-track overflow-hidden">
      <div
        className="h-full rounded-full bg-chart-focus"
        style={{
          width: `${Math.max(0, Math.min(100, pct))}%`,
          opacity: strong ? 1 : 0.55,
          transition: 'width 900ms var(--ease-soft)',
        }}
      />
    </div>
  )
}

/* ── 본체 ────────────────────────────────────────────────── */

export default function EndingScreen() {
  // 셀렉터는 필드 단위로 하나씩 구독한다
  const go = useStore((s) => s.go)
  const seats = useStore((s) => s.seats)
  const lastSessionId = useStore((s) => s.lastSessionId)
  const openSettings = useStore((s) => s.openSettings)

  const [stage, setStage] = useState(1)
  const [nearBottom, setNearBottom] = useState(false)
  const [arrowFocused, setArrowFocused] = useState(false)
  const [barOn, setBarOn] = useState(false) // 진입 후 비교 바를 늘린다 (존 A)
  const [countdown, setCountdown] = useState(5)

  const downRef = useRef(null)
  const upRef = useRef(null)
  const stage1Ref = useRef(null)
  const stage2Ref = useRef(null)
  const scrollRef = useRef(null)
  const mounted = useRef(false)

  /* 세션 로드 — 없으면 안내 후 홈으로 */
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

    // 2단계 원천
    const quiz = db.getQuizResults(session.id)
    const points = db.getStudyPoints(session.id)
    const today = db.getDaily(todayKey())
    const yesterday = db.getDaily(daysAgoKey(1))
    const peers = db.getPeers() || []
    const myWeek = myWeeklyFocusSec()

    const todayFocus = today ? today.total_focus_sec || 0 : snapshot.focusSec || 0
    const yFocus = yesterday ? yesterday.total_focus_sec || 0 : null
    const diff = yFocus == null ? null : todayFocus - yFocus

    const higher = peers.filter((p) => (p.weekly_focus_sec || 0) > myWeek).length
    const topPct = Math.max(1, Math.min(99, Math.round(((higher + 1) / (peers.length + 1)) * 100)))

    const friends = peers
      .filter((p) => p.is_friend)
      .map((p) => ({ name: p.name, sec: p.weekly_focus_sec || 0, me: false }))
    const chart = [...friends, { name: '나', sec: myWeek, me: true }].sort((a, b) => b.sec - a.sec)

    return {
      session,
      topic,
      mate,
      measured,
      snapshot,
      score,
      tone,
      quiz,
      points,
      diff,
      yFocus,
      streak: db.streakDays(),
      topPct,
      chart,
      relaxed: session.integrity === 'relaxed',
    }
  }, [lastSessionId, seats])

  /* 세션이 없을 때 — 안내 후 자동으로 홈 (§3-3) */
  useEffect(() => {
    if (data) return
    if (countdown <= 0) {
      go('home')
      return
    }
    const t = setTimeout(() => setCountdown((n) => n - 1), 1000)
    return () => clearTimeout(t)
  }, [data, countdown, go])

  /* 비교 바 진입 애니메이션 */
  useEffect(() => {
    const t = setTimeout(() => setBarOn(true), 420)
    return () => clearTimeout(t)
  }, [])

  /* 하단 화살표 — 마우스를 화면 하단으로 옮기면 fade-in (§6-4) */
  useEffect(() => {
    if (stage !== 1) return
    const onMove = (e) => setNearBottom(e.clientY > window.innerHeight - 150)
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [stage])

  /* 키보드만으로 전부 조작 가능 (§6-4 [판단] 접근성 보완 · §11)
     1단계: ↓ / PageDown / Enter → 2단계   2단계: ↑ / PageUp / Esc → 1단계 */
  useEffect(() => {
    if (!data) return
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target
      const tag = (el?.tagName || '').toLowerCase()
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || el?.isContentEditable

      if (stage === 1) {
        if (e.key === 'ArrowDown' || e.key === 'PageDown') {
          e.preventDefault()
          setStage(2)
        } else if (e.key === 'Enter' && !typing && tag !== 'button' && tag !== 'a') {
          // 버튼에 포커스가 있을 때의 Enter는 그 버튼의 것이다
          e.preventDefault()
          setStage(2)
        }
      } else {
        const atTop = (scrollRef.current?.scrollTop || 0) <= 4
        if (e.key === 'Escape') {
          e.preventDefault()
          setStage(1)
        } else if ((e.key === 'ArrowUp' || e.key === 'PageUp') && atTop && !typing) {
          e.preventDefault()
          setStage(1)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stage, data])

  /* 단계 전환 시 포커스를 따라가게 하고, 숨은 단계는 포커스에서 빼둔다 (§11) */
  useEffect(() => {
    if (stage1Ref.current) stage1Ref.current.inert = stage !== 1
    if (stage2Ref.current) stage2Ref.current.inert = stage !== 2
    if (!mounted.current) {
      mounted.current = true
      return
    }
    const t = setTimeout(() => {
      if (stage === 2) upRef.current?.focus()
      else downRef.current?.focus()
    }, 520)
    return () => clearTimeout(t)
  }, [stage])

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
          <div className="glass-read enter-up w-[520px] rounded-lg p-9 text-center">
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

  const { session, topic, mate, measured, snapshot, score, tone, relaxed } = data
  const preset = PRESETS[mate?.preset] ? mate.preset : 'mina'
  const mateName = mate?.name || PRESETS[preset].name
  const studySec = snapshot.studySec
  const focusSec = snapshot.focusSec
  const focusPct = measured && studySec > 0 ? Math.round((focusSec / studySec) * 100) : 0
  const arrowShown = nearBottom || arrowFocused

  return (
    <div className="relative h-full w-full overflow-hidden bg-warm">
      {/* 화면 전체가 위로 슬라이드된다 — 스크롤이 아니라 transform (§6-4 2단계) */}
      <div
        className="absolute inset-x-0 top-0"
        style={{
          height: '200%',
          transform: stage === 2 ? 'translateY(-50%)' : 'translateY(0)',
          transition: 'transform 720ms var(--ease-soft)',
        }}
      >
        {/* ══ 1단계 — 요약 ══════════════════════════════════ */}
        <section ref={stage1Ref} className="relative h-1/2 w-full overflow-hidden" aria-label="학습 요약">
          {/* 존 A: 배경 블롭 허용 (§4-3) */}
          <div className="blob bg-sage" style={{ width: 520, height: 520, left: '4%', top: '6%' }} />
          <div
            className="blob blob-delayed bg-lavender"
            style={{ width: 460, height: 460, right: '6%', bottom: '4%' }}
          />

          {/* 캐릭터 — 좌측 하단 고정 (§6-4) */}
          <div className="absolute left-12 bottom-8 z-10 enter-up d1 flex flex-col items-center gap-1">
            <CharacterSprite
              imageKey={mate?.imageKey || PRESETS[preset].imageKey}
              size={280}
              state="studying"
            />
            <span className="t-caption rounded-full bg-surface border border-hairline px-3 py-1">
              {mateName}
            </span>
          </div>

          {/* 말풍선 — 캐릭터를 제외한 화면 대부분 */}
          <div className="absolute left-[368px] right-16 top-14 bottom-16">
            <div className="relative h-full">
              {/* 꼬리 — 캐릭터 방향(좌측 하단). 테두리용 + 면용 삼각형 2겹 */}
              <span
                aria-hidden="true"
                className="absolute"
                style={{
                  left: -27,
                  bottom: 78,
                  width: 0,
                  height: 0,
                  borderTop: '19px solid transparent',
                  borderBottom: '19px solid transparent',
                  borderRight: '27px solid rgba(255,255,255,.8)',
                }}
              />
              <span
                aria-hidden="true"
                className="absolute"
                style={{
                  left: -25,
                  bottom: 79,
                  width: 0,
                  height: 0,
                  borderTop: '18px solid transparent',
                  borderBottom: '18px solid transparent',
                  borderRight: '25px solid rgba(255,255,255,.94)',
                }}
              />

              <div className="glass-read glass-spec enter-up flex h-full flex-col rounded-lg overflow-hidden">
                <div className="flex-1 overflow-y-auto scroll-soft px-12 py-8">
                  {/* ① 오늘 공부한 주제 (§6-4) */}
                  <div className="fade-in d1">
                    <div className="t-caption text-muted">오늘 공부한 주제</div>
                    <h1 className="t-screen mt-1">{topic.title}</h1>
                    <p className="t-help mt-1">
                      {topic.kind === 'topic' && '업로드한 자료에서 주제를 뽑아봤어요.'}
                      {topic.kind === 'file' && '자료에서 주제를 뽑지 못해 파일 이름을 그대로 적었어요.'}
                      {topic.kind === 'none' && '업로드한 자료가 없어 오늘의 공부로 기록했어요.'}
                    </p>
                  </div>

                  {/* ② 이번 공부 시간 / 이번 집중 시간 (§8-1 라벨) */}
                  <div className="fade-in d2 mt-7 pt-7 border-t border-hairline">
                    <div className="t-caption text-muted">이번 학습 시간</div>
                    <div className="mt-2 flex items-end gap-12">
                      <div>
                        <div className="t-help">이번 공부 시간</div>
                        <div className="t-section tnum mt-0.5">{fmtHuman(studySec)}</div>
                      </div>
                      <div>
                        <div className="t-help">이번 집중 시간</div>
                        <div className="t-section tnum mt-0.5">
                          {measured ? fmtHuman(focusSec) : '측정 안 함'}
                        </div>
                      </div>
                    </div>

                    {measured ? (
                      <div className="mt-4 max-w-[620px]">
                        {/* 비교 바 — 트랙=공부 시간, 채움=집중 시간. 빨간 바를 쓰지 않는다 (§6-4) */}
                        <div className="h-3.5 w-full rounded-full bg-chart-track overflow-hidden">
                          <div
                            className="h-full rounded-full bg-chart-focus"
                            style={{
                              width: `${barOn ? focusPct : 0}%`,
                              transition: 'width 1100ms var(--ease-soft)',
                            }}
                          />
                        </div>
                        <div className="mt-2 flex items-center gap-5 t-caption">
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className="inline-block h-2.5 w-2.5 rounded-full bg-chart-focus"
                              aria-hidden="true"
                            />
                            집중 시간 {focusPct}%
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className="inline-block h-2.5 w-2.5 rounded-full bg-chart-track"
                              aria-hidden="true"
                            />
                            전체 공부 시간
                          </span>
                        </div>
                      </div>
                    ) : (
                      /* §8-3 폴백 — 감지가 꺼져 있으면 비교 바를 표시하지 않는다 */
                      <div className="mt-4 flex max-w-[620px] items-center gap-4 rounded-sm bg-peach border border-hairline px-4 py-3">
                        <Info size={18} className="shrink-0 text-subtle" aria-hidden="true" />
                        <p className="t-body flex-1">집중 측정이 꺼져 있어 이번에는 공부 시간만 기록했어요</p>
                        <Button variant="secondary" onClick={() => openSettings('me')}>
                          <Settings size={15} aria-hidden="true" />
                          설정 열기
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* ③ 오늘의 학습 점수 (§8-4 문구 통일) */}
                  <div className="fade-in d3 mt-7 pt-7 border-t border-hairline">
                    <div className="t-caption text-muted">오늘의 학습 점수</div>
                    <p className="t-body mt-1">오늘 나의 집중 점수는?</p>
                    <div className="t-metric tnum mt-1">
                      {score}
                      <span className="t-section ml-1 font-semibold">점</span>
                    </div>
                    {!measured && (
                      <p className="t-help mt-1">집중 측정이 꺼져 있어 공부 시간만으로 계산한 점수예요.</p>
                    )}
                  </div>

                  {/* ④ 스터디 메이트의 한마디 — 평가자가 아니라 동료 (§1-3) */}
                  <div className="fade-in d4 mt-7 pt-7 border-t border-hairline">
                    <div className="t-caption text-muted">{mateName}의 한마디</div>
                    <p className="t-body mt-1 max-w-[720px]">
                      {(MATE_LINES[tone] || MATE_LINES.neutral)[preset] || MATE_LINES.neutral.mina}
                    </p>
                  </div>
                </div>

                {/* CTA — 말풍선 제일 하단 */}
                <div className="border-t border-hairline px-12 py-5 flex items-center justify-between">
                  <span className="t-help">아래 화살표(또는 ↓ 키)로 더 자세한 기록을 볼 수 있어요.</span>
                  <Button variant="primary" onClick={() => go('home')}>
                    홈 화면으로 돌아가기
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* 하단 화살표 — 평소 낮은 투명도, 마우스 하단 이동/포커스 시 fade-in (§6-4 [판단]) */}
          <div className="absolute inset-x-0 bottom-3 z-20 flex justify-center">
            <button
              ref={downRef}
              type="button"
              aria-label="세부 요약 보기"
              onClick={() => setStage(2)}
              onFocus={() => setArrowFocused(true)}
              onBlur={() => setArrowFocused(false)}
              className="inline-flex flex-col items-center gap-0.5 rounded-full px-5 py-2 text-subtle hover:bg-[var(--hover-bg)]"
              style={{
                opacity: arrowShown ? 1 : 0.28,
                transition: 'opacity 420ms var(--ease-soft)',
              }}
            >
              <span className="t-caption">세부 요약</span>
              <ChevronDown size={22} aria-hidden="true" />
            </button>
          </div>
        </section>

        {/* ══ 2단계 — 세부 요약 (§6-4 [결정 7] 8개 항목 전부) ══ */}
        <section ref={stage2Ref} className="relative h-1/2 w-full bg-warm" aria-label="세부 요약">
          <div ref={scrollRef} className="h-full overflow-y-auto scroll-soft">
            <div className="mx-auto w-full max-w-[1180px] px-16 pb-24 pt-10">
              <div className="flex items-start justify-between gap-6">
                <div>
                  <h2 className="t-screen">세부 요약</h2>
                  <p className="t-help mt-1">
                    {new Date(session.started_at).toLocaleString('ko-KR', {
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}{' '}
                    시작한 세션 · 총 {fmtShort(studySec)}
                  </p>
                </div>
                <button
                  ref={upRef}
                  type="button"
                  aria-label="요약 화면으로 돌아가기"
                  onClick={() => setStage(1)}
                  className="inline-flex flex-col items-center gap-0.5 rounded-full px-5 py-2 text-subtle hover:bg-[var(--hover-bg)]"
                >
                  <ChevronUp size={22} aria-hidden="true" />
                  <span className="t-caption">돌아가기 (Esc)</span>
                </button>
              </div>

              {/* ── 이 기기에서 바로 측정한 값 ── */}
              <h3 className="t-section mt-9">이번 세션 기록</h3>
              <p className="t-help mb-3">이 기기에서 이번 세션 동안 직접 측정한 값이에요.</p>

              <div className="grid grid-cols-3 gap-4">
                {/* 1 최장 집중 시간 */}
                <StatCard
                  icon={<Timer size={17} />}
                  label="최장 집중 시간"
                  delay="d1"
                  note={measured ? '이탈로 끊기지 않은 가장 긴 구간이에요.' : null}
                >
                  {measured ? (
                    <Metric value={fmtShort(snapshot.bestStreakSec || 0)} />
                  ) : (
                    <>
                      <Metric value="측정 안 함" muted />
                      <p className="t-help mt-2">집중 감지가 꺼져 있어 기록하지 않았어요.</p>
                    </>
                  )}
                </StatCard>

                {/* 2 집중 이탈 횟수 */}
                <StatCard
                  icon={<DoorOpen size={17} />}
                  label="집중 이탈 횟수"
                  delay="d2"
                  note={measured ? '60초 이상 자리를 비운 경우만 셌어요. 휴식은 빼고요.' : null}
                >
                  {measured ? (
                    <Metric value={snapshot.awayCount || 0} unit="회" />
                  ) : (
                    <>
                      <Metric value="측정 안 함" muted />
                      <p className="t-help mt-2">집중 감지가 꺼져 있어 기록하지 않았어요.</p>
                    </>
                  )}
                </StatCard>

                {/* 7 기습 질문 응답 결과 */}
                <StatCard icon={<HelpCircle size={17} />} label="기습 질문 응답 결과" delay="d3">
                  {data.quiz.length ? (
                    <>
                      <Metric
                        value={`성공 ${data.quiz.filter((q) => q.is_correct).length} / 전체 ${data.quiz.length}`}
                      />
                      <ul className="mt-3 space-y-1.5">
                        {data.quiz.slice(0, 3).map((q) => (
                          <li key={q.id} className="t-help flex items-start gap-2">
                            <span className="t-caption mt-0.5 shrink-0 rounded-full border border-hairline px-2 py-0.5">
                              {q.is_correct ? '성공' : '아쉬움'}
                            </span>
                            <span className="min-w-0 flex-1 truncate">{q.question}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p className="t-body text-subtle">이번 세션에는 기습 질문이 없었어요.</p>
                  )}
                </StatCard>

                {/* 8 심화 학습 포인트 */}
                <StatCard
                  icon={<Lightbulb size={17} />}
                  label="심화 학습 포인트"
                  delay="d4"
                  className="col-span-3"
                >
                  {data.points.length ? (
                    <ul className="grid grid-cols-2 gap-x-8 gap-y-2">
                      {data.points.map((p) => (
                        <li key={p.id} className="t-body flex items-start gap-2">
                          <span
                            className="mt-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-coral"
                            aria-hidden="true"
                          />
                          <span>
                            {p.text}
                            {p.source_doc && <span className="t-help ml-2">({p.source_doc})</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="t-body text-subtle">이번 세션에서 따로 정리된 포인트는 없었어요.</p>
                  )}
                </StatCard>
              </div>

              {/* ── 계정 기록이 있어야 보이는 값 ── */}
              <h3 className="t-section mt-10">지난 기록과 비교</h3>
              <p className="t-help mb-3">
                계정에 쌓인 학습 기록과 다른 이용자 기록이 필요한 항목이에요. 지금은 데모 데이터로 보여주고
                있어요.
              </p>

              <div className="grid grid-cols-3 gap-4">
                {/* 3 전일 대비 집중 시간 */}
                <StatCard
                  icon={<TrendingUp size={17} />}
                  label="전일 대비 집중 시간"
                  period="이번 주 기준 · 어제와 비교"
                  badge="이번 주 · 데모 데이터"
                  delay="d1"
                >
                  {!measured || data.diff == null ? (
                    <>
                      <Metric value={!measured ? '측정 안 함' : '비교할 기록 없음'} muted />
                      <p className="t-help mt-2">
                        {!measured
                          ? '집중 감지가 꺼져 있어 비교하지 않았어요.'
                          : '어제 기록이 없어 비교하지 못했어요.'}
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className={data.diff > 0 ? 'text-[var(--chart-focus)]' : 'text-muted'}
                        >
                          {data.diff > 0 ? (
                            <TrendingUp size={26} />
                          ) : data.diff < 0 ? (
                            <TrendingDown size={26} />
                          ) : (
                            <Minus size={26} />
                          )}
                        </span>
                        <span className="t-metric tnum">{fmtShort(Math.abs(data.diff))}</span>
                      </div>
                      <p className="t-body mt-1">
                        {data.diff > 0
                          ? '어제보다 더 집중했어요.'
                          : data.diff < 0
                            ? '어제보다는 조금 짧았어요.'
                            : '어제와 거의 같아요.'}
                      </p>
                      <p className="t-help mt-1 tnum">어제 집중 시간 {fmtShort(data.yFocus || 0)}</p>
                    </>
                  )}
                </StatCard>

                {/* 4 연속 학습일 */}
                <StatCard
                  icon={<Flame size={17} />}
                  label="연속 학습일"
                  period="이번 주 기준 · 오늘까지"
                  badge="이번 주 · 데모 데이터"
                  delay="d2"
                  note="하루 10분 이상 공부한 날만 셉니다."
                >
                  <Metric value={data.streak} unit="일" />
                </StatCard>

                {/* 6 전체 이용자 대비 주간 상위 % */}
                <StatCard
                  icon={<Trophy size={17} />}
                  label="전체 이용자 대비"
                  period="이번 주 기준 · 주간 집중 시간"
                  badge="이번 주 · 데모 데이터"
                  delay="d3"
                  note={relaxed ? '완화 모드로 측정해 순위 집계에서 제외됨' : null}
                >
                  <div
                    aria-hidden={relaxed ? 'true' : undefined}
                    style={relaxed ? { filter: 'blur(6px)', opacity: 0.45 } : undefined}
                  >
                    <Metric value={`상위 ${data.topPct}%`} />
                  </div>
                  {relaxed && (
                    <p className="t-body mt-2">
                      이번 세션은 순위에 넣지 않았어요. 종이책·강의 모드에서는 이탈을 세지 않기 때문이에요.
                    </p>
                  )}
                </StatCard>

                {/* 5 친구 대비 주간 비교 */}
                <StatCard
                  icon={<Users size={17} />}
                  label="친구 대비 주간 집중 시간"
                  period="이번 주 기준 (월요일 시작)"
                  badge="이번 주 · 데모 데이터"
                  delay="d4"
                  className="col-span-3"
                  note={relaxed ? '완화 모드로 측정해 순위 집계에서 제외됨' : null}
                >
                  {relaxed && (
                    <p className="t-body mb-3">
                      이번 세션은 친구 비교에서 빠졌어요. 아래 순위는 참고용으로만 흐리게 보여드려요.
                    </p>
                  )}
                  <div
                    aria-hidden={relaxed ? 'true' : undefined}
                    style={relaxed ? { filter: 'blur(5px)', opacity: 0.5 } : undefined}
                  >
                    <ul className="space-y-2.5">
                      {data.chart.map((row) => {
                        const max = Math.max(1, ...data.chart.map((r) => r.sec))
                        return (
                          <li key={row.name} className="flex items-center gap-4">
                            <span
                              className={`t-item w-20 shrink-0 ${row.me ? 'font-semibold' : 'text-subtle'}`}
                            >
                              {row.name}
                              {row.me && (
                                <span className="t-caption ml-1 rounded-full border border-hairline bg-peach px-1.5 py-0.5">
                                  나
                                </span>
                              )}
                            </span>
                            <span className="flex-1">
                              <Bar pct={barOn ? (row.sec / max) * 100 : 0} strong={row.me} />
                            </span>
                            <span className="t-caption tnum w-24 shrink-0 text-right">
                              {fmtShort(row.sec)}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                </StatCard>
              </div>

              <div className="mt-10 flex justify-center">
                <Button variant="primary" onClick={() => go('home')}>
                  홈 화면으로 돌아가기
                </Button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
