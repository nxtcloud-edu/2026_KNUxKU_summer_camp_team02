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

/**
 * 이만큼 **더** 이어져야 인정한다.
 *
 * ⚠️ 비전 모듈이 이미 흔들림을 걸러 준다. 여기 값은 그 위에 **더해지는** 시간이다.
 *      자리 비움  HYSTERESIS.toNoFace 10표본 × 200ms = 2.0초
 *      복귀      HYSTERESIS.toFocused 2표본       = 0.4초
 *      휴대폰    PHONE.confirmCount 3회 × 250ms   = 0.75초
 *
 * 처음에 이걸 모르고 4~5초를 얹었다가 체감 지연이 6초가 됐다.
 * constants.js 주석에 "5초 주기 → 체감 10초 → 250ms 로 줄여 0.75초 달성" 이라는
 * 튜닝 기록이 남아 있는데, 그 노력을 그대로 되돌린 셈이었다.
 *
 * 여기 얹는 이유는 하나뿐이다 — 이 신호가 **화면의 시계를 멈추고 빨갛게 만든다.**
 * 내부 상태가 잠깐 흔들리는 것과 시계가 깜빡이는 것은 무게가 다르다.
 * 그래서 아주 조금만 둔다.
 */
export const CONFIRM_MS = {
  absent: 1200, // 합계 약 3.2초
  present: 500, // 합계 약 0.9초 — 돌아왔는데 기다리게 하면 억울하다
  phone: 800, // 합계 약 1.6초
  phoneGone: 1200,
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
export function useVision({ stream, enabled, onSignal, onAlert, onDegrade }) {
  const [status, setStatus] = useState({ running: false, error: '', state: 'unknown' })
  const videoRef = useRef(null)
  const loopRef = useRef(null)
  const cbRef = useRef({ onSignal, onAlert, onDegrade })
  cbRef.current = { onSignal, onAlert, onDegrade }

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
    let lastPerfLog = 0

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

      // 30초에 한 번 실제 성능을 남긴다. "느리다"는 인상을 숫자로 바꿔 놓는다
      if (!lastPerfLog || now - lastPerfLog > 30_000) {
        lastPerfLog = now
        console.debug(
          '[vision] 주기',
          s.diag?.intervalMs ?? '?',
          'ms · 추론',
          s.perf,
          '· 표본',
          s.diag?.samples,
        )
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
          /**
           * 느려지면 주기를 늘리거나 아예 끈다.
           *
           * **조용히 두면 안 된다.** 주기가 1000ms 가 되면 자리 비움 판정이
           * 10표본 × 1000ms = 10초가 된다. 사용자 눈에는 "인식을 못 한다"로 보이는데
           * 화면은 멀쩡해서 원인을 알 수가 없다.
           */
          onDegrade: (info) => {
            if (dead) return
            setStatus((s) => ({ ...s, degraded: true, note: info?.reason || '' }))
            console.warn('[vision] 강등', info)
            cbRef.current.onDegrade?.(info)
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
