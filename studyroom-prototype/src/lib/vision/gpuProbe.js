/**
 * GPU 가용성 점검.
 *
 * MediaPipe의 "GPU delegate"는 **WebGL2**다 (WebGPU가 아니다).
 * glue 코드가 canvas.getContext('webgl2', ...) 로 컨텍스트를 만든다.
 * 브라우저가 ANGLE로 플랫폼 API를 감싸주므로 벤더는 가리지 않는다.
 *   macOS  → Metal        Windows → D3D11 / Vulkan       Linux → Vulkan / OpenGL
 *
 * ⚠️ 함정: getContext('webgl2')가 성공해도 **소프트웨어 렌더러**일 수 있다.
 *    드라이버가 낡았거나 Chrome 차단 목록에 걸리면 SwiftShader(CPU 래스터라이저)로
 *    떨어지는데, 이건 CPU delegate보다도 느리다. 그런데 API상으로는 "GPU 성공"으로 보인다.
 *    그래서 렌더러 문자열을 반드시 확인해야 한다.
 */

/** 소프트웨어 래스터라이저 표식 — 이게 잡히면 GPU가 없는 것으로 취급한다 */
const SOFTWARE_HINTS = [
  'swiftshader', // Chrome/Chromium 폴백
  'llvmpipe', // Mesa 소프트웨어
  'softpipe',
  'software rasterizer',
  'microsoft basic render', // Windows 기본 어댑터 (VM·원격에서 흔하다)
  'generic renderer',
]

export function probeGpu() {
  if (typeof document === 'undefined') {
    return { usable: false, reason: 'DOM 없음' }
  }

  let gl = null
  try {
    const canvas = document.createElement('canvas')
    gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true })
  } catch {
    /* 아래에서 처리 */
  }

  if (!gl) {
    // failIfMajorPerformanceCaveat 때문일 수도 있으니 한 번 더 본다
    try {
      gl = document.createElement('canvas').getContext('webgl2')
    } catch {
      /* noop */
    }
    if (!gl) return { usable: false, reason: 'WebGL2를 쓸 수 없는 브라우저·기기입니다' }
  }

  const dbg = gl.getExtension('WEBGL_debug_renderer_info')
  const renderer = String(
    (dbg && gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || '',
  )
  const vendor = String(
    (dbg && gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)) || gl.getParameter(gl.VENDOR) || '',
  )

  const lower = `${renderer} ${vendor}`.toLowerCase()
  const software = SOFTWARE_HINTS.some((h) => lower.includes(h))
  if (software) {
    return {
      usable: false,
      renderer,
      vendor,
      software: true,
      reason: '그래픽 드라이버가 소프트웨어 렌더러로 동작 중입니다 (실제 GPU 가속이 아닙니다)',
    }
  }

  // MediaPipe는 float 텍스처에 기댄다. 없으면 그래프가 통째로 실패할 수 있다
  const colorBufferFloat = !!gl.getExtension('EXT_color_buffer_float')
  if (!colorBufferFloat) {
    return {
      usable: false,
      renderer,
      vendor,
      reason: 'EXT_color_buffer_float 미지원 — 이 GPU에서는 추론 그래프가 동작하지 않습니다',
    }
  }

  return {
    usable: true,
    renderer,
    vendor,
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
  }
}

/** CPU 추론이 몇 스레드를 쓸 수 있는가 — 실제로는 항상 1이다 */
export function cpuThreadInfo() {
  return {
    cores: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : null,
    // 배포된 MediaPipe wasm에는 스레드 빌드가 없다.
    // SharedArrayBuffer가 없으면 wasm 스레딩 자체가 불가능하다.
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    crossOriginIsolated: typeof window !== 'undefined' ? !!window.crossOriginIsolated : false,
    usableThreads: 1,
  }
}
