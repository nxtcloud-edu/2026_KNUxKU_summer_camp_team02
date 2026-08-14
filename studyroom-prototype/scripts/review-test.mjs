import { validateReview, collectInput, contentScale, MIN_CHARS } from '/Users/sinsuhyeong/Downloads/aws프로젝트/studyroom-prototype/src/lib/review.js'
let pass=0, fail=0
const T=(n,g,w)=>{ if(g===w) pass++; else {fail++; console.log(`  ❌ ${n}\n       기대 ${w} · 실제 ${g}`)} }

console.log('\n[1] 글자 그대로 온 줄바꿈을 되살린다')
const r = validateReview({
  conceptGroups:[{domain:'data_structure',label:'자료구조',concepts:[{title:'해시',markdown:'### 개념 설명\\n본문이야\\n\\n### 예시\\n- 항목'}]}],
  deepeningPoints:[{title:'재해싱',body:'설명'}],
  trueFalseQuizzes:[{statement:'문장',answer:true,explanation:'해설'}],
  summaryText:'요약', downloadSummaryMarkdown:'# 노트\\n본문',
})
T('개념 줄바꿈', (r.conceptGroups[0].concepts[0].markdown.match(/\n/g)||[]).length, 4)
T('노트 줄바꿈', (r.downloadSummaryMarkdown.match(/\n/g)||[]).length, 1)
T('제목이 줄 맨앞', r.conceptGroups[0].concepts[0].markdown.startsWith('### 개념 설명'), true)

console.log('[2] 못 쓸 값은 걸러낸다')
T('개념 없으면 null', validateReview({conceptGroups:[],deepeningPoints:[],trueFalseQuizzes:[],summaryText:'',downloadSummaryMarkdown:''}), null)
T('빈 개념 그룹 제거', validateReview({conceptGroups:[{domain:'a',label:'b',concepts:[{title:'',markdown:''}]}],deepeningPoints:[],trueFalseQuizzes:[],summaryText:'',downloadSummaryMarkdown:''}), null)
const q = validateReview({conceptGroups:[{domain:'a',label:'b',concepts:[{title:'t',markdown:'m'}]}],deepeningPoints:[{title:'',body:'x'}],trueFalseQuizzes:[{statement:'s',answer:'참',explanation:'e'}],summaryText:'s',downloadSummaryMarkdown:'d'})
T('제목 없는 심화 제거', q.deepeningPoints.length, 0)
T('answer 가 불리언 아니면 제거', q.trueFalseQuizzes.length, 0)
T('null 입력', validateReview(null), null)

console.log('[3] 분량 기준')
T('짧음', contentScale(500), 'short')
T('보통', contentScale(3000), 'normal')
T('긺',  contentScale(9000), 'long')
T('문턱', MIN_CHARS, 180)

console.log(`\n${fail===0?'전부 통과':'실패 있음'} — 통과 ${pass} / 실패 ${fail}`)
process.exit(fail?1:0)
