import './voice-shim.mjs'
import { createListener, LISTEN } from '/Users/sinsuhyeong/Downloads/aws프로젝트/studyroom-prototype/src/lib/voice/listener.js'

let pass=0, fail=0
const T=(n,g,w)=>{ if(g===w) pass++; else {fail++; console.log(`  ❌ ${n} 기대 ${w} 실제 ${g}`)} }
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms))

console.log('\n[1] 설정값')
T('침묵 판정 1.2초', LISTEN.silenceMs, 1200)
T('강제 끊기 없음', LISTEN.hardFlushMs, 0)

console.log('[2] 말이 길어져도 중간에 안 끊는다')
const got = []
const l = createListener({ onUtterance: (t) => got.push(t), onPartial: () => {}, onState: () => {}, subscribeSpeaking: () => () => {} })
l.start()
const SR = globalThis.MockSR.last
// 0.4초 간격으로 계속 말한다 — 침묵이 1.2초를 못 넘으므로 확정되면 안 된다
for (let i = 0; i < 12; i++) { SR.say(`조각${i} `, true); await sleep(400) }
T('4.8초 말하는 동안 확정 0건', got.length, 0)

console.log('[3] 말을 멈추면 그때 한 번에 나온다')
await sleep(1400)
T('확정 1건', got.length, 1)
T('앞 조각이 다 들어있다', got[0].includes('조각0') && got[0].includes('조각11'), true)

l.stop()
console.log(`\n${fail===0?'전부 통과':'실패 있음'} — 통과 ${pass} / 실패 ${fail}`)
process.exit(fail?1:0)
