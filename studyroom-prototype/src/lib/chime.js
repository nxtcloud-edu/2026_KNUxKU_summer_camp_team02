/**
 * 짧은 알림음.
 *
 * 조는 사람을 말풍선으로는 못 깨운다. 눈을 감고 있으니까.
 * 그래서 졸음 알림에는 소리를 같이 낸다 — 읽어주기(TTS)를 꺼 둔 사람에게도.
 *
 * 놀라게 하려는 게 아니라 고개를 들게 하려는 것이라, 짧고 부드러운 두 음만 쓴다.
 * 파일을 받아오지 않고 그 자리에서 만든다 (네트워크·용량 0).
 */

let ctx = null

function context() {
  if (typeof window === 'undefined') return null
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return null
  if (!ctx) ctx = new AC()
  // 사용자 조작 전에 만들어졌으면 멈춰 있다. 깨워 준다
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

/**
 * @param {{volume?:number}} opts  0~1. 기본 0.18 — 방 안에서 들리되 놀라지 않을 정도
 */
export function wakeChime({ volume = 0.18 } = {}) {
  const c = context()
  if (!c) return false
  const now = c.currentTime
  // 도–솔. 올라가는 두 음이라 경고음보다 부르는 느낌에 가깝다
  const notes = [
    { hz: 523.25, at: 0, dur: 0.18 },
    { hz: 783.99, at: 0.16, dur: 0.26 },
  ]
  for (const n of notes) {
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = 'sine'
    osc.frequency.value = n.hz
    // 딸깍 소리가 나지 않게 양 끝을 부드럽게 여닫는다
    gain.gain.setValueAtTime(0.0001, now + n.at)
    gain.gain.exponentialRampToValueAtTime(volume, now + n.at + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + n.at + n.dur)
    osc.connect(gain).connect(c.destination)
    osc.start(now + n.at)
    osc.stop(now + n.at + n.dur + 0.02)
  }
  return true
}

export const chimeSupported =
  typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext)
