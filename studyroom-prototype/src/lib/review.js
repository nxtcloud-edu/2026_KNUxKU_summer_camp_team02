/**
 * 엔딩 요약 — 오늘 공부한 것을 정리한다.
 *
 * 예전에는 화면이 하드코딩된 표본을 그대로 보여줬다. 조건부 확률·베이즈 정리·Attention…
 * 사용자가 뭘 했든 늘 같은 개념이 떴다. 시연에서는 그럴듯해 보이지만, 심사위원이
 * 그 목록을 **실제로 공부한 것**으로 읽는다. 없는 걸 있다고 보여주는 셈이다.
 *
 * 이제 실제 기록에서 만든다. 그리고 **만들 게 없으면 만들지 않는다** —
 * 빈 화면이 가짜 목록보다 낫다.
 */

import { db } from '../store/db'
import { requestReply } from './agent/client'

/**
 * 이만큼은 있어야 정리할 게 있다고 본다.
 *
 * 문턱을 두는 이유는 비용이 아니라 **정직함**이다. 두 마디 나눈 세션에서 개념 네 개가
 * 나오면 그건 정리가 아니라 창작이다. 모델은 시키면 만들어 낸다.
 */
export const MIN_CHARS = 180
export const MIN_USER_TURNS = 2

/*
 * 처음엔 300자로 뒀는데 실측에서 **개념 두 개를 다룬 8턴 대화가 279자**로 밀렸다.
 * 한국어는 글자가 조밀해서 300자면 생각보다 긴 대화다. 문턱의 목적은
 * "두 마디 나눈 세션에서 개념 네 개를 지어내는 것"을 막는 거지, 짧지만 알찬 대화를
 * 버리는 게 아니다. 사용자 발화 2턴이라는 조건이 그 목적을 이미 지킨다.
 */

/** 대화가 길수록 많이 뽑는다. 문서의 기준을 그대로 쓴다 */
export function contentScale(chars) {
  if (chars < 1200) return 'short'
  if (chars < 5000) return 'normal'
  return 'long'
}

/**
 * 이 세션에서 모델에게 줄 재료를 모은다.
 * @returns {{enough:boolean, chars:number, userTurns:number, scale:string, text:string, why?:string}}
 */
export function collectInput(sessionId) {
  const msgs = db.getMessages(sessionId) || []
  const docs = db.getDocuments() || []
  const points = db.getStudyPoints(sessionId) || []

  const talk = msgs
    .filter((m) => m.kind !== 'file')
    .map((m) => `${m.sender_type === 'me' ? '나' : '메이트'}: ${m.body || ''}`)
    .filter((l) => l.length > 4)

  const userTurns = msgs.filter((m) => m.sender_type === 'me' && m.kind !== 'file').length

  // 이 세션에 올린 자료만. 예전 세션 자료까지 넣으면 오늘 안 본 걸 오늘 공부한 걸로 정리한다
  const mine = docs.filter((d) => d.session_id === sessionId)
  const docText = mine.map((d) => `[자료 "${d.name}"]\n${d.text.slice(0, 6000)}`).join('\n\n')

  const text = [talk.join('\n'), docText, points.map((p) => `· ${p.text}`).join('\n')]
    .filter(Boolean)
    .join('\n\n')

  const chars = text.length
  const enough = chars >= MIN_CHARS && (userTurns >= MIN_USER_TURNS || mine.length > 0)
  return {
    enough,
    chars,
    userTurns,
    scale: contentScale(chars),
    text,
    why: enough
      ? ''
      : userTurns < MIN_USER_TURNS && !mine.length
        ? '대화가 거의 없었어요'
        : '정리할 내용이 아직 적어요',
  }
}

/**
 * 모델이 줄바꿈을 **글자 그대로** 쓰는 일이 있다.
 *
 * JSON 문자열 안에서 `\n` 을 한 번 더 이스케이프해 버리면, 파싱 결과가 진짜 줄바꿈이
 * 아니라 역슬래시+n 두 글자가 된다. 그러면 마크다운이 통째로 한 줄이 되어
 * 제목도 목록도 안 먹는다. 실측에서 개념 본문이 한 덩어리로 나왔다.
 * 스키마를 강제해도 이건 못 막는다 — 문법은 맞고 내용이 그런 것이기 때문이다.
 */
const unescapeNewlines = (t) =>
  String(t || '')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '  ')

/** 화면에 올려도 되는 모양인가. 스키마를 강제해도 값의 앞뒤는 확인한다 */
export function validateReview(r) {
  if (!r || typeof r !== 'object') return null
  const groups = (Array.isArray(r.conceptGroups) ? r.conceptGroups : [])
    .map((g) => ({
      domain: String(g.domain || 'general_cs'),
      label: String(g.label || '컴퓨터 일반'),
      concepts: (Array.isArray(g.concepts) ? g.concepts : [])
        .filter((c) => c && c.title && c.markdown)
        .map((c) => ({ title: String(c.title).trim(), markdown: unescapeNewlines(c.markdown).trim() })),
    }))
    .filter((g) => g.concepts.length)

  // 개념이 하나도 없으면 요약이 아니다. 빈 화면을 보여주는 게 낫다
  if (!groups.length) return null

  return {
    conceptGroups: groups,
    deepeningPoints: (Array.isArray(r.deepeningPoints) ? r.deepeningPoints : [])
      .filter((p) => p && p.title && p.body)
      .map((p) => ({ title: String(p.title).trim(), body: String(p.body).trim() })),
    trueFalseQuizzes: (Array.isArray(r.trueFalseQuizzes) ? r.trueFalseQuizzes : [])
      .filter((q) => q && q.statement && typeof q.answer === 'boolean')
      .map((q) => ({
        statement: String(q.statement).trim(),
        answer: q.answer,
        explanation: String(q.explanation || '').trim(),
      })),
    summaryText: String(r.summaryText || '').trim(),
    downloadSummaryMarkdown: unescapeNewlines(r.downloadSummaryMarkdown).trim(),
  }
}

/**
 * 요약을 가져온다. 이미 만들어 뒀으면 그걸 준다.
 *
 * @returns {Promise<{state:'ok'|'empty'|'error', review?:object, why?:string}>}
 */
export async function ensureReview(sessionId, seat) {
  if (!sessionId) return { state: 'empty', why: '세션을 찾지 못했어요' }

  const cached = db.getReview(sessionId)
  if (cached) return { state: 'ok', review: cached }

  const input = collectInput(sessionId)
  if (!input.enough) return { state: 'empty', why: input.why }

  try {
    const r = await requestReply({
      seat: seat || { slotNo: 1, name: '메이트' },
      funcId: 'sys:review',
      settings: {},
      turns: [],
      message:
        `아래는 오늘 스터디룸에서 오간 대화와 자료야. 여기 실제로 나온 것만 정리해줘.\n` +
        `분량 기준은 "${input.scale}".\n\n${input.text.slice(0, 24000)}`,
    })
    const parsed = validateReview(JSON.parse(r?.text || 'null'))
    if (!parsed) return { state: 'empty', why: '정리할 개념을 찾지 못했어요' }
    db.saveReview(sessionId, parsed)
    return { state: 'ok', review: parsed }
  } catch (e) {
    console.warn('[review] 만들기 실패', e?.message || e)
    return { state: 'error', why: '요약을 만들지 못했어요' }
  }
}
