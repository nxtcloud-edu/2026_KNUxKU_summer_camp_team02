/**
 * Google 로그인 — Google Identity Services (GIS).
 *
 * 클라이언트 ID 는 **비밀이 아니다.** 어차피 페이지에 그대로 실린다.
 * 그런데도 번들에 박지 않고 서버가 `/api/config` 로 내려준다. 이유는 습관이다 —
 * 번들에 넣으려면 `VITE_` 접두사를 붙여야 하는데, 그 접두사를 진짜 모델 키에
 * 붙이는 순간 F12 에 키가 그대로 보인다. 그 문을 아예 열지 않는다.
 *
 * ⚠️ 승인된 JavaScript 원본(Authorized JavaScript origins)에 지금 주소가 등록돼 있어야
 *    버튼이 동작한다. 우리 공개 주소는 Cloudflare 임시 터널이라 **재시작할 때마다 바뀐다.**
 *    바뀌면 구글 콘솔에 새 주소를 추가하기 전까지 로그인이 막힌다.
 *    그래서 실패해도 앱이 멈추지 않게 아래 폴백이 있다.
 */

const GIS_SRC = 'https://accounts.google.com/gsi/client'

let configPromise = null
let gisPromise = null

/** 서버가 알려주는 공개 설정. 한 번만 받아 온다 */
export function authConfig() {
  if (!configPromise) {
    configPromise = fetch('/api/config')
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}))
      .then((c) => c || {})
  }
  return configPromise
}

/** GIS 스크립트를 한 번만 넣는다 */
function loadGis() {
  if (gisPromise) return gisPromise
  gisPromise = new Promise((resolve, reject) => {
    if (typeof document === 'undefined') return reject(new Error('브라우저가 아님'))
    if (window.google?.accounts?.id) return resolve(window.google)

    const existing = document.querySelector(`script[src="${GIS_SRC}"]`)
    const el = existing || document.createElement('script')
    const done = () =>
      window.google?.accounts?.id ? resolve(window.google) : reject(new Error('GIS 로드 실패'))

    el.addEventListener('load', done, { once: true })
    el.addEventListener('error', () => reject(new Error('GIS 스크립트를 못 받았습니다')), { once: true })

    if (!existing) {
      el.src = GIS_SRC
      el.async = true
      el.defer = true
      document.head.appendChild(el)
    }
    // 이미 로드가 끝난 스크립트 태그면 load 이벤트가 다시 오지 않는다
    if (existing && window.google?.accounts?.id) resolve(window.google)
  })
  return gisPromise
}

/**
 * 구글이 그린 버튼을 컨테이너에 붙인다.
 *
 * 우리 디자인의 버튼을 쓰고 싶었지만, GIS 는 커스텀 버튼으로 **ID 토큰**을 받는 길을
 * 공식적으로 열어두지 않았다. One Tap(`prompt()`)은 사용자가 이전에 닫았으면 조용히
 * 안 뜬다. 로그인이 "가끔 안 되는" 것보다 버튼 모양이 다른 게 낫다.
 *
 * @returns {Promise<() => void>} 정리 함수
 */
export async function mountGoogleButton(container, { clientId, onCredential, onError, width = 320 }) {
  if (!clientId) throw new Error('클라이언트 ID 가 없습니다')
  const google = await loadGis()

  google.accounts.id.initialize({
    client_id: clientId,
    callback: (res) => {
      if (res?.credential) onCredential(res.credential)
      else onError?.(new Error('구글이 자격 증명을 주지 않았습니다'))
    },
    // 실패 원인이 콘솔에만 남으면 원인을 못 찾는다
    error_callback: (e) => onError?.(new Error(e?.type || '구글 로그인 실패')),
    auto_select: false,
    cancel_on_tap_outside: true,
  })

  container.innerHTML = ''
  google.accounts.id.renderButton(container, {
    type: 'standard',
    theme: 'outline',
    size: 'large',
    text: 'continue_with',
    shape: 'pill',
    logo_alignment: 'center',
    locale: 'ko',
    width,
  })

  return () => {
    try {
      google.accounts.id.cancel()
    } catch {
      /* 이미 정리됐으면 무시 */
    }
    container.innerHTML = ''
  }
}

/** 서버에 토큰을 넘겨 검증하고 신원을 받는다 */
export async function verifyCredential(credential) {
  const res = await fetch('/api/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `로그인 확인 실패 (HTTP ${res.status})`)
  return body.profile
}
