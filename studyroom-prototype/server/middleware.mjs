/**
 * Vite 개발 서버와 EC2 배포가 **같은 핸들러**를 쓰게 하는 어댑터.
 * 개발과 배포에서 동작이 갈리지 않게 하려는 것이다.
 */
import { handleChat, handleSummarize, handleHealth, HttpError, loadEnv } from './chat.mjs'
import { checkRate, checkAccess, clientIp, rateStats, LIMITS } from './guard.mjs'
import { handleGoogleAuth, publicConfig } from './auth.mjs'

const ROUTES = {
  '/api/chat': handleChat,
  '/api/summarize': handleSummarize,
  /**
   * 로그인. 호출 상한 안에 둔다 — 토큰을 무한정 던져 보는 걸 막는다.
   * 출입 열쇠도 그대로 요구한다. 열쇠를 걸어 둔 배포에서는 링크를 받은 사람만 로그인한다.
   */
  '/api/auth/google': handleGoogleAuth,
  /**
   * 브라우저가 남기는 진단.
   *
   * 비전 판정은 전부 브라우저에서 돌기 때문에, 성능이 어떤지 서버 로그만 봐서는
   * 알 수가 없었다. "느리다"는 말을 들어도 숫자를 볼 방법이 없었다.
   * 이제 브라우저가 30초마다 실제 주기·추론 시간을 여기로 보낸다.
   *   sudo journalctl -u studyroom -f | grep diag
   */
  '/api/diag': async (body) => {
    const { kind = '?', ...rest } = body || {}
    console.log(`[diag] ${kind}`, JSON.stringify(rest).slice(0, 400))
    return { ok: true }
  },
}

/** 열쇠를 정해두면 그때부터 요구한다. 안 정하면 예전과 똑같이 동작한다 */
const ACCESS_KEY = loadEnv().APP_ACCESS_KEY || process.env.APP_ACCESS_KEY || ''

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (c) => {
      raw += c
      if (raw.length > LIMITS.maxBodyBytes) reject(new HttpError(413, { error: '요청이 너무 큽니다' }))
    })
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        reject(new HttpError(400, { error: 'JSON 파싱 실패' }))
      }
    })
    req.on('error', reject)
  })
}

const send = (res, status, obj) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(obj))
}

/** @returns {boolean} 이 요청을 처리했는가 */
export async function apiHandler(req, res) {
  const url = (req.url || '').split('?')[0]

  if (url === '/api/health') {
    // 열쇠를 건 상태에서는 키 이름·호출수 같은 속사정을 아무에게나 보여주지 않는다
    const inside = checkAccess(req, ACCESS_KEY).ok
    send(res, 200, inside ? { ...handleHealth(), rate: rateStats() } : { ok: true, locked: true })
    return true
  }

  /**
   * 로그인 화면이 **로그인하기 전에** 읽어야 하는 값. 그래서 열쇠를 묻지 않는다.
   * 공개해도 되는 것만 담는다 — publicConfig() 안에 키를 넣지 말 것.
   */
  if (url === '/api/config') {
    send(res, 200, publicConfig())
    return true
  }

  const fn = ROUTES[url]
  if (!fn) return false

  if (req.method !== 'POST') {
    send(res, 405, { error: 'POST 만 허용됩니다' })
    return true
  }

  // 주소만 알면 우리 모델 할당량을 쓸 수 있다. 공개 주소에 올릴 때는 이 두 겹이 필요하다
  const access = checkAccess(req, ACCESS_KEY)
  if (!access.ok) {
    send(res, access.status, { error: access.error })
    return true
  }
  const rate = checkRate(clientIp(req), Date.now(), access.local === true)
  if (!rate.ok) {
    if (rate.retryAfterSec) res.setHeader('Retry-After', String(rate.retryAfterSec))
    send(res, rate.status, { error: rate.error })
    return true
  }

  const t0 = Date.now()
  try {
    const out = await fn(await readBody(req))
    // 한 줄 요청 기록. 무슨 일이 있었는지 서버에서 볼 수 있어야 한다
    if (url !== '/api/diag') {
      console.log(`[api] ${url} 200 ${Date.now() - t0}ms ${out?.meta?.model || ''} ${out?.meta?.keyId || ''}`)
    }
    send(res, 200, out)
  } catch (e) {
    const status = e.status || 500
    console.warn(`[api] ${url} ${status} ${Date.now() - t0}ms — ${String(e.message || e).slice(0, 120)}`)
    send(res, status, e.body || { error: String(e.message || e) })
  }
  return true
}

/** Vite 플러그인 */
export function apiPlugin() {
  return {
    name: 'studyroom-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!(await apiHandler(req, res))) next()
      })
    },
  }
}
