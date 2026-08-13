/**
 * MediaPipe 구동부 — 모델 로딩과 표본 루프.
 *
 * 판정은 attention.js가 한다. 이 파일은 "프레임 → 숫자"까지만 책임진다.
 *
 * ⚠️ 전부 브라우저에서 돈다. 프레임은 어디로도 전송되지 않는다.
 *
 * 지금은 메인 스레드에서 돌린다. 얼굴 10fps + 폰 0.2fps 정도면 감당하지만,
 * /bench 측정에서 버벅임이 보이면 Web Worker + ImageBitmap 전송으로 옮긴다.
 * 그때도 attention.js는 그대로 쓴다.
 */

import { FilesetResolver, FaceLandmarker, ObjectDetector } from '@mediapipe/tasks-vision'
import { RATES, MODELS, WASM_PATH, PHONE, USE_EYE_SIGNAL, DEGRADE } from './constants'
import { AttentionAnalyzer, PhoneTracker, poseFromMatrix, eyeClosednessFromBlendshapes } from './attention'
import { probeGpu } from './gpuProbe'

let filesetPromise = null
function loadFileset() {
  if (!filesetPromise) filesetPromise = FilesetResolver.forVisionTasks(WASM_PATH)
  return filesetPromise
}

/**
 * GPU 델리게이트로만 만든다.
 *
 * ⚠️ CPU로 조용히 폴백하지 않는다.
 *    실측(Apple Silicon)에서 CPU delegate는 p50 10.8ms인데 **p95 72.9ms / max 235ms**로
 *    꼬리가 폭발한다. 눈에 보이는 끊김이고, 웹캠·캐릭터 애니메이션과 겹치면 더 나빠진다.
 *    "느리게라도 돌아간다"보다 "이 기기에서는 이 기능을 끈다"가 낫다.
 *    CPU를 쓰려면 호출부가 명시적으로 allowCpu를 켜야 한다.
 */
async function createGpuOnly(factory, { allowCpu = false } = {}) {
  // getContext('webgl2')가 성공해도 소프트웨어 렌더러일 수 있다.
  // 그 경우 "GPU 성공"으로 보이지만 CPU delegate보다 느리다. 먼저 걸러낸다.
  const gpu = probeGpu()
  if (!gpu.usable && !allowCpu) {
    const err = new Error(gpu.reason || 'GPU 가속을 쓸 수 없는 기기입니다.')
    err.code = 'NO_GPU'
    err.probe = gpu
    console.warn('[vision]', err.message, gpu)
    throw err
  }

  try {
    if (!gpu.usable) throw new Error(gpu.reason)
    return { instance: await factory('GPU'), delegate: 'GPU', gpu }
  } catch (e) {
    if (!allowCpu) {
      const msg = 'GPU 가속을 쓸 수 없는 기기입니다. 이 기능은 꺼집니다.'
      console.warn('[vision]', msg, e)
      const err = new Error(msg)
      err.cause = e
      err.code = 'NO_GPU'
      throw err
    }
    console.warn('[vision] GPU 실패 → CPU로 (느립니다)', e)
    return { instance: await factory('CPU'), delegate: 'CPU', gpu }
  }
}

export async function createFaceLandmarker({ useEye = USE_EYE_SIGNAL, allowCpu = false } = {}) {
  const fileset = await loadFileset()
  return createGpuOnly(
    (delegate) =>
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODELS.faceLandmarker, delegate },
        runningMode: 'VIDEO',
        numFaces: 1,
        // 졸음을 고개 끄덕임으로 보므로 기본은 끈다. 켜면 눈 관련 출력까지 계산한다
        outputFaceBlendshapes: useEye,
        outputFacialTransformationMatrixes: true, // 머리 방향 — 이게 주 신호다
      }),
    { allowCpu },
  )
}

export async function createObjectDetector({ allowCpu = false, modelUrl = MODELS.objectDetector } = {}) {
  const fileset = await loadFileset()
  return createGpuOnly(
    (delegate) =>
      ObjectDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelUrl, delegate },
        runningMode: 'VIDEO',
        scoreThreshold: PHONE.rawScoreThreshold, // 1차는 낮게 받고 PhoneTracker에서 거른다
        maxResults: 8,
      }),
    { allowCpu },
  )
}

/**
 * 표본 루프.
 *
 * @param {object} o
 * @param {HTMLVideoElement} o.video
 * @param {(snap:object)=>void} o.onSample
 * @param {boolean} [o.detectPhone]
 * @param {boolean} [o.columnMajor] 행렬 해석 방식 (bench에서 확인용)
 */
export function createVisionLoop({
  video,
  onSample,
  detectPhone = false,
  phoneModelUrl,
  /** 측정 중에는 꺼서 방해받지 않게 한다 */
  autoDegrade = true,
  phoneMs = RATES.phoneMs,
  faceMs = RATES.faceMs,
  columnMajor = true,
  useEye = USE_EYE_SIGNAL,
  /** GPU delegate가 안 되는 기기에서 CPU로라도 돌릴지. 기본은 끈다 (꼬리 지연이 크다) */
  allowCpu = false,
  /** 강등·중단 시 알림 — 호출부가 사용자에게 안내하거나 기능을 끌 수 있다 */
  onDegrade = () => {},
}) {
  let stopped = false
  let face = null
  let detector = null
  let faceTimer = null
  let phoneTimer = null

  const analyzer = new AttentionAnalyzer({ useEye })
  const phone = new PhoneTracker(PHONE)

  const perf = { faceMs: [], phoneMs: [] }
  const pushPerf = (arr, v) => {
    arr.push(v)
    if (arr.length > 60) arr.shift()
  }
  const median = (arr) => pct(arr, 0.5)
  const pct = (arr, q) => {
    if (!arr.length) return null
    const s = [...arr].sort((a, b) => a - b)
    return s[Math.min(s.length - 1, Math.floor(s.length * q))]
  }

  let lastFaceRaw = null
  let phoneVisible = false
  let lastDetections = [] // 모델이 실제로 뭘 봤는지 (폰 판정 품질 확인용)
  let lastTs = 0
  let faceInterval = faceMs
  let phoneInterval = phoneMs
  let phoneSteps = 0
  let degraded = false
  const diag = {
    samples: 0,
    skipped: 0,
    errors: 0,
    lastError: '',
    lastSkipReason: '',
    faceSeen: 0,
    delegate: '',
    intervalMs: RATES.faceMs,
    p95: null,
    degradeNote: '',
  }

  /** 어떤 경우에도 화면에 현재 상태를 흘려보낸다 */
  function report(snap) {
    onSample({
      ...(snap || analyzer.snapshot()),
      pose: snap ? lastFaceRaw?.pose : null,
      eyeClosedness: lastFaceRaw?.eye ?? null,
      phoneVisible,
      phoneScore: phone.lastScore,
      phoneName: phone.lastName,
      detections: lastDetections,
      perf: { faceMs: median(perf.faceMs), phoneMs: median(perf.phoneMs) },
      diag: { ...diag },
    })
  }

  function videoReady() {
    return video && video.readyState >= 2 && video.videoWidth > 0
  }

  function stepFace() {
    if (stopped || !face) return

    // 조용히 return하면 화면이 "—" 인 채로 멈춘 것처럼 보인다.
    // 왜 멈췄는지가 보여야 디버깅이 된다.
    if (!videoReady()) {
      diag.skipped += 1
      diag.lastSkipReason = !video
        ? 'video 엘리먼트 없음'
        : `readyState=${video.readyState} size=${video.videoWidth}x${video.videoHeight}`
      report(null)
      return
    }

    const t = performance.now()
    // MediaPipe는 타임스탬프가 단조 증가해야 한다. 같은 값이 두 번 들어가면 예외가 난다.
    const ts = Math.max(t, lastTs + 1)
    lastTs = ts

    let res
    try {
      res = face.detectForVideo(video, ts)
      diag.errors = 0
    } catch (e) {
      diag.errors += 1
      diag.lastError = String(e?.message || e)
      console.warn('[vision] face 추론 실패', e)
      report(null)
      return
    }
    pushPerf(perf.faceMs, performance.now() - t)
    diag.samples += 1
    diag.lastSampleAt = Date.now()
    maybeDegrade()

    const hasFace = !!(res && res.faceLandmarks && res.faceLandmarks.length)
    let pose = null
    let eye = null
    if (hasFace) {
      pose = poseFromMatrix(res.facialTransformationMatrixes?.[0], columnMajor)
      if (useEye) eye = eyeClosednessFromBlendshapes(res.faceBlendshapes?.[0]?.categories)
    }
    lastFaceRaw = { hasFace, pose, eye }

    const snap = analyzer.push({
      t: Date.now(),
      hasFace,
      yaw: pose?.yaw,
      pitch: pose?.pitch,
      eyeClosedness: eye,
    })

    if (hasFace) diag.faceSeen += 1
    report(snap)
  }

  /**
   * 워밍업 뒤 실측 p95를 보고 스스로 주기를 늘리거나 기능을 끈다.
   * 기기 성능이 제각각이라 한 주기로 고정하면 저사양에서 화면이 끊긴다.
   */
  function maybeDegrade() {
    if (!autoDegrade || degraded || diag.samples < DEGRADE.warmupSamples) return
    if (diag.samples % DEGRADE.warmupSamples !== 0) return

    const p95 = pct(perf.faceMs, 0.95)
    diag.p95 = p95
    if (p95 == null) return

    /**
     * 너무 느려도 **끄지 않고 최대한 늦춘다.**
     *
     * 예전에는 여기서 stop() 을 불러 통째로 껐고, 되살리는 코드가 없었다.
     * p95 는 30표본 창이라 GC 한 번, 탭 전환 한 번에도 튄다.
     * 그 순간의 측정으로 기능을 영구히 죽이는 건 과하다 —
     * 느린 판정이라도 없는 것보다 낫고, 잠시 뒤 회복될 수도 있다.
     */
    if (p95 > DEGRADE.unusableMs) {
      if (faceInterval < DEGRADE.maxIntervalMs) {
        faceInterval = DEGRADE.maxIntervalMs
        diag.intervalMs = faceInterval
        diag.degradeNote = `너무 느려서 주기를 ${faceInterval}ms로 늦췄습니다 (p95 ${p95.toFixed(0)}ms)`
        perf.faceMs.length = 0
        onDegrade({ kind: 'slow', p95, intervalMs: faceInterval, reason: diag.degradeNote })
        return
      }
      // 가장 느린 주기에서도 못 버티면 그때 끈다. 이유는 남긴다
      degraded = true
      diag.degradeNote = `가장 느린 주기에서도 버거워 껐습니다 (p95 ${p95.toFixed(0)}ms)`
      onDegrade({ kind: 'off', p95, reason: diag.degradeNote })
      stop()
      report(null)
      return
    }

    if (p95 > DEGRADE.slowMs && faceInterval < DEGRADE.maxIntervalMs) {
      faceInterval = Math.min(DEGRADE.maxIntervalMs, faceInterval * 2)
      diag.intervalMs = faceInterval
      diag.degradeNote = `느려서 주기를 ${faceInterval}ms로 늘렸습니다 (p95 ${p95.toFixed(0)}ms)`
      // 구동기가 주기를 함수로 읽으므로 다시 만들 필요가 없다
      perf.faceMs.length = 0 // 새 주기로 다시 측정
      onDegrade({ kind: 'slow', p95, intervalMs: faceInterval })
    }
  }

  function stepPhone() {
    if (stopped || !detector || !videoReady()) return
    const t = performance.now()
    let res
    try {
      res = detector.detectForVideo(video, t)
    } catch (e) {
      console.warn('[vision] object 추론 실패', e)
      return
    }
    pushPerf(perf.phoneMs, performance.now() - t)
    phoneVisible = phone.push(res?.detections)

    // 폰 검출이 느린 기기에서는 주기를 늘린다 (얼굴 루프와 독립적으로)
    phoneSteps += 1

    /* 자동 강등 — 버그 두 개를 고쳤다.
       ① 워밍업 제외가 없었다. 모델 첫 추론은 셰이더 컴파일 때문에 수백 ms가 걸리는데
          그게 p95를 오염시켜 시작하자마자 강등됐다.
       ② 문턱이 절대값(120ms)이었다. 주기가 250ms든 5000ms든 같은 잣대를 들이대면
          빠른 주기가 무조건 걸린다. 실제로 중요한 건 "주기 대비 얼마나 먹는가"다. */
    if (
      autoDegrade &&
      phoneSteps > DEGRADE.phoneWarmupSamples &&
      perf.phoneMs.length >= DEGRADE.phoneJudgeSamples &&
      phoneInterval < DEGRADE.maxIntervalMs * 4
    ) {
      const p95 = pct(perf.phoneMs, 0.95)
      const dutyLimit = phoneInterval * DEGRADE.phoneDutyLimit
      if (p95 != null && p95 > dutyLimit) {
        phoneInterval = Math.min(DEGRADE.maxIntervalMs * 4, phoneInterval * 2)
        diag.phoneIntervalMs = phoneInterval
        perf.phoneMs.length = 0
        phoneSteps = 0 // 새 주기에서 다시 워밍업부터
        onDegrade({ kind: 'phoneSlow', p95, intervalMs: phoneInterval, limitMs: dutyLimit })
      }
    }

    // 상위 검출을 점수순으로 남긴다. 'cell phone'이 안 잡힐 때
    // 모델이 대신 뭐라고 부르는지(remote/book/laptop…)를 봐야 판단이 선다
    lastDetections = (res?.detections || [])
      .flatMap((d) => (d.categories || []).map((c) => ({ name: c.categoryName, score: c.score })))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
  }

  async function start() {
    let f
    try {
      f = await createFaceLandmarker({ useEye, allowCpu })
    } catch (e) {
      diag.lastError = `모델 로딩 실패: ${e?.message || e}`
      console.error('[vision]', diag.lastError, e)
      report(null)
      throw e
    }
    if (stopped) {
      f.instance.close?.()
      return
    }
    face = f.instance
    diag.delegate = f.delegate
    diag.renderer = f.gpu?.renderer || ''
    faceTimer = driveFrames(() => faceInterval, stepFace)

    if (detectPhone) {
      const d = await createObjectDetector({ allowCpu, modelUrl: phoneModelUrl || MODELS.objectDetector })
      if (stopped) {
        d.instance.close?.()
        return
      }
      detector = d.instance
      phoneTimer = driveFrames(() => phoneInterval, stepPhone)
    }
    return { faceDelegate: f.delegate }
  }

  /**
   * **프레임이 나올 때** 돌린다. 벽시계로 깨우지 않는다.
   *
   * setInterval 은 카메라가 새 프레임을 냈는지 모른 채 깨운다. 그래서
   *   · 같은 프레임을 두 번 판단하거나 (추론 낭비)
   *   · 프레임을 통째로 건너뛰거나 (반응 지연)
   *   · 추론이 주기보다 길면 타이머가 쌓여 메인 스레드를 잡는다
   *
   * requestVideoFrameCallback 은 **새 프레임이 실제로 준비됐을 때** 부른다.
   * 거기서 목표 주기만큼 솎아내면, 언제나 최신 프레임으로 판단하면서
   * 느린 기기에서는 자연스럽게 횟수만 줄어든다 (밀려 쌓이지 않는다).
   *
   * @param {() => number} targetMs  목표 주기 (강등으로 바뀌므로 함수로 받는다)
   */
  function driveFrames(targetMs, step) {
    let last = 0
    let busy = false
    let rvfcHandle = null
    let timeoutHandle = null
    const useRvfc = typeof video?.requestVideoFrameCallback === 'function'

    const schedule = () => {
      if (stopped) return
      if (useRvfc) rvfcHandle = video.requestVideoFrameCallback(tick)
      // rVFC 가 없는 브라우저는 짧은 타이머로 흉내낸다. 그래도 busy 가드는 그대로 산다
      else timeoutHandle = setTimeout(tick, Math.max(16, Math.floor(targetMs() / 3)))
    }

    const tick = () => {
      if (stopped) return
      schedule() // 다음 프레임을 먼저 예약해 둔다
      if (busy) return // 이전 추론이 아직 안 끝났다. 이번 프레임은 버린다
      const now = performance.now()
      if (now - last < targetMs()) return // 목표 주기보다 이르다
      last = now
      busy = true
      try {
        step()
      } finally {
        busy = false
      }
    }

    schedule()
    return () => {
      if (rvfcHandle != null && video?.cancelVideoFrameCallback) video.cancelVideoFrameCallback(rvfcHandle)
      clearTimeout(timeoutHandle)
    }
  }

  function stop() {
    stopped = true
    faceTimer?.() // 구동기 해제
    phoneTimer?.()
    try {
      face?.close?.()
      detector?.close?.()
    } catch {
      /* noop */
    }
    face = null
    detector = null
  }

  return {
    start,
    stop,
    analyzer,
    getRaw: () => lastFaceRaw,
    getPerf: () => ({ faceMs: median(perf.faceMs), phoneMs: median(perf.phoneMs) }),
    setColumnMajor: (v) => {
      columnMajor = v
    },
  }
}
