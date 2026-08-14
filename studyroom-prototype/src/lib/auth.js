/**
 * 계정 신원 — 이 브라우저에서 지금 누구인가.
 *
 * ⚠️ 이것은 **권한 경계가 아니다.** 학습 기록은 전부 이 기기 안(localStorage)에 있고,
 *    계정은 그 데이터를 나누는 **이름표**일 뿐이다. 서버에 사용자 테이블이 없으므로
 *    같은 기기를 쓰는 다른 사람은 개발자 도구로 남의 칸을 열어볼 수 있다.
 *    진짜 격리가 필요해지면 저장소를 서버로 옮겨야 하고, 그때 이 파일의
 *    accountKeyOf() 가 그대로 서버 쪽 사용자 키가 된다.
 *
 * 로그인이 하는 일은 두 가지다.
 *   1) 데이터 칸을 가른다 (db.js 가 이 키로 localStorage 를 나눈다)
 *   2) 이름과 사진을 실제 값으로 채운다
 */

const STORE_KEY = 'studyroom.account.v1'

/** 로그인하지 않은 상태도 하나의 계정이다. 로그인 전에 공부한 기록이 사라지면 안 된다 */
export const GUEST = Object.freeze({
  provider: 'guest',
  sub: 'guest',
  name: '나',
  email: '',
  picture: '',
})

/**
 * localStorage 키에 그대로 들어간다. 구글 sub 는 숫자뿐이지만,
 * 다른 공급자가 붙었을 때를 대비해 한 번 거른다.
 */
function safe(s) {
  return String(s || '')
    .replace(/[^A-Za-z0-9_.@-]/g, '_')
    .slice(0, 64)
}

/** @returns {string} 데이터 칸의 이름 */
export function accountKeyOf(profile) {
  if (!profile || !profile.provider || profile.provider === 'guest') return 'guest'
  if (!profile.sub) return 'guest'
  return `${safe(profile.provider)}_${safe(profile.sub)}`
}

export function loadAccount() {
  if (typeof localStorage === 'undefined') return { ...GUEST }
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return { ...GUEST }
    const p = JSON.parse(raw)
    return p && p.provider && p.sub ? p : { ...GUEST }
  } catch {
    return { ...GUEST }
  }
}

export function saveAccount(profile) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(profile))
  } catch (e) {
    console.warn('[auth] 계정 저장 실패', e)
  }
}

export function clearAccount() {
  try {
    localStorage.removeItem(STORE_KEY)
  } catch {
    /* 지우기 실패는 무시한다 — 다음 로그인이 덮어쓴다 */
  }
}

export const isGuest = (p) => !p || p.provider === 'guest'

/** 화면에 쓸 표시 이름. 구글 이름이 비어 있는 계정도 있다 */
export function displayNameOf(profile) {
  if (isGuest(profile)) return '나'
  return profile.name || (profile.email ? profile.email.split('@')[0] : '나')
}
