/**
 * 내가 올린 자료에서 근거를 찾는다 — **계정별 RAG**.
 *
 * 전공지식 뱅크(server/retrieve.mjs)는 모두가 같이 쓰는 공용 자료다.
 * 이건 반대다. 내가 올린 강의자료·정리본만 들어 있고, 계정 칸이 갈려 있어
 * 남의 자료가 섞이지 않는다 (store/db.js 의 저장 칸이 계정마다 하나씩).
 *
 * ⚠️ 자료는 **브라우저 밖으로 나가지 않는다.** 질문에 필요한 조각만 그때 프롬프트에 실린다.
 *    카메라 판정을 기기 안에서만 돌리는 것과 같은 이유다.
 *
 * 낱말 처리는 뱅크와 같은 것을 쓴다 (lib/textSearch.js). 동의어를 한쪽에만
 * 추가하는 일이 없어야 해서 부품을 공유한다.
 */

import { db } from '../store/db'
import { tokenize, queryGroups, flat } from './textSearch'

/** 한 조각의 길이. 너무 잘게 쪼개면 문맥이 끊기고, 크면 엉뚱한 부분까지 딸려 온다 */
const CHUNK_CHARS = 700
const CHUNK_OVERLAP = 120

/**
 * 문턱. 뱅크(2.2)보다 낮게 잡는다 — 내가 올린 자료는 애초에 내 관심사라
 * 조금만 걸려도 보여주는 게 낫다. 다만 0 은 아니다. 아무 말에나 자료가 딸려 오면
 * 답이 흐려지는 건 똑같다.
 */
const MIN_SCORE = 1.5
const TOP_K = 3
const MAX_CHARS = 1400

/** 자료 하나를 조각으로 나눈다. 문단 경계를 되도록 지킨다 */
function chunk(text) {
  const out = []
  const s = String(text || '')
  let i = 0
  while (i < s.length) {
    let end = Math.min(s.length, i + CHUNK_CHARS)
    if (end < s.length) {
      // 문단·문장 경계에서 끊는다. 없으면 그냥 자른다
      const win = s.slice(i, end)
      const cut = Math.max(win.lastIndexOf('\n\n'), win.lastIndexOf('\n'), win.lastIndexOf('. '))
      if (cut > CHUNK_CHARS * 0.5) end = i + cut + 1
    }
    const body = s.slice(i, end).trim()
    if (body) out.push(body)
    if (end >= s.length) break
    i = Math.max(i + 1, end - CHUNK_OVERLAP)
  }
  return out
}

/**
 * 조각 색인은 비싸다. 자료가 그대로면 다시 만들지 않는다.
 * 키는 자료 id + 길이 — 덮어쓰기로 내용이 바뀌면 길이도 대개 바뀐다.
 */
const cache = new Map()

function indexOf(doc) {
  const key = `${doc.id}:${doc.chars}`
  const hit = cache.get(key)
  if (hit) return hit
  const nameTokens = new Set(tokenize(doc.name))
  // 붙여 쓴 원문도 들고 있는다 — 굴절을 잡는 데 쓴다 (scoreToken 주석)
  const parts = chunk(doc.text).map((body) => ({
    body,
    tokens: new Set(tokenize(body)),
    flatBody: flat(body),
  }))
  const built = { name: doc.name, nameTokens, nameFlat: flat(doc.name), parts }
  cache.set(key, built)
  // 캐시가 무한히 늘지 않게 한다. 자료는 30개 상한이라 여유 있게 잡아도 된다
  if (cache.size > 60) cache.delete(cache.keys().next().value)
  return built
}

/**
 * 낱말 하나가 조각에 얼마나 맞는지.
 *
 * 마지막 층이 없으면 "격리수준 몇 단계"가 안 걸린다. 본문에는 "네 단계다"라고 적혀 있고
 * 낱말로 끊으면 "단계다"가 되어 "단계"와 다른 말이 된다. 조사 규칙으로는 "다"를 못 뗀다
 * (그걸 떼면 "정확도"가 "정확"이 되는 쪽이 망가진다). 형태소 분석기 없이 굴절을 잡는
 * 값싼 방법이 붙여 쓴 원문에서 찾아보는 것이다. 대신 약한 신호로 센다.
 */
function scoreToken(t, part, idx) {
  if (idx.nameTokens.has(t)) return 2.0 // 자료 이름에 있다 — 강한 신호
  if (t.length >= 3 && idx.nameFlat.length >= 3 && idx.nameFlat.includes(t)) return 2.0
  if (part.tokens.has(t)) return 1.0 // 본문에 낱말 그대로 있다
  if (t.length >= 2 && part.flatBody.includes(t)) return 0.6 // 굴절·붙여쓰기
  return 0
}

/**
 * @param {string} query
 * @returns {Array<{name:string, body:string, score:number}>}
 */
export function searchUserDocs(query, { topK = TOP_K, minScore = MIN_SCORE } = {}) {
  const docs = db.getDocuments()
  if (!docs.length) return []

  const q = tokenize(query)
  if (!q.length) return []
  const groups = queryGroups(q)

  const scored = []
  for (const doc of docs) {
    const idx = indexOf(doc)
    for (const part of idx.parts) {
      let score = 0
      // 뜻 뭉치마다 가장 잘 맞는 표현 하나만 센다 (동의어로 점수가 불어나지 않게)
      for (const forms of groups) {
        let best = 0
        for (const t of forms) {
          const s = scoreToken(t, part, idx)
          if (s > best) best = s
        }
        score += best
      }
      if (score > 0) scored.push({ name: doc.name, body: part.body, score })
    }
  }

  scored.sort((a, b) => b.score - a.score)
  // 같은 자료가 상위를 독차지하지 않게 자료당 최대 2조각까지만
  const perDoc = new Map()
  const out = []
  for (const s of scored) {
    if (s.score < minScore) break
    const n = perDoc.get(s.name) || 0
    if (n >= 2) continue
    perDoc.set(s.name, n + 1)
    out.push(s)
    if (out.length >= topK) break
  }
  return out
}

/** 찾은 조각을 프롬프트에 넣을 문자열로. 길이 상한을 지킨다 */
export function toUserDocContext(hits) {
  if (!hits.length) return ''
  const lines = ['[내가 전에 올린 자료 — 아래 내용을 근거로 답한다. 자료에 없는 내용은 지어내지 않는다]']
  let used = 0
  for (const h of hits) {
    const body = `\n· ${h.name}: ${h.body}`
    if (used + body.length > MAX_CHARS) break
    lines.push(body)
    used += body.length
  }
  if (lines.length === 1) return ''
  lines.push('\n[자료 끝]')
  return lines.join('')
}

/** 자료를 계정 칸에 저장한다. 화면 코드가 db 를 직접 만지지 않게 하는 창구 */
export function rememberDocument(name, text, sessionId) {
  return db.addDocument({ name, text, sessionId })
}
