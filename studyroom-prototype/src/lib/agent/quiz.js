/**
 * 기습 질문 만들기.
 *
 * 예전에는 캐릭터가 채팅으로 문제를 내고, 사용자의 **다음 메시지가 무엇이든** 답안으로
 * 채점했다. "이 자료 요약해줘"라고 물어도 퀴즈 답으로 처리되고 원래 질문은 사라졌다.
 * 이제 답이 채팅 입력창을 지나가지 않으므로 그 버그가 구조적으로 없어졌다.
 *
 * 모델이 스키마를 지키도록 강제하지만(functions.js 의 sys:quiz), 그래도 받은 값을
 * 한 번 더 확인한다. 시연 도중 선택지가 3개로 오거나 정답 번호가 범위를 벗어나면
 * 화면이 깨지는 것보다 문제를 안 내는 쪽이 낫다.
 */

import { requestReply } from './client'

/** 받은 값이 화면에 올려도 되는 모양인가 */
export function validateQuiz(q) {
  if (!q || typeof q !== 'object') return null
  const question = String(q.question || '').trim()
  const explanation = String(q.explanation || '').trim()
  const choices = Array.isArray(q.choices) ? q.choices.map((c) => String(c || '').trim()).filter(Boolean) : []
  const answerIndex = Number(q.answerIndex)

  if (!question || choices.length < 3 || choices.length > 5) return null
  if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= choices.length) return null
  // 같은 선택지가 두 개면 정답이 둘이 된다
  if (new Set(choices).size !== choices.length) return null

  return { question, choices, answerIndex, explanation }
}

/**
 * @param {{seat:object, settings:object, goalText?:string, recentTopics?:string[], history?:Array}} o
 * @returns {Promise<null | {question:string, choices:string[], answerIndex:number, explanation:string}>}
 *          만들지 못하면 null. **문제를 못 내는 건 조용히 넘어간다** —
 *          "문제를 못 만들었어요" 같은 말풍선은 아무에게도 도움이 안 된다.
 */
export async function makeQuiz({
  seat,
  settings = {},
  goalText = '',
  recentTopics = [],
  history = [],
  /**
   * 올린 자료의 본문(toPrompt 로 감싼 것). **있으면 반드시 실어 보낸다.**
   *
   * 예전에는 자료 **이름만** 넘겼다. 그랬더니 모델이 이름만 보고 지어냈다 —
   * 실측에서 "sisa_neurips_submission.pdf" 하나만 주니
   * "SISA 프레임워크에서 샤드를 슬라이스로 나누는 이유는?" 이라는 문제가 나왔다.
   * 그 논문에 샤드도 슬라이스도 없다. 4지선다는 그럴듯해 보여서 더 위험하다.
   */
  docPrompt = '',
}) {
  const scope = goalText || recentTopics.join(', ')
  if (!scope && !docPrompt) return null // 범위가 없으면 아예 내지 않는다

  try {
    const r = await requestReply({
      seat,
      settings,
      funcId: 'sys:quiz',
      state: { goalText, recentTopics },
      turns: history.slice(-6),
      withDoc: !!docPrompt, // 자료가 있으면 그 자료가 근거다 (뱅크 대신)
      message: docPrompt
        ? `${docPrompt}\n\n위 자료에서 4지선다 확인 문제를 하나 내줘. 자료에 없는 건 묻지 않는다.`
        : `지금까지 다룬 범위에서 4지선다 확인 문제를 하나 내줘.`,
    })
    const parsed = JSON.parse(r?.text || 'null')
    return validateQuiz(parsed)
  } catch (e) {
    console.warn('[quiz] 만들기 실패', e?.message || e)
    return null
  }
}
