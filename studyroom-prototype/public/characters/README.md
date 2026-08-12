# 캐릭터 에셋 (임시)

현재 들어 있는 `bear.svg` / `tiger.svg` / `duck.svg` 는 팀에서 정한 임시 캐릭터 3종을
**SVG로 재현한 것**입니다. 원본 이미지가 채팅으로만 전달되어 파일로 확보하지 못했습니다.

## 원본 PNG로 교체하는 방법

이 폴더에 아래 이름으로 파일을 넣기만 하면 자동으로 교체됩니다. SVG보다 PNG가 우선합니다.

```
public/characters/bear.png    ← 파란 곰
public/characters/tiger.png   ← 호랑이 (K 방패)
public/characters/duck.png    ← 노란 오리
```

투명 배경 PNG, 정사각형(권장 512×512)이면 가장 깔끔합니다.

## 정식 에셋에서 필요한 것 (통합 설계서 §13-5)

지금은 캐릭터 1종당 이미지 1장뿐이라 **애니메이션 상태가 표현되지 않습니다.**
정식 단계에서는 상태 10종 × 캐릭터 3종 = 30개 에셋이 필요합니다.

```
studying · writing · reading · drinking · stretching
resting · distracted · away · cameraOff · typing
```

화면별 노출 프레임도 4종입니다.

| 프레임 | 쓰이는 곳 |
| --- | --- |
| 룸 타일 | 스터디룸 2×2 그리드 |
| 셀렉터 썸네일 | 대기 화면 커스텀 패널 |
| 설정 카드 | 설정 창 캐릭터 목록 |
| 엔딩 전신 | 엔딩 페이지 좌측 하단 |
