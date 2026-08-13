/**
 * 상시 받아쓰기 — 마이크를 계속 열어 두고, 말이 끝나면 한 덩어리로 넘긴다.
 *
 * 세 가지를 처리한다.
 *
 * 1. **`continuous = true` 는 "계속 듣는다"는 뜻이 아니다.**
 *    Chrome 은 무음이 이어지면 세션을 스스로 끊는다. 조용히 공부하는 1~2시간짜리
 *    세션은 정확히 그 조건이라, `onend` 에서 다시 켜 주지 않으면 조용히 죽는다.
 *    다만 무한 재시작은 막아야 해서 짧은 간격의 연속 재시작에는 제동을 건다.
 *
 * 2. **캐릭터가 말하는 동안에는 받아쓰기를 멈춘다.**
 *    `getUserMedia` 의 echoCancellation 은 `speechSynthesis` 소리를 지우지 못한다.
 *    (Chrome 의 반향 제거는 자기 재생 경로만 참조 신호로 쓴다.)
 *    게다가 SpeechRecognition 은 자체 마이크 스트림을 열어서 우리가 제약을 걸 수도 없다.
 *    막지 않으면 캐릭터 답변이 그대로 사용자 발화로 되돌아와 자기 말에 자기가 답한다.
 *
 * 3. **발화 종료 판정.**
 *    Chrome 이 주는 `isFinal` 은 생각이 끝난 지점이 아니라 잠깐 끊긴 지점이다.
 *    그래서 조각을 모아 두었다가 일정 시간 새 소리가 없으면 한 덩어리로 내보낸다.
 */

import { onSpeakingChange } from '../ttsQueue'

/**
 * 인식기 생성자를 **쓸 때 찾는다.**
 * 모듈을 읽는 순간 붙잡아 두면 로드 순서에 묶여서, 나중에 바꿔 끼울 수도 시험할 수도 없다.
 */
const getSR = () =>
  (typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)) || null

export const listenSupported =
  typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition)

export const LISTEN = {
  /** 이만큼 새 소리가 없으면 한 발화가 끝난 것으로 본다.
   *  한국어 발화 끝의 자연스러운 쉼이 0.7초 안팎이라 그 위로 잡는다.
   *  공부하며 더듬거리는 말은 더 느리므로 900ms 는 짧다. */
  silenceMs: 1200,
  /** 쉼 없이 계속 말해도 이만큼 지나면 일단 끊어 보낸다 */
  hardFlushMs: 15000,
  /** 읽어주기가 끝나고 이만큼 기다렸다가 다시 듣는다 (스피커 잔향) */
  ttsTailMs: 500,
  /** 이보다 짧은 발화는 버린다 */
  minChars: 2,
  /** 재시작이 이 간격 안에 연달아 일어나면 잠시 쉰다 */
  restartFloorMs: 400,
  restartBurst: 5,
  restartBackoffMs: 3000,
}

/**
 * @param {object} o
 * @param {(text:string)=>void} o.onUtterance  말 한 덩어리가 끝났을 때
 * @param {(text:string)=>void} [o.onPartial]  받아쓰는 중 (화면 표시용)
 * @param {(s:object)=>void}    [o.onState]    {listening, mutedByTts, error}
 * @param {boolean}             [o.processLocally] 온디바이스 인식을 요구할지
 * @param {(fn:(speaking:boolean)=>void)=>()=>void} [o.subscribeSpeaking]
 *        "지금 캐릭터가 말하는 중인가"를 알려주는 구독원. 기본값은 우리 TTS 큐다.
 *        **밖에서 주입받는다** — 안에서 직접 import 하면 결합이 숨어서, 번들러가 모듈을
 *        두 벌로 올렸을 때 구독이 조용히 빗나가도 아무도 모른다. 실제로 그렇게 당했다.
 */
export function createListener({
  onUtterance,
  onPartial,
  onState,
  processLocally = false,
  subscribeSpeaking = onSpeakingChange,
}) {
  if (!getSR()) return null

  let rec = null
  let running = false // 사용자가 켰는가
  let live = false // 인식기가 실제로 도는가
  let mutedByTts = false
  let buffer = ''
  let silenceTimer = null
  let hardTimer = null
  let ttsTailTimer = null
  let recentRestarts = []
  let unsubscribeTts = null

  const state = () => onState?.({ listening: live, mutedByTts, buffered: buffer.length })

  /* ── 발화 조립 ─────────────────────────────────────────── */

  function flush(why) {
    clearTimeout(silenceTimer)
    clearTimeout(hardTimer)
    silenceTimer = hardTimer = null
    const text = buffer.trim()
    buffer = ''
    if (text.length >= LISTEN.minChars) onUtterance?.(text, { why })
    state()
  }

  function armTimers() {
    clearTimeout(silenceTimer)
    silenceTimer = setTimeout(() => flush('silence'), LISTEN.silenceMs)
    // 쉬지 않고 말하는 경우에도 영영 안 넘어가는 일이 없게
    if (!hardTimer) hardTimer = setTimeout(() => flush('hard'), LISTEN.hardFlushMs)
  }

  /* ── 인식기 ────────────────────────────────────────────── */

  function build() {
    const SR = getSR()
    const r = new SR()
    r.lang = 'ko-KR'
    r.continuous = true
    r.interimResults = true
    r.maxAlternatives = 1
    // 있으면 켠다. 없는 브라우저에서는 그냥 무시되는 속성이다
    if (processLocally && 'processLocally' in r) r.processLocally = true

    r.onstart = () => {
      live = true
      state()
    }

    r.onresult = (e) => {
      // 껐는데도 늦게 도착하는 결과가 있다. Chrome 은 abort() 뒤에도 마지막 조각을 흘려보낸다.
      // 이걸 막지 않으면 "마이크를 껐는데 방금 한 말이 전송되는" 일이 생긴다.
      if (!running || mutedByTts) return
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) buffer += (buffer ? ' ' : '') + t.trim()
        else interim += t
      }
      onPartial?.((buffer ? buffer + ' ' : '') + interim)
      armTimers()
    }

    r.onerror = (e) => {
      const err = e?.error
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        // 권한이 없으면 재시작해도 소용없다. 멈추고 알린다
        running = false
        live = false
        onState?.({ listening: false, mutedByTts, error: 'permission' })
        return
      }
      // no-speech / aborted / network 는 흔하다. onend 가 이어서 오고 거기서 다시 켠다
      if (err === 'network') onState?.({ listening: live, mutedByTts, error: 'network' })
    }

    r.onend = () => {
      live = false
      state()
      // 남은 조각이 있으면 흘리지 않는다
      if (buffer.trim()) flush('end')
      if (running && !mutedByTts) restart()
    }

    return r
  }

  function restart() {
    const now = Date.now()
    recentRestarts = recentRestarts.filter((t) => now - t < 5000)
    recentRestarts.push(now)
    // 즉시 재시작이 반복되면 뭔가 잘못된 것이다. 잠깐 쉬었다 간다
    const burst = recentRestarts.length > LISTEN.restartBurst
    const delay = burst ? LISTEN.restartBackoffMs : LISTEN.restartFloorMs
    if (burst) recentRestarts = []
    setTimeout(() => {
      if (running && !mutedByTts) safeStart()
    }, delay)
  }

  function safeStart() {
    if (!running || mutedByTts || live) return
    if (!rec) rec = build()
    try {
      rec.start()
    } catch {
      // 이미 시작된 상태. onend 가 오면 거기서 다시 잡는다
    }
  }

  function hardStop() {
    live = false
    if (!rec) return
    try {
      rec.abort() // stop() 은 남은 오디오를 마저 처리한다. 지금은 버리는 게 맞다
    } catch {
      /* 무시 */
    }
  }

  /* ── 읽어주기 연동 ─────────────────────────────────────── */

  function bindTts() {
    unsubscribeTts = subscribeSpeaking((speaking) => {
      clearTimeout(ttsTailTimer)
      if (speaking) {
        mutedByTts = true
        // 지금까지 받아적은 건 살린다. 캐릭터가 말하기 전의 사용자 발화다
        if (buffer.trim()) flush('tts-start')
        hardStop()
        state()
      } else {
        // 스피커 잔향이 마이크로 들어오지 않게 조금 기다렸다 연다
        ttsTailTimer = setTimeout(() => {
          mutedByTts = false
          state()
          safeStart()
        }, LISTEN.ttsTailMs)
      }
    })
  }

  return {
    start() {
      if (running) return
      running = true
      if (!unsubscribeTts) bindTts()
      safeStart()
      state()
    },
    stop() {
      running = false
      clearTimeout(silenceTimer)
      clearTimeout(hardTimer)
      clearTimeout(ttsTailTimer)
      silenceTimer = hardTimer = ttsTailTimer = null
      buffer = ''
      hardStop()
      // 손잡이를 떼어 낸다. running 검사만으로도 막히지만, 끊어 둘 수 있으면 끊는 게 확실하다
      if (rec) {
        rec.onresult = null
        rec.onend = null
        rec.onerror = null
        rec.onstart = null
      }
      unsubscribeTts?.()
      unsubscribeTts = null
      rec = null
      state()
    },
    get running() {
      return running
    },
    get mutedByTts() {
      return mutedByTts
    },
  }
}

/** 이 브라우저가 온디바이스 인식을 지원하는지 (오디오가 기기를 안 떠나는가) */
export async function onDeviceStatus(lang = 'ko-KR') {
  const SR = getSR()
  if (!SR || typeof SR.available !== 'function') return { supported: false, status: 'no-api' }
  try {
    const status = await SR.available({ langs: [lang], processLocally: true })
    return { supported: status === 'available', status }
  } catch (e) {
    return { supported: false, status: 'error', message: e.message }
  }
}
