/**
 * 키 연쇄를 실제 handleChat 으로 검증한다.
 * 모델 호출만 가짜로 바꿔치기해서, 어떤 키·모델이 어떤 순서로 시도되는지 본다.
 */
const R = '/Users/sinsuhyeong/Downloads/aws프로젝트/studyroom-prototype'
const { PROVIDERS } = await import(R + '/server/providers.mjs')
const { handleChat, loadEnv } = await import(R + '/server/chat.mjs')

/**
 * 상위 모델 이름을 여기에 박아 두지 않는다.
 * 예전엔 'gemini-3.6-flash' 라고 적어 뒀는데, 모델을 3.7 로 올리자 **이 검사만** 빨갛게 됐다.
 * 검사가 확인해야 할 것은 "어떤 모델이냐"가 아니라 **"상위 자리에 상위 모델이 오느냐"** 다.
 */
const PRO_MODEL = (loadEnv().MODEL_PRO || 'gemini-3.7-flash')

const env = loadEnv()
const byKey = new Map()
for (const [n, v] of Object.entries(env)) if (v && v.length > 20) byKey.set(v, n)

let pass = 0, fail = 0
const T = (n, g, w) => { if (JSON.stringify(g) === JSON.stringify(w)) pass++; else { fail++; console.log(`  ❌ ${n}\n       기대 ${JSON.stringify(w)}\n       실제 ${JSON.stringify(g)}`) } }

let log = []
const real = PROVIDERS.gemini
/** @param failFor 이 키 이름들은 429(일일 소진)로 실패시킨다 */
function mock(failFor) {
  log = []
  PROVIDERS.gemini = async ({ apiKey, model }) => {
    const id = byKey.get(apiKey) || '?'
    log.push(`${id}/${model}`)
    if (failFor.includes(id)) {
      const e = new Error('quota'); e.status = 429
      e.body = { error: { message: 'Quota exceeded ... quotaId: GenerateRequestsPerDayPerProjectPerModel' } }
      throw e
    }
    return { text: '응답', inTok: 1, outTok: 1, ms: 1, finish: 'STOP' }
  }
}
const ask = (funcId) => handleChat({
  seat: { slotNo: 1, name: '미나', tone: 'T1' }, funcId, message: '테스트', settings: {}, turns: [],
})

const FREE = ['T2', 'T3', 'T4', 'T5', 'T6']

console.log('\n[1] 평소 — 무료 키로 3.5-flash-lite')
mock([])
let r = await ask('F5')
T('무료 키 하나로 끝', log.length, 1)
T('모델', log[0].split('/')[1], 'gemini-3.5-flash-lite')
T('무료 키', FREE.includes(log[0].split('/')[0]), true)
T('meta.route', r.meta.route, 'free')

console.log('[2] 무료 키 하나가 죽으면 다음 무료 키로')
mock([log[0].split('/')[0]])
r = await ask('F5')
T('두 번 시도', log.length, 2)
T('둘 다 무료', log.every((l) => FREE.includes(l.split('/')[0])), true)
T('여전히 무료 경로', r.meta.route, 'free')

console.log('[3] 무료가 전부 소진되면 → S1 으로, 모델은 그대로 3.5-flash-lite')
mock(FREE)
r = await ask('F5')
T('마지막은 S1', log[log.length - 1].split('/')[0], 'S1')
T('모델은 값싼 쪽 유지', log[log.length - 1].split('/')[1], 'gemini-3.5-flash-lite')
T('폴백이라고 표시', r.meta.route, 'quota-fallback')
T('무료를 3번 시도한 뒤 넘어감', log.filter((l) => FREE.includes(l.split('/')[0])).length, 3)

console.log('[4] 지능이 필요한 자리 — 처음부터 S1 + 3.6-flash')
mock([])
r = await ask('F6')
T('첫 시도가 S1', log[0].split('/')[0], 'S1')
// 값을 박아 두면 모델을 올릴 때마다 여기서 걸린다. chat.mjs 의 기본값을 그대로 읽는다
T('상위 모델', log[0].split('/')[1], PRO_MODEL)
T('지능 승급 표시', r.meta.route, 'pro')

console.log('[5] 유료까지 막히면 무료로라도 답한다 (침묵보다 낫다)')
mock(['S1'])
r = await ask('F6')
T('S1 먼저 시도', log[0].split('/')[0], 'S1')
T('그다음 무료', FREE.includes(log[log.length - 1].split('/')[0]), true)
T('값싼 모델로 내려감', log[log.length - 1].split('/')[1], 'gemini-3.5-flash-lite')
T('내려감 표시', r.meta.route, 'pro-down')

console.log('[6] 같은 키를 두 번 시도하지 않는다')
mock(FREE)
await ask('F5')
T('중복 없음', new Set(log).size, log.length)

console.log('[7] 전부 죽으면 오류를 낸다 (조용히 성공한 척하지 않는다)')
mock([...FREE, 'S1'])
let threw = null
try { await ask('F5') } catch (e) { threw = e.status }
T('오류 던짐', threw, 429)

PROVIDERS.gemini = real
console.log(`\n${fail === 0 ? '전부 통과' : '실패 있음'} — 통과 ${pass} / 실패 ${fail}`)
process.exit(fail ? 1 : 0)
