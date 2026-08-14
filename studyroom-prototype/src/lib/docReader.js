/**
 * 올린 파일을 읽을 수 있는 형태로 만든다.
 *
 * 처음에는 pdf.js 로 브라우저에서 글자를 뽑았다. 그런데 하루에 세 번 발목을 잡혔다.
 *   · 워커가 application/octet-stream 으로 나가 실행 거부됨 (배포에서만)
 *   · 배경 탭에서 캔버스 렌더링이 멈춤
 *   · 400KB 짜리 청크를 터널 너머로 받아야 함
 * 게다가 한글 PDF 는 글꼴에 유니코드 대응표가 없으면 "사본"이 "칺쫆"으로 나온다.
 *
 * 그래서 **PDF 는 그냥 모델에게 준다.** 실측에서 모델이 9쪽을 4,811토큰에 정확히 읽었고
 * (표 안의 값, 예외 조항까지) 우리가 글자를 뽑아 넘긴 것보다 나았다.
 * 라이브러리도, 워커도, 깨짐 판별도 필요 없어졌다.
 *
 * 글자 파일(txt·md·코드)은 브라우저가 그냥 읽는다. 그건 모델에 보낼 이유가 없다.
 */

/**
 * 모델에 넘길 글자 수 상한. 이보다 길면 앞뒤를 살리고 가운데를 접는다.
 * 8,000자 ≈ 4,700토큰. 프롬프트 예산(8,000토큰)의 절반가량이라
 * 자료를 넣어도 대화 기록이 통째로 밀려나지 않는다.
 */
export const MAX_CHARS = 8000

/** PDF 를 통째로 모델에 넘길 수 있는 크기. base64 로 1.33배가 된다 */
export const MAX_PDF_BYTES = 10 * 1024 * 1024

/** 글자 파일 크기 상한 */
export const MAX_TEXT_BYTES = 5 * 1024 * 1024

const TEXT_EXT =
  /\.(txt|md|markdown|csv|tsv|json|log|ya?ml|html?|xml|js|ts|jsx|tsx|py|java|c|cpp|h|go|rs|sql|sh)$/i

export function fileKind(file) {
  const n = (file?.name || '').toLowerCase()
  if (n.endsWith('.pdf') || file?.type === 'application/pdf') return 'pdf'
  if (TEXT_EXT.test(n) || (file?.type || '').startsWith('text/')) return 'text'
  if ((file?.type || '').startsWith('image/')) return 'image'
  return 'other'
}

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

/* ── 긴 자료를 나눠 읽기 ─────────────────────────────────────
   [결정] 쪽수가 많으면 조각으로 나눠 **동시에** 읽는다.

   빠르라고 나누는 게 아니다. **안 잘리려고** 나눈다.

   모델의 한 번 출력 상한이 24,000토큰이다. 22쪽짜리 논문이 그 언저리라
   통째로 읽으면 될 때도 있고 조용히 잘릴 때도 있었다 — 실측에서 같은 파일이
   한 번은 65,778자 STOP, 다음엔 66,296자 MAX_TOKENS 였다. 뒤가 날아가도
   화면에는 아무 표시가 없고, sys:extract 는 예산을 늘려 다시 부르지도 않는다
   (widen:false — 터널 100초 제한 때문에 그렇게 뒀다).
   조각으로 나누면 조각마다 예산이 따로라 이 절벽이 사라진다.

   덤으로 빠르기도 하다. 실측(22쪽): 통째로 39초 · 4조각 동시 25초 · 4조각 차례 59초.
   ⚠️ 조각 시간은 튄다. 같은 4조각이 한 번은 25초, 한 번은 213초였다(API 쪽 사정).
      그래서 조각 수를 무작정 늘리지 않는다. */

/** 한 조각이 맡을 쪽수 */
export const PAGES_PER_CHUNK = 6

/**
 * 이 쪽수까지는 통째로 읽는다.
 * 10쪽이면 출력이 대략 9천 토큰이라 상한(24,000)에 한참 못 미친다.
 * 그 아래에서는 나누는 값보다 쪽수를 묻는 호출 하나가 더 비싸다.
 */
export const WHOLE_DOC_MAX_PAGES = 10

/** 1쪽부터 pages 쪽까지를 조각 범위로 자른다 */
export function planRanges(pages, per = PAGES_PER_CHUNK) {
  if (!Number.isFinite(pages) || pages <= 0) return []
  const out = []
  for (let p = 1; p <= pages; p += per) out.push([p, Math.min(pages, p + per - 1)])
  return out
}

/** 조각 하나에게 줄 지시. `[p12]` 표시를 요구하는 게 병합의 열쇠다 */
export function rangePrompt(fileName, from, to) {
  return (
    `"${fileName}" 자료의 **${from}쪽부터 ${to}쪽까지만** 빠짐없이 글로 옮겨 적어줘.\n` +
    `- 각 쪽이 시작할 때 [p쪽번호] 를 먼저 적는다. 예: [p${from}]\n` +
    `- 표는 값을 그대로 옮긴다. 요약하지 않는다.\n` +
    `- 범위 밖의 쪽은 적지 않는다. 그 쪽이 없으면 아무것도 적지 않는다.`
  )
}

/**
 * 조각들을 한 벌로 합친다.
 *
 * 이어붙이기만 하면 조각이 겹치거나 빠졌을 때 그대로 티가 안 난다.
 * `[p12]` 표시로 **쪽 단위**로 갈라 담으면, 쪽수를 잘못 세도 겹친 쪽은 하나로 모이고
 * 순서도 저절로 맞는다. 같은 쪽이 두 번 오면 **더 긴 쪽**을 남긴다 —
 * 조각 경계에서 한쪽이 잘렸을 때 온전한 쪽이 이긴다.
 */
export function mergePages(parts) {
  const pages = new Map()
  let sawMarker = false
  for (const t of parts) {
    const s = String(t || '')
    const marks = [...s.matchAll(/\[p(\d+)\]/g)]
    if (!marks.length) continue
    sawMarker = true
    for (let i = 0; i < marks.length; i++) {
      const no = Number(marks[i][1])
      const from = marks[i].index + marks[i][0].length
      const to = i + 1 < marks.length ? marks[i + 1].index : s.length
      const body = s.slice(from, to).trim()
      if (!body) continue
      if (!pages.has(no) || pages.get(no).length < body.length) pages.set(no, body)
    }
  }
  // 표시를 하나도 안 붙였으면 순서대로 잇는다. 없는 것보다 낫다
  if (!sawMarker) return parts.filter(Boolean).join('\n\n').trim()
  return [...pages.keys()]
    .sort((a, b) => a - b)
    .map((n) => pages.get(n))
    .join('\n\n')
    .trim()
}

/** 모델이 답한 쪽수 문자열에서 숫자만 꺼낸다. 못 읽으면 null */
export function parsePageCount(text) {
  const m = /\d+/.exec(String(text || ''))
  if (!m) return null
  const n = Number(m[0])
  return Number.isFinite(n) && n > 0 && n <= 2000 ? n : null
}

/** 파일을 모델에 그대로 넘길 형태로 (base64) */
export async function asInlineFile(file) {
  const buf = new Uint8Array(await file.arrayBuffer())
  let bin = ''
  const CHUNK = 0x8000 // 한 번에 다 넘기면 인자 개수 제한에 걸린다
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK))
  }
  return { mimeType: file.type || 'application/pdf', data: btoa(bin) }
}

/**
 * 이 파일을 어떻게 다룰지 정한다. 실제 모델 호출은 화면 쪽이 한다.
 *
 * @returns {{mode:'text', text:string, chars:number, truncated:boolean}
 *          |{mode:'model'}
 *          |{mode:'no', reason:string}}
 */
export async function planDocument(file) {
  const kind = fileKind(file)

  if (kind === 'text') {
    if (file.size > MAX_TEXT_BYTES) {
      return { mode: 'no', reason: `글자 파일이 너무 커요 (${(file.size / 1024 / 1024).toFixed(1)}MB)` }
    }
    try {
      const raw = await file.text()
      if (!raw.trim()) return { mode: 'no', reason: '내용이 비어 있어요' }
      const { text, truncated } = fit(raw)
      return { mode: 'text', text, chars: raw.length, truncated }
    } catch (e) {
      return { mode: 'no', reason: `파일을 여는 데 실패했어요 (${String(e?.message || e).slice(0, 60)})` }
    }
  }

  if (kind === 'pdf') {
    if (file.size > MAX_PDF_BYTES) {
      const mb = (file.size / 1024 / 1024).toFixed(1)
      return { mode: 'no', reason: `PDF 가 너무 커요 (${mb}MB · ${MAX_PDF_BYTES / 1024 / 1024}MB 까지)` }
    }
    return { mode: 'model' } // 모델이 직접 읽는다
  }

  if (kind === 'image') return { mode: 'no', reason: '이미지는 아직 못 읽어요' }
  return { mode: 'no', reason: '이 형식은 아직 못 읽어요' }
}

/** 모델에게 넘길 형태로 감싼다 */
/**
 * 자료를 프롬프트에 넣는 모양.
 *
 * 예전에는 본문만 감싸서 넣었다. 그러면 모델은 자료를 **참고 자료 중 하나**로 다루고,
 * 모르는 대목은 아는 것으로 메운다. 실제로 이렇게 나왔다 —
 * 논문 Table 8 은 SISA 가 Transformer 보다 39% 느리다고(16,783 vs 27,714 tok/s)
 * 적어 뒀는데, "빨라지는 거 맞아?"에 "속도를 높였어"라고 답했다.
 * 하이브리드 구조는 대개 빠르다는 **일반 상식**으로 메운 것이다.
 * 문장은 매끄럽고 내용은 정반대인, 제일 알아채기 어려운 종류의 오답이다.
 *
 * 그래서 자료와 함께 근거 규칙을 같이 넣는다. 이 규칙의 핵심은 세 번째 줄이다 —
 * **모른다고 말할 자리를 만들어 주는 것.** 그 자리가 없으면 모델은 메운다.
 */
export function toPrompt(fileName, text) {
  return (
    `[학생이 올린 자료 — "${fileName}"]\n${text}\n[자료 끝]\n\n` +
    `위 자료가 이 대화의 근거다. 지킬 것:\n` +
    `- 자료에 있는 것만 사실로 말한다. 자료에서 확인 안 되면 "이 자료엔 안 나와 있어"라고 말한다.\n` +
    `- 숫자·성능·비교는 특히 그렇다. 그럴듯한 값을 지어내지 않는다.\n` +
    `- 자료가 한계나 단점을 적어 뒀으면 그것도 같이 말한다. 좋은 점만 골라 말하지 않는다.\n` +
    `- 일반 상식과 자료가 어긋나면 **자료를 따른다.**`
  )
}
