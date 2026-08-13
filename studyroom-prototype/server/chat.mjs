/**
 * /api/chat 처리기.
 *
 * 브라우저는 키를 모른다. 키는 이 파일이 도는 Node 프로세스에만 있다.
 * 개발 중에는 Vite 미들웨어가, 배포 후에는 EC2의 Node가 같은 함수를 부른다.
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, existsSync } from 'node:fs'

import { poolFromEnv } from './keyPool.mjs'
import { PROVIDERS, redact, HttpError } from './providers.mjs'
import { search, toContext, bankStats } from './retrieve.mjs'
import { assemble, needsTruncation, splitForSummary, summaryRequest, budgetReport } from './memory.mjs'
import { buildSystemPrompt } from '../src/lib/agent/persona.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const BANK_DIR = join(root, 'src', 'data', 'csbank')

/* ── 설정 ─────────────────────────────────────────────────── */

export function loadEnv() {
  const env = {}
  const p = join(root, '.env')
  if (!existsSync(p)) return env
  for (const line of readFileSync(p, 'utf-8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#') || !t.includes('=')) continue
    const i = t.indexOf('=')
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim()
  }
  return env
}

const env = loadEnv()

/** 구글 키 여러 개를 풀로 묶는다. 한 계정에 몰빵하지 않기 위한 것 */
const geminiPool = poolFromEnv(env, ['T2', 'T3', 'T4', 'T5', 'T6', 'GOOGLE_API_KEY'])
const openaiPool = poolFromEnv(env, ['T1', 'OPENAI_API_KEY'])

const MODELS = {
  gemini: env.MODEL_GEMINI || 'gemini-3.5-flash-lite',
  openai: env.MODEL_OPENAI || 'gpt-5.4-mini',
}

const SECRETS = Object.values(env).filter((v) => v && v.length > 12)

/** 기본은 Gemini. 키가 없으면 OpenAI로 */
function routeProvider(prefer) {
  if (prefer === 'openai' && openaiPool) return { name: 'openai', pool: openaiPool }
  if (geminiPool) return { name: 'gemini', pool: geminiPool }
  if (openaiPool) return { name: 'openai', pool: openaiPool }
  return null
}

/* ── 본체 ─────────────────────────────────────────────────── */

/**
 * @param {object} body
 * @param {object} body.seat      말할 캐릭터 (slotNo, name, traits, explainStyle, proactivity)
 * @param {object} body.settings  대화 운영 설정 (replyLength 등)
 * @param {Array}  body.turns     [{role:'user'|'model', text}] 최근 대화
 * @param {string} body.message   이번 사용자 발화 (개입이면 비어 있을 수 있다)
 * @param {string} [body.summary] 이전에 압축해둔 요약
 * @param {string} [body.kind]    'reply' | 'intervention'
 */
export async function handleChat(body) {
  const { seat, settings = {}, turns = [], message = '', summary = '', kind = 'reply', images = [] } = body || {}
  if (!seat || !seat.name) throw new HttpError(400, { error: 'seat 이 필요합니다' })

  const route = routeProvider(settings.provider)
  if (!route) throw new HttpError(503, { error: '사용 가능한 API 키가 없습니다. .env 를 확인하세요.' })

  // ── 전공 근거 검색 ──
  // 개입 턴에는 넣지 않는다. 연관 낮은 조각이 긴 컨텍스트에서 답을 더 흐린다.
  let hits = []
  let knowledge = ''
  if (kind === 'reply' && message && !images.length) {
    hits = search(message, BANK_DIR)
    knowledge = toContext(hits)
  }

  const system = buildSystemPrompt(seat, settings)
  const history = [...turns]
  if (message || images.length) {
    history.push(images.length ? { role: 'user', text: message, images } : { role: 'user', text: message })
  }

  let assembled = assemble({ system, knowledge, summary, turns: history })

  // ── 예산 초과 시 절삭 ──
  // 자를 뿐이지 요약 호출은 여기서 하지 않는다(지연). 호출부가 다음 턴 전에 백그라운드로 만든다.
  let truncated = false
  if (needsTruncation(history, assembled.estimatedTokens)) {
    const { keep } = splitForSummary(history)
    assembled = assemble({ system, knowledge, summary, turns: keep })
    truncated = true
  }

  // ── 호출 (키 실패 시 다른 키로 재시도) ──
  /**
   * 답변 길이 예산.
   *
   * 아끼면 품질이 떨어진다. 설명이 문장 중간에서 끊기는 것보다 나쁜 건 없다.
   * 출력 1,000토큰이 $0.0025 라 넉넉히 줘도 부담이 아니다 — 잘리는 쪽이 훨씬 비싸다.
   * (한국어 1토큰 ≈ 1.7자. detailed 2000토큰 ≈ 3,400자까지 쓸 수 있다는 뜻)
   */
  const maxOut = { short: 200, brief: 700, detailed: 2000 }[settings.replyLength] ?? 700

  /**
   * 사고 단계는 답변 길이에 맞춘다.
   *
   * 맞장구 한 줄에 사고를 시키면 지연만 늘고 얻는 게 없다.
   * 설명을 요구하는 답변에서는 중간 단계가 눈에 띄게 짜임새를 높인다 —
   * 실측에서 low 는 서론을 길게 늘어놓고(3.7~4.0초), medium 은 곧장 본론으로 갔다(2.8~3.3초).
   *
   * high 는 쓰지 않는다. 예산 2000에서도 답이 끝나기 전에 잘렸다.
   */
  const thinking = kind === 'intervention' ? 'low' : { short: 'low', brief: 'medium', detailed: 'medium' }[settings.replyLength] ?? 'medium'
  const call = PROVIDERS[route.name]
  let lastErr = null

  for (let attempt = 0; attempt < Math.min(3, route.pool.size + 1); attempt++) {
    // 같은 캐릭터는 늘 같은 키로 (프리픽스 캐시 유지). 실패하면 다음 키로 넘어간다
    const k = route.pool.pick(`${seat.slotNo ?? seat.name}-${attempt}`)
    try {
      const opts = {
        apiKey: k.key,
        model: MODELS[route.name],
        system: assembled.system,
        messages: assembled.messages,
        maxTokens: maxOut,
        temperature: kind === 'intervention' ? 1.0 : 0.9,
        thinking,
      }
      let r = await call(opts)

      // 답이 문장 중간에서 끊긴 경우.
      //
      // 사고를 끄면 안 된다 — 그건 품질을 깎아 길이를 사는 것이다.
      // 사고량은 질문마다 크게 달라서(같은 medium 에서 254~1150토큰) 어떤 고정 예산도
      // 넘길 수 있다. 그러니 **예산만 키워서** 다시 부른다.
      let widened = 0
      while (r.finish === 'MAX_TOKENS' && widened < 2) {
        widened += 1
        r = await call({ ...opts, maxTokens: maxOut * (1 + widened) })
      }

      route.pool.report(k.id, { ok: true })
      if (!r.text) throw new HttpError(502, { error: `빈 응답 (finish=${r.finish})` })

      return {
        text: r.text,
        meta: {
          provider: route.name,
          model: MODELS[route.name],
          keyId: k.id,
          ms: r.ms,
          inTok: r.inTok,
          outTok: r.outTok,
          truncated,
          thinking,
          widened, // 예산을 키워 다시 부른 횟수 (0이면 한 번에 끝난 것)
          knowledge: hits.map((h) => ({ id: h.item.id, topic: h.item.topic, score: +h.score.toFixed(2) })),
          budget: budgetReport(assembled, history),
        },
      }
    } catch (e) {
      lastErr = e
      const status = e.status || 500
      route.pool.report(k.id, { ok: false, status })
      // 400은 우리 요청이 잘못된 것이라 키를 바꿔도 소용없다
      if (status === 400) break
    }
  }

  throw new HttpError(lastErr?.status || 502, {
    error: redact(lastErr?.message || '모델 호출 실패', SECRETS),
    detail: redact(JSON.stringify(lastErr?.body || {}).slice(0, 300), SECRETS),
  })
}

/** 대화 압축 — 다음 턴 전에 백그라운드로 부른다 */
export async function handleSummarize(body) {
  const { turns = [], previousSummary = '' } = body || {}
  const route = routeProvider()
  if (!route) throw new HttpError(503, { error: 'API 키 없음' })
  const { drop } = splitForSummary(turns)
  if (!drop.length) return { summary: previousSummary, changed: false }

  // sourceKind 를 강제한다. 요약을 다시 요약하면 앞부분이 뭉개진다
  const req = summaryRequest(drop, previousSummary, { sourceKind: 'transcript' })
  // 요약은 매번 새 프롬프트라 캐시가 걸리지 않는다. 대화에 안 쓰이고 노는 키로 보낸다
  const k = route.pool.pickIdle()
  const r = await PROVIDERS[route.name]({
    apiKey: k.key,
    model: MODELS[route.name],
    system: req.system,
    messages: [{ role: 'user', text: req.user }],
    maxTokens: 500,
    temperature: 0.3,
  })
  route.pool.report(k.id, { ok: true })
  return { summary: r.text, changed: true, droppedTurns: drop.length, ms: r.ms }
}

export function handleHealth() {
  return {
    ok: true,
    providers: {
      gemini: geminiPool ? { keys: geminiPool.size, model: MODELS.gemini, stats: geminiPool.stats() } : null,
      openai: openaiPool ? { keys: openaiPool.size, model: MODELS.openai, stats: openaiPool.stats() } : null,
    },
    bank: bankStats(BANK_DIR),
  }
}

export { HttpError }
