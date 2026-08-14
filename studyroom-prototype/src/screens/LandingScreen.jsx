/**
 * 랜딩 페이지 (랜딩 기획서 docs/랜딩페이지_기획.md)
 *
 * 존 A(§4-3, index.css) — 홈·엔딩과 같은 톤의 화면이라 배경 블롭과 enter-up/fade-in
 * 스태거를 그대로 가져온다. 왼쪽 스터디룸 프리뷰 내부(타일 그리드)는 StudyRoomScreen과
 * 같은 존 B 성격(카드 기울임 없음)을 유지 — 블롭은 페이지 배경에만 있고 타일은 안정적으로 둔다.
 *
 * 블롭 크기·불투명도: 좌우 패널이 opaque한 카드/텍스트 블록이라 Home보다 더 많은 면적을
 * 가린다. Home과 "같은 수준"으로 보이게 하려고 .blob의 기본 opacity(index.css, 0.62)를
 * 인라인 style로만 올렸다(0.95) — index.css는 건드리지 않는다.
 */
import { useState } from 'react'
import BrandPanel from '../components/landing/BrandPanel'
import StudyPreview from '../components/landing/StudyPreview'
import LoginModal from '../components/landing/LoginModal'

export default function LandingScreen() {
  const [loginOpen, setLoginOpen] = useState(false)

  /*
   * 넓은 화면은 예전처럼 한 화면에 꽉 채우고(lg:h-full lg:overflow-hidden),
   * 좁아져 두 패널이 세로로 쌓이면 스크롤을 연다.
   *
   * 예전에는 `h-full overflow-hidden` 이라, 세로로 쌓인 뒤 아래로 밀려난
   * Sign Up / Sign In 에 **닿을 수가 없었다.** 이 앱의 유일한 로그인 진입로다.
   */
  return (
    <div className="relative min-h-full overflow-y-auto bg-warm lg:h-full lg:overflow-hidden">
      <div
        className="blob bg-sage"
        style={{ width: 720, height: 720, top: -280, left: -240, opacity: 0.95 }}
        aria-hidden="true"
      />
      <div
        className="blob blob-delayed bg-lavender"
        style={{ width: 620, height: 620, bottom: -260, right: -220, opacity: 0.95 }}
        aria-hidden="true"
      />

      <div className="relative mx-auto flex min-h-full lg:h-full max-w-[1240px] w-full items-center justify-between gap-8 lg:gap-16 px-4 sm:px-6 lg:px-10 flex-col lg:flex-row py-10 lg:py-0">
        <StudyPreview className="enter-up" onOpenLogin={() => setLoginOpen(true)} />
        <BrandPanel onOpenLogin={() => setLoginOpen(true)} />
      </div>

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  )
}
