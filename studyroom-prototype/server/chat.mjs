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
import { effectiveSpec, isSmallTalk } from '../src/lib/agent/functions.js'
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
  /**
   * 지능이 필요한 자리(자료 읽기·자료를 놓고 답하기·엔딩 요약)에 쓰는 유료 키 모델.
   *
   * 3.6 → 3.7 로 올린다. 실측에서 전 구간이 빨랐고, 무엇보다 **잘리던 게 안 잘린다**:
   *   자료 읽기(22쪽)   85초 → 39초, 3.6 은 MAX_TOKENS 로 끝났고 3.7 은 STOP
   *   자료 놓고 답하기  16.6초 → 11.1초 (사고 high, 3회 중앙값)
   *   엔딩 요약 JSON    12.9초 → 7.7초, 스키마 강제 정상
   *   검색 근거         양쪽 다 정상
   * ⚠️ 꼬리 지연은 3.7 도 튄다 (같은 호출이 84초 걸린 적 있음). 되돌리려면 이 한 줄이다.
   */
  pro: env.MODEL_PRO || 'gemini-3.7-flash',
}

/**
 * 값싼 모델이 "이건 내 몫이 아니다"라고 말하는 표시.
 *
 * 답을 흉내내지 말고 이 다섯 글자만 내라고 시킨다. 짧아야 값싸고,
 * 평범한 대화에 우연히 섞일 일이 없어야 해서 대괄호를 두 겹 쓴다.
 */
const HANDOFF = '[[전공]]'
const HANDOFF_RE = /\[\[전공\]\]/
/**
 * ⚠️ 이 규칙은 프롬프트 **맨 뒤**에 붙인다. 앞으로 옮기지 말 것.
 *
 * 어디에 두는 게 나은지 실측했다 (lite · 전공 5개 · 일상 4개 · 2회씩):
 *
 *     배치                전공 넘김   일상 오탐
 *     규칙 없음             0/10      0/8    ← 페르소나만으로는 **절대** 안 넘긴다
 *     맨 뒤 (지금)         10/10      0/8    ← 최선
 *     기능 블록 자리          8/10      4/8    ← 인사에도 넘긴다
 *     맨 앞                9/10      2/8
 *     기능 자리 + 도구 호출     6/10      0/8
 *
 * 두 가지가 드러났다.
 *  1) 페르소나에 은근히 심어 두는 걸로는 안 된다. 규칙이 없으면 0/10 이다.
 *  2) 규칙을 앞에 두면 모델이 "넘겨야 하나"를 과하게 의식해 **인사까지 넘긴다.**
 *     일상 대화를 상위 모델로 보내는 건 애초에 고치려던 문제 그 자체다.
 *
 * 도구 호출(functionCall)로 받는 쪽이 구조적으로는 깔끔하다 — 글자로 안 나오니
 * 샐 수가 없다. 다만 넘김률이 낮게 나왔고(6/10), tools 는 검색 근거가 이미 쓰고 있어
 * 겹친다. 시연 뒤에 검색·스키마·넘김을 한꺼번에 정리할 때 다시 볼 것.
 */
const HANDOFF_RULE =
  `\n\n[지금 맡은 몫]\n` +
  `너는 지금 **가벼운 대화만** 맡는다. 인사·맞장구·잡담에는 평소처럼 답한다.\n` +
  `그런데 이 말이 전공 지식이나 설명·비교·풀이를 요구하는 질문이라면, ` +
  `**답하려 하지 말고** 다른 말 없이 딱 이것만 출력한다: ${HANDOFF}\n` +
  `어설프게 아는 대로 답하는 것보다 넘기는 편이 낫다.`

const SECRETS = Object.values(env).filter((v) => v && v.length > 12)

/** 기본은 Gemini. 키가 없으면 OpenAI로 */
function routeProvider(prefer) {
  if (prefer === 'openai' && openaiPool) return { name: 'openai', pool: openaiPool }
  if (geminiPool) return { name: 'gemini', pool: geminiPool }
  if (openaiPool) return { name: 'openai', pool: openaiPool }
  return null
}

/**
 * 어떤 키로 어떤 모델을 부를지, **순서대로** 정한다.
 *
 * 두 가지가 완전히 다른 일이라 갈라 둔다.
 *
 *   지능 승급 — 어려운 자리(개념·정리·심화·자료·출제)는 처음부터 유료 키의 상위 모델.
 *               품질을 사려고 올리는 것이다.
 *   할당량 폴백 — 무료 키가 전부 소진되면 유료 키로 넘어가되 **같은 급 모델**을 쓴다.
 *               멈추지 않으려고 넘어가는 것이지 품질을 올리려는 게 아니다.
 *               여기서 상위 모델을 쓰면 한도가 풀린 뒤에도 비싼 호출이 계속된다.
 *
 * 마지막 줄은 반대 방향 폴백이다. 유료 키까지 막히면 무료로라도 답한다 —
 * 값싼 답이 침묵보다 낫다.
 *
 * @returns {Array<{pool:KeyPool, key:object, model:string, why:string}>}
 */
function buildAttempts({ wantsPro, sticky }) {
  /**
   * ⚠️ 주 경로와 폴백의 자리를 **따로** 잡는다.
   *
   * 처음엔 그냥 이어 붙이고 앞에서 5개를 잘랐다. 그런데 무료 키가 5개라 상한을
   * 무료가 전부 먹어 버려서 **폴백이 한 번도 실행되지 않았다.** 정확히 막으려던
   * 상황(전부 소진)에서만 조용히 안 되는, 제일 나쁜 종류의 버그다.
   */
  const take = (pool, model, why, n) => {
    if (!pool) return []
    return pool
      .orderedKeys(sticky)
      .slice(0, n)
      .map((key) => ({ pool, key, model, why }))
  }

  if (wantsPro) {
    return [
      ...take(proPool, MODELS.pro, 'pro', PRIMARY_TRIES), // 지능 승급
      ...take(geminiPool, MODELS.gemini, 'pro-down', FALLBACK_TRIES), // 유료가 막히면 값싼 모델로라도
    ]
  }
  return [
    ...take(geminiPool, MODELS.gemini, 'free', PRIMARY_TRIES),
    ...take(proPool, MODELS.gemini, 'quota-fallback', FALLBACK_TRIES), // 무료 소진 → 유료 키, 같은 급
  ]
}

/**
 * 한 요청이 시도할 횟수.
 *
 * 키를 전부 순회하면 사용자가 너무 오래 기다린다. 주 경로에서 세 번 막히면
 * 그 풀은 지금 상태가 나쁜 것이니 폴백으로 넘어가는 게 빠르다.
 */
const PRIMARY_TRIES = 3
const FALLBACK_TRIES = 2

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

  // ── 전공 근거 검색 ──
  // 개입 턴에는 넣지 않는다. 연관 낮은 조각이 긴 컨텍스트에서 답을 더 흐린다.
  const spec = effectiveSpec(funcId, settings)

  let hits = []
  let knowledge = ''
  /**
   * **자료를 놓고 묻는 질문에는 뱅크를 넣지 않는다.**
   *
   * 실측에서 드러난 고장이다. 사용자가 올린 논문을 놓고 "이 논문 설명해줘"라고 물으면
   * 질문에 "어텐션"이 들어 있으니 뱅크가 교과서 어텐션 항목을 근거로 물려줬다.
   * 모델은 읽지도 않은 논문을 그 일반론으로 설명했고, 문장은 그럴듯한데 내용이 틀렸다.
   *
   * 게다가 뱅크가 맞으면 아래에서 `hits.length === 0` 이 깨져 **검색까지 꺼졌다.**
   * 논문이 arXiv 에 공개돼 있어도 찾아볼 길이 그렇게 함께 막혔다.
   *
   * 자료가 붙은 턴에서는 그 자료가 유일한 권위다. 일반론은 도움이 아니라 잡음이다.
   */
  if (spec.useKnowledge && message && !images.length && !withDoc) {
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
  /**
   * 일상 대화는 값싼 모델에 맡긴다.
   *
   * 예전에는 F1 이 라우터의 **기본값**이라 아무 규칙도 안 걸린 말이 전부 F1 이 됐고,
   * F1 은 spec.wantsPro 가 참이라 "안녕"·"아 배고파"까지 유료 상위 모델로 갔다.
   * 실측에서 12개 표본 중 11개가 승급됐다 — 바로 위 주석이 "잡담까지 여기로 보내면
   * 돈이 샌다"고 적어 둔 그 일이 그대로 일어나고 있었다.
   * 무료 키 5개를 두고 분산하려던 구조인데 T2~T6 이 거의 놀고, S1 이 한도에 걸리면
   * 그 순간 **모든 대화가 동시에** 값싼 모델로 떨어진다.
   *
   * 내려보내는 조건을 좁게 잡는다. 아래 넷을 **전부** 만족해야 한다 —
   * 하나라도 어긋나면 상위 모델 그대로다. 판정을 놓쳐도 답이 나빠지지 않는 방향이다.
   */
  const chitchat =
    funcId === 'F1' && // 기능이 정해진 말(정리·심화·퀴즈)은 목적이 분명하다
    !withDoc && // 자료를 놓고 하는 말은 잡담이 아니다
    !images.length &&
    hits.length === 0 && // 전공 뱅크가 근거를 찾았으면 전공 질문이다
    isSmallTalk(message)

  const wantsPro = !!(
    proPool &&
    !chitchat &&
    (hits.length > 0 || images.length > 0 || spec.wantsPro || withDoc)
  )
  const stickyKey = `${seat?.slotNo ?? seat?.name ?? funcId}`
  const attempts = buildAttempts({ wantsPro, sticky: stickyKey })
  if (!attempts.length)
    throw new HttpError(503, { error: '사용 가능한 API 키가 없습니다. .env 를 확인하세요.' })

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
  const call = PROVIDERS.gemini
  let lastErr = null

  /**
   * 주어진 키·모델 차례대로 한 번씩 던져 본다. 첫 성공에서 끝낸다.
   * 되돌림(값싼 모델 → 상위 모델) 때 두 번 부르려고 함수로 뺐다.
   */
  async function runAttempts(list, systemText) {
    for (const step of list) {
      const k = step.pool.use(step.key)
      try {
        const opts = {
          apiKey: k.key,
          model: step.model,
          system: systemText,
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
          // 검색은 유료 키에서만 동작한다. 무료로 폴백된 시도에서는 켜지 않는다
          search: spec.useSearch && step.why === 'pro' && hits.length === 0,
          jsonSchema: spec.json || null,
        }
        let r = await call(opts)

        // 답이 문장 중간에서 끊긴 경우.
        //
        // 사고를 끄면 안 된다 — 그건 품질을 깎아 길이를 사는 것이다.
        // 사고량은 질문마다 크게 달라서(같은 medium 에서 254~1150토큰) 어떤 고정 예산도
        // 넘길 수 있다. 그러니 **예산만 키워서** 다시 부른다.
        let widened = 0
        while (r.finish === 'MAX_TOKENS' && widened < 2 && spec.widen !== false) {
          widened += 1
          r = await call({ ...opts, maxTokens: maxOut * (1 + widened) })
        }

        step.pool.report(k.id, { ok: true })
        if (!r.text) throw new HttpError(502, { error: `빈 응답 (finish=${r.finish})` })

        // 지시로 못 막는 것만 코드가 확인한다 — 이모지·웃음표기·길이 상한.
        // 실측에서 상한 120자짜리 기능이 184자로 나왔다. 예산으로는 막을 수 없다
        // JSON 을 받기로 한 호출은 손대지 않는다. 이모지 제거가 문자열 값 안을 건드리면
        // 파싱은 되는데 내용이 달라진다 — 눈에 안 띄는 종류의 고장이다
        const cleaned = spec.json
          ? { text: r.text, changed: [] }
          : postprocess(r.text, spec, toneOf(seat || {}))

        return {
          text: cleaned.text,
          meta: {
            funcId,
            fixed: cleaned.changed, // 후처리가 무엇을 고쳤는지 — 프롬프트 튜닝의 단서
            searched: r.searched || 0,
            provider: 'gemini',
            model: step.model,
            keyId: k.id,
            // 왜 이 키·모델이 됐는지. 폴백이 조용히 일어나면 원인을 못 찾는다
            route: step.why,
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
        step.pool.report(k.id, { ok: false, status, body: e.body })
        console.warn(`[key] ${k.id}(${step.why}) ${status} — 다음 키로`)
        // 400은 우리 요청이 잘못된 것이라 키를 바꿔도 소용없다
        if (status === 400) break
      }
    }
    return null
  }

  /**
   * 값싼 모델이 받아 보고 "이건 내가 답할 게 아니다" 하면 상위 모델로 넘긴다.
   *
   * 일상 대화 판정은 코드가 정규식으로 한다. 정규식은 반드시 틀린다 —
   * "요즘 정렬 뭐가 제일 좋아?" 는 인사도 아니고 물음 신호도 약해서 새어 나갈 수 있다.
   * 그때 값싼 모델이 어설프게 답해 버리면 사용자는 **틀린 답을 받는다.**
   *
   * 그래서 값싼 모델에게 거절할 길을 준다. 전공 질문이면 답하지 말고 표시만 내라고
   * 일러두고, 그 표시가 오면 상위 모델로 다시 부른다. 판정을 놓쳐도 답은 안 나빠지고,
   * 대가는 값싼 호출 한 번(2초 안팎)이다.
   */
  let out = await runAttempts(attempts, chitchat ? assembled.system + HANDOFF_RULE : assembled.system)

  if (out && chitchat && HANDOFF_RE.test(out.text)) {
    const proAttempts = buildAttempts({ wantsPro: true, sticky: stickyKey })
    const again = await runAttempts(proAttempts, assembled.system)
    if (again) {
      again.meta.handedOff = true // 값싼 모델이 넘긴 것 — 진단에서 보이게
      out = again
    } else {
      // 상위 모델까지 막혔다. **표시가 사용자에게 새면 안 된다** —
      // 화면에 "[[전공]]" 이 뜨는 건 우리 속사정이지 답이 아니다
      out.text = out.text.replace(HANDOFF_RE, '').trim() || '이건 제대로 답해주고 싶은데 지금 잘 안 되네. 잠깐 뒤에 다시 물어봐 줄래?'
      out.meta.handoffFailed = true
    }
  }
  if (out) return out

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
