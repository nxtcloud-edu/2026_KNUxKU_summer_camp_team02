/**
 * 페르소나 프레임 데이터 — 스터디룸 캐릭터 애니메이션
 *
 * 3 페르소나의 base loop(눈 뜸/감김), talking 크로스페이드,
 * 일회성 리액션 시퀀스를 선언적으로 기술한다. `CharacterSprite`가
 * 이 데이터만 읽고 자기완결적으로 프레임을 교체한다.
 *
 * 이미지는 public/characters/persona{1,2,3}/ 에 있고
 * 페르소나 미배정 imageKey(예: 신규 캐릭터)는 기존 SVG/PNG 폴백으로 빠진다.
 */

export const ANIM_TIMING = {
  blinkHoldMs: 500,
  blinkIntervalMinMs: 3000,
  blinkIntervalMaxMs: 6000,
  talkingFrameMs: 200,
  reactionAutoReturn: true,
  defaultBase: 'studying',
}

/** imageKey → persona id. 새 캐릭터 추가 시 이 표만 확장하면 된다. */
export const IMAGE_KEY_TO_PERSONA = {
  bear: 'persona1',
  tiger: 'persona3',
  duck: 'persona2',
}

/** 각 페르소나가 노출하는 base loop 이름들 */
const P = (id) => `/characters/${id}/`

export const PERSONA_FRAMES = {
  persona1: {
    base: {
      studying: { open: P('persona1') + 'studying-open.png', blink: P('persona1') + 'studying-blink.png' },
      idle:     { open: P('persona1') + 'idle-open.png',     blink: P('persona1') + 'idle-blink.png' },
    },
    talking: [P('persona1') + 'talking-1.png', P('persona1') + 'talking-2.png'],
    reactions: {
      surprised: [
        { src: P('persona1') + 'surprised-open.png',  ms: 900 },
        { src: P('persona1') + 'surprised-blink.png', ms: 500 },
        { src: P('persona1') + 'surprised-open.png',  ms: 600 },
      ],
    },
  },
  persona2: {
    base: {
      studying:  { open: P('persona2') + 'studying-open.png', blink: P('persona2') + 'studying-blink.png' },
      idle:      { open: P('persona2') + 'idle-open.png',     blink: P('persona2') + 'idle-blink.png' },
      listening: { loop: [P('persona2') + 'listening-1.png', P('persona2') + 'listening-2.png'], frameMs: 500 },
      dozing:    { loop: [P('persona2') + 'dozing.png'], frameMs: 1000 },
    },
    talking: [P('persona2') + 'talking-1.png', P('persona2') + 'talking-2.png'],
    reactions: {},
  },
  persona3: {
    base: {
      studying: { open: P('persona3') + 'idle-open.png', blink: P('persona3') + 'idle-blink.png' },
      idle:     { open: P('persona3') + 'idle-open.png', blink: P('persona3') + 'idle-blink.png' },
      dozing:   {
        loop: [P('persona3') + 'dozing-0.png', P('persona3') + 'dozing-1.png', P('persona3') + 'dozing-2.png'],
        frameMs: 700,
      },
    },
    talking: [P('persona3') + 'talking-1.png', P('persona3') + 'talking-2.png'],
    reactions: {
      idea:     [{ src: P('persona3') + 'idea.png', ms: 2000 }],
      thinking: [
        { src: P('persona3') + 'thinking-0.png',        ms: 600 },
        { src: P('persona3') + 'thinking-question.png', ms: 1400 },
      ],
    },
  },
}

/**
 * `CharacterSprite`의 `state`(mockAgent.ANIMATION_STATES) → base loop 이름 매핑.
 * 페르소나에 해당 loop이 없으면 자동으로 studying/idle 순으로 폴백한다.
 */
export const STATE_TO_BASE = {
  studying:   'studying',
  writing:    'studying',
  reading:    'studying',
  typing:     'studying', // typing은 talking overlay가 별도로 켜지므로 base는 공부 자세
  drinking:   'idle',
  stretching: 'idle',
  distracted: 'idle',
  away:       'idle',
  cameraOff:  'idle',
  resting:    'dozing',   // 없으면 idle로 폴백
  listening:  'listening', // 페르소나2 전용 — 다른 페르소나는 idle로 폴백
}

/**
 * 요청된 base 이름을 페르소나가 제공하지 않으면 안전한 대체를 고른다.
 */
export function resolveBase(personaId, baseName) {
  const bases = PERSONA_FRAMES[personaId]?.base || {}
  if (bases[baseName]) return baseName
  if (baseName === 'resting' && bases.dozing) return 'dozing'
  if (baseName === 'listening' && bases.listening) return 'listening'
  if (bases[ANIM_TIMING.defaultBase]) return ANIM_TIMING.defaultBase
  return Object.keys(bases)[0] || null
}

/**
 * `imageKey` → persona id. 매핑이 없으면 null (호출측에서 기존 정적 이미지로 폴백).
 */
export function personaOf(imageKey) {
  return IMAGE_KEY_TO_PERSONA[imageKey] || null
}

/**
 * 특정 페르소나가 사용하는 모든 프레임 URL을 평탄화. 프리로드용.
 */
export function allFramesOf(personaId) {
  const p = PERSONA_FRAMES[personaId]
  if (!p) return []
  const out = []
  for (const b of Object.values(p.base || {})) {
    if (b.open) out.push(b.open)
    if (b.blink) out.push(b.blink)
    if (b.loop) out.push(...b.loop)
  }
  if (p.talking) out.push(...p.talking)
  for (const seq of Object.values(p.reactions || {})) {
    for (const step of seq) out.push(step.src)
  }
  return Array.from(new Set(out))
}
