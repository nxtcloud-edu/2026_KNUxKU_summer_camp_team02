/**
 * 올린 파일에서 글자를 뽑아낸다.
 *
 * 이게 없던 동안 캐릭터는 **읽지도 않은 파일을 "훑어봤어요"** 라고 말했다.
 * 파일 이름만 보고 고정 문구 다섯 개 중 하나를 뽑아 읊었을 뿐이다.
 * 지어내느니 "못 읽었다"고 말하는 게 낫고, 읽을 수 있으면 진짜로 읽는 게 제일 낫다.
 *
 * 전부 브라우저 안에서 처리한다. 파일은 서버로 올라가지 않는다 —
 * 모델에게 보내는 건 뽑아낸 글자뿐이다.
 */

/**
 * 모델에 넘길 글자 수 상한. 이보다 길면 앞뒤를 살리고 가운데를 접는다.
 * 8,000자 ≈ 4,700토큰. 프롬프트 예산(8,000토큰)의 절반가량이라
 * 자료를 넣어도 대화 기록이 통째로 밀려나지 않는다.
 */
export const MAX_CHARS = 8000

/** 이 크기를 넘으면 열지 않는다 (브라우저가 멈춘다) */
export const MAX_BYTES = 20 * 1024 * 1024

const TEXT_EXT =
  /\.(txt|md|markdown|csv|tsv|json|log|ya?ml|html?|xml|js|ts|jsx|tsx|py|java|c|cpp|h|go|rs|sql|sh)$/i

export function fileKind(file) {
  const n = (file?.name || '').toLowerCase()
  if (n.endsWith('.pdf') || file?.type === 'application/pdf') return 'pdf'
  if (TEXT_EXT.test(n) || (file?.type || '').startsWith('text/')) return 'text'
  if ((file?.type || '').startsWith('image/')) return 'image'
  return 'other'
}

/**
 * 뽑아낸 한글이 진짜 글자인지, 깨진 것인지 가린다.
 *
 * PDF 안의 글꼴에 유니코드 대응표(ToUnicode)가 없으면 pdf.js 는 글리프 번호를
 * 엉뚱한 코드포인트로 옮긴다. 그래서 "사본"이 "칺쫆"으로 나온다.
 * 브라우저 인쇄로 만든 한글 PDF 에서 흔하다.
 *
 * 이걸 못 거르면 **모델에게 쓰레기를 주고 그럴듯한 요약을 받게 된다.**
 * 읽은 척하는 것보다 나쁘다 — 읽었는데 틀린 말을 하게 되니까.
 *
 * 판별은 간단하다. 한국어 글에서 압도적으로 흔한 음절이 차지하는 비율을 본다.
 * 실측: 정상 한국어 36~49% · 깨진 추출문 0.0%
 */
const COMMON_SYLLABLES = new Set(
  '이다는에의를은가고하지서로들과한나수있게내년월일도만부터까지어요습니당그리저우무엇왜때문거것적으면서'.split(
    '',
  ),
)

/** @returns {null | {hangul:number, ratio:number}} 한글이 적으면 판단하지 않는다 */
function hangulHealth(text) {
  const h = [...text].filter((c) => c >= '가' && c <= '힣')
  if (h.length < 30) return null // 영어 문서일 수도 있다. 섣불리 깨졌다고 하지 않는다
  return { hangul: h.length, ratio: h.filter((c) => COMMON_SYLLABLES.has(c)).length / h.length }
}

/** 이 아래면 깨진 것으로 본다 (정상 36~49% · 깨짐 0%) */
const GARBLED_BELOW = 0.1

/** 너무 길면 가운데를 접는다. 앞과 끝이 대개 제일 많은 걸 말해준다 */
function fit(text, max = MAX_CHARS) {
  const t = text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (t.length <= max) return { text: t, truncated: false }
  const head = Math.floor(max * 0.7)
  const tail = max - head - 40
  return {
    text: `${t.slice(0, head)}\n\n…(가운데 ${t.length - max}자 생략)…\n\n${t.slice(-tail)}`,
    truncated: true,
  }
}

async function readPdf(file, onProgress) {
  // 필요할 때만 불러온다. 1MB 가까이 되는 라이브러리를 첫 화면부터 들고 있을 이유가 없다
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href

  const buf = await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data: buf }).promise
  const parts = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const line = content.items.map((it) => it.str).join(' ')
    if (line.trim()) parts.push(line)
    onProgress?.(i, doc.numPages)
  }
  await doc.destroy()
  return { raw: parts.join('\n\n'), pages: doc.numPages }
}

/** 그림으로 읽을 때 최대 몇 쪽까지. 쪽당 약 1,100토큰이라 8쪽이면 9,000토큰쯤 된다 */
export const MAX_IMAGE_PAGES = 8

/** 글자를 알아볼 만큼의 해상도. 너무 키우면 용량만 커지고 인식률은 안 오른다 */
const RENDER_WIDTH = 1400

/**
 * PDF 쪽을 그림으로 만든다.
 *
 * 글자층이 깨진 PDF 라도 **사람 눈에는 멀쩡히 보인다.** 모델도 마찬가지다.
 * 실측: 이 방식으로 깨졌던 한글 문서를 표 안의 값까지 정확히 읽어냈다.
 * 글자 추출이 실패했을 때만 쓴다 — 토큰이 훨씬 많이 든다.
 */
export async function renderPages(file, { maxPages = MAX_IMAGE_PAGES, onProgress } = {}) {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href

  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const n = Math.min(doc.numPages, maxPages)
  const images = []

  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: RENDER_WIDTH / base.width })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    await page.render({ canvasContext: canvas.getContext('2d'), viewport, canvas }).promise
    // JPEG 로 줄인다. 글자 문서는 0.85 면 알아보는 데 지장이 없다
    const url = canvas.toDataURL('image/jpeg', 0.85)
    images.push({ mimeType: 'image/jpeg', data: url.slice(url.indexOf(',') + 1) })
    canvas.width = canvas.height = 0 // 메모리를 즉시 놓아준다
    onProgress?.(i, n)
  }
  await doc.destroy()
  return { images, pages: doc.numPages, rendered: n }
}

/**
 * @returns {Promise<{ok:true, kind:string, text:string, chars:number, pages?:number, truncated:boolean}
 *                 | {ok:false, kind:string, reason:string}>}
 */
export async function readDocument(file, { onProgress } = {}) {
  const kind = fileKind(file)

  if (file.size > MAX_BYTES) {
    return { ok: false, kind, reason: `파일이 너무 커요 (${(file.size / 1024 / 1024).toFixed(1)}MB)` }
  }

  try {
    if (kind === 'text') {
      const raw = await file.text()
      const { text, truncated } = fit(raw)
      return { ok: true, kind, text, chars: raw.length, truncated }
    }

    if (kind === 'pdf') {
      const { raw, pages } = await readPdf(file, onProgress)
      if (!raw.trim()) {
        // 스캔본이면 글자가 없다. 그림만 있는 PDF 다
        return { ok: false, kind, reason: '글자가 없는 PDF 예요 (스캔본일 수 있어요)' }
      }
      // 글자는 나왔는데 깨진 경우. 이걸 넘기면 모델이 쓰레기를 읽고 그럴듯하게 지어낸다
      const health = hangulHealth(raw)
      if (health && health.ratio < GARBLED_BELOW) {
        return {
          ok: false,
          kind,
          reason: '한글이 깨져서 나와요 (글꼴 정보가 없는 PDF 예요)',
          garbled: true,
        }
      }
      const { text, truncated } = fit(raw)
      return { ok: true, kind, text, chars: raw.length, pages, truncated }
    }

    if (kind === 'image') return { ok: false, kind, reason: '이미지는 아직 못 읽어요' }
    return { ok: false, kind, reason: '이 형식은 아직 못 읽어요' }
  } catch (e) {
    console.warn('[doc] 읽기 실패', e)
    return { ok: false, kind, reason: '파일을 여는 데 실패했어요' }
  }
}

/** 모델에게 넘길 형태로 감싼다 */
export function toPrompt(fileName, doc) {
  const head = `[학생이 올린 자료 — "${fileName}"${doc.pages ? ` · ${doc.pages}쪽` : ''}${doc.truncated ? ' · 일부 생략됨' : ''}]`
  return `${head}\n${doc.text}\n[자료 끝]`
}
