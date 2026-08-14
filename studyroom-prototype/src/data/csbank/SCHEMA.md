# 컴공 전공지식 뱅크 — 스키마

## 왜 만드는가

작은 런타임 모델(Gemini Flash Lite)은 **회상**은 잘하지만 **구성·추론**에서 그럴듯하게 틀린다.
실측에서 다익스트라 음수 간선 반례를 틀리게 만들었고, 추적 설명까지 확신에 차서 잘못 붙였다.

그래서 상위 모델(Claude Opus 5)이 **오프라인에서 미리** 정확한 답을 만들어두고,
런타임에는 검색해서 근거로 주입한다. 작은 모델은 캐릭터 말투로 옮기기만 한다.
못하는 건 추론이지 서술이 아니기 때문이다.

## 항목 스키마

```jsonc
{
  "id": "algo-001",                    // {domain 약어}-{3자리}
  "domain": "algorithm",               // algorithm|os|network|db|ai|security
  "topic": "다익스트라",                 // 검색·필터용 주제어
  "kind": "counterexample",            // counterexample|derivation|misconception|comparison|tradeoff
  "difficulty": "medium",              // easy|medium|hard

  "question": "다익스트라가 음수 간선에서 왜 실패해?",
  "answer": "확정된 정점은 다시 갱신하지 않기 때문이다. …",   // RAG 근거로 주입될 본문

  // 코드로 검산 가능한 경우에만. 불가능하면 null
  "verify": {
    "lang": "python",
    "code": "…",                      // 참이면 True를 print 하는 스크립트
    "expect": "True"
  },
  "verified": true,                    // 검산 통과 여부. false면 런타임에서 쓰지 않는다
  "verify_note": "",                   // 검산 불가 사유 또는 수동 확인 근거

  // 기습 질문(§7-5)으로도 재활용한다. 지금 QUIZ_BANK가 3개뿐이다
  "quiz": {
    "q": "다익스트라를 음수 간선에 쓰면 뭐가 문제야?",
    "accept": ["확정", "갱신", "finalize"]   // 이 중 하나라도 포함하면 정답 처리
  },

  "source_model": "claude-opus-5",
  "created_at": "2026-08-13"
}
```

## 규칙

1. **answer는 근거 본문이다.** 캐릭터 말투로 쓰지 않는다. 런타임 모델이 미나/테오/주노 말투로 옮긴다.
   존댓말·반말을 섞지 말고 평서형으로 쓴다. 200~400자.
2. **검산 가능한 것은 반드시 `verify`를 채운다.** 수치·반례·복잡도·계산은 전부 검산 대상이다.
   검산에 실패한 항목은 버리고 다시 만든다. `verified: false`인 항목은 런타임에 주입하지 않는다.
3. **검산 불가한 개념 설명은 `verify: null`** 로 두고 `verify_note`에 왜 불가한지 적는다.
4. **학부생이 실제로 틀리는 지점**을 고른다. 정의 나열은 값어치가 없다. 작은 모델도 정의는 안다.
5. 한국어로 쓴다. 전공 용어는 한글(영문) 병기를 한 번만 한다.
