/**
 * 홈 화면 v1 — UI 수정 실험본
 */

import { useMemo, useState, useCallback } from 'react'
import {
  Settings,
  Play,
  Flame,
  Clock3,
  CalendarRange,
  ListTodo,
  Circle,
  CheckCircle2,
  X,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Send,
  Download,
  ShoppingBag,
} from 'lucide-react'
import ShopPage, { CHARACTERS } from './ShopPage'
import { useStore } from '../store/useStore'
import { db, todayKey, weekStart, daysAgoKey } from '../store/db'
import { fmtShort } from '../lib/metrics'
import { Button, CharacterSprite } from '../components/ui'

/* ── 지역 헬퍼 ───────────────────────────────────────────── */

const WEEKDAY = ['월', '화', '수', '목', '금', '토', '일']

function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

const dayLabel = (key) => {
  const d = parseKey(key)
  return `${d.getMonth() + 1}월 ${d.getDate()}일`
}

const shortLabel = (key) => {
  const d = parseKey(key)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function weekKeys() {
  const start = weekStart()
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return todayKey(d)
  })
}

const recent7Keys = () => Array.from({ length: 7 }, (_, i) => daysAgoKey(6 - i))

function toDateKey(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function slotOfMessage(m, seats) {
  const raw = m.slotNo ?? m.slot ?? m.seatNo ?? m.seat
  if (typeof raw === 'number') return raw
  const who = m.name ?? m.from ?? m.speaker ?? m.author
  if (typeof who === 'string') {
    const hit = seats.find((s) => s.name === who)
    if (hit) return hit.slotNo
  }
  return null
}

function pickGreeter(seats, lastSessionId) {
  const enabled = seats.filter((s) => s.enabled)
  const fallback =
    enabled.find((s) => s.slotNo === 1) || enabled[0] || seats.find((s) => s.slotNo === 1) || seats[0]
  if (!lastSessionId || !enabled.length) return fallback

  const count = new Map()
  for (const m of db.getMessages(lastSessionId) || []) {
    const slot = slotOfMessage(m, seats)
    if (slot != null) count.set(slot, (count.get(slot) || 0) + 1)
  }
  let best = null
  let bestN = 0
  for (const s of enabled) {
    const n = count.get(s.slotNo) || 0
    if (n > bestN) {
      best = s
      bestN = n
    }
  }
  return best || fallback
}

function greetingLine(seat, { todaySec, streak }) {
  const key = seat?.preset || 'mina'
  if (todaySec >= 600) {
    return {
      mina: `오늘 벌써 ${fmtShort(todaySec)} 했네요. 이어서 조금만 더 해볼까요?`,
      theo: `오늘 ${fmtShort(todaySec)}이나 했잖아! 한 번 더 달려볼래?`,
      juno: `${fmtShort(todaySec)} 했으면 충분히 잘했어. 더 할 거면 같이 있을게.`,
    }[key]
  }
  if (streak >= 3) {
    return {
      mina: `${streak}일째 이어지고 있어요. 오늘도 가볍게 시작해요.`,
      theo: `${streak}일 연속이야! 오늘도 가자!`,
      juno: `${streak}일째네. 안 끊기게 조금만 하자.`,
    }[key]
  }
  return {
    mina: '자리 정리해뒀어요. 준비되면 시작해요.',
    theo: '왔다! 오늘은 뭐부터 볼까?',
    juno: '왔네. 천천히 시작하면 돼.',
  }[key]
}

/* ── 학습 계획 로컬 스토리지 헬퍼 ─────────────────────────── */

function loadPlans() {
  try {
    return JSON.parse(localStorage.getItem('studyPlans') || '{}')
  } catch {
    return {}
  }
}

function savePlans(plans) {
  localStorage.setItem('studyPlans', JSON.stringify(plans))
}

function loadCompleted() {
  try {
    return JSON.parse(localStorage.getItem('studyPlansCompleted') || '{}')
  } catch {
    return {}
  }
}

function saveCompleted(completed) {
  localStorage.setItem('studyPlansCompleted', JSON.stringify(completed))
}

/* ── 화면 ─────────────────────────────────────────────────── */

export default function HomeScreen() {
  const go = useStore((s) => s.go)
  const openSettings = useStore((s) => s.openSettings)
  const seats = useStore((s) => s.seats)
  const lastSessionId = useStore((s) => s.lastSessionId)

  const today = todayKey()
  const [selected, setSelected] = useState(today)
  const [plans, setPlans] = useState(loadPlans)
  const [completed, setCompleted] = useState(loadCompleted)
  const [showShopPage, setShowShopPage] = useState(null) // null 또는 charId
  const [showPlanPopup, setShowPlanPopup] = useState(false)

  const data = useMemo(() => {
    const stats = db.getDailyStats()
    const byDate = new Map(stats.map((r) => [r.date, r]))
    const todaySec = db.todayTotalSec()
    const week = weekKeys()

    const weekSec = week.reduce((sum, k) => {
      if (k > today) return sum
      if (k === today) return sum + todaySec
      return sum + (byDate.get(k)?.total_study_sec || 0)
    }, 0)

    return {
      byDate,
      week,
      todaySec,
      weekSec,
      streak: db.streakDays(),
      trend: recent7Keys().map((k) => ({
        key: k,
        weekday: WEEKDAY[(parseKey(k).getDay() + 6) % 7],
        score: byDate.get(k)?.score ?? null,
        studySec: byDate.get(k)?.total_study_sec || 0,
      })),
    }
  }, [today])

  const greeter = useMemo(() => pickGreeter(seats, lastSessionId), [seats, lastSessionId])
  const greeting = greetingLine(greeter, { todaySec: data.todaySec, streak: data.streak })

  const selectedRow = data.byDate.get(selected) || null
  const selectedIsToday = selected === today
  const selectedSec = selectedIsToday ? data.todaySec : selectedRow?.total_study_sec || 0

  const updatePlans = useCallback((newPlans) => {
    setPlans(newPlans)
    savePlans(newPlans)
  }, [])

  const updateCompleted = useCallback((newCompleted) => {
    setCompleted(newCompleted)
    saveCompleted(newCompleted)
  }, [])

  const toggleComplete = (idx) => {
    const key = today
    const current = completed[key] || []
    const next = current.includes(idx) ? current.filter((i) => i !== idx) : [...current, idx]
    updateCompleted({ ...completed, [key]: next })
  }

  const selectedPlans = plans[selected] || []
  const selectedCompleted = completed[selected] || []

  // 수정사항 4: 상점 페이지 표시
  if (showShopPage !== null) {
    return (
      <ShopPage
        onBack={() => setShowShopPage(null)}
        initialCharId={showShopPage === true ? null : showShopPage}
      />
    )
  }

  return (
    <div className="relative min-h-full overflow-hidden bg-warm">
      {/* 존 A 배경 블롭 2개 */}
      <div
        className="blob bg-sage"
        style={{ width: 520, height: 520, top: -190, left: -140 }}
        aria-hidden="true"
      />
      <div
        className="blob blob-delayed bg-lavender"
        style={{ width: 460, height: 460, top: 300, right: -160 }}
        aria-hidden="true"
      />

      <div className="relative mx-auto w-[1240px] px-10 pb-16 pt-10">
        {/* ── 상단 헤더 ── */}
        <header className="glass glass-spec enter-up mb-10 flex items-center justify-between rounded-full py-4 pl-8 pr-4">
          <div className="flex items-baseline gap-3">
            <span className="h-6 w-6 shrink-0 self-center rounded-full bg-coral" aria-hidden="true" />
            <h1 className="t-section">AI 스터디룸</h1>
            <p className="t-help">
              {dayLabel(today)} {WEEKDAY[(parseKey(today).getDay() + 6) % 7]}요일 · 혼자 공부하지만 혼자가
              아닌 시간
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={() => openSettings('me')}>
              <Settings size={18} /> 설정
            </Button>
            <Button
              variant="primary"
              onClick={() => go('lobby')}
              style={{
                fontSize: 17,
                fontWeight: 600,
                paddingLeft: 32,
                paddingRight: 32,
                paddingTop: 14,
                paddingBottom: 14,
              }}
            >
              <Play size={19} /> 스터디 시작
            </Button>
          </div>
        </header>

        {/* ── 1행: 할일 + 주간 스트립 ── */}
        <div className="mt-8 flex items-stretch gap-6">
          <TodoCard
            selected={selected}
            today={today}
            selectedPlans={selectedPlans}
            selectedCompleted={selectedCompleted}
            onToggle={toggleComplete}
          />
          <WeekStrip
            days={data.week}
            today={today}
            selected={selected}
            onSelect={setSelected}
            byDate={data.byDate}
            todaySec={data.todaySec}
            plans={plans}
            completed={completed}
            onOpenPlan={() => setShowPlanPopup(true)}
          />
        </div>

        {/* ── 2행: 통계 (2/3 너비) + 상점 카드 (1/3 너비) ── */}
        <div className="relative z-0 mt-6 flex items-stretch gap-6">
          <StatsCard
            selected={selected}
            selectedIsToday={selectedIsToday}
            selectedSec={selectedSec}
            selectedScore={selectedRow?.score ?? null}
            weekSec={data.weekSec}
            streak={data.streak}
            trend={data.trend}
          />
          <ShopCard onGoShop={() => setShowShopPage(true)} onGoChar={(charId) => setShowShopPage(charId)} />
        </div>

        {/* ── 하단 인사 텍스트 ── */}
        {greeter && (
          <p className="t-help mt-10 text-center">
            {greeter.name}: &ldquo;{greeting}&rdquo;
          </p>
        )}
      </div>

      {/* PlanPopup을 최상위에서 렌더 — z-index 문제 근본 해결 */}
      {showPlanPopup && (
        <PlanPopup onClose={() => setShowPlanPopup(false)} plans={plans} onUpdatePlans={updatePlans} />
      )}
    </div>
  )
}

/* ── 학습 계획 팝업 (수정사항 1: 하단 잘림 수정 — overflow visible, 패딩 확보) ── */

function PlanPopup({ onClose, plans, onUpdatePlans }) {
  const now = new Date()
  const [viewYear, setViewYear] = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth())
  const [selectedDate, setSelectedDate] = useState(null)
  const [draft, setDraft] = useState('')

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const firstDayOfWeek = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7

  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewYear(viewYear - 1)
      setViewMonth(11)
    } else setViewMonth(viewMonth - 1)
  }
  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewYear(viewYear + 1)
      setViewMonth(0)
    } else setViewMonth(viewMonth + 1)
  }

  const dateKey = selectedDate ? toDateKey(new Date(viewYear, viewMonth, selectedDate)) : null
  const currentPlans = dateKey ? plans[dateKey] || [] : []

  const addPlan = () => {
    if (!draft.trim() || !dateKey) return
    const updated = { ...plans, [dateKey]: [...currentPlans, draft.trim()] }
    onUpdatePlans(updated)
    setDraft('')
  }

  const removePlan = (idx) => {
    if (!dateKey) return
    const arr = [...currentPlans]
    arr.splice(idx, 1)
    const updated = { ...plans, [dateKey]: arr }
    onUpdatePlans(updated)
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" onClick={onClose}>
      {/* 수정사항 1: pb-10으로 하단 여유 확보, overflow-hidden 제거 */}
      <div
        className="relative flex w-[860px] flex-col rounded-lg border border-hairline bg-surface p-8 pb-10 shadow-soft"
        style={{ height: 560 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* X 버튼 */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 rounded-full p-1 transition-colors duration-300 hover:bg-[var(--hover-bg)]"
          aria-label="닫기"
        >
          <X size={20} />
        </button>

        <h2 className="t-section mb-6">이번 달 학습 계획</h2>

        <div className="flex flex-1 min-h-0 gap-6">
          {/* 달력 */}
          <div className={`${selectedDate ? 'w-[380px]' : 'w-full'} transition-all duration-300`}>
            <div className="mb-4 flex items-center justify-between">
              <button
                type="button"
                onClick={prevMonth}
                className="rounded-full p-1 hover:bg-[var(--hover-bg)]"
              >
                <ChevronLeft size={18} />
              </button>
              <span className="t-item font-semibold">
                {viewYear}년 {viewMonth + 1}월
              </span>
              <button
                type="button"
                onClick={nextMonth}
                className="rounded-full p-1 hover:bg-[var(--hover-bg)]"
              >
                <ChevronRight size={18} />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 mb-2">
              {WEEKDAY.map((w) => (
                <div key={w} className="t-caption text-center py-1">
                  {w}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-2">
              {Array.from({ length: firstDayOfWeek }, (_, i) => (
                <div key={`empty-${i}`} />
              ))}
              {Array.from({ length: daysInMonth }, (_, i) => {
                const day = i + 1
                const key = toDateKey(new Date(viewYear, viewMonth, day))
                const hasPlan = (plans[key] || []).length > 0
                const isSelected = selectedDate === day

                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => setSelectedDate(day)}
                    className={[
                      'flex h-10 w-full items-center justify-center rounded-md text-sm transition-colors duration-200',
                      isSelected
                        ? 'bg-coral font-bold text-ink'
                        : hasPlan
                          ? 'bg-sage/50 hover:bg-sage'
                          : 'hover:bg-[var(--hover-bg)]',
                    ].join(' ')}
                  >
                    {day}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 계획 작성 패널 */}
          {selectedDate && (
            <div className="flex flex-1 flex-col border-l border-hairline pl-6 min-h-0">
              <h3 className="t-item font-semibold mb-3">
                {viewMonth + 1}월 {selectedDate}일 학습 계획
              </h3>

              <div className="flex-1 overflow-y-auto min-h-0">
                {currentPlans.length > 0 ? (
                  <ul className="flex flex-col gap-2">
                    {currentPlans.map((p, idx) => (
                      <li
                        key={idx}
                        className="flex items-center gap-2 rounded-sm bg-[var(--hover-bg)] px-3 py-2"
                      >
                        <span className="t-body flex-1">{p}</span>
                        <button
                          type="button"
                          onClick={() => removePlan(idx)}
                          className="text-muted hover:text-danger transition-colors"
                          aria-label="삭제"
                        >
                          <X size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="t-help">아직 작성한 계획이 없어요.</p>
                )}
              </div>

              {/* 입력창 하단 고정 */}
              <div className="flex gap-2 items-center mt-3 pt-3 border-t border-hairline shrink-0">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addPlan()
                    }
                  }}
                  placeholder="학습 계획을 입력하세요"
                  className="flex-1 rounded-md border border-hairline bg-white px-3 py-1.5 text-sm"
                />
                <button
                  type="button"
                  onClick={addPlan}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-hairline bg-coral transition-colors hover:bg-coral/80"
                  aria-label="추가"
                >
                  <Send size={13} className="text-ink" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── 주간 스트립 ──────────────────────────────────────────── */

function WeekStrip({ days, today, selected, onSelect, byDate, todaySec, plans, completed, onOpenPlan }) {
  return (
    <section className="enter-up d1 flex-1 rounded-lg border border-hairline bg-surface p-7 shadow-soft">
      <div className="mb-5 flex items-center gap-2">
        <CalendarRange size={18} className="text-subtle" aria-hidden="true" />
        <h2 className="t-section">이번 주</h2>
        <span className="t-help ml-2">날짜를 누르면 아래 통계가 그날 기록으로 바뀝니다</span>
        <button
          type="button"
          onClick={onOpenPlan}
          className="ml-auto rounded-full border border-hairline px-3 py-1 t-caption transition-colors duration-300 hover:bg-[var(--hover-bg)]"
        >
          학습 계획
        </button>
      </div>

      <div className="flex items-start justify-between gap-3">
        {days.map((key) => {
          const d = parseKey(key)
          const weekday = WEEKDAY[(d.getDay() + 6) % 7]
          const isToday = key === today
          const isFuture = key > today
          const isSelected = key === selected

          const dayPlans = plans[key] || []
          const dayCompleted = completed[key] || []
          const hasPlan = dayPlans.length > 0
          const allDone = hasPlan && dayPlans.every((_, idx) => dayCompleted.includes(idx))

          return (
            <div key={key} className="flex flex-1 flex-col items-center gap-2">
              <span className={['t-caption', isToday ? 'font-bold text-ink' : ''].join(' ')}>{weekday}</span>

              <button
                type="button"
                disabled={isFuture}
                aria-pressed={isSelected}
                aria-current={isToday ? 'date' : undefined}
                onClick={() => onSelect(key)}
                className={[
                  'flex h-[58px] w-[58px] items-center justify-center rounded-full border transition-all duration-300 ease-soft',
                  isFuture
                    ? 'cursor-not-allowed border-hairline bg-white text-muted opacity-55'
                    : 'hover:shadow-soft',
                  allDone
                    ? 'border-green-500 bg-green-100 font-bold text-ink'
                    : isToday
                      ? 'border-[var(--text-dark)] bg-coral font-bold text-ink'
                      : isSelected
                        ? 'border-[var(--text-strong)] bg-peach font-semibold text-ink'
                        : !isFuture
                          ? 'border-hairline bg-white text-subtle hover:bg-[var(--hover-bg)]'
                          : '',
                ].join(' ')}
              >
                <span className="tnum text-[17px]">{d.getDate()}</span>
              </button>

              {hasPlan ? (
                <span className="t-caption text-center truncate max-w-[70px]" title={dayPlans.join(', ')}>
                  {dayPlans.length}개 계획
                </span>
              ) : (
                <span className="t-caption">—</span>
              )}

              <span
                aria-hidden="true"
                className={[
                  'h-[3px] w-7 rounded-full',
                  isSelected ? 'bg-[var(--text-strong)]' : 'bg-transparent',
                ].join(' ')}
              />
            </div>
          )
        })}
      </div>
    </section>
  )
}

/* ── 할일 카드 (수정사항 2: 3개 초과 시 스크롤) ──────────────── */

function TodoCard({ selected, today, selectedPlans, selectedCompleted, onToggle }) {
  const isToday = selected === today

  return (
    <section className="enter-up d2 flex w-[380px] flex-col rounded-lg border border-hairline bg-surface p-7 shadow-soft">
      <div className="mb-4 flex items-center gap-2">
        <ListTodo size={18} className="text-subtle" aria-hidden="true" />
        <h2 className="t-section">{isToday ? '오늘의 할일' : `${shortLabel(selected)}의 계획`}</h2>
      </div>

      {selectedPlans.length > 0 ? (
        /* 수정사항 2: max-h로 3개까지만 보이고 초과 시 스크롤 */
        <ul className="flex flex-col gap-2.5 overflow-y-auto" style={{ maxHeight: 168 }}>
          {selectedPlans.map((item, idx) => {
            const done = selectedCompleted.includes(idx)
            return (
              <li
                key={idx}
                className="flex items-center gap-2.5 rounded-sm bg-[var(--hover-bg)] px-4 py-3 shrink-0"
              >
                {isToday ? (
                  <button
                    type="button"
                    onClick={() => onToggle(idx)}
                    className="shrink-0"
                    aria-label={done ? '완료 취소' : '완료 처리'}
                  >
                    {done ? (
                      <CheckCircle2 size={18} className="text-green-500" />
                    ) : (
                      <Circle size={18} className="text-muted" />
                    )}
                  </button>
                ) : (
                  <span className="shrink-0">
                    <Circle size={18} className="text-muted opacity-40" />
                  </span>
                )}
                <span className={`t-body ${isToday && done ? 'line-through text-muted' : ''}`}>{item}</span>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="t-help">
          {isToday
            ? '아직 오늘의 학습 계획이 없어요. 주간 스트립의 \u2018학습 계획\u2019 버튼에서 추가해보세요.'
            : '이 날의 학습 계획이 없어요.'}
        </p>
      )}
    </section>
  )
}

/* ── 통계 (수정사항 3: 너비 2/3) ──────────────────────────── */

function StatsCard({ selected, selectedIsToday, selectedSec, selectedScore, weekSec, streak, trend }) {
  const [reviewPopup, setReviewPopup] = useState(null)

  return (
    <section
      className="enter-up d3 rounded-lg border border-hairline bg-surface p-7 shadow-soft relative"
      style={{ width: '70%' }}
    >
      <div className="mb-5 flex items-center gap-2">
        <Clock3 size={18} className="text-subtle" aria-hidden="true" />
        <h2 className="t-section">통계</h2>
        <span className="t-help ml-2">{selectedIsToday ? '오늘 기준' : `${dayLabel(selected)} 기준`}</span>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Metric
          label={selectedIsToday ? '오늘 학습 시간' : `${dayLabel(selected)} 학습 시간`}
          value={selectedSec > 0 ? fmtShort(selectedSec) : '기록 없음'}
          sub={selectedScore != null ? `집중 점수 ${selectedScore}점` : '점수 기록 없음'}
        />
        <Metric label="이번 주 합계" value={fmtShort(weekSec)} sub="월요일부터 오늘까지" />
        <Metric
          label="연속 학습일"
          value={`${streak}일`}
          sub="하루 10분 이상 기준"
          icon={<Flame size={18} className="text-[var(--chart-focus)]" aria-hidden="true" />}
        />
      </div>

      {/* "더 공부하기" 항목 */}
      <h3 className="t-item mt-8 mb-1 flex items-center gap-2">
        <BookOpen size={16} className="text-subtle" />더 공부하기
      </h3>
      <p className="t-help mb-3">지난 일주일의 학습 기록을 카드로 확인할 수 있어요.</p>

      <div className="grid grid-cols-4 gap-3">
        {trend
          .slice()
          .reverse()
          .slice(0, 7)
          .map((t, idx) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setReviewPopup(t)}
              className="rounded-md border border-hairline bg-[var(--hover-bg)] px-3 py-3 text-left transition-colors duration-200 hover:bg-white hover:shadow-soft"
            >
              <div className="t-caption">{dayLabel(t.key)}</div>
              <div className="t-item mt-1">
                {t.weekday}
                {idx === 0 ? ' (오늘)' : ''}
              </div>
            </button>
          ))}
      </div>

      {reviewPopup && <ReviewPopup item={reviewPopup} onClose={() => setReviewPopup(null)} />}
    </section>
  )
}

/* ── 상점 카드 (캐릭터 미리보기 포함) ─────────────────────── */

function ShopCard({ onGoShop, onGoChar }) {
  // 각 섹션에서 첫 캐릭터 하나씩 미리보기
  const previews = [CHARACTERS.collab[0], CHARACTERS.cute[0], CHARACTERS.popular[0]]

  return (
    <section
      className="enter-up d4 flex flex-col rounded-lg border border-hairline bg-surface p-7 shadow-soft"
      style={{ width: '30%' }}
    >
      <div className="mb-4 flex items-center gap-2">
        <ShoppingBag size={18} className="text-subtle" aria-hidden="true" />
        <h2 className="t-section">상점</h2>
      </div>

      {/* 세 칸: 각 칸에 캐릭터 미리보기. 실선이 카드 양끝에 닿지 않음 */}
      <div className="flex flex-1 flex-col">
        {previews.map((char, idx) => (
          <div key={char.id} className="flex flex-1 flex-col">
            {idx > 0 && <div className="mx-4 border-t border-hairline" />}
            <button
              type="button"
              onClick={() => onGoChar(char.id)}
              className="flex flex-1 items-center gap-3 px-2 py-2 rounded-md transition-colors hover:bg-[var(--hover-bg)]"
            >
              {/* 캐릭터 이미지 플레이스홀더 (회색 네모) */}
              <div className="h-10 w-10 shrink-0 rounded-md bg-gray-200" />
              <div className="text-left min-w-0">
                <div className="t-item truncate">{char.name}</div>
                <div className="t-caption truncate">{char.desc}</div>
              </div>
            </button>
          </div>
        ))}
      </div>

      {/* 더 알아보기 버튼 (우하단) */}
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={onGoShop}
          className="rounded-full border border-hairline px-3 py-1 t-caption transition-colors duration-300 hover:bg-[var(--hover-bg)]"
        >
          더 알아보기
        </button>
      </div>
    </section>
  )
}

/* ── 더 공부하기 팝업 ─────────────────────────────────────── */

function ReviewPopup({ item, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div
        className="relative w-[480px] rounded-lg border border-hairline bg-surface p-8 shadow-soft"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 rounded-full p-1 transition-colors duration-300 hover:bg-[var(--hover-bg)]"
          aria-label="닫기"
        >
          <X size={20} />
        </button>

        <h2 className="t-section mb-2">
          {dayLabel(item.key)} ({item.weekday}) 복습
        </h2>

        <div className="mt-4 rounded-sm border border-hairline bg-[var(--hover-bg)] px-5 py-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="t-item font-semibold">공부 종료 후 요약</h3>
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white border border-hairline shadow-sm transition-colors hover:bg-[var(--hover-bg)]"
              aria-label="PDF 다운로드"
              title="PDF 다운로드"
            >
              <Download size={15} className="text-ink" />
            </button>
          </div>
          {item.studySec > 0 ? (
            <p className="t-body">이 날의 학습 요약 PDF를 다운로드할 수 있습니다.</p>
          ) : (
            <p className="t-help">이 날은 학습 기록이 없습니다.</p>
          )}
        </div>

        <div className="mt-4 rounded-sm border border-hairline bg-[var(--hover-bg)] px-5 py-4">
          <h3 className="t-item font-semibold mb-2">심화 학습 포인트</h3>
          {item.studySec > 0 ? (
            <ul className="flex flex-col gap-1.5">
              <li className="t-body">• 핵심 개념을 다시 정리해보세요.</li>
              <li className="t-body">• 관련된 예제를 추가로 풀어보면 좋겠어요.</li>
            </ul>
          ) : (
            <p className="t-help">학습 기록이 없어 심화 포인트를 제공할 수 없어요.</p>
          )}
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value, sub, icon }) {
  return (
    <div className="rounded-sm border border-hairline bg-[var(--hover-bg)] px-5 py-4">
      <div className="t-caption flex items-center gap-1.5">
        {icon}
        {label}
      </div>
      <div className="tnum mt-1 text-[28px] font-bold leading-9 text-strong">{value}</div>
      <div className="t-help mt-0.5">{sub}</div>
    </div>
  )
}
