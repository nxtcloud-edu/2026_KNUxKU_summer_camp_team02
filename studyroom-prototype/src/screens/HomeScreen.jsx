/**
 * 홈 화면 — 통합 설계서 §6-1 (손그림 ex_04 기반 최소 정의)
 *
 * 레이아웃 (§6-1 손그림)
 *   ┌ 주간 스트립 ─────────────┬ 할일 [TBD] ┐
 *   ├ 통계 ───────────────────┼ 캐릭터 인사 ┤
 *
 * 모션 존 A (§4-4) — 홈은 배경 블롭 float 허용. 그레인·카드 기울임은 반입 목록에서 제외됐다.
 * 축 B (§1-3) — 홈은 숫자와 그래프를 본격적으로 보여주는 화면이다.
 *   다만 순위·상위 %는 엔딩 2단계 전용이라 여기서는 절대 노출하지 않는다.
 */

import { useMemo, useState } from 'react'
import { Settings, Play, Flame, Clock3, CalendarRange, ListTodo, Circle, Sparkles } from 'lucide-react'
import { useStore } from '../store/useStore'
import { db, todayKey, weekStart, daysAgoKey } from '../store/db'
import { fmtShort } from '../lib/metrics'
import { Button, CharacterSprite } from '../components/ui'

/* ── 지역 헬퍼 (§ 새 의존 파일을 만들지 않는다) ───────────────── */

const WEEKDAY = ['월', '화', '수', '목', '금', '토', '일']

/** 'YYYY-MM-DD' → Date */
function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

const dayLabel = (key) => {
  const d = parseKey(key)
  return `${d.getMonth() + 1}월 ${d.getDate()}일`
}

/** 이번 주 월~일 7일 (§5-3 주는 월요일 시작) */
function weekKeys() {
  const start = weekStart()
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return todayKey(d)
  })
}

/** 최근 7일 (오래된 → 최신) — 점수 추이 그래프용 */
const recent7Keys = () => Array.from({ length: 7 }, (_, i) => daysAgoKey(6 - i))

/**
 * 메시지 한 건이 몇 번 자리에서 나온 것인지 추정한다.
 * 스터디룸의 메시지 스키마가 아직 한 가지로 굳지 않아 후보 필드를 모두 살핀다 (§9-2 message).
 */
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

/** §6-1 [판단] 표시 캐릭터 = 최근 세션에서 가장 많이 상호작용한 자리, 없으면 1번 */
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

/**
 * 인사 한 줄 — 캐릭터는 평가자가 아니라 동료의 말투로 말한다 (§1-3 톤 관리)
 */
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

/* ── 화면 ─────────────────────────────────────────────────── */

export default function HomeScreen() {
  // 셀렉터는 필드 단위로 하나씩 구독한다 (객체를 새로 만들면 무한 렌더)
  const go = useStore((s) => s.go)
  const openSettings = useStore((s) => s.openSettings)
  const seats = useStore((s) => s.seats)
  const lastSessionId = useStore((s) => s.lastSessionId)

  const today = todayKey()
  const [selected, setSelected] = useState(today)

  // db.init()은 스토어가 이미 호출했다. 여기서는 읽기만 한다 (§9)
  const data = useMemo(() => {
    const stats = db.getDailyStats()
    const byDate = new Map(stats.map((r) => [r.date, r]))
    const todaySec = db.todayTotalSec()
    const week = weekKeys()

    // 이번 주 합계 — 오늘은 진행 중 세션을 포함한 todayTotalSec을 쓴다 (§8-1)
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
      streak: db.streakDays(), // 하루 10분 이상 (§8-4)
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

  return (
    <div className="relative min-h-full overflow-hidden bg-warm">
      {/* 존 A 배경 블롭 2개 — 홈·엔딩만 허용 (§4-4) */}
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
        {/* ── 상단 헤더 ─────────────────────────────────── */}
        {/* 기조의 nav처럼 떠 있는 유리 pill (§4-4) */}
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
            {/* 가장 눈에 띄는 진입 CTA (§6-1) — 홈 → 대기 화면 (§3-2) */}
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

        {/* ── 1행: 주간 스트립 + 할일 ────────────────────── */}
        <div className="mt-8 flex items-stretch gap-6">
          <WeekStrip
            days={data.week}
            today={today}
            selected={selected}
            onSelect={setSelected}
            byDate={data.byDate}
            todaySec={data.todaySec}
          />
          <TodoCard />
        </div>

        {/* ── 2행: 통계 + 캐릭터 인사 ────────────────────── */}
        <div className="mt-6 flex items-stretch gap-6">
          <StatsCard
            selected={selected}
            selectedIsToday={selectedIsToday}
            selectedSec={selectedSec}
            selectedScore={selectedRow?.score ?? null}
            weekSec={data.weekSec}
            streak={data.streak}
            trend={data.trend}
          />
          <GreetingCard seat={greeter} line={greeting} onStart={() => go('lobby')} />
        </div>
      </div>
    </div>
  )
}

/* ── 주간 스트립 (§6-1) ────────────────────────────────────
   오늘은 코랄 강조 + 굵게. 선택은 테두리와 밑줄 막대로도 표시한다.
   상태를 색만으로 구분하지 않는다 (§4-6). */
function WeekStrip({ days, today, selected, onSelect, byDate, todaySec }) {
  return (
    <section className="enter-up d1 flex-1 rounded-lg border border-hairline bg-surface p-7 shadow-soft">
      <div className="mb-5 flex items-center gap-2">
        <CalendarRange size={18} className="text-subtle" aria-hidden="true" />
        <h2 className="t-section">이번 주</h2>
        <span className="t-help ml-2">날짜를 누르면 아래 통계가 그날 기록으로 바뀝니다</span>
      </div>

      <div className="flex items-start justify-between gap-3">
        {days.map((key) => {
          const d = parseKey(key)
          const weekday = WEEKDAY[(d.getDay() + 6) % 7]
          const isToday = key === today
          const isFuture = key > today
          const isSelected = key === selected
          const sec = isToday ? todaySec : byDate.get(key)?.total_study_sec || 0
          const studied = sec > 0

          return (
            <div key={key} className="flex flex-1 flex-col items-center gap-2">
              <span className={['t-caption', isToday ? 'font-bold text-ink' : ''].join(' ')}>{weekday}</span>

              <button
                type="button"
                disabled={isFuture}
                aria-pressed={isSelected}
                aria-current={isToday ? 'date' : undefined}
                aria-label={[
                  `${dayLabel(key)} ${weekday}요일`,
                  isToday ? '오늘' : '',
                  isFuture ? '아직 오지 않은 날' : studied ? `학습 ${fmtShort(sec)}` : '학습 기록 없음',
                ]
                  .filter(Boolean)
                  .join(', ')}
                onClick={() => onSelect(key)}
                className={[
                  'flex h-[58px] w-[58px] items-center justify-center rounded-full border transition-all duration-300 ease-soft',
                  isFuture
                    ? 'cursor-not-allowed border-hairline bg-white text-muted opacity-55'
                    : 'hover:shadow-soft',
                  isToday
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

              {/* 학습 여부 점 — 채움/비움 모양으로도 구분된다 (§4-6) */}
              <span
                aria-hidden="true"
                className={[
                  'h-[7px] w-[7px] rounded-full',
                  studied ? 'bg-chart-focus' : 'border border-hairline bg-transparent',
                ].join(' ')}
              />

              {/* 선택 표시 — 색 외 신호 */}
              <span
                aria-hidden="true"
                className={[
                  'h-[3px] w-7 rounded-full',
                  isSelected ? 'bg-[var(--text-strong)]' : 'bg-transparent',
                ].join(' ')}
              />
              <span className="t-caption">{isToday ? '오늘' : studied ? fmtShort(sec) : '—'}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

/* ── 할일 [TBD] (§6-1 · §13-1) ────────────────────────────
   데이터 모델과 편집 UI가 미정이라 프로토타입에서는 정적 목록만 둔다. */
function TodoCard() {
  const items = ['알고리즘 문제 3개 풀기', '어제 정리한 노트 다시 읽기', '내일 퀴즈 범위 훑어보기']

  return (
    <section className="enter-up d2 w-[380px] rounded-lg border border-hairline bg-surface p-7 shadow-soft">
      <div className="mb-4 flex items-center gap-2">
        <ListTodo size={18} className="text-subtle" aria-hidden="true" />
        <h2 className="t-section">오늘의 할일</h2>
        <span className="t-caption ml-auto rounded-full bg-[var(--hover-bg)] px-2.5 py-1">TBD</span>
      </div>

      <ul className="flex flex-col gap-2.5">
        {items.map((t) => (
          <li key={t} className="flex items-center gap-2.5 rounded-sm bg-[var(--hover-bg)] px-4 py-3">
            <Circle size={15} className="shrink-0 text-muted" aria-hidden="true" />
            <span className="t-body">{t}</span>
          </li>
        ))}
      </ul>

      <p className="t-help mt-4 border-t border-hairline pt-4">
        할일 편집은 준비 중이에요. 지금은 예시 목록만 보여줍니다.
      </p>
    </section>
  )
}

/* ── 통계 (§6-1 · §8) ─────────────────────────────────────
   오늘 학습 시간 · 이번 주 합계 · 연속 학습일 · 최근 7일 점수 추이 */
function StatsCard({ selected, selectedIsToday, selectedSec, selectedScore, weekSec, streak, trend }) {
  return (
    <section className="enter-up d3 flex-1 rounded-lg border border-hairline bg-surface p-7 shadow-soft">
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

      <h3 className="t-item mt-8 mb-1">최근 7일 점수 추이</h3>
      <p className="t-help mb-2">선택한 날은 진하게 표시됩니다. 기록이 없는 날은 막대가 비어 있습니다.</p>
      <TrendChart trend={trend} selected={selected} />

      {/* 그래프를 볼 수 없는 경우를 위한 텍스트 대체 (§11) */}
      <ul className="sr-only">
        {trend.map((t) => (
          <li key={t.key}>{`${dayLabel(t.key)} ${t.score != null ? `${t.score}점` : '기록 없음'}`}</li>
        ))}
      </ul>
    </section>
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

/**
 * 인라인 SVG 막대 + 선 그래프.
 * 데이터 시각화 색은 UI 액션 색과 섞지 않는다 (§4-6) → --chart-focus / --chart-track 만 쓴다.
 */
function TrendChart({ trend, selected }) {
  const W = 660
  const H = 190
  const PAD_X = 10
  const PAD_T = 26
  const PAD_B = 34
  const slot = (W - PAD_X * 2) / trend.length
  const barW = 30
  const plotH = H - PAD_T - PAD_B
  const baseY = H - PAD_B

  const pts = trend.map((t, i) => {
    const cx = PAD_X + slot * i + slot / 2
    const score = t.score ?? null
    const h = score == null ? 0 : (Math.max(0, Math.min(100, score)) / 100) * plotH
    return { ...t, cx, h, y: baseY - h }
  })

  const line = pts.filter((p) => p.score != null)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label="최근 7일 집중 점수 추이 막대 그래프"
      style={{ height: 190 }}
    >
      <title>최근 7일 집중 점수 추이</title>

      {/* 기준선 */}
      <line x1={PAD_X} y1={baseY} x2={W - PAD_X} y2={baseY} stroke="var(--chart-track)" strokeWidth="1.5" />

      {pts.map((p) => {
        const on = p.key === selected
        return (
          <g key={p.key}>
            {/* 트랙 — 기록이 없어도 자리를 남긴다 */}
            <rect
              x={p.cx - barW / 2}
              y={baseY - plotH}
              width={barW}
              height={plotH}
              rx="8"
              fill="var(--chart-track)"
              opacity="0.45"
            />
            {p.score != null && (
              <rect
                x={p.cx - barW / 2}
                y={p.y}
                width={barW}
                height={Math.max(3, p.h)}
                rx="8"
                fill="var(--chart-focus)"
                opacity={on ? 1 : 0.42}
              />
            )}
            {/* 값 라벨 — 색 없이도 읽히도록 (§4-6) */}
            <text
              x={p.cx}
              y={p.score != null ? p.y - 9 : baseY - 9}
              textAnchor="middle"
              fontSize="12"
              fontWeight={on ? 700 : 500}
              fill={on ? 'var(--text-strong)' : 'var(--text-muted)'}
            >
              {p.score != null ? p.score : '—'}
            </text>
            {/* 요일 라벨 */}
            <text
              x={p.cx}
              y={H - 12}
              textAnchor="middle"
              fontSize="12"
              fontWeight={on ? 700 : 400}
              fill={on ? 'var(--text-strong)' : 'var(--text-muted)'}
            >
              {p.weekday}
            </text>
          </g>
        )
      })}

      {/* 추이 선 */}
      {line.length > 1 && (
        <polyline
          points={line.map((p) => `${p.cx},${p.y}`).join(' ')}
          fill="none"
          stroke="var(--chart-focus)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {line.map((p) => (
        <circle
          key={`pt-${p.key}`}
          cx={p.cx}
          cy={p.y}
          r={p.key === selected ? 5 : 3.5}
          fill="var(--surface)"
          stroke="var(--chart-focus)"
          strokeWidth="2"
        />
      ))}
    </svg>
  )
}

/* ── 캐릭터 인사 (§6-1 [판단]) ────────────────────────────
   평가자가 아니라 동료의 말투. 숫자를 앞세우지 않는다 (§1-3) */
function GreetingCard({ seat, line, onStart }) {
  if (!seat) return null

  return (
    <section className="enter-up d4 flex w-[380px] flex-col items-center rounded-lg border border-hairline bg-peach p-7 shadow-soft">
      <div className="mb-1 flex items-center gap-1.5 self-start">
        <Sparkles size={16} className="text-subtle" aria-hidden="true" />
        <h2 className="t-section">{seat.name}</h2>
      </div>
      <p className="t-help mb-4 self-start">오늘 함께 공부할 스터디 메이트</p>

      {/* 말풍선 */}
      <div className="relative w-full rounded-lg border border-hairline bg-surface px-5 py-4">
        <p className="t-body text-center">{line}</p>
        <span
          aria-hidden="true"
          className="absolute -bottom-[7px] left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-b border-r border-hairline bg-surface"
        />
      </div>

      <CharacterSprite imageKey={seat.imageKey} size={190} state="studying" className="mt-6" />

      <Button variant="primary" className="mt-6 w-full" onClick={onStart}>
        <Play size={17} /> 함께 스터디 시작
      </Button>
    </section>
  )
}
