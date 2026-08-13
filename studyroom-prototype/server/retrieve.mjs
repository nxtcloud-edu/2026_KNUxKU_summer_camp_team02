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
// 낱말 처리는 브라우저(사용자 자료 검색)와 공유한다 — 두 벌로 두면 갈라진다
import { tokenize, bigrams, flat, queryGroups } from '../src/lib/textSearch.js'

// 주제어 하나만 정확히 맞은 질문("인덱스 걸면 왜 빨라져")이 2.0×1.15=2.3 이다.
// 그게 통과해야 하므로 문턱은 그 바로 아래에 둔다. 오탐은 아래 NEG 시험으로 확인했다.
const MIN_SCORE = 2.2
const TOP_K = 3
const MAX_CHARS = 1400 // 주입 본문 총량 상한

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
