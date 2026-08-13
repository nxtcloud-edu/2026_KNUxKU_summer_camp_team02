# 컴공 전공지식 뱅크 (csbank)

오프라인에서 미리 만들어 검산해 둔 **컴퓨터공학 전공지식 근거 모음**이다.
런타임에 검색해서 작은 모델의 프롬프트에 근거로 주입하고, 기습 퀴즈 출제에도 재활용한다.

- 항목 수: **162개** (6개 분야)
- 검산 통과: **145개 / 162개 (89.5%)** — 나머지 17개는 코드로 참·거짓을 가릴 수 없는 항목
- 생성 모델: `claude-opus-5`
- 스키마 정의: [`SCHEMA.md`](./SCHEMA.md) · 목록/통계: [`index.json`](./index.json)

## 1. 왜 있는가

런타임 모델(Gemini Flash Lite급)은 **회상은 되는데 구성·추론에서 그럴듯하게 틀린다.**
실측에서 다익스트라 음수 간선 반례를 틀리게 만들어놓고, 추적 설명까지 확신에 차서 붙였다.
학생 입장에서는 틀린 답을 자신 있게 들려주는 조교가 제일 나쁘다.

그래서 역할을 나눴다.

| | 담당 | 하는 일 |
|---|---|---|
| 오프라인 | Claude Opus 5 | 정확한 답을 만들고 **코드로 검산**해서 여기 저장 |
| 런타임 | 작은 모델 | 검색된 근거를 캐릭터 말투(미나/테오/주노)로 옮기기만 |

작은 모델이 못하는 건 추론이지 서술이 아니다. 서술만 시키면 잘한다.

## 2. 무엇이 들어 있나

분야별로 파일 하나씩이다.

| key | 파일 | 항목 | 검산 통과 |
|---|---|---:|---:|
| algorithm | `algorithm.json` | 30 | 30 |
| os | `os.json` | 28 | 25 |
| network | `network.json` | 26 | 19 |
| db | `db.json` | 26 | 24 |
| ai | `ai.json` | 26 | 25 |
| security | `security.json` | 26 | 22 |
| **합계** | | **162** | **145** |

주제어(`topic`)는 130종이다. 다익스트라 · 벨만포드 · 위상정렬 · union-find · 탐욕 · 정렬 · 마스터 정리 ·
해시 충돌 · B+트리 · 페이지 교체 · 스케줄링 · 교착상태 · 우선순위 역전 · 스래싱 · fork/스레드 ·
CIDR · 혼잡 제어 · 체크섬/CRC · QUIC · DNS · 정규화 · 직렬성 · 격리수준 · MVCC · 인덱스 선택도 ·
평가지표 · 정규화(L1) · 데이터 누수 · 어텐션 · RSA · 해시/생일 문제 · 패스워드 저장 · XSS/SQLi 등.
전체 목록은 `index.json` 의 `topics` 에 있다.

종류별 분포는 misconception 51 · derivation 50 · counterexample 26 · comparison 22 · tradeoff 13,
난이도는 medium 91 · hard 55 · easy 16 이다. **정의 나열은 넣지 않았다.** 작은 모델도 정의는 안다.
넣은 것은 학부생이 실제로 틀리는 지점 — 반례, 유도 과정, 수치 트레이드오프뿐이다.

## 3. 어떻게 쓰나

### 3-1. RAG 근거 주입

1. 학생 질문에서 키워드를 뽑아 `topic` / `question` / `answer` 로 검색한다.
2. **`verified: true` 인 항목만** 후보로 삼는다.
3. 상위 1~3개의 `answer` 를 그대로 시스템 프롬프트에 근거 블록으로 넣는다.
4. 작은 모델에게는 "이 근거 안에서만 말하고, 캐릭터 말투로 옮겨라"고 지시한다.

```js
import index from './csbank/index.json';

const banks = await Promise.all(
  index.domains.map(d => import(`./csbank/${d.file}`).then(m => m.default))
);
const items = banks.flat().filter(it => it.verified);   // 미검증 항목 제외

function retrieve(query, k = 3) {
  const q = query.toLowerCase();
  return items
    .map(it => {
      const hay = `${it.topic} ${it.question} ${it.answer}`.toLowerCase();
      let score = 0;
      if (hay.includes(q)) score += 3;
      for (const t of q.split(/\s+/).filter(Boolean)) if (hay.includes(t)) score += 1;
      return { it, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(x => x.it);
}

const grounding = retrieve('다익스트라 음수 간선')
  .map(it => `[${it.id}] ${it.question}\n${it.answer}`)
  .join('\n\n');
```

`answer` 는 200~400자의 **평서형 근거 본문**이다. 존댓말·반말이 섞여 있지 않으니
말투 변환은 런타임 모델에 맡기고, **수치와 반례는 절대 바꾸지 못하게** 못을 박아야 한다.
(`answer` 안의 숫자는 전부 실행으로 확인된 값이다. 모델이 반올림하거나 "약"을 붙이면 그게 오염이다.)

### 3-2. 기습 질문

모든 항목이 `quiz` 를 갖고 있다(162/162). 기존 `QUIZ_BANK` 가 3개뿐이라 이걸로 대체한다.

```js
const pool = items.filter(it => it.domain === session.domain);
const pick = pool[Math.floor(Math.random() * pool.length)];

// 출제
say(pick.quiz.q);

// 채점: accept 중 하나라도 부분 문자열로 포함되면 정답
const ok = pick.quiz.accept.some(kw => reply.includes(kw));

// 오답이면 해설을 그대로 근거로 넘긴다
if (!ok) explainWith(pick.answer);
```

`accept` 는 **부분 문자열 매칭**이다. 그래서 키워드를 1글자로 두면 안 된다.
`'1'` 은 "100배 늘어난다"라는 오답에도 걸리고, `'있'` 은 "있을 수 없다"에도 걸린다.
현재 뱅크는 1글자 한글/라틴/숫자 키워드를 전부 2글자 이상으로 확장해 둔 상태다.
(예외적으로 `λ`, `φ`, `√`, `#` 같은 수학 기호만 1글자로 남겼다 — 자유 서술문에서 오탐이 없다.)

## 4. 검증되지 않은 항목을 어떻게 다루나

`verified` 는 **"이 답이 코드 실행으로 참임을 확인했다"** 는 뜻이다. "맞는 말인가"보다 좁다.

- `verify: {lang, code, expect}` + `verified: true` → 스크립트를 돌려 `True` 가 나온 항목. **145개.**
- `verify: null` + `verified: false` + `verify_note` → 애초에 코드로 판정할 수 없는 항목. **17개.**

미검증 17개는 틀린 게 아니다. 규범적 판단(어느 지표를 우선할지), 설계 논증(3-way handshake의 최소성),
브라우저·엔진 구현 동작(CORS, SameSite, HSTS, InnoDB 격리수준), 역사적 사실(HTTP/1.1 파이프라이닝)처럼
**단일 파이썬 스크립트의 True/False로 환원되지 않는 명제**들이다. `verify_note` 에 왜 불가한지와
어떤 표준 문서(RFC 번호 등)를 근거로 삼았는지 적어뒀다.

취급 규칙:

1. **런타임 RAG 주입에는 쓰지 않는다.** `verified === true` 로 필터링하는 게 기본값이다.
2. 기습 퀴즈에도 기본적으로 넣지 않는다. 굳이 쓰려면 해설을 "일반적으로는" 톤으로 낮춰야 한다.
3. 사람이 표준 문서로 확인했다면 `verify_note` 에 근거를 남기되 `verified` 는 그대로 `false` 로 둔다.
   이 필드는 **자동 검산 통과 여부**를 뜻하고, 수동 확인과 섞으면 필터가 무의미해진다.
4. `verified: true` 인데 `verify: null` 인 조합은 **모순**이다. 검사 스크립트가 이걸 잡는다.

미검증 항목: `ai-008` / `db-007` `db-013` / `net-007` `net-008` `net-011` `net-018` `net-019` `net-022` `net-023` /
`os-013` `os-020` `os-022` / `sec-015` `sec-020` `sec-021` `sec-024`

## 5. 항목을 추가하려면

1. **분야 파일 끝에 append 한다.** `id` 는 `{접두사}-{3자리}` 로 파일 안에서 연속이어야 한다
   (`algo-` / `os-` / `net-` / `db-` / `ai-` / `sec-`). 현재 최대 번호 다음을 쓴다.
2. **필수 필드 13개를 모두 채운다.**
   `id, domain, topic, kind, difficulty, question, answer, verify, verified, verify_note, quiz, source_model, created_at`
   - `kind`: `counterexample | derivation | misconception | comparison | tradeoff`
   - `difficulty`: `easy | medium | hard`
   - `answer`: 200~400자, 평서형. 캐릭터 말투 금지. 전공 용어는 한글(영문) 병기 1회.
3. **검산 가능하면 반드시 `verify` 를 채운다.** 수치·반례·복잡도·계산은 전부 검산 대상이다.
   - `verify.code` 는 **참이면 `True` 만 출력하는 자립 실행형 파이썬 스크립트**여야 한다.
     표준 라이브러리만 쓰고, 네트워크를 타지 않고, 몇 초 안에 끝나야 한다.
   - 통과하면 `verified: true`. 통과 못 하면 **항목을 고쳐서 다시 통과시키거나 버린다.**
     "일단 false로 두고 넣기"는 하지 않는다.
   - 코드로 판정 불가하면 `verify: null` + `verified: false` + `verify_note` 에 불가 사유와 근거 문헌.
4. **`quiz` 를 채운다.** `accept` 는 **2글자 이상** 키워드 3~7개. 오답에도 걸리는 표현은 넣지 않는다.
   특히 부정문(`있을 수 없다`)에 부분 매칭되는 긍정 키워드(`있`)를 조심한다.
5. **검사와 재생성을 돌린다.**
   - 스키마 검사: 필수 필드 / `id` 중복 / `quiz` 누락 / `verified:true` + `verify:null` 모순 / `answer` 길이
   - 검산 재실행: `verify` 가 있는 모든 항목의 `code` 를 **JSON 파일에서 다시 읽어** 서브프로세스로 실행,
     `stdout.strip() == expect` 확인. 자기보고를 믿지 말고 매번 실제로 돌린다.
     난수·타이밍에 의존하는 항목은 3회 이상 반복해 흔들리지 않는지 본다.
   - `index.json` 재생성: `total`, 분야별 `count`/`verified`, `topics` 가 파일과 어긋나면 안 된다.

## 6. 파일 규약

- 인코딩 UTF-8, JSON `indent=2`, 한글 이스케이프 금지(`ensure_ascii=False`).
- 최상위는 항목 객체의 **배열**이다. 래퍼 객체를 씌우지 않는다.
- `index.json` 은 **생성물**이다. 직접 손으로 고치지 말고 재생성한다.
