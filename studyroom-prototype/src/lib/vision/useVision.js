/**
 * 카메라 판정을 화면에 붙이는 훅.
 *
 * 판정 자체는 전부 이 기기 안에서 돈다. 영상은 어디로도 나가지 않는다.
 *
 * 하는 일은 두 가지다.
 *  1) 원시 신호(5fps)를 **지속 시간으로 걸러** 흔들림을 없앤다.
 *     한 프레임 얼굴을 놓쳤다고 "자리 비움"이 되면 집중 시간이 누더기가 된다.
 *  2) 졸음은 상태가 아니라 **사건**으로도 올려보낸다 — 깨워야 하니까.
 */

import { useEffect, useRef, useState } from 'react'
import { createVisionLoop } from './visionEngine'
import { STATE } from './attention'

/** 이만큼 이어져야 그 상태로 인정한다 */
export const CONFIRM_MS = {
  absent: 4000, // 자리 비움 — 잠깐 몸을 숙이거나 옆을 보는 것과 구분해야 한다
  present: 1500, // 돌아온 판정은 더 빨리 (기다리게 하면 억울하다)
  phone: 5000, // 휴대폰 — 계산기·필통 오인이 있어 넉넉히 본다
  phoneGone: 3000,
}

/** 같은 사유로 반복해서 말 걸지 않도록 */
export const ALERT_COOLDOWN_MS = {
  drowsy: 3 * 60 * 1000,
  phone: 5 * 60 * 1000,
}

/**
 * @param {object} o
 * @param {MediaStream|null} o.stream
 * @param {boolean} o.enabled
 * @param {(sig:{absent:boolean,phone:boolean,drowsy:boolean})=>void} o.onSignal
 * @param {(kind:'drowsy'|'phone')=>void} o.onAlert  깨우기·환기가 필요한 순간
 */
export function useVision({ stream, enabled, onSignal, onAlert }) {
  const [status, setStatus] = useState({ running: false, error: '', state: 'unknown' })
  const videoRef = useRef(null)
  const loopRef = useRef(null)
  const cbRef = useRef({ onSignal, onAlert })
  cbRef.current = { onSignal, onAlert }

  useEffect(() => {
    if (!enabled || !stream) {
      setStatus((s) => ({ ...s, running: false }))
      return
    }

    let dead = false
    // 화면에 보이지 않는 전용 video. SelfTile 은 사용자가 끌 수 있어서 따로 둔다
    const video = document.createElement('video')
    video.autoplay = true
    video.playsInline = true
    video.muted = true
    video.srcObject = stream
    videoRef.current = video

    // 지속 시간 판정용 상태
    const since = { absent: null, present: null, phone: null, phoneGone: null }
    const cur = { absent: false, phone: false, drowsy: false }
    const lastAlert = { drowsy: 0, phone: 0 }

    const mark = (key, on, now) => {
      if (on) since[key] = since[key] ?? now
      else since[key] = null
      return since[key] != null && now - since[key] >= CONFIRM_MS[key]
    }

    const onSample = (s) => {
      if (dead) return
      const now = Date.now()
      let changed = false

      // ── 자리 비움 ──
      const faceMissing = s.state === STATE.NO_FACE
      if (!cur.absent && mark('absent', faceMissing, now)) {
        cur.absent = true
        since.present = null
        changed = true
      } else if (cur.absent && mark('present', !faceMissing, now)) {
        cur.absent = false
        since.absent = null
        changed = true
      }

      // ── 휴대폰 ── 얼굴이 안 보이면 판단하지 않는다
      const phoneNow = !cur.absent && !!s.phoneVisible
      if (!cur.phone && mark('phone', phoneNow, now)) {
        cur.phone = true
        since.phoneGone = null
        changed = true
      } else if (cur.phone && mark('phoneGone', !phoneNow, now)) {
        cur.phone = false
        since.phone = null
        changed = true
      }

      // ── 졸음 ── 분석기가 이미 20초 창에서 끄덕임을 세어 판정한다
      const drowsyNow = !cur.absent && !!s.drowsy
      if (drowsyNow !== cur.drowsy) {
        cur.drowsy = drowsyNow
        changed = true
      }

      if (changed) cbRef.current.onSignal?.({ ...cur })
      setStatus((prev) => (prev.state === s.state ? prev : { ...prev, state: s.state }))

      // ── 깨우기 ──
      if (cur.drowsy && now - lastAlert.drowsy > ALERT_COOLDOWN_MS.drowsy) {
        lastAlert.drowsy = now
        // 경보를 소비해서 같은 끄덕임으로 계속 울리지 않게 한다
        loopRef.current?.analyzer?.consumeDrowsy?.()
        cur.drowsy = false
        cbRef.current.onSignal?.({ ...cur })
        cbRef.current.onAlert?.('drowsy')
      } else if (cur.phone && now - lastAlert.phone > ALERT_COOLDOWN_MS.phone) {
        lastAlert.phone = now
        cbRef.current.onAlert?.('phone')
      }
    }

    ;(async () => {
      try {
        await video.play().catch(() => {})
        const loop = createVisionLoop({
          video,
          onSample,
          detectPhone: true,
          onDegrade: (info) => {
            if (dead) return
            setStatus((s) => ({ ...s, degraded: true, note: info?.reason || '' }))
          },
        })
        loopRef.current = loop
        await loop.start()
        if (dead) {
          loop.stop()
          return
        }
        setStatus({ running: true, error: '', state: 'unknown' })
      } catch (e) {
        if (!dead) setStatus({ running: false, error: e?.message || String(e), state: 'unknown' })
      }
    })()

    return () => {
      dead = true
      loopRef.current?.stop?.()
      loopRef.current = null
      video.srcObject = null
      videoRef.current = null
      // 화면을 떠나면 판정도 없던 것으로
      cbRef.current.onSignal?.({ absent: false, phone: false, drowsy: false })
    }
  }, [stream, enabled])

  return status
}
