/**
 * API 키 분배 — 한 키에 몰리지 않게.
 *
 * 왜 필요한가: 무료 티어는 키마다 분당 요청·토큰 한도가 따로 걸린다.
 * 키 3개를 두고 캐릭터 3명이 각자 쓰면 한도가 3배가 되고,
 * 한 키가 429를 맞아도 나머지로 이어진다.
 *
 * 두 가지를 동시에 만족시킨다.
 *  1) **분산** — 캐릭터마다 다른 키
 *  2) **고정(sticky)** — 같은 캐릭터는 늘 같은 키.
 *     프리픽스 캐싱이 프로젝트 단위로 걸리므로 오가면 캐시 적중률이 떨어진다.
 * 고장났을 때만 다른 키로 넘어간다.
 */

const COOLDOWN = {
  429: 60_000, // 분당 한도 — 넉넉히 쉰다
  500: 10_000,
  502: 10_000,
  503: 15_000,
  default: 5_000,
}

/**
 * 하루치를 다 쓴 키는 오래 쉬게 한다.
 *
 * 429 는 두 가지다 — **분당** 한도와 **하루** 한도. 둘 다 60초만 쉬게 하면,
 * 하루치를 다 쓴 키를 하루 종일 1분마다 다시 두드리게 된다. 그 호출은 전부 실패하고
 * 그동안 진짜 살아 있는 키로 넘어가는 게 늦어진다.
 *
 * 구글은 어느 쪽인지 오류 본문에 적어 준다(quotaId 에 PerDay / PerMinute).
 * 적혀 있지 않으면 짧은 쪽으로 본다 — 멀쩡한 키를 오래 재우는 쪽이 더 나쁘다.
 */
const DAILY_COOLDOWN = 30 * 60_000

function isDailyQuota(body) {
  try {
    const s = typeof body === 'string' ? body : JSON.stringify(body || {})
    return /PerDay|per day|daily limit/i.test(s)
  } catch {
    return false
  }
}

export class KeyPool {
  /**
   * @param {Array<{id:string, key:string}>} keys
   */
  constructor(keys) {
    this.keys = keys.map((k) => ({
      ...k,
      cooldownUntil: 0,
      calls: 0,
      errors: 0,
      lastUsed: 0,
    }))
    if (!this.keys.length) throw new Error('사용 가능한 API 키가 없습니다')
  }

  get size() {
    return this.keys.length
  }

  _healthy(now) {
    return this.keys.filter((k) => k.cooldownUntil <= now)
  }

  /**
   * @param {number|string} sticky  캐릭터 자리 번호 등. 같은 값이면 같은 키를 준다
   */
  pick(sticky = 0) {
    const now = Date.now()
    const healthy = this._healthy(now)

    // 전부 쉬는 중이면 가장 빨리 풀리는 걸 쓴다 (호출을 버리는 것보다 낫다)
    const pool = healthy.length ? healthy : [...this.keys].sort((a, b) => a.cooldownUntil - b.cooldownUntil)

    // sticky 우선 — 원래 배정된 키가 살아 있으면 그걸 쓴다
    const idx = Math.abs(hash(String(sticky))) % this.keys.length
    const preferred = this.keys[idx]
    const chosen = pool.includes(preferred)
      ? preferred
      : // 아니면 가장 오래 안 쓴 것 (부하 분산)
        pool.reduce((a, b) => (a.lastUsed <= b.lastUsed ? a : b))

    chosen.calls += 1
    chosen.lastUsed = now
    return chosen
  }

  /**
   * 캐시가 의미 없는 호출(요약·퀴즈 채점 등)에 쓸 키.
   *
   * 대화는 캐릭터마다 키를 고정해야 프리픽스 캐시가 산다. 그래서 캐릭터가 3명이면
   * 키를 5개 넣어도 3개만 돌고 나머지는 논다. 매번 프롬프트가 새로 만들어지는
   * 호출은 캐시가 걸릴 일이 없으니, 그런 건 **가장 덜 쓴 키**로 보내 남는 한도를 쓴다.
   */
  pickIdle() {
    const now = Date.now()
    const healthy = this._healthy(now)
    const pool = healthy.length ? healthy : [...this.keys].sort((a, b) => a.cooldownUntil - b.cooldownUntil)
    const chosen = pool.reduce((a, b) => (a.calls <= b.calls ? a : b))
    chosen.calls += 1
    chosen.lastUsed = now
    return chosen
  }

  /**
   * 지금 쓸 수 있는 키를 **순서대로** 준다.
   *
   * 예전에는 재시도할 때마다 `pick(slot-attempt)` 로 해시를 다시 돌렸다. 해시라서
   * **같은 키를 두 번 뽑을 수 있었고**, 키가 5개여도 3번만 시도하니 두 개는 아예
   * 손도 안 댔다. 이제 살아 있는 키를 전부, 겹치지 않게, 정해진 순서로 넘긴다.
   *
   * 맨 앞은 sticky 키다 — 같은 캐릭터가 같은 키를 써야 프리픽스 캐시가 산다.
   * 그다음은 덜 쓴 순, 마지막이 쉬는 중인 키(빨리 풀리는 순)다.
   * 쉬는 키까지 넣는 이유는, 전부 쉬는 중이어도 침묵하는 것보다 한 번 던져 보는 게 낫기 때문이다.
   */
  orderedKeys(sticky = 0) {
    const now = Date.now()
    const healthy = this._healthy(now)
    const resting = this.keys.filter((k) => k.cooldownUntil > now).sort((a, b) => a.cooldownUntil - b.cooldownUntil)

    const preferred = this.keys[Math.abs(hash(String(sticky))) % this.keys.length]
    const rest = healthy.filter((k) => k !== preferred).sort((a, b) => a.calls - b.calls)
    const head = healthy.includes(preferred) ? [preferred, ...rest] : rest
    return [...head, ...resting]
  }

  /** 이 키를 쓴다고 표시한다 (orderedKeys 로 직접 고른 경우) */
  use(k) {
    k.calls += 1
    k.lastUsed = Date.now()
    return k
  }

  /** 살아 있는 키가 하나라도 있는가 */
  get hasHealthy() {
    return this._healthy(Date.now()).length > 0
  }

  /** 호출 결과를 알려준다. 실패하면 그 키를 잠시 쉬게 한다 */
  report(id, { ok, status, body }) {
    const k = this.keys.find((x) => x.id === id)
    if (!k) return
    if (ok) return
    k.errors += 1
    const ms = status === 429 && isDailyQuota(body) ? DAILY_COOLDOWN : (COOLDOWN[status] ?? COOLDOWN.default)
    k.cooldownUntil = Date.now() + ms
  }

  stats() {
    const now = Date.now()
    return this.keys.map((k) => ({
      id: k.id,
      calls: k.calls,
      errors: k.errors,
      resting: k.cooldownUntil > now ? Math.ceil((k.cooldownUntil - now) / 1000) : 0,
    }))
  }
}

function hash(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h
}

/** .env 에서 키를 모은다. T2/T3/T4 처럼 여러 개면 전부 풀에 넣는다 */
export function poolFromEnv(env, names) {
  const keys = names.map((n) => ({ id: n, key: env[n] })).filter((k) => k.key && k.key.trim())
  return keys.length ? new KeyPool(keys) : null
}
