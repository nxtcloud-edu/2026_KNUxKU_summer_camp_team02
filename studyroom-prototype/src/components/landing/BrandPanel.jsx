/**
 * 랜딩 오른쪽 — 브랜드 영역 (랜딩 기획서 §5~§9·§11)
 * 순서 고정: 워드마크 → 한 줄 설명 → Sign Up/Sign In (§11)
 *
 * layout='blockCentered'(기본) | 'buttonsCentered' — 두 정렬안을 한 컴포넌트에 두고
 * prop 하나로 전환한다. buttonsCentered는 워드마크·태그라인은 왼쪽 정렬 그대로 두고
 * 버튼 줄만 워드마크 폭(w-fit 래퍼)에 맞춰 가운데로 미는 안 — 정렬축이 두 개가 되는
 * 절충안이다. 기본값은 blockCentered로 뒀다(이유는 요청 응답 본문 참고).
 */
import { Sparkles } from 'lucide-react'
import { BRAND } from '../../lib/brand'
import { Button } from '../ui'

export default function BrandPanel({ onOpenLogin, layout = 'blockCentered' }) {
  const accent = BRAND.name.slice(0, 2)
  const rest = BRAND.name.slice(2)

  const wordmark = (
    <div className="fade-in d1 flex items-end gap-3">
      <Sparkles size={36} className="text-subtle mb-3" aria-hidden="true" />
      <h1 className="t-wordmark">
        {/* §4 — 코랄 불투명도 82%: 65%는 강조가 아니라 비활성처럼 읽혔다 */}
        <span className="text-coral opacity-[.82]">{accent}</span>
        {rest}
      </h1>
    </div>
  )

  const tagline = (
    <p className="text-subtle fade-in d2 mt-4 max-w-[480px] text-[19px] leading-[1.6] text-balance">
      {BRAND.tagline}
    </p>
  )

  const buttons = (
    <div className="fade-in d3 mt-8 flex items-center gap-3">
      <Button variant="primary" shape="rounded" onClick={onOpenLogin}>
        {BRAND.signUp}
      </Button>
      <Button variant="secondary" shape="rounded" onClick={onOpenLogin} className="!border-hairline">
        {BRAND.signIn}
      </Button>
    </div>
  )

  if (layout === 'buttonsCentered') {
    return (
      <div className="-mt-3 w-fit">
        {wordmark}
        {tagline}
        <div className="flex w-full justify-center">{buttons}</div>
      </div>
    )
  }

  return (
    <div className="-mt-3 flex w-[560px] flex-col items-center text-center">
      {wordmark}
      {tagline}
      {buttons}
    </div>
  )
}
