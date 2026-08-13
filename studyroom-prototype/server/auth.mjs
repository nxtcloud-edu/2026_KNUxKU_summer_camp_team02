/**
 * 구글 로그인 검증.
 *
 * 브라우저가 받은 ID 토큰(JWT)을 그대로 믿지 않는다. 브라우저에서 만든 값은
 * 브라우저에서 고칠 수 있다. 서명을 확인해야 이름·메일이 진짜 구글이 준 값이 된다.
 *
 * 확인 방법은 두 가지다.
 *   (a) 구글 공개키(JWKS)를 받아 서명을 직접 검증 — 로그인마다 외부 호출이 없다
 *   (b) 구글의 tokeninfo 엔드포인트에 물어본다 — 한 줄이면 끝나고 틀릴 여지가 적다
 * 여기서는 (b)를 쓴다. 로그인은 세션당 한 번이라 200ms 왕복이 문제되지 않고,
 * RS256 서명 검증을 직접 짜다 틀리면 **틀린 줄도 모르는** 종류의 버그가 된다.
 *
 * ⚠️ 지금 학습 기록은 브라우저 안에 있다. 그래서 이 검증은 권한 경계가 아니라
 *    "이름표가 진짜인지" 확인하는 것이다. 저장소를 서버로 옮기는 순간
 *    이 함수가 반환하는 sub 가 진짜 사용자 키가 된다.
 */

import { HttpError, loadEnv } from './chat.mjs'

const TOKENINFO = 'https://oauth2.googleapis.com/tokeninfo?id_token='

const VALID_ISS = new Set(['accounts.google.com', 'https://accounts.google.com'])

export function googleClientId() {
  const env = loadEnv()
  return env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || ''
}

/** 브라우저에 내려도 되는 공개 설정만 담는다. 여기에 키를 넣지 말 것 */
export function publicConfig() {
  return { googleClientId: googleClientId() }
}

export async function handleGoogleAuth(body) {
  const clientId = googleClientId()
  if (!clientId) {
    throw new HttpError(503, {
      error: '구글 로그인이 아직 설정되지 않았습니다 (.env 의 GOOGLE_CLIENT_ID 가 비어 있음)',
    })
  }

  const credential = String(body?.credential || '')
  // JWT 는 점 두 개로 나뉜 세 토막이다. 형태부터 아니면 외부 호출을 아낀다
  if (!credential || credential.split('.').length !== 3 || credential.length > 4096) {
    throw new HttpError(400, { error: '토큰 형식이 올바르지 않습니다' })
  }

  let info
  try {
    const res = await fetch(TOKENINFO + encodeURIComponent(credential), {
      signal: AbortSignal.timeout(8000),
    })
    info = await res.json().catch(() => null)
    if (!res.ok || !info || info.error || info.error_description) {
      throw new HttpError(401, { error: '구글이 이 토큰을 거절했습니다' })
    }
  } catch (e) {
    if (e instanceof HttpError) throw e
    throw new HttpError(502, { error: `구글에 확인하지 못했습니다 (${String(e?.message || e).slice(0, 80)})` })
  }

  // 남이 만든 앱의 토큰을 우리 앱 토큰으로 쓰는 걸 막는 건 이 한 줄이다
  if (info.aud !== clientId) throw new HttpError(401, { error: '다른 앱에서 발급된 토큰입니다' })
  if (!VALID_ISS.has(info.iss)) throw new HttpError(401, { error: '발급자가 구글이 아닙니다' })

  const exp = Number(info.exp) * 1000
  if (!Number.isFinite(exp) || exp <= Date.now()) throw new HttpError(401, { error: '만료된 토큰입니다' })

  return {
    profile: {
      provider: 'google',
      sub: String(info.sub),
      name: info.name || '',
      email: info.email || '',
      // 메일 인증이 안 된 계정도 있다. 화면에 쓰기 전에 알고는 있어야 한다
      emailVerified: info.email_verified === 'true' || info.email_verified === true,
      picture: info.picture || '',
    },
  }
}
