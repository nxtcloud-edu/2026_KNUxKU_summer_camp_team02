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
import { ChevronDown } from 'lucide-react'
import BrandPanel from '../components/landing/BrandPanel'
import StudyPreview from '../components/landing/StudyPreview'
import LoginModal from '../components/landing/LoginModal'
import LandingSections from '../components/landing/LandingSections'

export default function LandingScreen() {
  const [loginOpen, setLoginOpen] = useState(false)

  /*
   * 첫 화면은 예전 그대로 한 화면에 꽉 채우고(lg:h-full), 그 아래로 소개 섹션이 이어진다.
   *
   * 예전에는 바깥 컨테이너가 `lg:h-full lg:overflow-hidden` 이라 넓은 화면에서 스크롤 자체가
   * 막혀 있었다. 그 잠금을 바깥에서 첫 화면 <section> 안으로 옮겼다 — 첫 화면의 "한 화면"
   * 규칙(기획서 §1)은 그대로 지키면서 아래로는 내려갈 수 있게 된다.
   *
   * 블롭도 같이 안으로 옮긴다. 바깥에 두면 컨테이너가 페이지 전체 높이로 늘어나면서
   * `bottom:-260` 블롭이 맨 아래 섹션까지 떠내려간다.
   */
  const goToSections = () => {
    const el = document.getElementById('landing-more')
    if (!el) return
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' })
  }

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-warm">
      <section className="relative overflow-hidden lg:h-full">
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

        <div className="relative mx-auto flex min-h-full w-full max-w-[1240px] flex-col items-center justify-between gap-8 px-4 py-10 sm:px-6 lg:h-full lg:flex-row lg:gap-16 lg:px-10 lg:py-0">
          <StudyPreview className="enter-up" onOpenLogin={() => setLoginOpen(true)} />
          <BrandPanel onOpenLogin={() => setLoginOpen(true)} />
        </div>

        {/* 아래에 내용이 더 있다는 유일한 신호. 예전에는 한 화면으로 잠겨 있어 필요 없었다 */}
        <button
          type="button"
          onClick={goToSections}
          aria-label="서비스 소개 보기"
          className="fade-in d4 absolute bottom-7 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-1.5 text-muted transition-colors duration-300 ease-soft hover:text-ink lg:flex"
        >
          <span className="t-caption">아래로</span>
          <ChevronDown size={18} className="anim-idle" aria-hidden="true" />
        </button>
      </section>

      <div id="landing-more">
        <LandingSections onOpenLogin={() => setLoginOpen(true)} />
      </div>

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  )
}
