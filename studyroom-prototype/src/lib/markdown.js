/**
 * 최소 마크다운 파서.
 *
 * 엔딩 화면(MarkdownViewer)과 내려받기용 PDF 가 **같은 파서**를 쓴다.
 * 따로 두면 화면에서는 목록으로 보이는 게 PDF 에서는 별표가 박힌 한 줄로 나가는 식으로
 * 조용히 갈라진다. 사용자는 그걸 "다운로드가 부실하다"로 겪는다.
 *
 * 지원: ### 제목 · 문단 · - 목록 · 1. 번호 목록 · 코드블록 ·
 *       문단 전체가 `...` 로만 되어 있으면 공식 박스 · 빈 줄 기준 문단 분리
 */
export function parseMarkdownBlocks(md) {
  const lines = (md || '').replace(/\r\n/g, '\n').split('\n')
  const blocks = []
  let i = 0

  const isFence = (l) => l.trim().startsWith('```')
  const isHeading = (l) => /^###\s+/.test(l)
  const isBullet = (l) => /^[-*]\s+/.test(l)
  const isNumbered = (l) => /^\d+\.\s+/.test(l)

  while (i < lines.length) {
    const line = lines[i]

    if (line.trim() === '') {
      i++
      continue
    }

    if (isFence(line)) {
      const codeLines = []
      i++
      while (i < lines.length && !isFence(lines[i])) {
        codeLines.push(lines[i])
        i++
      }
      i++ // 닫는 펜스 건너뛰기
      blocks.push({ type: 'code', content: codeLines.join('\n') })
      continue
    }

    if (isHeading(line)) {
      blocks.push({ type: 'h3', content: line.replace(/^###\s+/, '') })
      i++
      continue
    }

    if (isBullet(line)) {
      const items = []
      while (i < lines.length && isBullet(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ''))
        i++
      }
      blocks.push({ type: 'ul', items })
      continue
    }

    if (isNumbered(line)) {
      const items = []
      while (i < lines.length && isNumbered(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''))
        i++
      }
      blocks.push({ type: 'ol', items })
      continue
    }

    // 문단 — 빈 줄이나 다음 블록 시작 전까지 이어붙인다
    const paraLines = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !isFence(lines[i]) &&
      !isHeading(lines[i]) &&
      !isBullet(lines[i]) &&
      !isNumbered(lines[i])
    ) {
      paraLines.push(lines[i].trim())
      i++
    }
    const joined = paraLines.join(' ')
    if (/^`[^`]+`$/.test(joined)) {
      blocks.push({ type: 'formula', content: joined.slice(1, -1) })
    } else {
      blocks.push({ type: 'p', content: joined })
    }
  }

  return blocks
}
