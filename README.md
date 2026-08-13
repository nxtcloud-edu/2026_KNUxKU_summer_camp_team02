# 2026_KNUxKU_summer_camp_team02

강원대x고려대 Summer Agentic AI 심화 몰입 캠프 2팀 레포지토리입니다.

---

## AI 스터디룸

Google Meet 형태의 화상 스터디룸에 입장해 **성격이 다른 3명의 AI 스터디 메이트와 함께 공부하는** 데스크톱 웹 서비스입니다.

사용자는 실제 웹캠으로 참여하고 나머지 세 자리는 2D 일러스트 캐릭터가 채웁니다. 핵심은 질문에 답하는 챗봇이 아니라 **"같은 방에서 각자 공부하고 있는 사람들"이라는 존재감**입니다. AI는 명령 없이도 공부하고, 물을 마시고, 잠시 자리를 비우고, 먼저 말을 겁니다.

> AI functionality보다 **AI presence**가 먼저 느껴지도록.

### 화면 흐름

```
홈  →  대기 화면  →  스터디룸  →  엔딩(요약 → 세부 요약)  →  홈
                                     ↑
                 설정 창 — 대기 화면 커스텀 패널의 설정 버튼,
                          스터디룸 하단바 설정 버튼 (같은 컴포넌트)
```

---

## 개발 환경 세팅

클론한 뒤 **한 번만** 실행하면 됩니다.

```bash
bash scripts/setup.sh
```

Node 버전 확인 → 의존성 설치 → `.env` 준비 → (선택) Claude Code용 UI/UX 스킬 설치까지 합니다.

수동으로 하려면:

```bash
cd studyroom-prototype
npm install
cp .env.example .env
npm run dev
```

http://127.0.0.1:5180 에서 열립니다. **Chrome으로 여세요** — 음성 입력은 Chrome/Edge에만 있고, 웹캠·마이크·음성 API는 `localhost` 또는 HTTPS에서만 동작합니다.

### 요구 사항

| | |
| --- | --- |
| Node | **20 이상** (`.nvmrc` 있음 — `nvm use`) |
| npm | 10 이상 |
| 브라우저 | Chrome / Edge (음성 입력 때문) |

### 명령어

| 명령 | 하는 일 |
| --- | --- |
| `npm run dev` | 개발 서버 (127.0.0.1:5180) |
| `npm run build` | 프로덕션 빌드 |
| `npm run lint` | ESLint |
| `npm run format` | Prettier로 포맷 |
| `npm run check` | 포맷 검사 + 린트 + 빌드 — **PR 올리기 전에 이거 하나만** |

### 저장소에 들어 있는 설정

| 파일 | 용도 |
| --- | --- |
| `.nvmrc` | Node 버전 고정 |
| `.editorconfig` | 들여쓰기·개행 통일 (에디터 무관) |
| `.prettierrc` | 코드 포맷 규칙 |
| `eslint.config.js` | 린트 규칙 (React + Hooks) |
| `.env.example` | 환경 변수 템플릿 — `.env`로 복사해서 씁니다 |
| `.vscode/` | 권장 확장(Tailwind·ESLint·Prettier)과 저장 시 자동 포맷 |
| `.claude/launch.json` | Claude Code에서 개발 서버 미리보기 |
| `.claude/settings.json` | 자주 쓰는 명령 허용 목록 |

> `.env`와 `node_modules/`, `.claude/skills/` 는 커밋되지 않습니다.
> 스킬은 용량이 커서 `scripts/setup.sh`가 각자 받아오게 했습니다.

자세한 내용은 [`studyroom-prototype/README.md`](studyroom-prototype/README.md).

### 지금 동작하는 것

- 5개 화면 전체와 화면 간 이동
- 웹캠 미리보기, 카메라 권한 예외 4종 처리
- 셀렉터(클릭·드래그·키보드), 캐릭터 자리 미리보기
- 스터디 메이트 자율 행동, 선제 개입, 채팅 라우팅, @멘션, 타이핑 인디케이터
- **음성 입력(STT)과 답변 낭독(TTS)** — Google Web Speech API, 키 불필요
- 학습 시간·집중 시간 측정, 이탈 판정, 학습 점수
- 엔딩 요약 + 세부 요약 8항목
- 설정 창 전체 + 설정 간 충돌 처리 + 반응 미리보기
- 임시 DB (localStorage 위, 서버로 교체 가능한 인터페이스)

### 아직 안 붙은 것

| 항목 | 붙이는 자리 |
| --- | --- |
| **모델 API** | `src/lib/mockAgent.js` 의 `generateReply()` 함수 하나 |
| **캐릭터 원본 이미지** | `public/characters/` 에 `bear.png` `tiger.png` `duck.png` (지금은 SVG 임시본) |
| 서버 DB | `src/store/db.js` 의 `db.*` 시그니처 유지하면 교체 가능 |

---

## 설계 문서

기획서와 통합 설계서는 **이 저장소에 두지 않습니다.** 팀 공유 폴더를 참고하세요.

소스 코드 주석의 `§6-2`, `[1장 §20]` 같은 표기는 그 문서들의 절 번호입니다.

---

## 남은 결정 사항

담당자가 필요한 것들입니다.

- **홈 화면 정식 기획** — 손그림만 있고 기획서가 없습니다
- **계정 / 로그인** — 엔딩 2단계의 친구 비교·랭킹이 계정을 전제합니다
- **캐릭터 아트 스펙** — 상태 10종 × 3캐릭터 = 30개 에셋
- **집중 블록(focusBlock) UI** — 설정에는 있는데 시작할 방법이 없습니다
