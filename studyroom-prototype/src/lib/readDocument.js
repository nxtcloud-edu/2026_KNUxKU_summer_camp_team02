/**
 * 파일 하나를 글로 옮긴다 — **화면과 세션에 딸린 것이 없는 부분만.**
 *
 * 원래 이 코드는 StudyRoomScreen 의 업로드 처리 안에 들어 있었다. 그런데 자료를
 * **입장 전 로비에서 미리 읽어 두자**는 요구가 생기면서, 같은 일을 두 곳에서 해야 했다.
 * 로비에는 세션도, 채팅도, 캐릭터 발언권도 없다.
 *
 * 그래서 "읽기"만 여기로 뺐다. 부르는 쪽이 각자 알아서 한다 —
 * 방은 채팅에 표시하고 캐릭터가 말하게 하고, 로비는 진행 상황만 보여준다.
 *
 * 왜 로비에서 읽는 게 이득인가: 22쪽 논문이 28초쯤 걸린다. 방에 들어가서 읽으면
 * 사용자는 빈 화면을 28초 본다. 로비에서 읽으면 그 시간이 카메라·마이크 점검에 묻힌다.
 * **기다림을 없애는 게 아니라 이미 기다리던 시간에 겹쳐 두는 것이다.**
 */

import {
  planDocument,
  asInlineFile,
  planRanges,
  rangePrompt,
  mergePages,
  parsePageCount,
  WHOLE_DOC_MAX_PAGES,
} from './docReader'
import { requestReply } from './agent/client'

/**
 * @param {File} file
 * @param {{onStage?: (s:{stage:string, pages?:number, chunks?:number}) => void}} [opts]
 *   onStage 는 진행 상황을 알린다. 부르는 쪽이 화면에 뭘 보여줄지는 각자 정한다.
 * @returns {Promise<{ok:true, name:string, body:string, pages:number|null}
 *                  | {ok:false, reason:string}>}
 */
export async function readDocumentFile(file, { onStage } = {}) {
  if (!file) return { ok: false, reason: '파일이 없어요' }

  const plan = await planDocument(file)
  if (plan.mode === 'no') return { ok: false, reason: plan.reason }

  // 글자 파일은 브라우저가 그냥 읽는다. 모델을 부를 이유가 없다
  if (plan.mode !== 'model') {
    return { ok: true, name: file.name, body: plan.text, pages: null }
  }

  const inline = await asInlineFile(file)
  const read = (message) =>
    requestReply({ mode: 'extract', settings: {}, turns: [], images: [inline], message })

  try {
    /**
     * 쪽수를 먼저 묻는다. 5~6초짜리 짧은 호출이다.
     * PDF 바이트에서 세 보려 했는데 압축된 파일에서는 `/Type /Page` 가 하나도
     * 안 나온다(실측: 22쪽 논문에서 0개). 모델은 "22"라고 정확히 답한다.
     */
    onStage?.({ stage: 'pages' })
    const pages = parsePageCount((await read('이 자료는 모두 몇 쪽이야? 숫자만 답해.'))?.text)
    const ranges = pages > WHOLE_DOC_MAX_PAGES ? planRanges(pages) : []

    let body
    if (ranges.length > 1) {
      /**
       * 긴 자료는 조각으로 나눠 **동시에** 읽는다.
       * 빠르라고가 아니라 **안 잘리려고** 나눈다 — 자세한 사정은 docReader 주석에.
       */
      onStage?.({ stage: 'reading', pages, chunks: ranges.length })
      const parts = await Promise.all(
        ranges.map(([a, b]) => read(rangePrompt(file.name, a, b)).then((r) => r?.text || '')),
      )
      body = mergePages(parts)
    } else {
      onStage?.({ stage: 'reading', pages, chunks: 1 })
      body = (await read(`"${file.name}" 자료의 내용을 빠짐없이 글로 옮겨 적어줘.`))?.text || ''
    }

    if (!body) return { ok: false, reason: '자료에서 글을 얻지 못했어요' }
    console.debug(`[doc] ${pages ?? '?'}쪽 · ${ranges.length || 1}조각 · ${body.length.toLocaleString()}자`)
    return { ok: true, name: file.name, body, pages }
  } catch (e) {
    console.warn('[doc] 자료 읽기 실패', e)
    return { ok: false, reason: String(e?.message || e).slice(0, 60) }
  }
}
