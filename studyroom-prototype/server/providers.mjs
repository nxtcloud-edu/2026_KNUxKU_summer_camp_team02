/**
 * 모델 어댑터 — 제공자마다 다른 요청·응답을 하나로 맞춘다.
 *
 * 어느 쪽이든 { text, inTok, outTok, ms } 를 돌려준다.
 * 나중에 Bedrock을 붙일 때도 이 계약만 지키면 나머지는 그대로다.
 */

/**
 * 사고 단계.
 *
 * ⚠️ `maxOutputTokens` 는 **사고와 답변이 나눠 쓰는 공동 예산**이다.
 *    단계만 올리고 예산을 그대로 두면 사고가 예산을 다 먹고 답이 문장 중간에 끊긴다.
 *    실측(gemini-3.5-flash-lite, 예산 400):
 *      low    사고   0토큰 → 답변 248토큰  (온전)
 *      medium 사고 254토큰 → 답변  96토큰  (잘림)
 *      high   사고 380토큰 → 답변  16토큰  (거의 아무것도 안 나옴)
 *
 *    그래서 단계마다 사고 몫을 따로 얹는다.
 *
 * ⚠️ 사고량은 **질문마다 크게 다르다.** 같은 medium 에서 254토큰만 쓸 때도, 1150토큰을
 *    쓸 때도 있었다. 어떤 고정값도 넘길 수 있다는 뜻이라, 넉넉히 잡고 그래도 모자라면
 *    호출부(chat.mjs)가 finish==='MAX_TOKENS' 를 보고 사고 없이 다시 부른다.
 *
 * high 는 쓰지 않는다. 예산 2000을 줘도 답변이 끝나기 전에 잘렸고 지연이 7초였다.
 */
export const THINK_ALLOWANCE = { low: 0, medium: 1800, high: 2600 }

class HttpError extends Error {
  constructor(status, body) {
    super(`HTTP ${status}`)
    this.status = status
    this.body = body
  }
}

async function postJson(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new HttpError(res.status, json)
  return json
}

/**
 * @param {object} o
 * @param {string} o.system
 * @param {Array<{role:'user'|'model', text:string}>} o.messages
 */
export async function callGemini({
  apiKey,
  model,
  system,
  messages,
  maxTokens = 400,
  temperature = 0.9,
  thinking = 'low',
  /**
   * 구글 검색으로 근거를 보탠다 (grounding).
   *
   * 유료 계정 키에서만 동작한다. 무료키로 켜면 호출 자체가 거절되므로
   * 켤지 말지는 호출부(chat.mjs)가 정한다 — 상위 모델로 올라간 요청에만 붙인다.
   */
  search = false,
}) {
  const t0 = Date.now()
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  const json = await postJson(url, {
    systemInstruction: { parts: [{ text: system }] },
    contents: messages.map((m) => ({
      role: m.role === 'model' ? 'model' : 'user',
      // 그림이 붙은 턴이 있다. 글자층이 깨진 PDF 를 쪽 그림으로 읽힐 때 쓴다.
      // 그림을 글 앞에 두어야 "이걸 보고 답해라"가 자연스럽게 읽힌다
      parts: [
        ...(m.images || []).map((im) => ({
          inlineData: { mimeType: im.mimeType || 'image/jpeg', data: im.data },
        })),
        ...(m.text ? [{ text: m.text }] : []),
      ],
    })),
    ...(search ? { tools: [{ google_search: {} }] } : {}),
    generationConfig: {
      // 답변 몫 + 사고 몫. 사고 몫을 안 얹으면 답이 잘린다 (위 주석 참고)
      maxOutputTokens: maxTokens + (THINK_ALLOWANCE[thinking] ?? 0),
      temperature,
      thinkingConfig: { thinkingLevel: thinking },
    },
  })

  const cand = json.candidates?.[0]
  const text = (cand?.content?.parts || [])
    .map((p) => p.text || '')
    .join('')
    .trim()
  const u = json.usageMetadata || {}
  return {
    text,
    inTok: u.promptTokenCount ?? null,
    outTok: u.candidatesTokenCount ?? null,
    ms: Date.now() - t0,
    finish: cand?.finishReason,
    // 검색을 실제로 썼는지. 진단에서 "검색이 켜졌는데 안 돌았다"를 구분하려면 필요하다
    searched: (cand?.groundingMetadata?.webSearchQueries || []).length || 0,
  }
}

export async function callOpenAI({ apiKey, model, system, messages, maxTokens = 400, temperature = 0.9 }) {
  const t0 = Date.now()
  const json = await postJson(
    'https://api.openai.com/v1/chat/completions',
    {
      model,
      messages: [
        { role: 'system', content: system },
        ...messages.map((m) => ({ role: m.role === 'model' ? 'assistant' : 'user', content: m.text })),
      ],
      max_completion_tokens: maxTokens,
      temperature,
    },
    { Authorization: `Bearer ${apiKey}` },
  )
  const c = json.choices?.[0]
  return {
    text: (c?.message?.content || '').trim(),
    inTok: json.usage?.prompt_tokens ?? null,
    outTok: json.usage?.completion_tokens ?? null,
    ms: Date.now() - t0,
    finish: c?.finish_reason,
  }
}

export const PROVIDERS = { gemini: callGemini, openai: callOpenAI }

/** 에러 메시지에서 키를 지운다. 로그·응답 어디에도 새면 안 된다 */
export function redact(text, secrets) {
  let out = String(text ?? '')
  for (const s of secrets) if (s && s.length > 12) out = out.split(s).join('<KEY>')
  return out
}

export { HttpError }
