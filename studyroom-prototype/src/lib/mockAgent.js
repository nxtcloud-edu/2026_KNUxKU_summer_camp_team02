/**
 * 스터디 메이트 시뮬레이션 — 통합 설계서 §7
 *
 * ⚠️ 모델 API 자리
 *   generateReply() 한 곳만 실제 LLM 호출로 바꾸면 된다.
 *   나머지(라우팅·개입 판정·자율 행동)는 모델과 무관한 규칙 엔진이라 그대로 쓴다.
 */

import { PRESETS, ANIMATION_STATES } from './presets'
import { requestReply } from './agent/client'

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

/* ── 자율 행동 (§7-3 3순위) ───────────────────────────────────
   ambient random은 animationState만 바꾸고 발화하지 않는다. (§10 규칙 12) */

export function nextAnimationState(seat, current) {
  const preset = PRESETS[seat.preset] || PRESETS.mina
  const w = preset.weights
  const pool = []
  for (const [state, weight] of Object.entries(w)) {
    if (state === current) continue
    for (let i = 0; i < weight; i++) pool.push(state)
  }
  const next = pick(pool) || 'studying'
  return ANIMATION_STATES.includes(next) ? next : 'studying'
}

/** 성격에 따라 상태를 바꾸는 주기(ms) */
export function stateInterval(seat) {
  const base = { rare: 26000, when_needed: 20000, active: 14000 }[seat.proactivity] || 20000
  return base + Math.random() * base * 0.6
}

/* ── 개입 판정 (§7-3) ─────────────────────────────────────── */

const CAP = { quiet: 0, moderate: 1, lively: 2.2, auto: 1.4 }
const WEIGHT = { rare: -1, when_needed: 0, active: 1 }

/**
 * @returns {{allowed:boolean, reason?:string}}
 */
export function canIntervene(settings, ctx) {
  // 1순위 — 방해 방지 (§7-3)
  if (settings.dnd.focusSilence && ctx.userTyping)
    return { allowed: false, reason: '집중 중에는 먼저 말 걸지 않기' }
  if (isQuietHour(settings.dnd)) return { allowed: false, reason: '방해 금지 시간' }
  if (ctx.sinceLastInterventionSec < settings.thresholds.cooldownMin * 60)
    return { allowed: false, reason: '재개입 대기 시간' }

  // 전역 개입 빈도 = 상한 (§7-3)
  if (settings.interventionLevel === 'quiet') return { allowed: false, reason: '조용한 방' }
  const cap = CAP[settings.interventionLevel] ?? 1
  const perHour = cap * 4
  if (ctx.interventionsThisHour >= perHour) return { allowed: false, reason: '개입 상한 도달' }

  return { allowed: true }
}

function isQuietHour(dnd) {
  if (!dnd.quietEnabled) return false
  const now = new Date()
  const cur = now.getHours() * 60 + now.getMinutes()
  const [fh, fm] = dnd.quietFrom.split(':').map(Number)
  const [th, tm] = dnd.quietTo.split(':').map(Number)
  const from = fh * 60 + fm
  const to = th * 60 + tm
  return from <= to ? cur >= from && cur < to : cur >= from || cur < to
}

/** 캐릭터별 가중치를 반영해 발화자를 고른다 */
export function pickInterventionSpeaker(seats) {
  const active = seats.filter((s) => s.enabled)
  if (!active.length) return null
  const pool = []
  active.forEach((s) => {
    const n = 3 + (WEIGHT[s.proactivity] ?? 0) * 2
    for (let i = 0; i < Math.max(1, n); i++) pool.push(s)
  })
  return pick(pool)
}

/*
 * 개입 문구는 더 이상 여기 없다.
 *
 * 캐릭터별로 미리 써 둔 문장을 골라 쓰던 자리였다. 그래서 말투 설정이 개입 발화에는
 * 전혀 먹지 않았고, 문구가 문서를 어겼다 — "어디 갔다 왔어! 기다렸잖아 ㅋㅋ" 는
 * 페이스 케어의 '어디 갔었냐고 묻지 않는다'를 정면으로 어긴다.
 * 이제 개입도 다른 발화와 같은 프롬프트 층을 지나간다 (agent/prompt.js 의 F4·F5).
 * 설정 창 미리보기는 agent/tone.js 의 TONE_SAMPLE 을 쓴다.
 */

/**
 * "@이름" 을 찾는 정규식.
 *
 * `\b` 를 쓰면 안 된다. `\b` 는 [A-Za-z0-9_] 기준이라 **한글 뒤에서는 경계가 성립하지 않는다.**
 * "@미나 이거 뭐야" 가 /@미나\b/ 에 안 걸려서, 이름을 한글로 바꾸는 순간 @멘션이 통째로 죽었다.
 *
 * 대신 이름 뒤에 호격·접속 조사만 허용하고 그 밖의 글자는 막는다.
 * "@미나야"·"@미나랑" 은 부르는 것이고 "@민아"·"@미나비" 는 다른 이름이다.
 */
const NAME_SUFFIX =
  '(?:이야|이랑|한테|에게|하고|보고|더러|야|아|님|씨|랑|은|는|이|가|을|를|도|만|의|에|와|과)?'

export function mentionRe(name) {
  return new RegExp(`@${escapeRe(name)}${NAME_SUFFIX}(?![가-힣A-Za-z0-9_])`, 'i')
}

/* ── 답변자 라우팅 (§10 규칙 11) ────────────────────────────
   우선순위: @멘션 > 답변 캐릭터 설정 > 자동 라우팅 */

export function routeReply(text, seats, settings) {
  const active = seats.filter((s) => s.enabled)
  if (!active.length) return []

  // 1) @멘션
  const mentioned = active.filter((s) => mentionRe(s.name).test(text))
  if (mentioned.length) return mentioned.slice(0, maxRepliers(settings))

  // 2) 주 담당 캐릭터
  if (settings.replyPolicy === 'primary') {
    const primary = active.find((s) => s.slotNo === settings.primarySlotNo)
    if (primary) return [primary]
  }

  // 3) 자동 라우팅 — Coordinator/Router Agent 자리 [1장 §17]
  const scored = active.map((s) => ({ s, score: routeScore(text, s) }))
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, maxRepliers(settings)).map((x) => x.s)
}

function maxRepliers(settings) {
  if (settings.noSupplement) return 1
  return { one: 1, two: 2, many: 3 }[settings.multiReply] ?? 1
}

function routeScore(text, seat) {
  let s = Math.random() * 2
  const t = text.toLowerCase()
  if (/왜|이유|원리|개념/.test(t) && seat.explainStyle === 'stepwise') s += 3
  if (/예시|예를|사례/.test(t) && seat.explainStyle === 'example') s += 3
  if (/간단|요약|짧게/.test(t) && seat.explainStyle === 'concise') s += 3
  if (/쉽게|모르겠/.test(t) && seat.explainStyle === 'easy') s += 3
  // 좌석 축을 T1~T4 로 갈아탈 때 traits 가 없는 좌석이 생긴다.
  // 여기는 사용자가 말을 보낼 때마다 도는 자리라, 없으면 첫 질문에서 통째로 터진다
  if (seat.traits?.includes?.('활발함')) s += 0.6
  return s
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/* ── 답변 생성 (모델 API 교체 지점) ───────────────────────── */

const LENGTH_HINT = { short: 1, brief: 2, detailed: 4 }

/** 휴식 선언 감지 — StudyRoomScreen의 REST_WORDS와 같은 뜻 (§6-3) */
const REST_RE = /(쉬고|쉴게|쉬러|휴식|잠깐만|잠시만|화장실|밥 먹|커피|스트레칭)/

const REST_REPLIES = {
  mina: ['네, 다녀와요. 여기까지 어디 봤는지 표시해둘게요.', '좋아요. 돌아오면 흐름 안 끊기게 짚어드릴게요.'],
  theo: ['좋아, 나도 물 좀 마시고 올게!', '오케이 쉬자! 나도 잠깐 스트레칭 좀 할래.'],
  juno: ['응, 천천히 와.', '그래. 나도 좀 늘어져 있을게.'],
}

/**
 * 모델 답변.
 *
 * 서버(/api/chat)를 부르고, 실패하면 아래 목업으로 떨어진다.
 * 목업을 남겨두는 이유: 키가 없거나 한도에 걸려도 데모가 멈추면 안 되기 때문이다.
 *
 * @param {Array} [history]  [{role:'user'|'model', text}] 최근 대화
 * @param {string} [summary] 압축해둔 앞부분
 */
export async function generateReply({
  seat,
  text,
  settings,
  history = [],
  summary = '',
  kind = 'reply',
  images = [],
  /**
   * 올린 자료를 놓고 묻는 질문인가.
   *
   * 화면은 이 값을 넘기고 있었는데 여기서 받지 않아 **서버까지 가지 않았다.**
   * 서버는 이 값으로 상위 모델(S1) 승급을 판단한다(chat.mjs 의 wantsPro).
   * 그래서 자료를 읽는 것만 상위 모델로 가고, 정작 **그 자료에 대한 질문은
   * 값싼 모델로 답하고 있었다.** 화면·서버 양쪽이 멀쩡해 보여서 눈에 띄지 않았다.
   */
  withDoc = false,
  /** 어느 기능으로 답할 것인가. 라우터(agent/functions.js)가 정한다 */
  funcId = 'F1',
  /** 프롬프트의 [지금 상태] 블록에 들어갈 값 */
  state = {},
}) {
  try {
    const r = await requestReply({
      seat,
      settings,
      turns: history,
      message: text,
      summary,
      kind,
      images,
      withDoc,
      funcId,
      state,
    })
    if (r?.text) return { text: r.text, meta: r.meta }
  } catch (e) {
    console.warn('[agent] 서버 호출 실패 → 목업으로 대체', e.message)
    lastError = e.message
  }
  return { text: await mockReply({ seat, text, settings }), meta: { mock: true } }
}

/** 마지막 실패 사유 — 화면에 한 번 알려주기 위해 보관한다 */
let lastError = ''
export const takeLastError = () => {
  const e = lastError
  lastError = ''
  return e
}

async function mockReply({ seat, text, settings }) {
  await sleep(700 + Math.random() * 1300) // 타이핑 인디케이터가 보이도록
  const preset = PRESETS[seat.preset] || PRESETS.mina
  const n = LENGTH_HINT[settings.replyLength] ?? 2
  const clean = text.replace(/@\S+\s*/g, '').trim()

  // 휴식 선언에는 설명이 아니라 반응으로 답한다 (§6-3)
  // "사용자의 자연어 메시지가 스터디룸 상태에 영향을 줄 수 있다" [1장 §19]
  if (REST_RE.test(clean)) return pick(REST_REPLIES[preset.key] || REST_REPLIES.mina)

  const openers = {
    mina: ['정리해서 말하면,', '핵심만 짚어볼게요.', '차근차근 볼까요?'],
    theo: ['오 좋은 질문!', '그거 나도 궁금했어!', '같이 보자!'],
    juno: ['음.', '이렇게 볼 수도 있어.', '간단히 말하면,'],
  }
  const bodies = {
    easy: `"${truncate(clean)}" 는 쉽게 말해 지금 보고 있는 개념의 핵심만 떼어놓은 거예요.`,
    example: `"${truncate(clean)}" 는 예를 들어 방금 올린 자료의 첫 사례를 떠올리면 이해가 빨라요.`,
    stepwise: `"${truncate(clean)}" 는 ① 정의 → ② 조건 → ③ 결과 순서로 보면 정리돼요.`,
    concise: `"${truncate(clean)}" — 결론만 말하면 조건이 만족될 때만 성립해요.`,
  }
  const tails = [
    '여기까지 이해되면 다음 부분으로 넘어가도 좋아요.',
    '헷갈리는 지점 있으면 그 문장만 다시 짚어줄게요.',
    '노트에 한 줄로 적어두면 나중에 훨씬 빨라요.',
  ]

  const parts = [pick(openers[preset.key]), bodies[seat.explainStyle] || bodies.stepwise]
  for (let i = 2; i < n; i++) parts.push(pick(tails))
  return parts.join(' ')
}

const truncate = (s, n = 24) => (s.length > n ? s.slice(0, n) + '…' : s || '그 부분')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ── 기습 질문 · 심화 학습 포인트 (§7-5) ───────────────────── */

const QUIZ_BANK = [
  { q: '방금 본 부분에서 가장 중요한 조건 하나만 말해볼래?', a: ['조건', '전제', '가정'] },
  { q: '지금까지 내용을 한 문장으로 요약하면?', a: ['요약', '정리', '핵심'] },
  { q: '이 개념이 안 통하는 예외 상황이 뭐였지?', a: ['예외', '반례', '아닌'] },
]

export function makeQuiz() {
  return pick(QUIZ_BANK)
}

/** 사용자의 답을 정오 판정 — 데모용 휴리스틱 (모델 연결 시 LLM 분류로 교체) */
export function judgeQuiz(quiz, answer) {
  if (!answer || answer.trim().length < 4) return false
  const t = answer.toLowerCase()
  return quiz.a.some((k) => t.includes(k)) || answer.trim().length >= 15
}

const POINT_BANK = [
  '정의와 조건을 분리해서 정리해두기',
  '예외 사례를 한 개 이상 직접 만들어보기',
  '앞 단원의 개념과 연결되는 지점 확인하기',
  '용어 두 개의 차이를 한 문장으로 설명해보기',
  '수식보다 말로 먼저 흐름 정리하기',
]

export function makeStudyPoint() {
  return pick(POINT_BANK)
}
