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
 * **자리 비움에는 아무것도 얹지 않는다.** 처음엔 시계가 깜빡이는 게 싫어서 4초를 얹었는데,
 * 그건 측정을 늦춰서 표시 문제를 푸는 것이었다. 깜빡임은 표시 쪽에서 늦추면 된다
 * (StudyRoomScreen 의 PAUSE_SHOW_MS). 측정은 빠를수록 집중 시간이 정확하다.
 *
 * **휴대폰에만 조금 얹는다.** 검출기가 계산기·필통·리모컨을 폰으로 오인한다
 * (constants.js 의 PHONE_CAVEAT). 모듈의 3회 확인이 주 방어고 이건 덤이다.
 */
export const CONFIRM_MS = {
  absent: 0, // 모듈의 2.0초로 충분하다
  present: 0, // 돌아온 건 즉시 인정한다
  phone: 400, // 합계 약 1.15초 — 오인 물체 때문에만
  phoneGone: 600,
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
/** 이만큼 표본이 안 들어오면 죽은 것으로 보고 되살린다 */
const WATCHDOG_MS = 6000

export function useVision({ stream, enabled, onSignal, onAlert, onDegrade }) {
  // 되살릴 때 이 값을 올려 effect 를 다시 돌린다
  const [reviveTick, setReviveTick] = useState(0)
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
    let lastSampleAt = Date.now()

    const mark = (key, on, now) => {
      if (on) since[key] = since[key] ?? now
      else since[key] = null
      return since[key] != null && now - since[key] >= CONFIRM_MS[key]
    }

    const onSample = (s) => {
      if (dead) return
      const now = Date.now()
      lastSampleAt = now
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

      // 30초에 한 번 실제 성능을 남긴다.
      // **서버로도 보낸다** — 판정은 브라우저에서 도는데 로그가 브라우저에만 있으면
      // "느리다"는 말을 들어도 숫자를 볼 방법이 없다
      if (!lastPerfLog || now - lastPerfLog > 30_000) {
        lastPerfLog = now
        const report = {
          kind: 'vision',
          faceMs: s.diag?.intervalMs ?? null,
          phoneMs: s.diag?.phoneIntervalMs ?? null,
          perf: s.perf,
          samples: s.diag?.samples,
          skipped: s.diag?.skipped,
          errors: s.diag?.errors,
          delegate: s.diag?.delegate,
          renderer: (s.diag?.renderer || '').slice(0, 60),
          state: s.state,
        }
        console.debug('[vision]', report)
        fetch('/api/diag', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(report),
        }).catch(() => {}) // 진단이 실패해도 판정은 계속돼야 한다
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

    /**
     * 감시견 — 판정이 조용히 죽는 걸 잡는다.
     *
     * 프레임에 맞춰 도는 구조라, 영상이 멈추면(탭 전환, 스트림 종료, GPU 컨텍스트 손실)
     * 콜백이 아예 안 온다. 예전 setInterval 은 최소한 계속 깨어는 있었다.
     * 그래서 표본이 끊기면 알아채고 되살린다.
     */
    const watchdog = setInterval(() => {
      if (dead) return
      const gap = Date.now() - lastSampleAt
      if (gap < WATCHDOG_MS) return
      console.warn(`[vision] ${gap}ms 동안 표본 없음 — 되살립니다`)
      fetch('/api/diag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'vision-stall', gapMs: gap }),
      }).catch(() => {})
      lastSampleAt = Date.now() // 되살리는 동안 또 울리지 않게
      setReviveTick((n) => n + 1)
    }, 2000)

    return () => {
      dead = true
      clearInterval(watchdog)
      loopRef.current?.stop?.()
      loopRef.current = null
      video.srcObject = null
      videoRef.current = null
      // 화면을 떠나면 판정도 없던 것으로
      cbRef.current.onSignal?.({ absent: false, phone: false, drowsy: false })
    }
  }, [stream, enabled, reviveTick])

  return status
}
