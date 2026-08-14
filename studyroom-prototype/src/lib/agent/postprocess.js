/**
 * 모델이 낸 글을 내보내기 전에 한 번 손본다.
 *
 * 하는 일은 두 가지다. 지시로 막기 어려운 표기를 지우고(이모지·웃음표기), 분량이
 * 얼마나 튀었는지 재서 남긴다. **길이를 자르지는 않는다** — 품질이 우선이라는 결정이다.
 *
 * ⚠️ 여기서 **내용을 고치지 않는다.** 지우는 것만 한다. 문장을 다시 쓰거나 요약하면
 *    말투 레이어가 만든 결과를 후처리가 덮어쓰는 셈이 되어, 설정을 바꿔도 출력이
 *    안 변하는 구간이 생긴다.
 */

/**
 * 모든 말투에서 금지.
 *
 * 이모지를 문자 클래스 하나로 묶으면 안 된다. 👨‍👩‍👧 같은 건 ZWJ 로 이어붙인
 * **여러 글자의 묶음**이라, 낱글자로 지우면 조각이 남는다. 묶음 전체를 하나로 잡는다.
 */
const EMOJI =
  /\p{Extended_Pictographic}(?:[\u{1F3FB}-\u{1F3FF}]|\u{FE0F})*(?:\u{200D}\p{Extended_Pictographic}(?:[\u{1F3FB}-\u{1F3FF}]|\u{FE0F})*)*/gu

/**
 * @param {string} text 모델 출력
 * @param {{maxChars:number, toneIntensity:string}} spec
 * @param {string} toneId
 * @returns {{text:string, changed:string[]}} changed 는 무엇을 고쳤는지 (진단용)
 */
export function postprocess(text, spec = {}, toneId = 'T1') {
  const changed = []
  let out = String(text || '')

  if (EMOJI.test(out)) {
    out = out.replace(EMOJI, '')
    changed.push('emoji')
  }

  // 웃음 표기는 장난스러움에서만, 그것도 한 번까지
  const laugh = /[ㅋㅎ]{2,}/g
  if (laugh.test(out)) {
    if (toneId === 'T2' && spec.toneIntensity !== 'low') {
      let first = true
      out = out.replace(laugh, () => {
        if (first) {
          first = false
          return 'ㅋㅋ'
        }
        changed.push('laugh-extra')
        return ''
      })
    } else {
      out = out.replace(laugh, '')
      changed.push('laugh')
    }
  }

  // 차분함은 느낌표와 물결을 쓰지 않는다
  if (toneId === 'T1') {
    if (/!/.test(out)) {
      out = out.replace(/!+/g, '.')
      changed.push('bang')
    }
    if (/~/.test(out)) {
      out = out.replace(/~/g, '')
      changed.push('tilde')
    }
  }

  out = out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  /**
   * **자르지 않는다.** 품질이 우선이라는 결정이다.
   *
   * 대신 얼마나 넘쳤는지는 남긴다. F1 의 짧은 분량은 토큰을 아끼려는 게 아니라
   * 말풍선이 길어지면 캐릭터가 화면에서 밀려나기 때문이다 — 이 제품은 "AI presence"가
   * 정체성이라 그게 손해다. 그래서 프롬프트로는 계속 짧게 유도하고, 실제로 얼마나
   * 튀는지는 여기서 재서 meta 로 올려 보낸다. 튜닝은 그 숫자를 보고 한다.
   */
  const over = spec.maxChars > 0 && out.length > spec.maxChars ? out.length - spec.maxChars : 0
  if (over > 0) changed.push(`over:+${over}`)

  return { text: out, changed }
}
