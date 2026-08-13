/**
 * 전공지식 검색 — src/data/csbank 에서 근거를 찾는다.
 *
 * 벡터 임베딩을 쓰지 않는다. 항목이 수백 개 규모라 어휘 점수로 충분하고,
 * 임베딩은 호출 지연·비용·"모든 기억 초기화 시 벡터도 지워야 하나" 같은 문제를 데려온다.
 * 자유 회상이 실제로 필요해지면 그때 벡터를 얹는다.
 *
 * ⚠️ 검색 결과를 무조건 넣지 않는다. 점수가 문턱을 못 넘으면 넣지 않는 게 낫다.
 *    연관 없는 조각은 답을 흐린다.
 *
 * 한국어 CS 질문에서 실측한 세 가지 실패를 각각 막는다 (§ 아래 주석 참고):
 *   1) 답변 본문 미색인 — "서브넷 마스크"는 답변에만 있고 주제어는 "서브네팅"뿐이었다
 *   2) 어간 변형     — 서브넷 ↔ 서브네팅 은 부분일치도 안 걸린다 (넷≠네)
 *   3) 음차 ↔ 한자어  — 오버피팅 ↔ 과적합, 데드락 ↔ 교착상태
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

// 주제어 하나만 정확히 맞은 질문("인덱스 걸면 왜 빨라져")이 2.0×1.15=2.3 이다.
// 그게 통과해야 하므로 문턱은 그 바로 아래에 둔다. 오탐은 아래 NEG 시험으로 확인했다.
const MIN_SCORE = 2.2
const TOP_K = 3
const MAX_CHARS = 1400 // 주입 본문 총량 상한

/** 한국어 조사·어미를 대충 떼어낸다. 형태소 분석기 없이 갈 수 있는 선까지만 */
const PARTICLES =
  /(으로써|으로서|이라고|라고|에서는|에게서|한테서|으로는|에서|에게|한테|께서|보다|처럼|만큼|부터|까지|마다|조차|라도|이나|나마|든지|이며|하고|이랑|으로|과|와|을|를|이|가|은|는|의|에|도|로|만|랑|야|아)$/

const STOP = new Set([
  '그리고','근데','그런데','그래서','하지만','왜','뭐','좀','안','못','더','또','저','이','그','것','거','수','때','중','내','네','너','나',
  '어떻게','어떤','무엇','뭔가','알려줘','설명해줘','알려','설명','해줘','해','줘','되','돼','있','없','같','거야','인가','인지','일까',
  '뭐야','뭔데','헷갈려','모르겠어','알려주라','궁금해','같아','건데','는데','면','때문','대해','관해','진짜','정말','너무','조금',
  // 공부방 잡담에 늘 나오지만 전공 질의어는 아닌 말.
  // 빈도로는 못 거른다 — "시간"과 "인덱스"가 똑같이 11개 항목에 나온다. 뜻으로 걸러야 한다.
  '시간','문제','방법','얼마나','다음','우리','오늘','공부','정도','부분','생각','이야기','얘기','시작','마지막',
  '어렵다','어려워','쉽다','쉬워','이거','저거','그거','다시','아직','벌써','이제','아까','나중','먼저',
  // 서술어. "오버피팅 어떻게 막아"의 '막아'가 엉뚱한 항목의 질문 문장과 맞아 근거로 딸려 들어왔다
  '막아','막는','막을','막지','생기','생겨','나면','되면','하면','쓰면','좋아','좋을','필요','사용','쓰는','쓸때','일어나','발생',
  '있어','있어야','있는','있을','없어','없는','알고','아는','모르','많이','적게','너네','너희','자기','서로','같이',
])

/**
 * 음차어 ↔ 한자어/우리말. 같은 줄에 있는 말은 서로를 불러온다.
 * 학생은 "오버피팅"이라 묻고 뱅크는 "과적합"이라 적혀 있는 일이 흔하다.
 */
const SYNONYM_GROUPS = [
  ['교착상태', '데드락', 'deadlock'],
  ['과적합', '오버피팅', 'overfitting'],
  ['과소적합', '언더피팅', 'underfitting'],
  ['서브넷', '서브네팅', '서브넷마스크', 'subnet', 'subnetting'],
  ['인덱스', '인덱싱', 'index'],
  ['퀵정렬', '퀵소트', 'quicksort'],
  ['병합정렬', '머지소트', 'mergesort'],
  ['힙정렬', '힙소트', 'heapsort'],
  ['스레드', '쓰레드', 'thread'],
  ['캐시', '캐쉬', 'cache'],
  ['해시', '해쉬', 'hash', '해싱'],
  ['문맥교환', '컨텍스트스위칭', '컨텍스트스위치', 'contextswitch'],
  ['경쟁조건', '레이스컨디션', '경쟁상태', 'racecondition'],
  ['상호배제', '뮤텍스', 'mutex'],
  ['세마포어', '세마포', 'semaphore'],
  ['가상메모리', '페이징', 'paging'],
  ['페이지폴트', '페이지부재', 'pagefault'],
  ['역전파', '백프로파게이션', 'backpropagation'],
  ['경사하강', '경사하강법', 'gradientdescent'],
  ['동적계획법', '다이나믹프로그래밍', 'dp'],
  ['이진탐색', '바이너리서치', 'binarysearch'],
  ['너비우선', '너비우선탐색', 'bfs'],
  ['깊이우선', '깊이우선탐색', 'dfs'],
  ['최단경로', '다익스트라', 'dijkstra'],
  ['정규화', '레귤러라이제이션', 'regularization'],
  ['트랜잭션', 'transaction'],
  ['격리수준', '고립수준', 'isolation'],
  ['부하분산', '로드밸런싱', 'loadbalancing'],
  ['대칭키', '비밀키', '공개키', '비대칭키'],
  ['인증', '인가', '권한', 'authentication', 'authorization'],
  ['혼잡제어', 'congestion'],
  ['흐름제어', 'flowcontrol'],
  ['핸드셰이크', '핸드쉐이크', 'handshake'],
  ['교차사이트스크립팅', 'xss'],
  ['점근표기법', '시간복잡도', '빅오', '빅오표기법', 'bigo'],
  ['우선순위역전', '우선순위전도'],
  ['유니온파인드', '분리집합', 'unionfind'],
  ['스래싱', '쓰래싱', 'thrashing'],
  ['단편화', '파편화', 'fragmentation'],
  ['재귀', '재귀호출', 'recursion'],
  ['정합성', '일관성', 'consistency'],
]

/** 낱말 → 같은 뜻 낱말들 */
const SYN = new Map()
for (const g of SYNONYM_GROUPS) {
  for (const w of g) {
    const cur = SYN.get(w) || new Set()
    for (const o of g) if (o !== w) cur.add(o)
    SYN.set(w, cur)
  }
}

/**
 * 낱말을 뽑는다. 조사를 뗀 형태와 **떼지 않은 원형을 둘 다** 남긴다.
 *
 * 조사 규칙만 믿으면 "시간복잡도"의 끝 "도"를 조사로 보고 "시간복잡"으로 만든다.
 * 정확도·난이도·선택도도 마찬가지다. 형태소 분석기 없이 이걸 구분할 방법은 없으니
 * 두 형태를 다 넣고 맞는 쪽이 이기게 둔다.
 */
function tokenize(s) {
  const out = []
  for (const w0 of String(s || '')
    .toLowerCase()
    .replace(/[^0-9a-z가-힣\s+#-]/g, ' ')
    .split(/\s+/)) {
    if (!w0) continue
    const stripped = w0.replace(PARTICLES, '')
    for (const w of new Set([w0, stripped])) {
      if (w.length >= 2 && !STOP.has(w)) out.push(w)
    }
  }
  return out
}

/**
 * 한글 2글자 조각. "서브네팅" → 서브·브네·네팅
 * 조사 제거로는 못 잡는 어간 변형(서브넷/서브네팅)을 여기서 잡는다.
 */
function bigrams(s) {
  const out = new Set()
  for (const w of tokenize(s)) {
    if (w.length < 3) continue
    for (let i = 0; i < w.length - 1; i++) out.add(w.slice(i, i + 2))
  }
  return out
}

const flat = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]/g, '')

/** 같은 뜻 낱말들의 대표 이름. 한 뜻은 한 번만 센다 */
function canonOf(t) {
  const g = SYN.get(t)
  return g ? [...g, t].sort()[0] : t
}

/**
 * 질의를 "뜻 뭉치"들로 나눈다. 각 뭉치는 같은 뜻의 표현들을 모아 놓은 것이고,
 * 채점할 때는 뭉치 안에서 **가장 잘 맞는 하나**만 센다.
 *
 * 이렇게 안 하면 "서브넷"(답변에만 있음, 0.8)을 먼저 세고
 * "서브네팅"(주제어, 2.0)을 중복이라며 버리는 일이 생긴다.
 */
function queryGroups(tokens) {
  const groups = new Map() // 대표이름 → Set<표현>
  const add = (t) => {
    const c = canonOf(t)
    const s = groups.get(c) || new Set()
    s.add(t)
    for (const syn of SYN.get(t) || []) s.add(syn)
    groups.set(c, s)
  }
  for (const t of tokens) add(flat(t))
  // "컨텍스트 스위칭"처럼 두 낱말이 붙어야 뜻이 되는 경우
  for (let i = 0; i < tokens.length - 1; i++) {
    const j = flat(tokens[i] + tokens[i + 1])
    if (SYN.has(j)) add(j)
  }
  return [...groups.values()]
}

let CACHE = null

/** 뱅크를 읽는다. 파일이 아직 없으면 빈 배열 — 뱅크 없이도 앱은 돌아야 한다 */
export function loadBank(dir) {
  if (CACHE && CACHE.dir === dir && Date.now() - CACHE.at < 30_000) return CACHE.items
  const items = []
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json') || f === 'index.json') continue
      try {
        const raw = JSON.parse(readFileSync(join(dir, f), 'utf-8'))
        if (Array.isArray(raw)) items.push(...raw)
      } catch (e) {
        console.warn(`[retrieve] ${f} 파싱 실패 — 건너뜁니다`, e.message)
      }
    }
  }
  for (const it of items) {
    const title = `${it.topic || ''} ${it.question || ''} ${(it.tags || []).join(' ')}`
    // 제목(주제어+질문)과 본문(답변)을 나눠 둔다. 본문 일치는 약한 신호다
    it._title = new Set(tokenize(title))
    it._body = new Set(tokenize(it.answer))
    it._bi = bigrams(title)
    // 주제어를 띄어쓰기·기호 없이 붙인 것. "퀵 정렬"의 "퀵"은 1글자라 낱말로는 살아남지 못한다
    it._topicFlat = flat(it.topic)
  }

  // 흔한 낱말은 값을 깎는다.
  // "오늘 몇 시간 공부했지"의 "시간"이 주제어와 정확히 맞아 근거를 끌고 오는 걸 막는다.
  const df = new Map()
  for (const it of items) {
    for (const t of new Set([...it._title, ...it._body])) df.set(t, (df.get(t) || 0) + 1)
  }
  const common = Math.max(4, Math.round(items.length * 0.15))
  const weight = new Map()
  for (const [t, n] of df) weight.set(t, n <= common ? 1 : Math.max(0.25, common / n))

  CACHE = { dir, at: Date.now(), items, weight }
  return items
}

/** 낱말의 변별력 (흔할수록 낮다) */
function idf(t) {
  return CACHE?.weight?.get(t) ?? 1
}

/** 낱말 하나가 항목에 얼마나 맞는지 (0 이면 안 맞음) */
function tokenScore(t, it) {
  if (it._title.has(t)) return 2.0 // 주제어·질문에 그대로 있다
  // 주제어를 붙여 쓴 형태와 맞는가 ("퀵소트" → 동의어 "퀵정렬" → 주제어 "퀵 정렬")
  if (t.length >= 3 && it._topicFlat.length >= 3) {
    if (it._topicFlat.includes(t) || t.includes(it._topicFlat)) return 2.0
  }
  if (it._body.has(t)) return 0.8 // 답변 본문에만 있다 — 약한 신호
  if (t.length >= 3) {
    for (const k of it._title) {
      if (k.length >= 3 && (k.includes(t) || t.includes(k))) return 0.7 // 부분 일치
    }
    // 어간이 갈린 경우: 2글자 조각이 절반 이상 겹치면 같은 말로 본다
    const tb = []
    for (let i = 0; i < t.length - 1; i++) tb.push(t.slice(i, i + 2))
    if (tb.length) {
      const hit = tb.filter((b) => it._bi.has(b)).length
      if (hit / tb.length >= 0.5) return 0.6
    }
  }
  return 0
}

/**
 * @returns {Array<{item:object, score:number}>}
 */
export function search(query, dir, { topK = TOP_K, minScore = MIN_SCORE } = {}) {
  const items = loadBank(dir)
  if (!items.length) return []

  const q = tokenize(query)
  if (!q.length) return []
  const groups = queryGroups(q)

  const scored = []
  for (const it of items) {
    let score = 0
    // 뜻 뭉치마다 가장 잘 맞는 표현 하나만 센다. 동의어로 점수가 불어나지 않는다
    for (const forms of groups) {
      let best = 0
      for (const t of forms) {
        const s = tokenScore(t, it) * idf(t)
        if (s > best) best = s
      }
      score += best
    }
    // 주제어가 질의에 그대로 들어 있으면 강한 신호
    if (it.topic && query.includes(it.topic)) score += 3
    // 검산된 항목을 우대한다 — 근거로서 신뢰도가 다르다
    if (it.verified) score *= 1.15
    if (score > 0) scored.push({ item: it, score })
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.filter((s) => s.score >= minScore).slice(0, topK)
}

/** 검색 결과를 프롬프트에 넣을 문자열로. 길이 상한을 지킨다 */
export function toContext(hits) {
  if (!hits.length) return ''
  const lines = ['[참고 자료 — 아래 내용을 근거로 답하되, 그대로 읽지 말고 네 말투로 풀어서 설명한다]']
  let used = 0
  for (const { item } of hits) {
    const body = `\n· ${item.topic}: ${item.answer}`
    if (used + body.length > MAX_CHARS) break
    lines.push(body)
    used += body.length
  }
  if (lines.length === 1) return ''
  lines.push('\n[참고 자료 끝. 자료에 없는 내용을 지어내지 않는다.]')
  return lines.join('')
}

/** 뱅크 상태 — /api/health 에서 보여준다 */
export function bankStats(dir) {
  const items = loadBank(dir)
  const byDomain = {}
  for (const it of items) {
    const d = it.domain || '?'
    byDomain[d] = byDomain[d] || { total: 0, verified: 0 }
    byDomain[d].total += 1
    if (it.verified) byDomain[d].verified += 1
  }
  return { total: items.length, byDomain, exists: existsSync(dir) && statSync(dir).isDirectory() }
}
