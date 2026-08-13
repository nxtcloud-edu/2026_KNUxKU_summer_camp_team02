/**
 * 읽어주기 큐 — 순서를 앱이 소유한다.
 *
 * `window.speechSynthesis` 는 전역 큐라서 speak() 를 던져 두면 브라우저가 알아서 줄을 세운다.
 * 문제는 **호출부가 언제 끝나는지 모른다**는 것이다. 그래서 예전 코드는 말풍선을 띄우고
 * 곧바로 다음 캐릭터로 넘어갔고, 화면에는 셋이 한꺼번에 말하는데 소리는 수십 초 뒤처졌다.
 *
 * 여기서는 한 번에 하나만 재생하고 **실제 재생이 끝나야** 약속이 풀린다.
 * 그래야 호출부가 "지금 누가 말하는 중"을 알 수 있고, 상시 마이크도 그동안 받아쓰기를 멈출 수 있다.
 *
 * 실측 (Chrome 148, macOS 한국어 로컬 음성):
 *   글자당 125~155ms. 9자 1.4초 / 32자 4.5초 / 109자 13.7초.
 *   그래서 답변 하나가 15~20초씩 걸린다 — 감시 타이머는 이 값에서 잡았다.
 */

export const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window

/** 대충 몇 초짜리 발화인지. 감시 타이머와 마이크 게이트가 쓴다 */
export function estimateMs(text) {
  return Math.max(800, String(text || '').length * 160)
}

/**
 * 소리내어 읽을 만큼만 잘라낸다.
 *
 * 답변 길이 제한을 풀면 설명이 1,000자를 넘기도 하는데, 그걸 다 읽으면 2분이 넘는다.
 * 그동안 마이크는 닫혀 있으므로(되먹임 방지) 사용자가 말을 걸 수 없다 — 상시 마이크가 무용지물이 된다.
 *
 * 그래서 **글은 다 보여주고 소리는 앞부분만** 낸다. 말끝이 어색하지 않도록 문장 경계에서 자른다.
 * 180자 ≈ 25초. 그 이상은 듣는 사람도 흘려 듣는다.
 */
export function ttsExcerpt(text, maxChars = 180) {
  const t = String(text || '').trim()
  if (t.length <= maxChars) return t
  const head = t.slice(0, maxChars)
  // 마지막 문장 끝에서 자른다
  const cut = Math.max(
    head.lastIndexOf('. '),
    head.lastIndexOf('.\n'),
    head.lastIndexOf('! '),
    head.lastIndexOf('? '),
    head.lastIndexOf('야. '),
    head.lastIndexOf('\n\n'),
  )
  if (cut > maxChars * 0.4) return head.slice(0, cut + 1).trim()
  // 문장 경계가 없으면 어절 경계에서
  const sp = head.lastIndexOf(' ')
  return (sp > maxChars * 0.5 ? head.slice(0, sp) : head).trim()
}

/**
 * 최근에 소리내어 말한 것들. 상시 마이크가 **자기 목소리를 받아적었는지** 가리는 데 쓴다.
 * 스피커로 나간 말이 마이크로 돌아오면 캐릭터가 자기 말에 답하게 된다.
 */
const spoken = []
export function recentSpoken(withinMs = 8000) {
  const cut = Date.now() - withinMs
  return spoken.filter((s) => s.at >= cut).map((s) => s.text)
}

/** 감시 타이머 — onend 가 안 오는 경우가 실제로 있다 */
const watchdogMs = (text) => estimateMs(text) * 1.8 + 3000

/** Chrome 은 긴 발화 도중 스스로 멈추는 일이 있다. 주기적으로 깨워 둔다 */
const KEEPALIVE_MS = 8000

let voicesCache = null

function koreanVoices() {
  if (!ttsSupported) return []
  if (voicesCache?.length) return voicesCache
  const all = window.speechSynthesis.getVoices()
  const ko = all.filter((v) => /^ko/i.test(v.lang))
  voicesCache = ko.length ? ko : all
  return voicesCache
}

if (ttsSupported && typeof window.speechSynthesis.addEventListener === 'function') {
  window.speechSynthesis.addEventListener('voiceschanged', () => {
    voicesCache = null
  })
}

/* ── 상태 ─────────────────────────────────────────────────── */

const queue = []
let current = null // { text, resolve }
let pumping = false
let keepalive = null
const listeners = new Set()

/** 지금 누가 소리내어 말하는 중인가 */
export function isSpeaking() {
  return current !== null || queue.length > 0
}

/** 발화 시작·종료를 구독한다. 마이크 게이트가 여기에 붙는다 */
export function onSpeakingChange(fn) {
  listeners.add(fn)
  fn(isSpeaking())
  return () => listeners.delete(fn)
}

/** 진단용 — 구독자가 실제로 붙었는지 확인할 때 쓴다 */
export function _debug() {
  return { listeners: listeners.size, queued: queue.length, speaking: isSpeaking(), lastEmitted }
}

let lastEmitted = false

/** 값이 실제로 바뀔 때만 알린다. 마이크 게이트가 여기 붙으므로 중복 통지는 곧 인식기 재시작이다 */
function emit() {
  const on = isSpeaking()
  if (on === lastEmitted) return
  lastEmitted = on
  for (const fn of listeners) {
    try {
      fn(on)
    } catch (e) {
      console.warn('[tts] 구독자 오류', e)
    }
  }
}

/* ── 재생 ─────────────────────────────────────────────────── */

function playOne({ text, opts }) {
  return new Promise((resolve) => {
    let done = false
    const finish = (why) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(why)
    }

    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'ko-KR'
    u.pitch = opts.pitch ?? 1
    u.rate = opts.rate ?? 1
    u.volume = 1
    const vs = koreanVoices()
    if (vs.length) u.voice = vs[(opts.voiceIndex ?? 0) % vs.length]

    u.onend = () => finish('end')
    u.onerror = (e) => {
      // 'interrupted' 는 우리가 cancelAll() 한 것이라 오류가 아니다
      if (e?.error && e.error !== 'interrupted' && e.error !== 'canceled') {
        console.warn('[tts] 재생 오류', e.error)
      }
      finish('error')
    }

    // onend 가 영영 안 오면 여기서 푼다. 안 그러면 캐릭터가 영원히 말하는 중이 된다
    const timer = setTimeout(() => {
      console.warn('[tts] onend 미도착 — 감시 타이머로 넘어감')
      try {
        window.speechSynthesis.cancel()
      } catch {
        /* 무시 */
      }
      finish('timeout')
    }, watchdogMs(text))

    window.speechSynthesis.speak(u)
  })
}

async function pump() {
  if (pumping) return
  pumping = true

  keepalive = setInterval(() => {
    try {
      // 멈춰 있지 않으면 아무 일도 하지 않는다
      window.speechSynthesis.resume()
    } catch {
      /* 무시 */
    }
  }, KEEPALIVE_MS)

  try {
    while (queue.length) {
      current = queue.shift()
      // 재생 **전에** 기록한다. 스피커로 나가는 즉시 마이크가 주워 담을 수 있어서,
      // onend 때 기록하면 이미 늦다
      spoken.push({ text: current.text, at: Date.now() })
      while (spoken.length > 12) spoken.shift()
      emit()
      await playOne(current)
      const { resolve } = current
      current = null
      resolve()
    }
  } finally {
    clearInterval(keepalive)
    keepalive = null
    pumping = false
    current = null
    emit()
  }
}

/**
 * 한 마디를 읽어준다. **실제 재생이 끝나야** 약속이 풀린다.
 * @param {string} text
 * @param {{pitch?:number, rate?:number, voiceIndex?:number}} opts
 * @returns {Promise<void>}
 */
export function speakAndWait(text, opts = {}) {
  if (!ttsSupported || !text) return Promise.resolve()
  return new Promise((resolve) => {
    queue.push({ text, opts, resolve })
    emit()
    pump()
  })
}

/** 기다리지 않고 던져 두는 쪽 — 예전 호출부 호환용 */
export function speak(text, opts = {}) {
  void speakAndWait(text, opts)
}

/** 전부 멈춘다. 대기 중인 약속도 풀어 준다 (호출부가 매달려 있지 않게) */
export function cancelAll() {
  if (!ttsSupported) return
  const waiting = queue.splice(0, queue.length)
  try {
    window.speechSynthesis.cancel()
  } catch {
    /* 무시 */
  }
  for (const w of waiting) w.resolve()
  emit()
}
