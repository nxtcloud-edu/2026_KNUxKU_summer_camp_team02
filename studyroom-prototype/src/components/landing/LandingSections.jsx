/**
 * 랜딩 첫 화면 아래로 이어지는 소개 섹션 (스크롤 시 등장)
 *
 * 첫 화면(StudyPreview + BrandPanel)은 그대로 두고, 그 아래에 서비스 설명을 얹는다.
 * 랜딩 기획서 §1의 "한 화면 중심"은 **첫 화면**에 대한 규칙이라 그대로 지켰다 —
 * 여기는 이미 스크롤을 내린 사람, 즉 더 알고 싶은 사람만 보는 영역이다.
 *
 * 새 CSS를 만들지 않는다. 등장 효과는 tailwind.config.js에 이미 있는 ease-soft +
 * opacity/translate 토글로 끝내고, 색·라운드·그림자는 전부 §4 토큰(index.css)만 쓴다.
 *
 * 코랄(--accent-coral #ffb7b2)은 밝아서 작은 글씨에 쓰면 배경과 붙어 읽히지 않는다.
 * BrandPanel이 92px 워드마크에만 쓰는 것과 같은 이유로, 여기서도 코랄은 선·점 같은
 * 장식에만 두고 본문·라벨은 text-subtle/text-muted 로 간다.
 */
import { useEffect, useRef, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { PRESET_ORDER, PRESETS } from '../../lib/presets'
import { CharacterSprite } from '../ui'
import { Button } from '../ui'

/* ── 스크롤 등장 ──────────────────────────────────────────
 * 한 번 보이면 관찰을 끊는다. 다시 위로 스크롤했을 때 또 사라졌다 나타나면
 * 읽던 사람을 방해한다 [1장 §9 "큰 움직임이 공부를 방해해서는 안 된다"와 같은 취지].
 */
const prefersReduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

function useReveal() {
  const ref = useRef(null)
  // 모션을 줄이는 설정이면 처음부터 보인 상태로 시작한다. 효과 안에서 setState 하면
  // 첫 렌더 직후 리렌더가 한 번 더 도는데, 그건 관찰자를 붙일 이유조차 없는 경우다.
  const [shown, setShown] = useState(prefersReduced)

  useEffect(() => {
    const el = ref.current
    if (!el || prefersReduced()) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true)
          io.disconnect()
        }
      },
      { threshold: 0.08, rootMargin: '0px 0px -10% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return [ref, shown]
}

function Reveal({ children, delay = 0, className = '' }) {
  const [ref, shown] = useReveal()
  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-soft ${
        shown ? 'translate-y-0 opacity-100' : 'translate-y-5 opacity-0'
      } ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  )
}

/* ── 공통 조각 ───────────────────────────────────────── */

function Band({ children, className = '', ...rest }) {
  return (
    <section className={`px-10 py-28 ${className}`} {...rest}>
      <div className="mx-auto w-full max-w-[1240px]">{children}</div>
    </section>
  )
}

/** 섹션 머리말. 코랄은 짧은 선으로만 쓴다 (작은 글씨에 쓰면 안 읽힌다) */
function Eyebrow({ children, onDark = false }) {
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden="true" className="h-px w-8 bg-coral" />
      <span
        className={`font-mono text-[11px] uppercase tracking-[0.16em] ${
          onDark ? 'text-white/55' : 'text-muted'
        }`}
      >
        {children}
      </span>
    </div>
  )
}

function Card({ children, className = '' }) {
  return (
    <div
      className={`rounded-lg border border-hairline bg-surface p-7 transition-all duration-500 ease-soft hover:-translate-y-0.5 hover:shadow-soft ${className}`}
    >
      {children}
    </div>
  )
}

/* ── 1. 왜 만들었나 ──────────────────────────────────── */

const CONTRAST = [
  {
    label: '함께 공부하는 서비스',
    title: '같이 있지만, 내 공부는 모른다',
    body: '화상 스터디는 실시간으로 잘 연결됩니다. 다만 옆에 앉은 사람은 내 목표도, 내가 어디서 막혔는지도 모릅니다. 존재감은 주지만 맥락은 주지 못합니다.',
  },
  {
    label: 'AI 튜터',
    title: '답은 정확하지만, 내가 물어야 열린다',
    body: '질문하면 정확하게 답합니다. 하지만 먼저 말을 걸지 않고, 창을 닫으면 사라집니다. 공부하는 90분 동안 곁에 있어 주지는 않습니다.',
  },
  {
    label: 'Alongside',
    title: '곁에 있으면서, 목표를 기억한다',
    body: '세션 시작에 적은 목표를 기억했다가 나중에 되묻습니다. 자리를 오래 비우면 묻지 않아도 먼저 말을 겁니다. 그리고 대부분의 시간에는 아무 말도 하지 않습니다.',
  },
]

function WhySection() {
  return (
    <Band>
      <Reveal>
        <div className="max-w-[62ch]">
          <Eyebrow>왜 만들었나</Eyebrow>
          <h2 className="t-screen mt-5 text-balance">
            사람은 있는데 반응이 없거나,
            <br />
            반응은 있는데 먼저 말하지 않거나.
          </h2>
        </div>
      </Reveal>

      <div className="mt-14 grid grid-cols-3 gap-4">
        {CONTRAST.map((c, i) => (
          <Reveal key={c.label} delay={i * 90}>
            <Card className="h-full">
              <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">{c.label}</div>
              <h3 className="t-section mt-3">{c.title}</h3>
              <p className="t-body mt-3 text-subtle">{c.body}</p>
            </Card>
          </Reveal>
        ))}
      </div>
    </Band>
  )
}

/* ── 2. 스터디 메이트 ────────────────────────────────── */

const TINTS = { mina: 'bg-sage', theo: 'bg-lavender', juno: 'bg-peach' }
const MATE_STATE = { mina: 'reading', theo: 'typing', juno: 'writing' }

/** 말투 T1~T4 중 이 자리에 배정된 것 + 담당 기능. presets.js 의 tone 값을 그대로 읽는다 */
const TONE_LABEL = { T1: '차분함', T2: '장난스러움', T3: '다정함', T4: '끈질김' }
const MATE_FN = {
  mina: ['F1 개념 해설', 'F6 심화 해설'],
  theo: ['F3 인출 점검', 'F5 페이스 케어'],
  juno: ['F2 구조 정리', 'F4 목표 추적'],
}
const MATE_NOTE = {
  mina: '말수가 적고, 생각을 마친 다음에 입을 엽니다.',
  theo: '침묵이 길어지면 먼저 말을 거는 쪽입니다.',
  juno: '숫자로 말하고, 한 번 물은 건 답을 받습니다.',
}

function MateCard({ presetKey }) {
  const p = PRESETS[presetKey]
  return (
    <Card className="flex h-full flex-col">
      <div className="flex items-center gap-4">
        <div
          className={`flex h-[72px] w-[72px] shrink-0 items-end justify-center overflow-hidden rounded-md ${TINTS[presetKey]}`}
        >
          <CharacterSprite imageKey={p.imageKey} state={MATE_STATE[presetKey]} size={72} />
        </div>
        <div>
          <div className="t-section">{p.name}</div>
          <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted">{p.archetype}</div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-1.5">
        <span className="rounded-full bg-peach px-2.5 py-1 font-mono text-[11px] text-subtle">
          {p.tone} {TONE_LABEL[p.tone]}
        </span>
        {MATE_FN[presetKey].map((f) => (
          <span
            key={f}
            className="rounded-full border border-hairline px-2.5 py-1 font-mono text-[11px] text-subtle"
          >
            {f}
          </span>
        ))}
      </div>

      <p className="t-body mt-4 text-subtle">
        {p.blurb} {MATE_NOTE[presetKey]}
      </p>
    </Card>
  )
}

function MatesSection() {
  return (
    <Band className="bg-[color:var(--hover-bg)]">
      <Reveal>
        <div className="max-w-[62ch]">
          <Eyebrow>스터디 메이트</Eyebrow>
          <h2 className="t-screen mt-5 text-balance">세 자리, 세 사람</h2>
          <p className="t-body mt-4 text-subtle">
            성격은 <b className="text-ink">말투</b>만 정합니다. 무엇을 할지는 기능이 정하고, 어떻게 말할지는
            성격이 정합니다. 그래서 성격을 바꿔도 목표를 되묻는 행위 자체는 사라지지 않습니다.
          </p>
        </div>
      </Reveal>

      <div className="mt-14 grid grid-cols-3 gap-4">
        {PRESET_ORDER.map((key, i) => (
          <Reveal key={key} delay={i * 90}>
            <MateCard presetKey={key} />
          </Reveal>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <Reveal delay={60}>
          <Card className="h-full">
            <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">말투 T1 – T4</div>
            <h3 className="t-section mt-3">같은 말도 누가 하느냐에 따라 다르게 들립니다</h3>
            <p className="t-body mt-3 text-subtle">
              차분함 · 장난스러움 · 다정함 · 끈질김. 설정에서 바꾸면 되묻는 <i>문장</i>만 바뀌고, 되묻는{' '}
              <i>행위</i>는 유지됩니다.
            </p>
          </Card>
        </Reveal>
        <Reveal delay={140}>
          <Card className="h-full">
            <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">기본값은 침묵</div>
            <h3 className="t-section mt-3">아무도 말하지 않는 시간이 정상입니다</h3>
            <p className="t-body mt-3 text-subtle">
              한 번에 말하는 사람은 최대 한 명이고, 대부분의 순간에는 아무도 말하지 않습니다. 확신이 없으면
              개입하지 않습니다. 잘못 끼어드는 것보다 조용한 편이 항상 낫습니다.
            </p>
          </Card>
        </Reveal>
      </div>
    </Band>
  )
}

/* ── 3. 기능 F1 – F6 ─────────────────────────────────── */

const FUNCTIONS = [
  [
    'F1',
    '개념 해설',
    '막힌 곳만 두세 문장으로 뚫습니다. 이해시키는 게 아니라 다시 앉게 만드는 것이 목적입니다.',
  ],
  ['F2', '구조 정리', '흩어진 내용을 다섯 줄 안으로 압축합니다. 새 개념을 더하지 않고 준 것만 재배열합니다.'],
  [
    'F3',
    '인출 점검',
    '방향이 반대인 유일한 기능. 목표 범위 안에서 질문을 하나 던지고, 답이 오면 한 문장으로 판정합니다.',
  ],
  [
    'F4',
    '목표 추적',
    '세션 처음에 적은 문장을 그대로 인용해 되묻습니다. 격려도 평가도 하지 않고, 지금 어디인지만 확인합니다.',
  ],
  [
    'F5',
    '페이스 케어',
    '자리를 비웠다 돌아오거나, 오래 멈춰 있거나, 너무 오래 앉아 있을 때. 한 문장만, 그리고 한동안 침묵합니다.',
  ],
  [
    'F6',
    '심화 해설',
    'F1으로 안 풀린 것 하나를 끝까지 팝니다. 범위는 좁게, 깊이는 깊게. 길게 답해도 되는 유일한 상황입니다.',
  ],
]

function FunctionsSection() {
  return (
    <Band>
      <Reveal>
        <div className="max-w-[62ch]">
          <Eyebrow>기능 F1 – F6</Eyebrow>
          <h2 className="t-screen mt-5 text-balance">여섯 가지 일, 서로 겹치지 않게</h2>
          <p className="t-body mt-4 text-subtle">
            각 기능은 발동 조건과 출력 길이, 하지 말아야 할 것까지 따로 정해져 있습니다. 담당을 고를 때는
            모델에게 묻지 않고 키워드 규칙으로 정합니다 — 빠르고, 틀려도 안전한 쪽으로 떨어집니다.
          </p>
        </div>
      </Reveal>

      <ul className="mt-12 border-t border-hairline">
        {FUNCTIONS.map(([code, name, desc], i) => (
          <Reveal key={code} delay={i * 55}>
            <li className="group grid grid-cols-[72px_minmax(0,1fr)_minmax(0,1.3fr)] items-baseline gap-6 border-b border-hairline px-1 py-6 transition-colors duration-500 ease-soft hover:bg-peach">
              <span className="font-mono text-[13px] tracking-[0.06em] text-subtle">{code}</span>
              <span className="t-section">{name}</span>
              <span className="t-body text-subtle">{desc}</span>
            </li>
          </Reveal>
        ))}
      </ul>
    </Band>
  )
}

/* ── 4. 작동 방식 ────────────────────────────────────── */

const STAGES = [
  ['01 Input', '사용자와 맥락', ['학업 질문 · 음성', '첨부 자료', '카메라 · 시간 · 목표']],
  [
    '02 Route',
    '중앙 오케스트레이터',
    ['필요한 기능 판단 F1–F6', '담당 에이전트 선택', '멘션 → 담당자 → 기본값'],
  ],
  ['03 Agents', '담당 에이전트', ['Mina · F1 · F6', 'Theo · F3 · F5', 'Juno · F2 · F4']],
  [
    '04 Experience',
    '공부 보조 · 공부 관리',
    ['질문 설명 · 내용 정리', '심화 학습 · 퀴즈', '목표 확인 · 복귀 · 집중 측정'],
  ],
]

function PipelineSection() {
  return (
    <Band className="bg-[color:var(--hover-bg)]">
      <Reveal>
        <div className="max-w-[62ch]">
          <Eyebrow>작동 방식</Eyebrow>
          <h2 className="t-screen mt-5 text-balance">질문과 상태가 들어와, 하나의 기록으로 나갑니다</h2>
          <p className="t-body mt-4 text-subtle">
            중앙 오케스트레이터가 무엇이 필요한지 판단하고 담당을 고릅니다. 공부 보조와 공부 관리의 결과는
            세션이 끝날 때 하나의 학습 기록으로 합쳐집니다.
          </p>
        </div>
      </Reveal>

      <Reveal delay={80}>
        <div className="mt-12 overflow-x-auto pb-2">
          <div className="flex min-w-[1000px] items-stretch">
            {STAGES.map(([code, title, items]) => (
              <div key={code} className="flex flex-1 items-stretch">
                <div className="flex flex-1 flex-col gap-2.5 rounded-md border border-hairline bg-surface p-5">
                  <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">{code}</span>
                  <h3 className="t-item text-ink">{title}</h3>
                  <ul className="flex flex-col gap-1">
                    {items.map((t) => (
                      <li key={t} className="t-help">
                        {t}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex w-11 shrink-0 items-center justify-center text-coral">
                  <ArrowRight size={18} aria-hidden="true" />
                </div>
              </div>
            ))}

            {/* 마지막 산출물 — 앞의 두 갈래(보조·관리)가 하나로 합쳐지는 자리라 유일하게 반전 */}
            <div className="flex w-[210px] shrink-0 flex-col gap-2.5 rounded-md bg-surface-dark p-5">
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-coral">Output</span>
              <h3 className="t-item text-warm">세션 기록</h3>
              <ul className="flex flex-col gap-1">
                {['개념 요약', '심화 포인트', '복습 문제'].map((t) => (
                  <li key={t} className="t-help text-white/60">
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mt-3 flex min-w-[1000px] flex-wrap items-baseline gap-x-5 gap-y-1 rounded-md border border-dashed border-hairline px-5 py-3.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink">Shared Engine</span>
            <span className="t-help">역할 + 말투 + 현재 상태</span>
            <span className="t-help">·</span>
            <span className="t-help">대화 기억 + 자료 검색 + 모델 호출</span>
          </div>
        </div>
      </Reveal>
    </Band>
  )
}

/* ── 5. 관측 ─────────────────────────────────────────── */

const METRICS = [
  ['5', 'fps', '얼굴 방향 · 졸음 판정 주기. 200ms마다 한 번이면 충분합니다.'],
  ['3.8', 'MB', '얼굴 랜드마크 모델. 처음 한 번 받고 캐시에 남습니다.'],
  ['0.75', '초', '신호를 확정하기까지 기다리는 시간. 성급하게 판단하지 않습니다.'],
  ['0', '', '서버로 전송되는 영상 프레임 수.'],
]

const OBSERVE_CARDS = [
  [
    '음성',
    '말로 묻고, 소리로 듣습니다',
    '브라우저에 내장된 음성 인식으로 질문하고, 답은 읽어줍니다. 캐릭터마다 높이와 속도가 달라 목소리가 구분됩니다.',
  ],
  [
    '보수적 판정',
    '확신이 없으면 넘어갑니다',
    '손에 쥔 작은 물체는 계산기나 필통일 수도 있습니다. 그래서 점수에는 넣지 않고 부드러운 알림에만 씁니다.',
  ],
  [
    '기록',
    '끝나면 남는 것',
    '오늘 얼마나 앉아 있었는지, 무엇을 물었는지, 무엇이 아직 흐린지. 세션이 끝나면 한 장으로 정리됩니다.',
  ],
]

function ObserveSection() {
  return (
    <Band className="bg-surface-dark">
      <Reveal>
        <div className="max-w-[62ch]">
          <Eyebrow onDark>관측</Eyebrow>
          <h2 className="t-screen mt-5 text-balance text-warm">영상은 기기 밖으로 나가지 않습니다</h2>
          <p className="t-body mt-4 text-white/65">
            얼굴 방향과 졸음은 브라우저 안에서만 계산합니다. 서버로 올리지 않고, 저장하지도 않습니다.
          </p>
        </div>
      </Reveal>

      <Reveal delay={80}>
        <div className="mt-12 grid grid-cols-4 gap-px overflow-hidden rounded-md border border-white/10 bg-white/10">
          {METRICS.map(([n, unit, note]) => (
            <div key={note} className="flex flex-col gap-1.5 bg-surface-dark p-6">
              <div
                className="tnum text-warm"
                style={{ fontSize: 40, lineHeight: 1.05, fontWeight: 500, letterSpacing: '-0.03em' }}
              >
                {n}
                {unit && <span className="ml-0.5 text-[15px] font-normal">{unit}</span>}
              </div>
              <p className="t-caption text-white/45">{note}</p>
            </div>
          ))}
        </div>
      </Reveal>

      <Reveal delay={140}>
        <blockquote className="t-section mt-10 border-l-2 border-coral pl-6 text-warm">
          졸음은 눈이 아니라 고개로 봅니다. 아래를 보고 필기하면 눈은 반쯤 감긴 것으로 보이지만, 필기는
          내려가서 머물고 졸음은 위아래로 오갑니다.
        </blockquote>
      </Reveal>

      <div className="mt-12 grid grid-cols-3 gap-4">
        {OBSERVE_CARDS.map(([label, title, body], i) => (
          <Reveal key={label} delay={i * 90}>
            <div className="h-full rounded-lg border border-white/10 p-7">
              <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/45">{label}</div>
              <h3 className="t-section mt-3 text-warm">{title}</h3>
              <p className="t-body mt-3 text-white/65">{body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </Band>
  )
}

/* ── 6. 마무리 ───────────────────────────────────────── */

function CloserSection({ onOpenLogin }) {
  return (
    <Band className="relative overflow-hidden">
      <div
        className="blob bg-lavender"
        style={{ width: 620, height: 620, top: -240, left: '50%', translate: '-50% 0', opacity: 0.8 }}
        aria-hidden="true"
      />
      <Reveal>
        <div className="relative flex flex-col items-center gap-6 text-center">
          <Eyebrow>시작하기</Eyebrow>
          <h2 className="t-hero text-balance">빈 자리가 하나 남아 있습니다</h2>
          <p className="t-body max-w-[46ch] text-subtle">
            목표 한 줄만 적으면 됩니다. 나머지는 자리에 앉은 사람들이 알아서 합니다.
          </p>
          <div className="mt-2">
            <Button variant="primary" shape="rounded" onClick={onOpenLogin}>
              자리에 앉기
            </Button>
          </div>
        </div>
      </Reveal>
    </Band>
  )
}

/* ── 조립 ────────────────────────────────────────────── */

export default function LandingSections({ onOpenLogin }) {
  return (
    <div className="relative bg-warm">
      <WhySection />
      <MatesSection />
      <FunctionsSection />
      <PipelineSection />
      <ObserveSection />
      <CloserSection onOpenLogin={onOpenLogin} />
    </div>
  )
}
