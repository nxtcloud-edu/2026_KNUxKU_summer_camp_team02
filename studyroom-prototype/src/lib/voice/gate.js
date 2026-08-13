/**
 * 자동 전송 앞단의 거름망.
 *
 * 말한 걸 그대로 다 보내면 안 되는 이유는 세 가지다.
 *  1) **되먹임** — 스피커로 나간 캐릭터 목소리를 마이크가 주워 담는다.
 *     그대로 보내면 캐릭터가 자기 말에 답하고, 그 답이 또 들어와 무한히 돈다.
 *  2) **군말** — "어…", "음", "아 네" 는 사람에게 말한 게 아니다.
 *  3) **중복** — 인식기가 같은 구간을 두 번 확정하는 일이 있다.
 *
 * 이건 "이름을 불러야만 보낸다" 같은 문지기가 아니다. 그건 사용자가 원한 게 아니다.
 * 여기서 막는 건 **보내면 안 되는 게 명백한 것들뿐**이다.
 */

/** 이것만으로 이루어진 발화는 버린다 */
const ONLY_FILLER =
  /^(?:[아어엄음응오예네넹그저야흠허핫ㅋㅎㅜㅠ\s.,!?…~]|그래|맞아|오케이|오키|ok|okay|응응|어어|음음)+$/i

/** 글자 2-gram 집합 */
function bigrams(s) {
  const t = String(s || '')
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]/g, '')
  const out = new Set()
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2))
  return out
}

/** 두 글이 얼마나 겹치는가 (0~1) */
export function similarity(a, b) {
  const A = bigrams(a)
  const B = bigrams(b)
  if (!A.size || !B.size) return 0
  let hit = 0
  for (const g of A) if (B.has(g)) hit += 1
  return hit / Math.min(A.size, B.size)
}

export const GATE = {
  minChars: 2,
  /** 캐릭터가 방금 한 말과 이만큼 닮았으면 되먹임으로 본다 */
  echoSimilarity: 0.5,
  /** 직전에 보낸 것과 이만큼 닮았고 이 시간 안이면 중복으로 본다 */
  dupSimilarity: 0.85,
  dupWindowMs: 6000,
}

/**
 * @param {string} text            이번 발화
 * @param {object} ctx
 * @param {string[]} ctx.recentTts 캐릭터가 최근에 소리내어 말한 것들
 * @param {{text:string, at:number}|null} ctx.lastSent 직전에 보낸 것
 * @returns {{ok:true, text:string} | {ok:false, why:string}}
 */
export function screenUtterance(text, { recentTts = [], lastSent = null } = {}) {
  const t = String(text || '').trim()

  if (t.length < GATE.minChars) return { ok: false, why: 'too-short' }
  if (ONLY_FILLER.test(t)) return { ok: false, why: 'filler' }

  for (const said of recentTts) {
    if (similarity(t, said) >= GATE.echoSimilarity) return { ok: false, why: 'tts-echo' }
  }

  if (lastSent && Date.now() - lastSent.at < GATE.dupWindowMs) {
    if (similarity(t, lastSent.text) >= GATE.dupSimilarity) return { ok: false, why: 'duplicate' }
  }

  return { ok: true, text: t }
}

/**
 * 이어질 말인가, 끝난 말인가.
 *
 * 침묵 1.2초를 "말 끝남"으로 보면 생각하며 말하는 사람을 못 따라간다.
 * "동적계획법이랑 …(생각)… 분할정복 차이가 뭐야" 는 한 문장인데 둘로 잘려 나간다.
 *
 * 그래서 시간이 아니라 **말끝**을 본다.
 *  - "…이랑", "…인데", "…니까" 처럼 이어지는 어미로 끝나면 아직 안 끝난 것이다
 *  - "…뭐야", "…모르겠어", "…맞나요" 처럼 맺는 어미면 끝난 것이다
 *
 * 틀려도 크게 손해 보지 않게 설계했다. 끝난 걸 못 알아보면 잠깐 기다렸다 보내면 되고,
 * 안 끝난 걸 끝났다고 보면 문장이 둘로 나뉠 뿐이다. 그래서 **애매하면 "안 끝났다"** 로 본다.
 */
const CONTINUING =
  /(?:이랑|랑|하고|이고|서|면서|면|며|는데|은데|ㄴ데|인데|니까|어서|아서|지만|거나|든지|부터|까지|에서|으로|로|와|과|의|을|를|이|가|은|는|도|만|고)$/

// '해'·'돼' 는 넣지 않는다 — "이거에 대해", "…를 위해" 처럼 이어지는 말이 흔하다
const FINAL = /(?:[.!?…]|요|죠|다|야|지|네|어|아|까|니|냐|군|걸|래|봐|자|였|겠|줘|주라|세요|게)$/

export function looksComplete(text) {
  const t = String(text || '').trim()
  if (!t) return false
  if (/[.!?…]$/.test(t)) return true
  const lastWord = t.split(/\s+/).pop() || ''
  if (CONTINUING.test(lastWord)) return false // 이어질 말이다
  return FINAL.test(lastWord)
}

/** 음성 조각을 이어 붙인다 */
export function joinVoice(prev, next) {
  const a = String(prev || '').trim()
  const b = String(next || '').trim()
  if (!a) return b
  if (!b) return a
  return `${a} ${b}`
}

export const WHY_LABEL = {
  'too-short': '너무 짧아요',
  filler: '군말만 있어요',
  'tts-echo': '캐릭터 목소리가 들어왔어요',
  duplicate: '방금 보낸 것과 같아요',
}
