/**
 * 브라우저 → 서버 API.
 *
 * 브라우저는 모델 키를 모른다. 전부 /api 뒤에 있다.
 * 개발 중엔 Vite 미들웨어가, 배포 후엔 EC2의 Node가 같은 핸들러를 쓴다.
 */

const API = import.meta.env.VITE_CHAT_API_URL || '/api/chat'

/**
 * 출입 열쇠.
 *
 * 공개 주소(터널·EC2)에 올리면 /api/chat 은 우리 모델 키로 대신 호출해 주는 창구가 된다.
 * 주소만 알면 누구나 우리 할당량을 쓸 수 있으므로 서버가 열쇠를 요구할 수 있게 해뒀다.
 *
 * 링크 한 줄로 나눠줄 수 있도록 주소의 ?k= 에서 받아 저장해 둔다.
 * 열쇠는 브라우저 번들에 박히지 않는다 — 링크를 받은 사람만 갖는다.
 */
const KEY_STORE = 'studyroom.accessKey'

function accessKey() {
  if (typeof window === 'undefined') return ''
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('k')
    if (fromUrl) {
      sessionStorage.setItem(KEY_STORE, fromUrl)
      // 주소창에서 지운다. 화면 공유나 어깨너머로 새는 걸 조금이라도 줄인다
      const u = new URL(window.location.href)
      u.searchParams.delete('k')
      window.history.replaceState({}, '', u)
      return fromUrl
    }
    return sessionStorage.getItem(KEY_STORE) || ''
  } catch {
    return ''
  }
}

/**
 * 게이트웨이가 끊은 것과 서버가 거절한 것을 구분한다.
 *
 * 우리 공개 주소는 Cloudflare 터널을 지나는데, **원본이 100초 안에 답하지 않으면
 * 524 로 끊는다.** 그 경우 서버는 멀쩡히 일하는 중이고 응답 본문도 없어서,
 * 그냥 "HTTP 524" 라고만 보이면 원인을 알 수가 없다. 실제로 논문 추출이
 * 여기 걸려서 "문서를 못 읽는다"로만 보였다.
 */
const GATEWAY = {
  504: '처리가 오래 걸려 연결이 끊겼어요.',
  524: '처리가 100초를 넘겨 연결이 끊겼어요. 문서가 길면 앞부분만 잘라서 올려 보세요.',
  502: '서버에 연결하지 못했어요.',
  503: '서버가 잠시 바빠요.',
}

class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || GATEWAY[status] || `HTTP ${status}`)
    this.status = status
    this.body = body
  }
}

async function post(url, body, signal) {
  const k = accessKey()
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(k ? { 'X-Access-Key': k } : {}) },
    body: JSON.stringify(body),
    signal,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, json)
  return json
}

/**
 * 캐릭터 한 명의 답변을 받는다.
 * @param {object} o
 * @param {object} o.seat      말할 자리
 * @param {object} o.settings  대화 운영 설정
 * @param {Array}  o.turns     [{role:'user'|'model', text}]
 * @param {string} o.message   이번 발화 (개입이면 '')
 * @param {string} [o.summary] 압축해둔 앞부분
 * @param {Array} [o.images]  쪽 그림 (글자층이 깨진 PDF 를 읽힐 때)
 * @param {'reply'|'intervention'} [o.kind]
 */
export function requestReply(o, signal) {
  return post(API, o, signal)
}

/** 앞부분 압축 — 다음 턴 전에 백그라운드로 부른다 */
export function requestSummary({ turns, previousSummary }, signal) {
  return post('/api/summarize', { turns, previousSummary }, signal)
}

/** 서버·키·뱅크 상태 */
export async function fetchHealth() {
  try {
    const k = accessKey()
    const res = await fetch('/api/health', { headers: k ? { 'X-Access-Key': k } : {} })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

export { ApiError }
