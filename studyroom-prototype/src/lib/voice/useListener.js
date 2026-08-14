/**
 * 상시 받아쓰기를 화면에 붙이는 훅.
 *
 * 콜백은 ref 에 담아 두고 인식기는 enabled 가 바뀔 때만 다시 만든다.
 * 콜백이 매 렌더 새로 만들어질 때마다 인식기를 재시작하면 말이 통째로 끊긴다.
 */

import { useEffect, useRef, useState } from 'react'
import { createListener, listenSupported } from './listener'
import { onSpeakingChange } from '../ttsQueue'

export { listenSupported }

/**
 * @param {object} o
 * @param {boolean} o.enabled
 * @param {(text:string)=>void} o.onPartial    받아적는 중 (화면 표시용)
 * @param {(text:string)=>void} o.onUtterance  말 한 덩어리가 끝났을 때
 * @param {(s:object)=>void} [o.onState]
 * @param {boolean} [o.processLocally]
 */
export function useListener({ enabled, onPartial, onUtterance, onState, processLocally = false }) {
  const [state, setState] = useState({ listening: false, mutedByTts: false, error: '' })
  const cb = useRef({ onPartial, onUtterance, onState })
  cb.current = { onPartial, onUtterance, onState }

  useEffect(() => {
    if (!enabled || !listenSupported) {
      setState({ listening: false, mutedByTts: false, error: '' })
      return
    }
    const l = createListener({
      processLocally,
      // 읽어주기 상태를 **밖에서 넣어 준다.** 안에서 직접 import 하면
      // 번들러가 모듈을 두 벌 올렸을 때 구독이 조용히 빗나간다 (실제로 겪었다)
      subscribeSpeaking: onSpeakingChange,
      onPartial: (t) => cb.current.onPartial?.(t),
      onUtterance: (t) => cb.current.onUtterance?.(t),
      onState: (s) => {
        setState((prev) => (prev.listening === s.listening && prev.mutedByTts === s.mutedByTts ? prev : s))
        cb.current.onState?.(s)
      },
    })
    if (!l) return
    l.start()
    return () => l.stop()
  }, [enabled, processLocally])

  return state
}
