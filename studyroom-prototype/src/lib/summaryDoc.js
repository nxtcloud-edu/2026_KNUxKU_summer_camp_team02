/**
 * 오늘의 공부 요약을 **문서로** 내보낸다.
 *
 * 예전에는 `내용 요약` 한 문단만 .txt 로 떨궜다. 화면에는 개념 해설과 심화 포인트와
 * 퀴즈가 다 있는데 정작 손에 남는 파일에는 두어 줄만 들어 있었다.
 * 사용자 말: "요약 다운로드 누르면 진짜 부실하게 뜬다."
 *
 * 이제 **화면에 있는 것을 전부** 담는다. 개념 해설이 본문이고, 한 문단짜리 요약은
 * 맨 뒤에 붙는 맺음말이다. 순서를 뒤집은 것이다.
 *
 * ── PDF 를 어떻게 굽는가 ──────────────────────────────────────
 * 브라우저의 인쇄를 쓴다. `PDF로 저장`이 인쇄 대화상자 안에 있다.
 *
 * jsPDF 같은 라이브러리를 안 쓴 이유는 **한글** 때문이다. 그 계열은 내장 글꼴에
 * 한글이 없어서 굽는 쪽에서 한글 글꼴을 통째로 실어야 한다. 부분집합을 떠도 2MB 가
 * 넘고 base64 로 다시 1.33배가 되며, 그 무게를 PDF 를 한 번도 안 받는 사람까지 전부
 * 나눠 진다. html2canvas 로 화면을 떠서 넣는 길도 있는데 그건 글자가 아니라 그림이라
 * 복사도 검색도 안 된다.
 *
 * 인쇄는 그 셋을 다 피한다. 글꼴은 기기에 이미 있고, 나가는 바이트가 0이고,
 * 글자가 글자로 남아 복사·검색이 된다. 대신 다운로드가 아니라 대화상자가 뜬다 —
 * 이 교환은 받아들일 만하다.
 */
import { parseMarkdownBlocks } from './markdown'

/* ── 재료 모으기 ─────────────────────────────────────────────
   화면과 문서가 **같은 데이터**에서 나오게 한다. 여기서 갈라지면
   "화면에는 있는데 파일에는 없다"가 다시 생긴다. */

/**
 * 요약을 문서의 뼈대로 편다.
 * @returns {{title:string, kind:string, items:Array}[]}
 */
export function buildSections(review) {
  const r = review || {}
  const sections = []

  const concepts = (r.conceptGroups || []).flatMap((g) =>
    (g.concepts || []).map((c) => ({
      title: c.title,
      label: g.label,
      markdown: c.markdown,
    })),
  )
  if (concepts.length) sections.push({ title: '공부한 개념', kind: 'concepts', items: concepts })

  if ((r.deepeningPoints || []).length)
    sections.push({ title: '심화 학습 포인트', kind: 'points', items: r.deepeningPoints })

  if ((r.trueFalseQuizzes || []).length)
    sections.push({ title: 'O/X 퀴즈', kind: 'quiz', items: r.trueFalseQuizzes })

  if ((r.summaryText || '').trim())
    sections.push({ title: '내용 요약', kind: 'text', items: [r.summaryText.trim()] })

  return sections
}

/* ── 마크다운 ─────────────────────────────────────────────── */

/**
 * 개념 본문은 스스로 `###` 를 쓴다. 개념 제목도 `###` 로 달면 둘이 같은 층이 되어
 * 목차가 뒤엉킨다. 그래서 본문 쪽을 한 칸 내린다.
 */
const demote = (md) => String(md || '').replace(/^###\s+/gm, '#### ')

/** 내려받을 .md 한 벌 */
export function buildMarkdown({ facts = [], sections = [] }) {
  const out = ['# 오늘의 공부 요약', '']
  for (const f of facts) out.push(`- **${f.label}**: ${f.value}`)
  out.push('')

  for (const s of sections) {
    out.push(`## ${s.title}`, '')
    if (s.kind === 'concepts') {
      for (const c of s.items) {
        out.push(`### ${c.title}${c.label ? ` — ${c.label}` : ''}`, '', demote(c.markdown), '')
      }
    } else if (s.kind === 'points') {
      for (const p of s.items) out.push(`- **${p.title}** — ${p.body}`)
      out.push('')
    } else if (s.kind === 'quiz') {
      s.items.forEach((q, i) => {
        out.push(`${i + 1}. ${q.statement}`)
        out.push(`   - 정답: ${q.answer ? 'O (참)' : 'X (거짓)'}`)
        if (q.explanation) out.push(`   - 해설: ${q.explanation}`)
      })
      out.push('')
    } else {
      out.push(s.items.join('\n\n'), '')
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

/* ── 인쇄용 HTML ──────────────────────────────────────────── */

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/**
 * 인라인 표기 — `코드` 와 **굵게**.
 *
 * 반드시 **이스케이프를 먼저** 한다. 모델이 쓴 본문에 `<script>` 같은 게 들어와도
 * 여기서 글자가 된다. 이스케이프가 백틱·별표를 건드리지 않으므로 순서를 지켜도 표기는 산다.
 */
function inline(text) {
  return esc(text)
    .split(/`([^`]+)`/g)
    .map((part, i) => {
      if (i % 2 === 1) return `<code>${part}</code>`
      return part.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    })
    .join('')
}

/** 마크다운 한 덩어리 → HTML. 화면과 같은 파서를 쓴다 */
function mdToHtml(md) {
  return parseMarkdownBlocks(md)
    .map((b) => {
      if (b.type === 'h3') return `<h4>${inline(b.content)}</h4>`
      if (b.type === 'ul') return `<ul>${b.items.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`
      if (b.type === 'ol') return `<ol>${b.items.map((x) => `<li>${inline(x)}</li>`).join('')}</ol>`
      if (b.type === 'code') return `<pre><code>${esc(b.content)}</code></pre>`
      if (b.type === 'formula') return `<p class="formula">${esc(b.content)}</p>`
      return `<p>${inline(b.content)}</p>`
    })
    .join('')
}

/**
 * 인쇄용 홑장 문서.
 *
 * 글꼴은 기기에 있는 것만 쓴다. 웹폰트를 걸면 인쇄 대화상자가 뜬 뒤에 글꼴이 도착해
 * 첫 장이 기본 글꼴로 굳는 일이 있다. 한글은 애초에 시스템 글꼴이 제일 안전하다.
 */
export function buildPrintHtml({ title = '오늘의 공부 요약', facts = [], sections = [] }) {
  const factsHtml = facts.length
    ? `<dl class="facts">${facts
        .map((f) => `<div><dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd></div>`)
        .join('')}</dl>`
    : ''

  const body = sections
    .map((s) => {
      let inner = ''
      if (s.kind === 'concepts') {
        inner = s.items
          .map(
            (c) =>
              `<article class="concept">` +
              `<h3>${esc(c.title)}</h3>` +
              (c.label ? `<p class="tag">${esc(c.label)}</p>` : '') +
              mdToHtml(c.markdown) +
              `</article>`,
          )
          .join('')
      } else if (s.kind === 'points') {
        inner =
          `<ul class="points">` +
          s.items
            .map((p) => `<li><strong>${esc(p.title)}</strong><span>${inline(p.body)}</span></li>`)
            .join('') +
          `</ul>`
      } else if (s.kind === 'quiz') {
        inner =
          `<ol class="quiz">` +
          s.items
            .map(
              (q) =>
                `<li><p class="stmt">${inline(q.statement)}</p>` +
                `<p class="ans"><span class="mark">${q.answer ? 'O' : 'X'}</span>` +
                `정답: ${q.answer ? '참' : '거짓'}</p>` +
                (q.explanation ? `<p class="why">${inline(q.explanation)}</p>` : '') +
                `</li>`,
            )
            .join('') +
          `</ol>`
      } else {
        inner = s.items.map((t) => `<p>${inline(t)}</p>`).join('')
      }
      return `<section><h2>${esc(s.title)}</h2>${inner}</section>`
    })
    .join('')

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: A4; margin: 17mm 15mm 15mm; }
  * { box-sizing: border-box; }
  /*
   * 바탕을 **반드시** 칠한다.
   *
   * 안 칠하면 이 문서가 얹히는 쪽의 바탕을 그대로 빌려 쓴다. 실제로 다크 모드
   * 브라우저에서 열어 보니 검은 바탕에 검은 글씨가 됐다. 인쇄는 종이 위라
   * 대개 흰 바탕으로 나오지만, "대개"에 기대는 건 확인이 아니다.
   * color-scheme 까지 못 박아 브라우저가 색을 뒤집지 못하게 한다.
   */
  html { color-scheme: light; background: #ffffff; }
  html, body { margin: 0; padding: 0; }
  body {
    background: #ffffff;
    font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Pretendard",
                 "Malgun Gothic", "Noto Sans KR", "Segoe UI", sans-serif;
    color: #22201d; font-size: 10.5pt; line-height: 1.72;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
    padding: 0 4mm;
  }
  h1 { font-size: 19pt; letter-spacing: -0.02em; margin: 0 0 2mm; }
  h2 {
    font-size: 12.5pt; letter-spacing: -0.01em; margin: 9mm 0 3mm;
    padding-bottom: 1.6mm; border-bottom: 1.4px solid #3f6152; color: #3f6152;
    break-after: avoid; page-break-after: avoid;
  }
  h3 { font-size: 11.5pt; margin: 0 0 1mm; letter-spacing: -0.01em; break-after: avoid; }
  h4 { font-size: 10.5pt; margin: 3mm 0 1mm; color: #3f6152; break-after: avoid; }
  p { margin: 0 0 1.8mm; }
  ul, ol { margin: 0 0 2mm; padding-left: 5.5mm; }
  li { margin: 0 0 1mm; }
  code {
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    font-size: 9.2pt; background: #f1efea; border: 0.5px solid #e0ddd6;
    border-radius: 2px; padding: 0.3mm 1mm;
  }
  pre {
    background: #f7f5f1; border: 0.5px solid #e0ddd6; border-radius: 2px;
    padding: 2.5mm 3mm; overflow: hidden; white-space: pre-wrap; word-break: break-word;
    margin: 0 0 2mm;
  }
  pre code { background: none; border: 0; padding: 0; }
  .formula {
    background: #f4f2fa; border: 0.5px solid #e2def0; border-radius: 2px;
    padding: 1.8mm 2.5mm; font-family: "SFMono-Regular", Consolas, monospace; font-size: 9.5pt;
  }

  header { border-bottom: 2.2px solid #22201d; padding-bottom: 3.5mm; margin-bottom: 2mm; }
  .facts { display: flex; flex-wrap: wrap; gap: 2mm 7mm; margin: 2.5mm 0 0; }
  .facts div { display: flex; gap: 2mm; align-items: baseline; }
  .facts dt { font-size: 8.6pt; letter-spacing: 0.04em; color: #7c766d; margin: 0; }
  .facts dd { margin: 0; font-size: 9.6pt; font-weight: 600; }

  .concept {
    border-left: 2.2px solid #cfd8d1; padding: 0 0 0 4mm; margin: 0 0 5mm;
    break-inside: avoid; page-break-inside: avoid;
  }
  .tag {
    display: inline-block; font-size: 8.2pt; color: #5c7a68; background: #eef3ef;
    border-radius: 8px; padding: 0.3mm 2mm; margin: 0 0 1.8mm;
  }

  .points { list-style: none; padding: 0; }
  .points li {
    break-inside: avoid; margin: 0 0 2.5mm; padding-left: 4mm; position: relative;
  }
  .points li::before {
    content: ""; position: absolute; left: 0; top: 2.4mm;
    width: 1.6mm; height: 1.6mm; border-radius: 50%; background: #c9756a;
  }
  .points strong { display: block; }
  .points span { color: #4a463f; }

  .quiz { padding-left: 5mm; }
  .quiz li { break-inside: avoid; margin: 0 0 3.5mm; }
  .quiz .stmt { margin: 0 0 1.2mm; }
  .quiz .ans { margin: 0 0 0.8mm; font-weight: 600; font-size: 9.8pt; }
  .quiz .mark {
    display: inline-block; min-width: 4.6mm; text-align: center; margin-right: 1.6mm;
    border: 1.1px solid #3f6152; border-radius: 50%; color: #3f6152; font-size: 8.6pt;
  }
  .quiz .why { margin: 0; color: #5f594f; font-size: 9.6pt; }

  footer { margin-top: 8mm; padding-top: 2.5mm; border-top: 0.5px solid #ddd9d2;
           font-size: 8.4pt; color: #8a847a; }
</style></head>
<body>
  <header><h1>${esc(title)}</h1>${factsHtml}</header>
  ${body}
  <footer>AI 스터디룸에서 나눈 대화와 올린 자료로 정리했습니다.</footer>
</body></html>`
}

/* ── 내보내기 ─────────────────────────────────────────────── */

/** 브라우저의 인쇄 대화상자를 띄운다. 거기서 `PDF로 저장`을 고르면 된다 */
export function printAsPdf({ html, filename }) {
  if (typeof document === 'undefined') return

  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.setAttribute('title', '요약 인쇄')
  /*
   * display:none 이면 인쇄가 빈 장을 뱉는다 — 배치가 안 된 문서라 그리 되는 것이다.
   * 그래서 **화면 밖에 실제 크기로** 둔다. A4 를 96dpi 로 잰 값이다.
   */
  frame.style.cssText =
    'position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0;opacity:0'
  document.body.appendChild(frame)

  // 저장 파일 이름은 문서 제목에서 온다. 잠깐 바꿔 두고 되돌린다
  const prevTitle = document.title
  let done = false
  const cleanup = () => {
    if (done) return
    done = true
    document.title = prevTitle
    setTimeout(() => frame.remove(), 300)
  }

  frame.onload = () => {
    const w = frame.contentWindow
    if (!w) return cleanup()
    if (filename) document.title = filename
    w.addEventListener('afterprint', cleanup)
    try {
      w.focus()
      w.print()
    } catch (e) {
      console.warn('[summary] 인쇄 실패', e)
    }
    // afterprint 를 안 주는 브라우저가 있다. 그때도 iframe 은 치워야 한다
    setTimeout(cleanup, 60_000)
  }
  frame.srcdoc = html
}

/** 마크다운 원문을 파일로 내려받는다 */
export function downloadMarkdown({ markdown, filename }) {
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
