# AI 스터디룸 — 웹 데모 프로토타입

`Downloads/디자인과 설계도/00_통합 설계서.md` 를 기준으로 만든 실행 가능한 프로토타입입니다.

## 실행

```bash
npm install && npm run dev
```

브라우저에서 http://127.0.0.1:5180 을 엽니다.

> **Chrome에서 여세요.** 음성 입력(STT)은 Chrome/Edge에만 있습니다.
> 웹캠·마이크·음성 API는 `localhost` 또는 HTTPS에서만 동작합니다.

## 화면 흐름

```
홈  →  대기 화면  →  스터디룸  →  엔딩(1단계 → 2단계)  →  홈
                                    ↑
                    설정 창 — 대기 화면 커스텀 패널의 설정 버튼,
                             스터디룸 하단바 설정 버튼 (같은 컴포넌트)
```

## 음성 — Google 무료 Web Speech API

키도 계정도 필요 없고, Chrome에 내장된 구글 엔진을 그대로 씁니다.

| 기능 | API | 쓰이는 곳 |
| --- | --- | --- |
| **STT** (음성 → 텍스트) | `webkitSpeechRecognition` (`lang: ko-KR`) | 스터디룸 채팅 입력창의 마이크 버튼 |
| **TTS** (텍스트 → 음성) | `window.speechSynthesis` | 스터디 메이트의 답변 읽어주기 |

캐릭터마다 `pitch`/`rate`를 다르게 줘서 목소리가 구분됩니다 (`src/lib/presets.js`의 `voice`).
설정 창 → 본인 설정 → 음성에서 각각 끌 수 있습니다.

> 이것이 통합 설계서 §13-5b **"사용자 마이크의 용도"** TBD의 답입니다.
> 마이크는 음성 질문 입력용이고, 스피커는 답변 낭독용입니다.

## 모델 API를 붙이는 자리

**`src/lib/mockAgent.js` 의 `generateReply()` 한 함수만** 교체하면 됩니다.

```js
export async function generateReply({ seat, text, settings }) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seat, text, settings }),
  })
  return (await res.json()).text
}
```

나머지(답변자 라우팅, 개입 판정, 자율 행동, 기습 질문)는 모델과 무관한 규칙 엔진이라 그대로 씁니다.
`judgeQuiz()`도 나중에 LLM 분류로 바꾸면 정확해집니다.

## 임시 DB

`src/store/db.js` 하나가 통합 설계서 §9-2 스키마를 그대로 구현합니다.
지금은 `localStorage`에 얹혀 있지만 **화면 코드는 `localStorage`를 직접 만지지 않습니다.**
`db.*` 함수 시그니처만 유지하면 SQLite나 서버 REST로 그대로 갈아끼울 수 있습니다.

첫 실행 시 seed가 들어갑니다 (§9-4).

- 내 최근 28일치 학습 기록 → 홈 통계·연속 학습일이 비어 보이지 않게
- 더미 이용자 20명(그중 친구 4명) → 엔딩 2단계의 친구 비교·상위 % 계산

초기화하려면 브라우저 콘솔에서:

```js
localStorage.removeItem('studyroom.db.v1'); location.reload()
```

## 구조

```
src/
  index.css              디자인 토큰 (§4) · 애니메이션
  store/
    useStore.js          deviceState / roomConfig 분리 (§5-4)
    db.js                임시 DB (§9)
  lib/
    presets.js           Mina·Theo·Juno 프리셋 (§7-1)
    metrics.js           지표 측정 · 이탈 판정 · 점수 (§8)
    mockAgent.js         개입 엔진 · 라우팅 · 답변 생성 (§7)
    speech.js            Web Speech API STT/TTS
  components/
    ui/index.jsx         공통 컴포넌트 (§13)
    SettingsDialog.jsx   설정 창 (§6-5)
  screens/
    HomeScreen.jsx       홈 (§6-1)
    LobbyScreen.jsx      대기 화면 (§6-2)
    StudyRoomScreen.jsx  스터디룸 (§6-3)
    EndingScreen.jsx     엔딩 (§6-4)
public/characters/       캐릭터 에셋 — README.md 참조
```

## 캐릭터 이미지 교체

지금 들어 있는 곰·호랑이·오리는 **SVG로 재현한 임시본**입니다.
`public/characters/` 에 `bear.png` `tiger.png` `duck.png` 를 넣으면 자동으로 교체됩니다.
자세한 내용은 `public/characters/README.md`.

## 이번 데모에서 뺀 것

통합 설계서 §12-2와 같습니다.

- 모바일 레이아웃 (데스크톱 전용, 최소 1280px)
- 캐릭터 추가 / 새 AI 초대
- 집중 블록(focusBlock) — 시작 UI 미정 (§13-4)
- 세션 만료 자동 종료 — 판정 기준 미정
- 다인 참여 방 · 초대 링크 · 정원
- 실제 LLM 연결
