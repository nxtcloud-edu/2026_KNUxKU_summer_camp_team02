/**
 * 스터디 메이트 프리셋 — 통합 설계서 §7-1
 * [결정 2] 1장 기준(3자리 고정 · Mina/Theo/Juno)에 4장식 커스터마이즈를 허용
 *
 * 이미지는 팀에서 정한 임시 캐릭터 3종. public/characters/README.md 참조.
 * PNG를 넣으면 SVG보다 우선한다.
 */

export const IMAGE_KEYS = ['bear', 'tiger', 'duck']

/** PNG가 있으면 PNG, 없으면 SVG로 폴백 */
export function characterImage(imageKey) {
  return `/characters/${imageKey}.svg`
}
export function characterImagePng(imageKey) {
  return `/characters/${imageKey}.png`
}

export const PRESETS = {
  mina: {
    key: 'mina',
    name: 'Mina',
    archetype: 'Focused & Reliable',
    imageKey: 'bear',
    tone: 'T1', // 차분함 — 기존 성격 그대로
    blurb: '성실하고 조용한 타입. 공부 관련 정보나 정리 중심으로 이야기한다.',
    // 자율 행동 가중치 (§7-1 행동 경향)
    weights: {
      studying: 40,
      writing: 20,
      reading: 20,
      drinking: 6,
      stretching: 4,
      resting: 5,
      distracted: 3,
      away: 1,
      cameraOff: 1,
    },
    voice: { pitch: 1.05, rate: 0.98 },
  },
  theo: {
    key: 'theo',
    name: 'Theo',
    archetype: 'Social & Energetic',
    imageKey: 'tiger',
    tone: 'T2', // 장난스러움 — 기존 개입 문구가 명백히 이 말투였다
    blurb: '활발하고 함께 공부하는 걸 좋아한다. 반응이 빠르고 표현이 많다.',
    weights: {
      studying: 26,
      writing: 10,
      reading: 10,
      drinking: 16,
      stretching: 14,
      resting: 10,
      distracted: 8,
      away: 4,
      cameraOff: 2,
    },
    voice: { pitch: 0.92, rate: 1.08 },
  },
  juno: {
    key: 'juno',
    name: 'Juno',
    archetype: 'Chill & Independent',
    imageKey: 'duck',
    // 끈질김. 문자 그대로면 T1 이지만 그러면 미나와 겹치고 T3·T4 가
    // 기본 시연에 한 번도 안 나온다. 충돌표 6행 중 3행도 이 배치가 피해 간다
    tone: 'T4',
    blurb: '느긋하고 자기 방식대로 공부한다. 예상치 못한 관점을 던진다.',
    weights: {
      studying: 28,
      writing: 8,
      reading: 12,
      drinking: 6,
      stretching: 6,
      resting: 10,
      distracted: 16,
      away: 9,
      cameraOff: 5,
    },
    voice: { pitch: 1.15, rate: 0.92 },
  },
}

export const PRESET_ORDER = ['mina', 'theo', 'juno']

/** §6-3 애니메이션 상태 열거형 — stretching 포함해 닫힌 집합 */
export const ANIMATION_STATES = [
  'studying',
  'writing',
  'reading',
  'drinking',
  'stretching',
  'resting',
  'distracted',
  'away',
  'cameraOff',
  'typing',
]

export const STATE_LABEL = {
  studying: '공부 중',
  writing: '필기 중',
  reading: '읽는 중',
  drinking: '물 마시는 중',
  stretching: '스트레칭',
  resting: '쉬는 중',
  distracted: '딴생각',
  away: '자리 비움',
  cameraOff: '카메라 끔',
  typing: '입력 중',
}

export const TRAIT_OPTIONS = ['차분함', '친근함', '활발함', '장난스러움']

export const EXPLAIN_STYLES = [
  { value: 'easy', label: '쉽게 설명' },
  { value: 'example', label: '예시 중심' },
  { value: 'stepwise', label: '단계별 설명' },
  { value: 'concise', label: '핵심만 간단히' },
]

export const PROACTIVITY = [
  { value: 'rare', label: '거의 말하지 않음', help: '먼저 말을 걸지 않고 질문할 때만 답합니다.' },
  { value: 'when_needed', label: '필요한 경우에만', help: '도움이 필요해 보일 때만 조심스럽게 말을 겁니다.' },
  { value: 'active', label: '적극적으로 도움', help: '먼저 말을 걸고 휴식이나 정리를 자주 제안합니다.' },
]

/** 새 자리 하나를 프리셋으로 초기화 */
export function seatFromPreset(slotNo, presetKey) {
  const p = PRESETS[presetKey]
  return {
    slotNo,
    enabled: true,
    preset: presetKey,
    name: p.name,
    imageKey: p.imageKey,
    /**
     * 말투 하나로 정한다 (T1~T4).
     *
     * 예전에는 성격(다중선택)·설명 방식·개입 정도 세 축이었다. 그런데 설명 방식은
     * 개념 해설·심화 해설이, 개입 정도는 페이스 케어가 이미 규정한다 — 같은 지시가
     * 두 레이어에 겹쳐서 어느 쪽을 고쳐야 출력이 바뀌는지 알 수 없었다.
     * 이제 좌석은 "어떻게 말할지"만 갖고, "무엇을 할지"는 settings.functionOwner 가 갖는다.
     */
    tone: p.tone,
  }
}

export function defaultSeats() {
  return PRESET_ORDER.map((k, i) => seatFromPreset(i + 1, k))
}
