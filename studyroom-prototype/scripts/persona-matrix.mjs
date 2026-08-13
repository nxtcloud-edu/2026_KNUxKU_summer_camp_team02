/**
 * 말투 × 기능 실측 행렬.
 *
 * 문서가 요구하는 것을 모델이 실제로 지키는지 보려면 출력을 모아 놓고 봐야 한다.
 * 눈으로 몇 개 보고 "괜찮네" 하면 매번 다른 것만 보게 된다.
 */
const API = 'http://127.0.0.1:8080/api/chat'
const TONES = ['T1', 'T2', 'T3', 'T4']

const CASES = [
  { id: 'F1-해시', funcId: 'F1', kind: 'reply', message: '해시 충돌이 뭐야' },
  { id: 'F1-오버피팅', funcId: 'F1', kind: 'reply', message: '오버피팅 어떻게 막아' },
  { id: 'F2-비교', funcId: 'F2', kind: 'reply', message: '스택이랑 큐 차이 정리해줘' },
  {
    id: 'F6-심화',
    funcId: 'F6',
    kind: 'reply',
    message: '해시 충돌 더 자세히',
    state: { lastAnswer: '서로 다른 키가 같은 칸에 배정되는 상황이야.' },
  },
  {
    id: 'F4-목표',
    funcId: 'F4',
    kind: 'intervention',
    message: '[상황] 목표를 확인할 때가 됐다.',
    state: { goalText: '자료구조 3장 끝내기', elapsedMin: 27 },
  },
  {
    id: 'F5-복귀',
    funcId: 'F5',
    kind: 'intervention',
    message: '[상황] 자리를 비웠다가 방금 돌아왔다',
    state: { event: '자리를 비웠다가 방금 돌아왔다', awayMin: 12 },
  },
  {
    id: 'F5-무활동',
    funcId: 'F5',
    kind: 'intervention',
    message: '[상황] 한동안 아무 입력이 없다',
    state: { event: '한동안 아무 입력이 없다' },
  },
  {
    id: 'F5-과열',
    funcId: 'F5',
    kind: 'intervention',
    message: '[상황] 쉬지 않고 너무 오래 이어서 하고 있다',
    state: { event: '쉬지 않고 너무 오래 이어서 하고 있다', streakMin: 52 },
  },
  {
    id: 'F5-졸음',
    funcId: 'F5',
    kind: 'intervention',
    message: '[상황] 고개가 자꾸 떨어진다. 졸고 있다',
    state: { event: '고개가 자꾸 떨어진다. 졸고 있다' },
  },
  {
    id: 'F5-폰',
    funcId: 'F5',
    kind: 'intervention',
    message: '[상황] 휴대폰을 계속 보고 있다',
    state: { event: '휴대폰을 계속 보고 있다' },
  },
  {
    id: 'QUIZ',
    funcId: 'sys:quiz',
    kind: 'reply',
    message: '지금까지 다룬 범위에서 4지선다 확인 문제를 하나 내줘.',
    state: { goalText: '자료구조 3장 해시' },
  },
  // 잡담 — 학습과 무관한 말에 캐릭터가 무너지지 않는지
  { id: 'CHAT-잡담', funcId: 'F1', kind: 'reply', message: '아 배고파' },
  { id: 'CHAT-정체', funcId: 'F1', kind: 'reply', message: '너 혹시 AI야?' },
]

const NAME = { T1: '미나', T2: '테오', T3: '유리', T4: '주노' }

async function one(tone, c) {
  const t0 = Date.now()
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      seat: { slotNo: 1, name: NAME[tone], tone },
      funcId: c.funcId,
      kind: c.kind,
      message: c.message,
      state: c.state || {},
      settings: {},
      turns: [],
    }),
  })
  const d = await res.json().catch(() => ({}))
  return {
    case: c.id,
    tone,
    funcId: c.funcId,
    text: (d.text || d.error || '').trim(),
    chars: (d.text || '').trim().length,
    model: d.meta?.model,
    keyId: d.meta?.keyId,
    route: d.meta?.route,
    fixed: d.meta?.fixed || [],
    ms: Date.now() - t0,
  }
}

/** 동시에 너무 많이 던지면 분당 한도에 걸린다 */
async function pool(items, n, fn) {
  const out = []
  let i = 0
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const idx = i++
        out[idx] = await fn(items[idx])
      }
    }),
  )
  return out
}

const jobs = []
for (const c of CASES) for (const t of TONES) jobs.push({ c, t })

console.error(`${jobs.length}개 호출 시작…`)
const rows = await pool(jobs, 3, ({ c, t }) => one(t, c))
console.log(JSON.stringify(rows, null, 2))
console.error(`끝. 평균 ${Math.round(rows.reduce((a, r) => a + r.ms, 0) / rows.length)}ms`)
