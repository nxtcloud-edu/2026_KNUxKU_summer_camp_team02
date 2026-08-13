/**
 * 모델 비교 — 캐릭터 말투를 어느 모델이 제일 잘 내는가
 *   npm run compare
 *
 * 같은 시스템 프롬프트(persona.js)와 같은 질문을 여러 모델에 던져
 * 응답 품질·지연시간·토큰을 나란히 본다.
 *
 * ⚠️ .env 의 키를 읽는다. 키를 절대 출력하지 않는다.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPrompt } from '../src/lib/agent/prompt.js'

/** 비교용 좌석 — 말투만 다르게 */
const SAMPLE_SEATS = [
  { slotNo: 1, name: 'Mina', preset: 'mina', tone: 'T1' },
  { slotNo: 2, name: 'Theo', preset: 'theo', tone: 'T2' },
  { slotNo: 3, name: 'Juno', preset: 'juno', tone: 'T4' },
]

const root = dirname(dirname(fileURLToPath(import.meta.url)))

function loadEnv() {
  const env = {}
  try {
    for (const line of readFileSync(join(root, '.env'), 'utf-8').split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#') || !t.includes('=')) continue
      const i = t.indexOf('=')
      env[t.slice(0, i).trim()] = t.slice(i + 1).trim()
    }
  } catch {
    console.error('.env 를 읽지 못했습니다.')
    process.exit(1)
  }
  return env
}

const env = loadEnv()

/** 에러 메시지에 키가 섞여 나오지 않게 가린다 */
const redact = (s) => {
  let out = String(s)
  for (const v of Object.values(env)) if (v && v.length > 12) out = out.split(v).join('<KEY>')
  return out
}

/* ── 제공자 ────────────────────────────────────────────────── */

async function callOpenAI({ model, system, user, apiKey }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_completion_tokens: 300,
    }),
  })
  const j = await res.json()
  if (!res.ok) throw new Error(redact(j.error?.message || JSON.stringify(j)))
  return {
    text: j.choices?.[0]?.message?.content?.trim() || '(빈 응답)',
    inTok: j.usage?.prompt_tokens,
    outTok: j.usage?.completion_tokens,
  }
}

async function callGemini({ model, system, user, apiKey }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { maxOutputTokens: 300, temperature: 0.9 },
    }),
  })
  const j = await res.json()
  if (!res.ok) throw new Error(redact(j.error?.message || JSON.stringify(j)))
  const parts = j.candidates?.[0]?.content?.parts || []
  return {
    text:
      parts
        .map((p) => p.text)
        .join('')
        .trim() || `(빈 응답 · finish=${j.candidates?.[0]?.finishReason})`,
    inTok: j.usageMetadata?.promptTokenCount,
    outTok: j.usageMetadata?.candidatesTokenCount,
  }
}

/* ── 비교 대상 ─────────────────────────────────────────────── */

const TARGETS = [
  env.T1 && { label: 'OpenAI gpt-5.4-mini', fn: callOpenAI, model: 'gpt-5.4-mini', apiKey: env.T1 },
  env.T2 && {
    label: 'Google gemini-3.5-flash-lite',
    fn: callGemini,
    model: 'gemini-3.5-flash-lite',
    apiKey: env.T2,
  },
].filter(Boolean)

/** 스터디룸에서 실제로 나올 법한 상황들 */
const CASES = [
  { seat: 0, user: '세포호흡이 왜 이렇게 헷갈리지' },
  { seat: 1, user: '나 좀 쉬었다 올게' },
  { seat: 2, user: '@Juno 넌 이거 어떻게 접근할 것 같아?' },
]

const settings = { replyLength: 'brief' }

console.log(`비교 대상 ${TARGETS.length}개 · 상황 ${CASES.length}개\n`)

const stats = new Map(TARGETS.map((t) => [t.label, { ms: [], inTok: 0, outTok: 0, fail: 0 }]))

for (const c of CASES) {
  const seat = SAMPLE_SEATS[c.seat]
  const system = buildPrompt({ seat, funcId: 'F1', settings }).system
  console.log('━'.repeat(78))
  console.log(`[${seat.name}] 사용자: "${c.user}"`)
  console.log('━'.repeat(78))

  for (const t of TARGETS) {
    const t0 = Date.now()
    try {
      const r = await t.fn({ model: t.model, system, user: c.user, apiKey: t.apiKey })
      const ms = Date.now() - t0
      const s = stats.get(t.label)
      s.ms.push(ms)
      s.inTok += r.inTok || 0
      s.outTok += r.outTok || 0
      console.log(
        `\n  ▸ ${t.label}  (${(ms / 1000).toFixed(1)}초, in ${r.inTok ?? '?'} / out ${r.outTok ?? '?'})`,
      )
      for (const line of r.text.split('\n')) console.log(`      ${line}`)
    } catch (e) {
      stats.get(t.label).fail += 1
      console.log(`\n  ▸ ${t.label}  실패 — ${e.message.slice(0, 160)}`)
    }
  }
  console.log()
}

console.log('━'.repeat(78))
console.log('요약')
console.log('━'.repeat(78))
console.log(
  '모델'.padEnd(34) +
    '중앙값'.padStart(9) +
    '최대'.padStart(9) +
    '입력tok'.padStart(9) +
    '출력tok'.padStart(9) +
    '실패'.padStart(6),
)
for (const [label, s] of stats) {
  const sorted = [...s.ms].sort((a, b) => a - b)
  const med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0
  const max = sorted.length ? sorted[sorted.length - 1] : 0
  console.log(
    label.padEnd(34) +
      `${(med / 1000).toFixed(1)}초`.padStart(9) +
      `${(max / 1000).toFixed(1)}초`.padStart(9) +
      String(s.inTok).padStart(9) +
      String(s.outTok).padStart(9) +
      String(s.fail).padStart(6),
  )
}
console.log('\n참고 — Kiro CLI 실측: 5.8~6.8초 (모델 1~2초 + 인증·세션 오버헤드 약 5초)')
