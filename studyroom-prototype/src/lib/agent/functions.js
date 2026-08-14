/**
 * 기능 축 — "무엇을 말할지"의 단일 정본.
 *
 * 라우팅은 두 축이 직교한다.
 *   1축 routeFunction(text, ctx)  → 무엇을 말할지 (F1·F2·F3·F6)
 *   2축 routeSpeaker(...)         → 누가 말할지   (mockAgent.js)
 * 예전에는 한 함수가 둘을 같이 정했다. 그래서 "정리해줘"에 답할 캐릭터를 고르는 규칙과
 * "정리 형식으로 답하라"는 규칙이 한 덩어리로 엉켜 있었다.
 *
 * ⚠️ **이 파일에는 프롬프트 문장이 한 줄도 없다.** 기능 문서가 "라우팅 키워드를 코드 상수로
 *    분리하고 프롬프트 안에 넣지 말 것"을 명시적으로 요구한다. 프롬프트 문자열은
 *    prompt/ 아래에 있고, 이 파일은 순수 규칙·상수·예산만 갖는다.
 *    import 도 두지 않는다 — 브라우저와 서버가 똑같이 읽어야 해서다.
 */

/* ── 기능 목록 ──────────────────────────────────────────── */

export const FUNCS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6']

/** 채팅 입력으로 발동하는 기능 */
export const CHAT_FUNCS = ['F1', 'F2', 'F3', 'F6']

/** 관찰자(틱·이벤트)로만 발동하는 기능. 채팅 라우터를 아예 타지 않는다 */
export const OBSERVER_FUNCS = ['F4', 'F5']

/**
 * 설정 화면이 쓰는 표시 정보.
 *
 * pairWith 는 "이 둘은 같은 캐릭터여야 한다"는 뜻이다. F6 는 F1 의 에스컬레이션
 * 경로라 중간에 화자가 바뀌면 대화가 끊긴다.
 * alwaysOn 은 배정에서 뺄 수 없다는 뜻 — 목표 되묻기와 먼저 말 걸기는
 * 각각 이 둘이 단독으로 책임진다.
 */
export const FUNC_META = {
  F1: { label: '개념 해설', hint: '모르는 걸 물으면 짧게 답한다', pairWith: 'F6' },
  F2: { label: '구조 정리', hint: '흩어진 내용을 표·순서로 압축한다' },
  F3: { label: '인출 점검', hint: '거꾸로 질문을 던진다' },
  F4: { label: '목표 추적', hint: '세션 목표를 기억했다 되묻는다', alwaysOn: true },
  F5: { label: '페이스 케어', hint: '이탈·무활동·과열에 먼저 말 건다', alwaysOn: true },
  F6: { label: '심화 해설', hint: '하나를 좁게, 깊게 판다', pairWith: 'F1' },
}

/* ── 예산·형식의 단일 출처 ──────────────────────────────── */

/**
 * 길이 제약이 예전엔 여섯 군데에 흩어져 있었다 — 페르소나 문구 두 겹, 서버 토큰 상한,
 * 잘림 방지 재호출, 사고 몫 가산, 화면의 개별 덮어쓰기. 서로 다른 값을 말하고 있었고
 * 어느 것이 이기는지 아무도 몰랐다. 이제 여기 하나만 본다.
 *
 *  maxChars      말풍선 분량의 **목표**. 자르는 데 쓰지 않는다 — 얼마나 튀는지 재기만 한다.
 *                (품질 우선 결정. postprocess.js 주석 참고)
 *  maxTokens     모델에게 줄 답변 몫. **사고 몫은 별도로 더해진다** (providers.mjs)
 *  thinking      사고 수준
 *  useKnowledge  전공지식 뱅크를 검색할 것인가
 *  useSearch     뱅크가 비었을 때 구글 검색까지 쓸 것인가 (S1 유료키에서만 동작)
 *  wantsPro      뱅크 적중과 무관하게 상위 모델로 올릴 것인가
 *  toneIntensity 'full' | 'low' — 짧은 발화는 말투 특징을 하나만 쓴다
 *  stateKeys     프롬프트의 [지금 상태] 블록에 넣을 항목
 */
export const FUNC_SPEC = {
  F1: {
    maxChars: 120,
    maxTokens: 900,
    /**
     * 개념을 틀리게 말하는 게 제일 나쁘다.
     *
     * medium 이었는데 실제로 써 보니 틀린 설명이 나왔다. 지연이 조금 늘어도
     * 맞는 걸 말하는 쪽이 낫다 — 학생이 틀린 개념을 배워 가는 것보다 1초 기다리는 게 싸다.
     */
    thinking: 'high',
    useKnowledge: true,
    useSearch: true,
    // 뱅크에 없는 전공 질문이 값싼 모델로 떨어지면 안 된다. 품질이 우선이라는 결정이다.
    // 뱅크가 비면 검색까지 붙는데, 그건 상위 키에서만 동작한다
    wantsPro: true,
    toneIntensity: 'full',
    stateKeys: [],
  },
  F2: {
    maxChars: 240,
    maxTokens: 1200,
    thinking: 'medium',
    // 정리·비교야말로 근거가 **더** 필요하다. 뱅크에 "UDP와 TCP", "인덱스/B트리 비교",
    // "정규화" 항목이 있는데 이 기능만 검색을 끄면 그 질문들이 통째로 근거를 잃는다
    useKnowledge: true,
    // 정리·비교도 근거가 틀리면 의미가 없다
    useSearch: true,
    wantsPro: true,
    toneIntensity: 'full',
    stateKeys: [],
  },
  F3: {
    maxChars: 60,
    maxTokens: 400,
    thinking: 'low',
    useKnowledge: false,
    useSearch: false,
    wantsPro: false,
    // 60자 이하 발화에 말투 특징을 다 넣으면 캐릭터가 아니라 캐리커처가 된다
    toneIntensity: 'low',
    stateKeys: ['goalText', 'recentTopics'],
  },
  F4: {
    maxChars: 50,
    maxTokens: 400,
    thinking: 'low',
    useKnowledge: false,
    useSearch: false,
    wantsPro: false,
    toneIntensity: 'low',
    stateKeys: ['goalText', 'progressText', 'elapsedMin'],
  },
  F5: {
    maxChars: 40,
    maxTokens: 400,
    thinking: 'low',
    useKnowledge: false,
    useSearch: false,
    wantsPro: false,
    toneIntensity: 'low',
    stateKeys: ['event', 'awayMin', 'streakMin'],
  },
  F6: {
    maxChars: 500,
    maxTokens: 3000,
    // 깊게 파는 게 이 기능의 전부다. 여기서 사고를 아끼면 기능이 없는 것과 같다
    thinking: 'high',
    useKnowledge: true,
    useSearch: true,
    // 심화는 뱅크가 비어도 상위 모델로 간다. 깊게 파는 게 이 기능의 전부다
    wantsPro: true,
    toneIntensity: 'full',
    stateKeys: ['lastAnswer'],
  },
}

/** 자료 읽기·소개처럼 캐릭터 기능이 아닌 내부 호출 */
export const SYS_SPEC = {
  'sys:extract': {
    maxChars: 0, // 분량을 재지도 않는다 — 자료 원문을 옮기는 작업이다
    /**
     * 논문 한 편이 들어갈 예산.
     *
     * 8,000 이었다가 실측에서 터졌다. 10쪽 논문이 9,700토큰이라 첫 호출이 잘리고,
     * 잘리면 **처음부터 다시** 읽는다. 두 번 재시도하면 같은 문서를 세 번 읽는 셈이라
     * 100초를 넘고, 그러면 Cloudflare 가 524 로 끊는다. 사용자에게는
     * "문서를 못 읽는다"로만 보인다.
     *
     * 예산을 키워도 **짧은 문서는 값이 안 오른다** — 생성한 만큼만 쓴다.
     * 실측: 예산 24,000 이나 40,000 이나 같은 34.8초·9,703토큰.
     */
    maxTokens: 24000,
    thinking: 'low',
    /**
     * 잘려도 다시 읽지 않는다.
     *
     * 다른 기능은 잘리면 예산을 키워 다시 부르는 게 맞다. 답이 문장 중간에서 끊기는 것보다
     * 낫기 때문이다. 그런데 자료 읽기는 입력이 통째로 다시 들어가서 **시간이 배로 든다.**
     * 잘린 앞부분이라도 있는 게, 시간 초과로 아무것도 못 받는 것보다 낫다.
     */
    widen: false,
    useKnowledge: false,
    useSearch: false,
    wantsPro: true,
    toneIntensity: 'none',
    stateKeys: [],
  },
  /**
   * 기습 질문 — **별도 창에서 눌러서 답한다.**
   *
   * 예전엔 캐릭터가 채팅으로 문제를 내고, 사용자의 **다음 메시지가 무엇이든** 답안으로
   * 채점했다. "이 자료 요약해줘"라고 물어도 퀴즈 답으로 처리되고 원래 질문은 사라졌다.
   * 창을 따로 띄우면 답이 채팅 입력창을 지나가지 않으므로 그 버그가 구조적으로 없어진다.
   *
   * 클릭으로 답하려면 선택지가 필요하고, 선택지를 받으려면 모양이 정해진 JSON 이어야 한다.
   */
  'sys:quiz': {
    maxChars: 0,
    maxTokens: 1200,
    thinking: 'medium',
    useKnowledge: true,
    useSearch: false,
    wantsPro: true,
    toneIntensity: 'none',
    stateKeys: ['goalText', 'recentTopics'],
    json: {
      type: 'OBJECT',
      properties: {
        question: { type: 'STRING' },
        choices: { type: 'ARRAY', items: { type: 'STRING' } },
        answerIndex: { type: 'INTEGER' },
        explanation: { type: 'STRING' },
      },
      required: ['question', 'choices', 'answerIndex', 'explanation'],
    },
  },

  /**
   * 엔딩 요약 — 오늘 공부한 것을 정리한다.
   *
   * 한 세션에 한 번뿐인 호출이고 결과가 화면 절반을 채운다. 값싸게 굴 자리가 아니다.
   * 스키마를 강제하지 않으면 코드펜스로 감싸거나 필드 이름을 바꿔서 파싱이 깨지는데,
   * 하필 세션 끝에서 터지면 그날 공부한 걸 통째로 못 보여준다.
   */
  'sys:review': {
    maxChars: 0,
    maxTokens: 8000,
    thinking: 'medium',
    useKnowledge: false,
    useSearch: false,
    wantsPro: true,
    toneIntensity: 'none',
    stateKeys: [],
    json: {
      type: 'OBJECT',
      properties: {
        conceptGroups: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              domain: { type: 'STRING' },
              label: { type: 'STRING' },
              concepts: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  properties: { title: { type: 'STRING' }, markdown: { type: 'STRING' } },
                  required: ['title', 'markdown'],
                },
              },
            },
            required: ['domain', 'label', 'concepts'],
          },
        },
        deepeningPoints: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: { title: { type: 'STRING' }, body: { type: 'STRING' } },
            required: ['title', 'body'],
          },
        },
        trueFalseQuizzes: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              statement: { type: 'STRING' },
              answer: { type: 'BOOLEAN' },
              explanation: { type: 'STRING' },
            },
            required: ['statement', 'answer', 'explanation'],
          },
        },
        summaryText: { type: 'STRING' },
        downloadSummaryMarkdown: { type: 'STRING' },
      },
      required: [
        'conceptGroups',
        'deepeningPoints',
        'trueFalseQuizzes',
        'summaryText',
        'downloadSummaryMarkdown',
      ],
    },
  },

  'sys:docIntro': {
    maxChars: 200,
    maxTokens: 900,
    thinking: 'low',
    useKnowledge: false,
    useSearch: false,
    wantsPro: true,
    toneIntensity: 'full',
    stateKeys: [],
  },
}

/** 알 수 없는 키가 와도 앱이 멈추지 않게 한다. 대신 기본값을 썼다는 사실을 남긴다 */
export function resolveSpec(funcId) {
  return FUNC_SPEC[funcId] || SYS_SPEC[funcId] || FUNC_SPEC.F1
}

/**
 * 방 전체 설정의 답변 길이는 **F1 에만** 배율로 적용한다.
 *
 * 기능마다 분량이 규정돼 있는데(페이스 케어 40자, 심화 300~500자) 전역 축이 그대로
 * 남으면 "짧게"를 고른 사용자에게 심화 해설의 300자가 프롬프트와 토큰 예산 양쪽에서
 * 동시에 부정당한다. 그래서 전역 축은 기본 답변(F1)의 상한만 움직인다.
 */
const LENGTH_SCALE = { short: 0.67, brief: 1, detailed: 1.5 }

export function effectiveSpec(funcId, settings = {}) {
  const spec = resolveSpec(funcId)
  if (funcId !== 'F1') return spec
  const k = LENGTH_SCALE[settings.replyLength] ?? 1
  if (k === 1) return spec
  return {
    ...spec,
    maxChars: Math.round(spec.maxChars * k),
    maxTokens: Math.round(spec.maxTokens * k),
  }
}

/* ── 라우팅 규칙 ────────────────────────────────────────── */

/**
 * 규칙 순서가 곧 우선순위다. 위에서부터 처음 걸리는 것이 이긴다.
 * LLM 분류를 쓰지 않는다 — 분류에 한 번 더 왕복하면 첫 응답이 눈에 띄게 늦고,
 * 틀렸을 때 왜 틀렸는지 볼 방법이 없다.
 */
export const ROUTE_RULES = [
  { funcId: 'F3', re: /퀴즈|문제\s*내|내줘|테스트|외웠|맞나|확인해|물어봐|질문해/ },
  { funcId: 'F2', re: /정리|요약|표로|흐름|순서|한눈에|비교|차이/ },
  /**
   * ⚠️ 한국어는 활용한다. `자세히` 만 적으면 `자세하게`·`자세하고`·`자세한` 을 놓친다.
   *    실제로 "좀더 자세하게 설명해주라" 가 기본 답변(120자)으로 떨어졌다.
   *    낱말이 아니라 **어간**으로 잡는다. `자세[히하]` 는 자세히·자세하게·자세하고·자세한을
   *    다 잡으면서 "자세를 바꿔"(몸가짐) 는 안 잡는다.
   */
  {
    funcId: 'F6',
    re: /자세[히하한]|깊[게이은]|제대로|처음부터|원리|어떻게 그렇게|왜 그렇게|길게|길고|풀어서/,
  },
]

/**
 * 앞 답변을 더 파고들겠다는 신호.
 *
 * 기능 문서는 "직전이 F1일 때"만 적었다. 그런데 심화 해설을 듣고 "더"라고 하면
 * 어느 규칙에도 안 걸려 짧은 답(F1)으로 떨어진다 — 더 물었는데 답이 짧아지는
 * 이상한 회귀다. 그래서 **직전이 F1이든 F6이든** 에스컬레이션으로 받는다.
 *
 * ⚠️ `더` 는 한 글자라 낱말 경계를 반드시 걸어야 한다. 안 걸면 "덥다"·"더미 데이터"·
 *    "어디더라" 안에서도 걸려서, 잡담 한마디가 500자짜리 심화 해설로 튄다.
 */
export const ESCALATE_RE =
  /(?:^|[\s,.])더(?=[\s,.?!]|$)|자세[히하한]|깊[게이]|길게|길고|잘 모르겠|모르겠|이해가 안|이해 안|무슨 말|어려워|어렵다/

/** 에스컬레이션이 살아 있는 시간. 지나면 새 대화로 본다 */
export const ESCALATE_TTL_MS = 5 * 60 * 1000

/**
 * 부정 어미. "퀴즈 말고 정리해줘"가 퀴즈로 새는 걸 막는다.
 *
 * 첫 매치가 이기는 구조라 이걸 안 보면 문장의 뒷부분(진짜 요구)이 통째로 무시된다.
 * 낱말 바로 뒤 6글자 안에서만 본다 — 멀리 떨어진 "말고"는 다른 절의 것이다.
 */
const NEGATION_RE = /^\s*(?:는|은|을|를|이|가)?\s*(?:말고|말구|대신|빼고|아니고|아니라|이외|외에)/
const NEGATION_WINDOW = 8

function negatedAt(text, idx, len) {
  return NEGATION_RE.test(text.slice(idx + len, idx + len + NEGATION_WINDOW))
}

/** 부정되지 않은 첫 매치를 찾는다 */
function liveMatch(text, re) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
  let m
  while ((m = g.exec(text)) !== null) {
    if (!negatedAt(text, m.index, m[0].length)) return m.index
    if (m.index === g.lastIndex) g.lastIndex++ // 빈 매치 방어
  }
  return -1
}

/** @멘션은 라우팅 낱말이 아니다. "@미나 정리해줘"에서 이름이 규칙에 끼어들지 않게 */
const MENTION_RE = /@[^\s]{1,12}/g

/**
 * 무엇을 말할지 정한다.
 *
 * @param {string} text 사용자 입력
 * @param {{lastFunc?:string, lastAt?:number, now?:number}} ctx
 *        lastFunc 는 **세션 전역 1슬롯**이다. 좌석별로 두면 "미나에게 물음 →
 *        테오와 딴 얘기 → '더 자세히'"에서 죽은 맥락이 되살아난다.
 * @returns {{funcId:string, rule:string}}
 */
export function routeFunction(text, ctx = {}) {
  const raw = String(text || '')
  const t = raw.replace(MENTION_RE, ' ').trim()
  if (!t) return { funcId: 'F1', rule: 'empty' }

  const { lastFunc = null, lastAt = 0, now = 0 } = ctx
  const fresh = lastAt > 0 && now > 0 ? now - lastAt < ESCALATE_TTL_MS : true

  // 규칙 0 — 앞 답변을 더 파고들겠다는 신호가 다른 어떤 규칙보다 먼저다.
  // 이게 아래로 내려가면 "방금 그거 더 자세히"가 퀴즈 요청으로 새어 캐릭터가
  // 갑자기 문제를 낸다
  if (fresh && (lastFunc === 'F1' || lastFunc === 'F6') && liveMatch(t, ESCALATE_RE) >= 0) {
    return { funcId: 'F6', rule: 'escalate' }
  }

  for (const { funcId, re } of ROUTE_RULES) {
    if (liveMatch(t, re) >= 0) return { funcId, rule: `keyword:${funcId}` }
  }

  return { funcId: 'F1', rule: 'default' }
}

/* ── 기능 배정 ──────────────────────────────────────────── */

/**
 * 배정은 좌석 배열이 아니라 **방 전체의 맵 하나**에 둔다.
 *
 * 맵으로 두면 중복 배정과 미배정이 자료 구조상 표현 불가능해진다.
 * 좌석 배열에 두면 세 좌석을 동시에 고칠 때 중간 상태가 저장되고,
 * "F4 를 아무도 안 맡은 방"이 만들어질 수 있다.
 *
 * 기본값의 근거 — F1+F6 은 같은 자리(문서 강제), F4 와 F5 는 **다른 자리**여야 한다.
 * 한 자리에 몰면 그 자리 참여를 끄는 순간 핵심 시연 두 개가 동시에 사라진다.
 */
export const DEFAULT_OWNER = { F1: 1, F6: 1, F2: 2, F4: 2, F3: 3, F5: 3 }

export function ownerSlot(settings, funcId) {
  const map = settings?.functionOwner || DEFAULT_OWNER
  return map[funcId] ?? DEFAULT_OWNER[funcId] ?? 1
}

/** 규칙 위반을 사람이 읽을 문장으로. 설정 창이 그대로 띄운다 */
export function validateOwner(map) {
  const m = { ...DEFAULT_OWNER, ...(map || {}) }
  const out = []
  if (m.F1 !== m.F6) out.push('개념 해설과 심화 해설은 같은 캐릭터가 맡아야 해요.')
  if (m.F4 === m.F5) out.push('목표 추적과 페이스 케어는 다른 캐릭터에게 나눠 주세요.')
  const count = {}
  for (const f of FUNCS) count[m[f]] = (count[m[f]] || 0) + 1
  for (const [slot, n] of Object.entries(count)) {
    if (n > 2) out.push(`${slot}번 자리가 기능을 ${n}개 맡았어요. 한 자리에 두 개까지예요.`)
  }
  return out
}

/* ── 시간 ───────────────────────────────────────────────── */

/**
 * 시연용 프로필.
 *
 * 임계값만 줄이면 소용이 없다 — 틱이 15초면 90초 동안 판정 기회가 6번뿐이다.
 * 그래서 틱 자체를 같이 줄인다.
 *
 * **말하는 시간을 0으로 놓지 않는다.** 캐릭터가 말하는 동안은 발언권을 쥐고 있어
 * 다음 판정이 멈춘다. 우리 실측이 약 7자/초라 심화 해설 한 번이 그것만으로
 * 40초를 먹는다. 그래서 시연 프로필은 **음성을 끄고**(ttsOff) 돌린다 —
 * 목소리는 따로 한 번만 들려주는 게 여섯 기능을 다 보여주는 것보다 낫다.
 */
export const TIMING = {
  normal: {
    tickMs: 15_000,
    goalAskMin: 25, // F4 — 이만큼 지나야 목표를 되묻는다
    goalMaxAsk: 2, // 세션당 2회까지
    idleMin: 10, // F5 무활동
    awayReturnSec: 60, // F5 복귀 — 이 이상 비웠다 와야 알은척한다
    overheatMin: 50, // F5 과열
    paceCooldownMin: 10, // F5 는 한 번 말하면 이만큼 침묵
    quizAfterMin: 25, // F3 출제
    quizDropMin: 5, // 답 없는 대기 질문은 조용히 폐기
    ttsOff: false,
  },
  demo: {
    tickMs: 3_000,
    goalAskMin: 0.5,
    goalMaxAsk: 2,
    idleMin: 0.4,
    awayReturnSec: 8,
    overheatMin: 1.5,
    paceCooldownMin: 0.4,
    quizAfterMin: 0.7,
    quizDropMin: 2,
    // 음성을 켜면 여섯 기능을 90초에 못 보여준다. 시연에서는 끈다
    ttsOff: true,
  },
}

/** `?demo=1` 로만 켠다. 저장하지 않는다 — 시연 값이 사용자 설정에 새면 안 된다 */
export function resolveTiming(search = '') {
  try {
    return new URLSearchParams(search).get('demo') === '1' ? TIMING.demo : TIMING.normal
  } catch {
    return TIMING.normal
  }
}
