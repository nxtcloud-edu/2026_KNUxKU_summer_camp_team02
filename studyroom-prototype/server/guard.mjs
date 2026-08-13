/**
 * 공개 주소에 올릴 때의 최소 방어.
 *
 * `/api/chat` 은 우리 모델 키로 대신 호출해 주는 창구다.
 * 주소만 알면 누구나 우리 할당량을 쓸 수 있다는 뜻이라, 공개하는 순간 이게 필요하다.
 *
 * 두 겹이다.
 *  1) **출입 열쇠** — `.env` 의 APP_ACCESS_KEY 가 있으면 요구한다. 없으면 요구하지 않는다.
 *     (개발 중에는 굳이 켜지 않아도 동작이 달라지지 않게)
 *  2) **호출 상한** — 열쇠가 새어도 한 사람이 무한정 쓰지는 못하게 IP 별로 센다.
 *
 * 완벽한 인증이 아니다. 캠프 기간 동안 주소가 퍼져도 계정이 털리지 않을 만큼만이다.
 */

export const LIMITS = {
  /** IP 하나당 1분에 허용할 호출 수 */
  perMinute: 20,
  /** IP 하나당 1시간에 허용할 호출 수 */
  perHour: 200,
  /** 전체 합산 1시간 상한 — 열쇠가 퍼졌을 때의 마지막 방어선 */
  globalPerHour: 1200,
  /** 요청 본문 최대 크기 */
  maxBodyBytes: 256 * 1024,
}

const MIN = 60_000
const HOUR = 3_600_000

const hits = new Map() // ip → number[] (호출 시각)
let globalHits = []

/** 오래된 기록을 버린다. 메모리가 무한정 늘지 않게 */
function prune(now) {
  globalHits = globalHits.filter((t) => now - t < HOUR)
  for (const [ip, arr] of hits) {
    const kept = arr.filter((t) => now - t < HOUR)
    if (kept.length) hits.set(ip, kept)
    else hits.delete(ip)
  }
}

let lastPrune = 0

/**
 * @returns {{ok:true} | {ok:false, status:number, error:string, retryAfterSec?:number}}
 */
export function checkRate(ip, now = Date.now()) {
  if (now - lastPrune > MIN) {
    prune(now)
    lastPrune = now
  }
  const arr = hits.get(ip) || []
  const inMinute = arr.filter((t) => now - t < MIN).length
  const inHour = arr.length

  if (globalHits.length >= LIMITS.globalPerHour) {
    return { ok: false, status: 503, error: '오늘은 여기까지예요. 잠시 뒤에 다시 시도해 주세요.' }
  }
  if (inMinute >= LIMITS.perMinute) {
    return { ok: false, status: 429, error: '너무 빠르게 요청했어요.', retryAfterSec: 30 }
  }
  if (inHour >= LIMITS.perHour) {
    return { ok: false, status: 429, error: '한 시간 사용량을 다 썼어요.', retryAfterSec: 600 }
  }

  arr.push(now)
  hits.set(ip, arr)
  globalHits.push(now)
  return { ok: true }
}

/** 프록시(Cloudflare 등) 뒤에서도 진짜 IP를 찾는다 */
export function clientIp(req) {
  const h = req.headers || {}
  const fwd = h['cf-connecting-ip'] || h['x-real-ip'] || h['x-forwarded-for']
  if (fwd) return String(fwd).split(',')[0].trim()
  return req.socket?.remoteAddress || 'unknown'
}

/**
 * 이 요청이 같은 기계에서 온 것인가 (개발 중인 나 자신).
 *
 * 터널·프록시를 거친 요청도 서버 입장에서는 접속 주소가 127.0.0.1 로 보인다.
 * 그래서 주소만으로 판단하면 안 되고, 전달 헤더가 붙어 있으면 바깥에서 온 것으로 본다.
 */
function isLoopback(req) {
  const h = req.headers || {}
  if (h['cf-connecting-ip'] || h['x-forwarded-for'] || h['x-real-ip']) return false
  const a = req.socket?.remoteAddress || ''
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1'
}

/**
 * 출입 열쇠 확인. 열쇠를 정해두지 않았으면 아무나 통과시킨다.
 * 헤더 또는 쿼리로 받는다 — 링크 하나로 공유할 수 있어야 해서.
 *
 * 내 기계에서 여는 개발 서버는 열쇠를 묻지 않는다.
 * 열쇠를 정해 뒀다는 이유로 `npm run dev` 가 깨지면 안 된다.
 */
export function checkAccess(req, expected) {
  if (!expected) return { ok: true, enforced: false }
  if (isLoopback(req)) return { ok: true, enforced: false, local: true }
  const h = req.headers || {}
  const fromHeader = h['x-access-key']
  const fromQuery = new URL(req.url || '/', 'http://x').searchParams.get('k')
  const got = fromHeader || fromQuery
  if (got && String(got) === String(expected)) return { ok: true, enforced: true }
  return { ok: false, status: 401, error: '접근 열쇠가 필요합니다.' }
}

/** 진단용 */
export function rateStats() {
  const now = Date.now()
  return {
    trackedIps: hits.size,
    lastHour: globalHits.filter((t) => now - t < HOUR).length,
    limits: LIMITS,
  }
}
