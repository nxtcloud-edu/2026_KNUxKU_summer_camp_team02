/** 기계로 셀 수 있는 규칙만 센다. "어색하다"는 세지 않는다 */
import { readFileSync } from 'node:fs'
const EMOJI = /\p{Extended_Pictographic}/u
const RULES = [
  ['이모지 (전 말투 금지)', (r) => EMOJI.test(r.text)],
  ['ㅋㅋ 2회 초과 (T2 만 1회 허용)', (r) => (r.text.match(/[ㅋㅎ]{2,}/g) || []).length > (r.tone === 'T2' ? 1 : 0)],
  ['T1 에 느낌표·물결', (r) => r.tone === 'T1' && /[!~]/.test(r.text)],
  ['평가·칭찬 표현', (r) => /잘하고 있|잘했|좋아요|훌륭|대단|멋지/.test(r.text)],
  ['어디 갔었냐 묻기 (F5 금지)', (r) => r.funcId === 'F5' && /어디 (갔|다녀)/.test(r.text)],
  ['자기를 AI 라고 소개', (r) => /(나는|난) ?(AI|인공지능|챗봇|언어\s?모델)/.test(r.text)],
  ['F1 이 목록·번호를 씀', (r) => r.funcId === 'F1' && /(^|\n)\s*([-·*]|\d+\.)\s/.test(r.text)],
  ['F2 가 "핵심은" 으로 안 닫음', (r) => r.funcId === 'F2' && !/핵심은/.test(r.text)],
  ['F2 가 마크다운 표를 씀', (r) => r.funcId === 'F2' && /\|.*\|/.test(r.text)],
  ['F1 이 120자 초과', (r) => r.funcId === 'F1' && r.case.startsWith('F1-') && r.chars > 120],
  ['F6 이 300자 미만', (r) => r.funcId === 'F6' && r.chars < 300],
  ['F6 이 500자 초과', (r) => r.funcId === 'F6' && r.chars > 500],
  ['F6 단 안에서 줄바꿈 남발 (개행 8회 초과)', (r) => r.funcId === 'F6' && (r.text.match(/\n/g) || []).length > 8],
  ['F5 가 40자 초과', (r) => r.funcId === 'F5' && r.chars > 40],
  ['F4 가 목표 원문을 인용 안 함', (r) => r.funcId === 'F4' && !r.text.includes('자료구조 3장')],
  ['서론으로 시작 (F6 금지)', (r) => r.funcId === 'F6' && /^(좋은 질문|이건 중요|먼저,|자,)/.test(r.text)],
]
const load = (p) => JSON.parse(readFileSync(p, 'utf8'))
const [bp, ap] = process.argv.slice(2)
const B = load(bp), A = load(ap)
let tb = 0, ta = 0
console.log('  규칙                                         전 → 후')
for (const [name, f] of RULES) {
  const nb = B.filter(f).length, na = A.filter(f).length
  tb += nb; ta += na
  const mark = na < nb ? '✅' : na > nb ? '⚠' : na === 0 ? '·' : '—'
  console.log(`  ${name.padEnd(42)} ${String(nb).padStart(2)} → ${String(na).padStart(2)}  ${mark}`)
}
console.log(`  ${'합계'.padEnd(42)} ${String(tb).padStart(2)} → ${String(ta).padStart(2)}`)
