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
import { buildPrompt } from '../src/lib/agent/prompt.js'
import { effectiveSpec } from '../src/lib/agent/functions.js'
import { postprocess } from '../src/lib/agent/postprocess.js'
import { toneOf } from '../src/lib/agent/tone.js'

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

/**
 * 상위 모델용 키 (유료 계정).
 *
 * 잡담까지 여기로 보내면 돈이 샌다. **어려운 자리에서만** 부른다:
 *  - 전공 뱅크가 근거를 찾아낸 질문 → 그 자체가 "전공 질문"이라는 신호다
 *  - 자료를 그림으로 읽는 질문 → 페이지를 알아보는 일은 작은 모델에 버겁다
 */
const proPool = poolFromEnv(env, ['S1'])

const MODELS = {
  gemini: env.MODEL_GEMINI || 'gemini-3.5-flash-lite',
  openai: env.MODEL_OPENAI || 'gpt-5.4-mini',
  pro: env.MODEL_PRO || 'gemini-3.6-flash',
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
  const {
    seat,
    settings = {},
    turns = [],
    message = '',
    summary = '',
    kind = 'reply',
    images = [],
    mode,
    withDoc = false,
    /**
     * 어느 기능으로 답할 것인가 (F1~F6 / sys:*). 라우터가 브라우저에서 정한다.
     *
     * ⚠️ 미지정을 400 으로 거절하지 않는다. 예전 화면이 아직 이 값을 안 보내고,
     *    거절하면 그 브라우저는 **모든 대화가 목업으로 떨어져** 가짜 답변만 보게 된다.
     *    화면은 멀쩡하고 답변만 엉터리가 되는, 제일 알아채기 어려운 고장이다.
     */
    funcId = mode === 'extract' ? 'sys:extract' : 'F1',
    /** 프롬프트의 [지금 상태] 블록에 들어갈 값 */
    state = {},
  } = body || {}
  if (mode !== 'extract' && (!seat || !seat.name)) throw new HttpError(400, { error: 'seat 이 필요합니다' })

  let route = routeProvider(settings.provider)
  if (!route) throw new HttpError(503, { error: '사용 가능한 API 키가 없습니다. .env 를 확인하세요.' })

  // ── 전공 근거 검색 ──
  // 개입 턴에는 넣지 않는다. 연관 낮은 조각이 긴 컨텍스트에서 답을 더 흐린다.
  const spec = effectiveSpec(funcId, settings)

  let hits = []
  let knowledge = ''
  if (spec.useKnowledge && message && !images.length) {
    hits = search(message, BANK_DIR)
    knowledge = toContext(hits)
  }

  // 전공 근거가 잡혔거나 자료를 그림으로 읽어야 하면 상위 모델로 올린다.
  // 검색을 마친 뒤에 판단해야 해서 여기서 갈아탄다
  /**
   * 상위 모델로 올릴 자리.
   *  - 전공 뱅크가 근거를 찾음 → 전공 질문이라는 신호
   *  - 자료를 읽거나(extract) 자료를 놓고 묻는 질문(withDoc) → 긴 자료를 정확히 다뤄야 한다
   *  - 그림이 붙음 → 작은 모델에는 버겁다
   */
  const wantsPro = proPool && (hits.length > 0 || images.length > 0 || spec.wantsPro || withDoc)
  if (wantsPro) route = { name: 'gemini', pool: proPool, model: MODELS.pro }

  /**
   * 자료 읽기 전용 모드.
   *
   * 캐릭터 말투를 씌우면 "친구처럼 말해"와 "그대로 옮겨 적어"가 서로 부딪친다.
   * 자료에서 글을 뽑아내는 일은 성격이 없어야 한다 — 뽑아낸 글로 캐릭터가
   * 말하는 건 그다음 순서다.
   */
  const system = buildPrompt({ seat: seat || { name: '도구' }, funcId, state, settings }).system

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
  const maxOut = spec.maxTokens

  /**
   * 사고 단계는 답변 길이에 맞춘다.
   *
   * 맞장구 한 줄에 사고를 시키면 지연만 늘고 얻는 게 없다.
   * 설명을 요구하는 답변에서는 중간 단계가 눈에 띄게 짜임새를 높인다 —
   * 실측에서 low 는 서론을 길게 늘어놓고(3.7~4.0초), medium 은 곧장 본론으로 갔다(2.8~3.3초).
   *
   * high 는 쓰지 않는다. 예산 2000에서도 답이 끝나기 전에 잘렸다.
   */
  const thinking = spec.thinking
  const call = PROVIDERS[route.name]
  let lastErr = null

  for (let attempt = 0; attempt < Math.min(3, route.pool.size + 1); attempt++) {
    // 같은 캐릭터는 늘 같은 키로 (프리픽스 캐시 유지). 실패하면 다음 키로 넘어간다
    const k = route.pool.pick(`${seat?.slotNo ?? seat?.name ?? mode}-${attempt}`)
    try {
      const opts = {
        apiKey: k.key,
        model: route.model || MODELS[route.name],
        system: assembled.system,
        messages: assembled.messages,
        maxTokens: maxOut,
        temperature: kind === 'intervention' ? 1.0 : 0.9,
        thinking,
        /**
         * 구글 검색으로 근거를 보탠다.
         *
         * **뱅크가 비었을 때만** 켠다. 뱅크에 있는 162항목은 검산까지 마친 자료라
         * 검색 결과보다 믿을 만하고, 검색은 왕복이 한 번 더 늘어 첫 응답이 눈에 띄게 늦다.
         * 그래서 "우리가 아는 것에 없을 때"의 마지막 수단이다.
         *
         * 유료키(S1)에서만 실제로 동작한다 — 무료키로 켜면 거절당한다.
         * 그래서 상위 모델로 올라간 호출에만 붙인다.
         */
        search: spec.useSearch && wantsPro && hits.length === 0,
        jsonSchema: spec.json || null,
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

      // 지시로 못 막는 것만 코드가 확인한다 — 이모지·웃음표기·길이 상한.
      // 실측에서 상한 120자짜리 기능이 184자로 나왔다. 예산으로는 막을 수 없다
      // JSON 을 받기로 한 호출은 손대지 않는다. 이모지 제거가 문자열 값 안을 건드리면
      // 파싱은 되는데 내용이 달라진다 — 눈에 안 띄는 종류의 고장이다
      const cleaned = spec.json ? { text: r.text, changed: [] } : postprocess(r.text, spec, toneOf(seat || {}))

      return {
        text: cleaned.text,
        meta: {
          funcId,
          fixed: cleaned.changed, // 후처리가 무엇을 고쳤는지 — 프롬프트 튜닝의 단서
          searched: r.searched || 0,
          provider: route.name,
          model: route.model || MODELS[route.name],
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
      pro: proPool ? { keys: proPool.size, model: MODELS.pro, stats: proPool.stats() } : null,
    },
    bank: bankStats(BANK_DIR),
  }
}

export { HttpError }
