/**
 * 프롬프트 예산과 대화 압축.
 *
 * 실측 전제 (조사 결과 반영):
 *   대화 1턴 = 70토큰(잡담) ~ 565토큰(전공 detailed)
 *   2시간 40턴 = 3,090토큰 = 1M 창의 0.29%
 *   → **창은 제약이 아니다.** 제약은 매 턴 재전송에서 오는 비용과 지연이다.
 *
 * 그래서 원칙이 셋이다.
 *  1) 예산은 창의 %가 아니라 **절대 토큰**으로 잡는다.
 *     같은 30%가 Gemini(1M)와 GPT-5.4-mini(400k)에서 2.6배 차이 난다.
 *  2) 짧은 대화는 **압축하지 않는다.** 3,090토큰을 줄이려고 3,090토큰을 요약 모델에 넣는 건 손해다.
 *  3) 자를 때는 **블록 단위**로 자른다. 매 턴 앞을 미는 슬라이딩은 프리픽스를 깨서
 *     캐시를 통째로 날린다. 블록 절삭은 그 턴만 캐시 콜드다.
 */

export const BUDGET = {
  /** 프롬프트 총량 하드캡 */
  maxTokens: 8000,
  /** 이 아래면 아무것도 하지 않는다 */
  triggerTokens: 6400,
  /** 어떤 경우에도 원문으로 남기는 최근 턴 수 */
  keepRawTurns: 25,
  /** 절삭 발동 기준 턴 수 */
  truncateAboveTurns: 50,
  /** 요약 목표 길이 */
  summaryTokens: 500,
}

/** 한국어는 대략 1토큰 ≈ 1.7자. 정확한 계산은 API가 하고, 여기선 예산 판단용 근사만 */
export const estTokens = (s) => Math.ceil(String(s || '').length / 1.7)

/**
 * 프롬프트를 조립한다.
 *
 * 블록 순서 = 캐시 프리픽스 순서다. **바꾸면 안 된다.**
 * 자주 바뀌는 것일수록 뒤에 둔다.
 *
 * @param {object} o
 * @param {string} o.system      페르소나 (세션 내 불변)
 * @param {string} o.knowledge   검색된 전공 근거 (가끔 변함)
 * @param {string} o.summary     압축된 앞부분 (절삭 시에만 변함)
 * @param {Array}  o.turns       [{role:'user'|'model', text}]
 */
export function assemble({ system, knowledge = '', summary = '', turns = [] }) {
  const head = [system]
  if (knowledge) head.push(knowledge)
  if (summary) head.push(`[지금까지의 대화 요약]\n${summary}`)

  const messages = turns.map((t) => ({ role: t.role, text: t.text }))
  const systemText = head.join('\n\n')
  const total = estTokens(systemText) + messages.reduce((a, m) => a + estTokens(m.text), 0)

  return { system: systemText, messages, estimatedTokens: total }
}

/**
 * 절삭이 필요한가.
 * 턴 수와 토큰을 **둘 다** 본다. 전공 질문은 한 턴이 565토큰이라
 * 턴 수만 보면 늦고, 잡담은 70토큰이라 토큰만 보면 영영 안 걸린다.
 */
export function needsTruncation(turns, estimated) {
  return turns.length > BUDGET.truncateAboveTurns || estimated > BUDGET.triggerTokens
}

/**
 * 앞부분을 잘라낸다. 잘린 원문은 **버리지 않고 호출부가 DB에 그대로 둔다.**
 * 압축은 프롬프트 조립 문제이지 저장 문제가 아니다.
 *
 * @returns {{keep:Array, drop:Array}}
 */
export function splitForSummary(turns) {
  const keep = turns.slice(-BUDGET.keepRawTurns)
  const drop = turns.slice(0, turns.length - BUDGET.keepRawTurns)
  return { keep, drop }
}

/**
 * 요약 프롬프트.
 *
 * ⚠️ 입력은 **반드시 원문 전사**다. 이전 요약을 다시 요약하면
 *    "요약의 요약의 요약"이 되어 앞부분이 뭉개진다. 아래 assert로 막는다.
 */
export function summaryRequest(dropTurns, previousSummary, { sourceKind }) {
  if (sourceKind !== 'transcript') {
    throw new Error('요약 입력은 원문 전사만 허용된다 (재귀 재요약 금지)')
  }
  const transcript = dropTurns.map((t) => `${t.role === 'user' ? '학생' : '메이트'}: ${t.text}`).join('\n')
  const system =
    '너는 공부 세션 기록자다. 아래 대화를 요약한다.\n' +
    '- 학생이 무엇을 물었고 어디서 막혔는지를 남긴다\n' +
    '- 이미 해결된 것과 아직 안 풀린 것을 구분한다\n' +
    '- 인사·잡담은 버린다\n' +
    '- 평서형으로 쓴다. 400자 이내.'
  const prior = previousSummary ? `\n\n[이전 요약 — 참고만 하고 그대로 베끼지 않는다]\n${previousSummary}` : ''
  return { system, user: `[대화 원문]\n${transcript}${prior}` }
}

/** 진단용 — /api/health 와 개발 중 확인에 쓴다 */
export function budgetReport(assembled, turns) {
  return {
    estimatedTokens: assembled.estimatedTokens,
    turns: turns.length,
    pctOfBudget: Math.round((assembled.estimatedTokens / BUDGET.maxTokens) * 100),
    willTruncate: needsTruncation(turns, assembled.estimatedTokens),
  }
}
