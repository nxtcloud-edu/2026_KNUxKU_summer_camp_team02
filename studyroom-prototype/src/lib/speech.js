/**
 * 음성 입출력 — Google 무료 Web Speech API
 *
 * STT: webkitSpeechRecognition (Chrome/Edge에 내장, 구글 음성 인식 엔진, 무료·키 불필요)
 * TTS: window.speechSynthesis (SpeechSynthesis API, 무료·키 불필요)
 *
 * ⚠️ HTTPS 또는 localhost에서만 동작한다. Safari/Firefox는 STT 미지원 → UI에서 숨긴다.
 *
 * 통합 설계서 §13-5b "사용자 마이크의 용도"가 TBD였는데, 이 모듈이 그 답이다.
 *  · 마이크 ON  → 음성으로 질문 (STT → 채팅 입력)
 *  · 스피커     → 스터디 메이트의 답변을 읽어줌 (TTS)
 */

const SR =
  typeof window !== 'undefined' &&
  (window.SpeechRecognition || window.webkitSpeechRecognition)

export const sttSupported = !!SR
export const ttsSupported =
  typeof window !== 'undefined' && 'speechSynthesis' in window

/* ── STT ──────────────────────────────────────────────────── */

export function createRecognizer({ onPartial, onFinal, onEnd, onError }) {
  if (!SR) return null
  const rec = new SR()
  rec.lang = 'ko-KR'
  rec.continuous = false
  rec.interimResults = true
  rec.maxAlternatives = 1

  rec.onresult = (e) => {
    let interim = ''
    let final = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript
      if (e.results[i].isFinal) final += t
      else interim += t
    }
    if (interim) onPartial?.(interim)
    if (final) onFinal?.(final.trim())
  }
  rec.onerror = (e) => onError?.(e.error)
  rec.onend = () => onEnd?.()

  return {
    start() {
      try {
        rec.start()
      } catch {
        /* 이미 시작된 경우 무시 */
      }
    },
    stop() {
      try {
        rec.stop()
      } catch {
        /* noop */
      }
    },
    abort() {
      try {
        rec.abort()
      } catch {
        /* noop */
      }
    },
  }
}

/* ── TTS ──────────────────────────────────────────────────── */

let voicesCache = []

function loadVoices() {
  if (!ttsSupported) return []
  const v = window.speechSynthesis.getVoices()
  if (v.length) voicesCache = v
  return voicesCache
}

if (ttsSupported) {
  loadVoices()
  window.speechSynthesis.onvoiceschanged = loadVoices
}

function pickKoreanVoice(index = 0) {
  const vs = loadVoices()
  const ko = vs.filter((v) => /ko/i.test(v.lang))
  if (!ko.length) return null
  return ko[index % ko.length]
}

/**
 * @param {string} text
 * @param {{pitch?:number, rate?:number, voiceIndex?:number}} opts
 */
export function speak(text, opts = {}) {
  if (!ttsSupported || !text) return
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'ko-KR'
  u.pitch = opts.pitch ?? 1
  u.rate = opts.rate ?? 1
  u.volume = 1
  const v = pickKoreanVoice(opts.voiceIndex ?? 0)
  if (v) u.voice = v
  window.speechSynthesis.speak(u)
}

export function stopSpeaking() {
  if (ttsSupported) window.speechSynthesis.cancel()
}

/** 브라우저 지원 요약 — 설정 창에서 사용자에게 알려준다 */
export function speechSupportNote() {
  if (sttSupported && ttsSupported) return null
  if (!sttSupported && !ttsSupported)
    return '이 브라우저는 음성 입력·읽어주기를 지원하지 않습니다. Chrome에서 열어주세요.'
  if (!sttSupported) return '이 브라우저는 음성 입력(STT)을 지원하지 않습니다. Chrome에서 열어주세요.'
  return '이 브라우저는 읽어주기(TTS)를 지원하지 않습니다.'
}
