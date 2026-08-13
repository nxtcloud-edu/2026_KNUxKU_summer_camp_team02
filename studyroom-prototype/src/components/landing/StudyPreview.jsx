/**
 * 랜딩 왼쪽 — 스터디룸 2×2 프리뷰 (랜딩 기획서 §2·§3·§4)
 *
 * [결정] 기획서 §3은 4칸 모두 AI 캐릭터라고 쓰여 있지만, 실제 제품은 §7-1대로
 * 스터디 메이트 자리가 3개(Mina/Theo/Juno)로 고정이고 캐릭터 일러스트도 3종뿐이다.
 * 그래서 랜딩도 실제 룸과 같은 구성(AI 3 + 나 1)으로 맞추고, 4번째 칸은 로그인 전
 * "내 자리"를 예약해 둔 조용한 플레이스홀더로 둔다. AI 3명을 먼저 채우고 "나"는
 * 그리드 마지막(우하단) 자리로 둬서, 가장 비어 있는 칸이 가장 먼저 눈에 띄지 않게 한다.
 *
 * §4 제외 목록(마이크·카메라·화면공유·통화종료·채팅·설정 등) 반영 —
 * StudyRoomScreen의 SelfTile/MateTile을 재사용하지 않고 타일 셸만 새로 만든다.
 * 이 컴포넌트는 실시간 스트림·권한 요청과 무관하다. 4번 타일의 참여 버튼도 예외는
 * 아니다 — 클릭해도 실제 통화에 들어가지 않고 Sign Up/Sign In과 같은 로그인 모달을 연다
 * (세 번째 진입 경로를 새로 만들지 않는다).
 *
 * 위계: 바깥 큰 컨테이너 하나만 shadow-pop으로 뜨고, 안쪽 4칸은 테두리·그림자 없이
 * 배경 틴트만 남긴다 — "카드 4장"이 아니라 "방 하나 안의 자리 4개"로 읽히게 하기 위해서다.
 */
import { Video } from 'lucide-react'
import { PRESET_ORDER, PRESETS } from '../../lib/presets'
import { BRAND } from '../../lib/brand'
import { CharacterSprite } from '../ui'

const TINTS = { mina: 'bg-sage', theo: 'bg-lavender', juno: 'bg-peach' }
const STATES = { mina: 'reading', theo: 'typing', juno: 'writing' }

// AI 타일(같은 행의 juno 자리 포함)은 items-end + pb-3(12px)로 size=136 캐릭터를 앉힌다 —
// 그 무게중심은 타일 바닥에서 12 + 136/2 = 80px 지점이다. 참여 버튼의 "중심"도 여기 맞춘다.
const SEAT_CENTER_FROM_BOTTOM = 80
const DESK_GAP = 14 // 책상 아이콘과 버튼 사이 간격

// 80px로 시작(요청대로). 100으로 바꾸면 비교용 큰 버전 — 응답 본문에 두 값 비교와 의견을 적었다.
const JOIN_DIAMETER = 80

function TileShell({ tint, children, caption, captionClass = '' }) {
  return (
    <div className={`relative flex min-h-0 items-end justify-center overflow-hidden rounded-md ${tint}`}>
      {children}
      <span
        className={`t-caption absolute bottom-2 left-2 rounded-full border border-hairline bg-surface px-2 py-0.5 ${captionClass}`}
      >
        {caption}
      </span>
    </div>
  )
}

function AiTile({ presetKey }) {
  const p = PRESETS[presetKey]
  return (
    <TileShell tint={TINTS[presetKey]} caption={p.name}>
      {/* items-end + 통일된 pb로 캐릭터 크기가 달라도 같은 바닥선에 앉은 것처럼 보이게 한다 */}
      <div className="flex h-full w-full items-end justify-center pb-3">
        <CharacterSprite imageKey={p.imageKey} state={STATES[presetKey]} size={136} />
      </div>
    </TileShell>
  )
}

/** 완전한 원형 참여 버튼. Button 'dark' variant와 같은 토큰(bg=--text-strong, text=--bg-warm)만
 *  쓰고 새 색은 만들지 않는다. 절대배치로 중심을 SEAT_CENTER_FROM_BOTTOM에 정확히 맞춘다 —
 *  Tailwind 간격 스케일로는 지름이 바뀔 때마다 딱 맞는 값이 없어서, 여기만 계산된 px를 쓴다
 *  (색·radius·shadow는 여전히 토큰만: rounded-full, shadow-pop, var(--text-strong)/var(--bg-warm)). */
function JoinButton({ onOpenLogin, diameter }) {
  const bottom = SEAT_CENTER_FROM_BOTTOM - diameter / 2
  const iconSize = Math.round(diameter * 0.475) // 지름의 45~50%

  return (
    <button
      type="button"
      aria-label="빈 자리에 참여하기"
      onClick={onOpenLogin}
      // :focus-visible 코랄 링은 index.css:64-68 전역 규칙이 button 태그면 자동으로 적용한다.
      // 다만 그 규칙이 outline에 border-radius:8px를 고정으로 줘서, 완전한 원 위에서는
      // 링이 완벽한 동심원이 아니라 살짝 각진 모양으로 보일 수 있다 — 전역 규칙이라 여기서 못 고친다.
      className="absolute left-1/2 flex -translate-x-1/2 items-center justify-center rounded-full bg-[var(--text-strong)] text-[var(--bg-warm)] shadow-pop transition-all duration-300 ease-soft hover:-translate-y-0.5"
      style={{ width: diameter, height: diameter, bottom }}
    >
      <Video size={iconSize} strokeWidth={2.5} aria-hidden="true" />
    </button>
  )
}

function DeskIcon({ diameter }) {
  const buttonTop = SEAT_CENTER_FROM_BOTTOM + diameter / 2
  return (
    <svg
      viewBox="0 0 140 96"
      width="92"
      height="63"
      aria-hidden="true"
      className="absolute left-1/2 -translate-x-1/2 text-muted"
      style={{ bottom: buttonTop + DESK_GAP }}
    >
      <rect x="20" y="52" width="100" height="8" rx="4" fill="currentColor" opacity="0.55" />
      <rect x="30" y="60" width="6" height="28" rx="3" fill="currentColor" opacity="0.35" />
      <rect x="104" y="60" width="6" height="28" rx="3" fill="currentColor" opacity="0.35" />
      <rect
        x="46"
        y="32"
        width="34"
        height="20"
        rx="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.5"
      />
      <path
        d="M52 39h22M52 45h14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.4"
      />
      <path
        d="M92 40h12v10a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.45"
      />
    </svg>
  )
}

/** 로그인 전 "내 자리" — 태그라인("Fill in your spot") → 빈 자리 그림 → 참여 버튼 순으로
 *  카피·그림·액션이 잇달아 이어지게 한다. 캡션은 "빈 자리" 한 마디, 좌하단 pill 유지. */
function SelfSeatTile({ onOpenLogin }) {
  return (
    <TileShell tint="bg-warm" caption={BRAND.emptySeatCaption} captionClass="text-coral">
      <DeskIcon diameter={JOIN_DIAMETER} />
      <JoinButton onOpenLogin={onOpenLogin} diameter={JOIN_DIAMETER} />
    </TileShell>
  )
}

export default function StudyPreview({ className = '', onOpenLogin }) {
  return (
    <div className={`rounded-lg border border-hairline bg-surface p-5 shadow-pop ${className}`}>
      <div className="grid h-[520px] w-[520px] grid-cols-2 grid-rows-2 gap-3.5">
        {PRESET_ORDER.map((key) => (
          <AiTile key={key} presetKey={key} />
        ))}
        <SelfSeatTile onOpenLogin={onOpenLogin} />
      </div>
    </div>
  )
}
