/**
 * 상점 페이지 — 캐릭터 판매
 */

import { useState } from 'react'
import { ArrowLeft, X } from 'lucide-react'

/* ── 캐릭터 데이터 ────────────────────────────────────────── */

const CHARACTERS = {
  collab: [
    {
      id: 'collab-2',
      name: '에스쿱스',
      desc: '조용한 미남',
      personality: '따뜻하고 포용력 있다',
      message: '네 속도대로 가면 돼, 내가 옆에 있을게.',
    },
    {
      id: 'collab-1',
      name: '준',
      desc: '카리스마 넘치는 리더',
      personality: '책임감 강하고 카리스마 있다',
      message: '목표를 정했으면 끝까지 가는 거야.',
    },
    {
      id: 'collab-3',
      name: '민규',
      desc: '다재다능한 만능형',
      personality: '호기심 많고 열정적이다',
      message: '새로운 걸 배우는 건 언제나 즐거워!',
    },
    {
      id: 'collab-4',
      name: '원우',
      desc: '분석적인 두뇌파',
      personality: '냉철하고 논리적이다',
      message: '문제를 쪼개서 하나씩 풀어보자.',
    },
    {
      id: 'collab-5',
      name: '도겸',
      desc: '밝은 에너지 충전기',
      personality: '밝고 긍정적이다',
      message: '힘들 때일수록 웃으면서 하는 거야!',
    },
    {
      id: 'collab-6',
      name: '승관',
      desc: '유쾌한 분위기 메이커',
      personality: '재치 있고 유머러스하다',
      message: '지루할 틈 없이 같이 달려보자!',
    },
    {
      id: 'collab-7',
      name: '우지',
      desc: '완벽주의 장인',
      personality: '꼼꼼하고 집중력이 높다',
      message: '디테일이 결과를 만든다, 조금만 더 파고들자.',
    },
    {
      id: 'collab-8',
      name: '디에잇',
      desc: '감성적인 예술가',
      personality: '섬세하고 창의적이다',
      message: '공부도 하나의 작품이야, 정성을 들여보자.',
    },
    {
      id: 'collab-9',
      name: '버논',
      desc: '쿨한 자유영혼',
      personality: '여유롭고 독립적이다',
      message: '너만의 방식으로 하면 돼, 정답은 없어.',
    },
    {
      id: 'collab-10',
      name: '디노',
      desc: '열정 가득 막내',
      personality: '열정적이고 도전적이다',
      message: '오늘도 어제보다 한 발짝 더 나가자!',
    },
    {
      id: 'collab-11',
      name: '조슈아',
      desc: '젠틀한 매너왕',
      personality: '상냥하고 배려심 깊다',
      message: '천천히 해도 괜찮아, 꾸준함이 답이야.',
    },
    {
      id: 'collab-12',
      name: '호시',
      desc: '폭발적 에너지',
      personality: '열정적이고 추진력 있다',
      message: '자, 불태우자! 오늘 끝장 보는 거야!',
    },
  ],
  cute: [
    {
      id: 'cute-1',
      name: '뭉치',
      desc: '포근한 도우미',
      personality: '다정하고 살갑다',
      message: '잘하고 있어, 조금만 더 힘내자!',
    },
    {
      id: 'cute-2',
      name: '콩이',
      desc: '깜찍한 도우미',
      personality: '장난기 많고 유쾌하다',
      message: '지루할 틈 없이 같이 해보자!',
    },
  ],
  popular: [
    {
      id: 'pop-1',
      name: '하루',
      desc: '꾸준함의 아이콘',
      personality: '성실하고 묵묵하다',
      message: '매일 조금씩이면 충분해.',
    },
    {
      id: 'pop-2',
      name: '소라',
      desc: '집중력의 달인',
      personality: '냉철하고 분석적이다',
      message: '지금 이 순간에 집중해 보자.',
    },
  ],
}

const SECTIONS = [
  { key: 'collab', title: '최신 콜라보레이션' },
  { key: 'cute', title: '귀염뽀짝 도우미들' },
  { key: 'popular', title: '인기 캐릭터' },
]

/* ── 캐릭터 카드 ──────────────────────────────────────────── */

function CharCard({ char, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-[180px] shrink-0 rounded-lg border border-hairline bg-[var(--hover-bg)] p-4 text-left transition-colors duration-200 hover:bg-white hover:shadow-soft"
    >
      {/* 이미지 플레이스홀더 (회색 네모) */}
      <div className="mb-3 h-[120px] w-full rounded-md bg-gray-200" />
      <div className="t-item font-semibold">{char.name}</div>
      <div className="t-caption mt-1">{char.desc}</div>
    </button>
  )
}

/* ── 캐릭터 상세 팝업 ─────────────────────────────────────── */

function CharDetailPopup({ char, onClose }) {
  if (!char) return null
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="relative w-[420px] rounded-lg border border-hairline bg-surface p-8 shadow-soft"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 rounded-full p-1 transition-colors duration-300 hover:bg-[var(--hover-bg)]"
          aria-label="닫기"
        >
          <X size={20} />
        </button>

        {/* 이미지 플레이스홀더 */}
        <div className="mx-auto mb-5 h-[160px] w-[160px] rounded-lg bg-gray-200" />

        <h2 className="t-section text-center mb-2">{char.name}</h2>
        <p className="t-help text-center mb-4">{char.desc}</p>

        <div className="rounded-sm border border-hairline bg-[var(--hover-bg)] px-5 py-4 mb-3">
          <h3 className="t-caption font-semibold mb-1">성격</h3>
          <p className="t-body">{char.personality}</p>
        </div>

        <div className="rounded-sm border border-hairline bg-[var(--hover-bg)] px-5 py-4 mb-5">
          <h3 className="t-caption font-semibold mb-1">공부 응원 메시지</h3>
          <p className="t-body">&ldquo;{char.message}&rdquo;</p>
        </div>

        {/* 구매하기 버튼 */}
        <button
          type="button"
          className="w-full rounded-md bg-coral py-3 text-center font-semibold text-ink transition-colors hover:bg-coral/80"
        >
          구매하기
        </button>
      </div>
    </div>
  )
}

/* ── 상점 페이지 메인 ─────────────────────────────────────── */

export default function ShopPage({ onBack, initialCharId }) {
  const [showBasicPopup, setShowBasicPopup] = useState(false)
  const [selectedChar, setSelectedChar] = useState(() => {
    if (!initialCharId) return null
    for (const section of Object.values(CHARACTERS)) {
      const found = section.find((c) => c.id === initialCharId)
      if (found) return found
    }
    return null
  })

  return (
    <div className="relative min-h-full overflow-hidden bg-warm">
      <div
        className="blob bg-sage"
        style={{ width: 520, height: 520, top: -190, left: -140 }}
        aria-hidden="true"
      />
      <div
        className="blob blob-delayed bg-lavender"
        style={{ width: 460, height: 460, top: 300, right: -160 }}
        aria-hidden="true"
      />

      <div className="relative mx-auto w-[1240px] px-10 pb-16 pt-10">
        {/* 뒤로가기 버튼 좌상단 */}
        <button
          type="button"
          onClick={onBack}
          className="mb-6 flex items-center gap-2 rounded-full border border-hairline px-4 py-2 t-item transition-colors duration-300 hover:bg-[var(--hover-bg)]"
        >
          <ArrowLeft size={18} />
          뒤로가기
        </button>

        {/* 상점 콘텐츠 카드 */}
        <div className="rounded-lg border border-hairline bg-surface p-10 shadow-soft">
          {/* 상단 정중앙 타이틀 */}
          <h1 className="t-section text-[22px] text-center mb-10">다양한 캐릭터를 만나보세요</h1>

          {/* 섹션들 */}
          {SECTIONS.map((section) => (
            <div key={section.key} className="mb-10 last:mb-0">
              <h2 className="t-item font-semibold mb-4">{section.title}</h2>
              <div className="flex gap-4 overflow-x-auto pb-2">
                {CHARACTERS[section.key].map((char) => (
                  <CharCard key={char.id} char={char} onClick={() => setSelectedChar(char)} />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* 하단 문구 (클릭 시 팝업) */}
        <div className="mt-8 flex justify-center">
          <button
            type="button"
            onClick={() => setShowBasicPopup(true)}
            className="t-help underline transition-colors hover:text-ink"
          >
            Basic에 가입하여 모든 캐릭터를 자유롭게 써보세요
          </button>
        </div>
      </div>

      {/* 캐릭터 상세 팝업 */}
      {selectedChar && <CharDetailPopup char={selectedChar} onClose={() => setSelectedChar(null)} />}

      {/* 구독 플랜 팝업 */}
      {showBasicPopup && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30"
          onClick={() => setShowBasicPopup(false)}
        >
          <div
            className="relative w-[820px] rounded-lg border border-hairline bg-surface p-8 shadow-soft"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setShowBasicPopup(false)}
              className="absolute top-4 right-4 rounded-full p-1 transition-colors duration-300 hover:bg-[var(--hover-bg)]"
              aria-label="닫기"
            >
              <X size={20} />
            </button>

            {/* 3개 섹션 */}
            <div className="flex gap-6">
              {/* 무료 */}
              <div className="flex-1 rounded-md border border-hairline p-5">
                <h3 className="t-item font-semibold mb-1">무료</h3>
                <p className="t-caption text-muted mb-4">OO에 오신 것을 환영합니다</p>
                <div className="mb-5">
                  <span className="text-[24px] font-bold">0₩</span>
                </div>
                <ul className="flex flex-col gap-2">
                  <li className="t-body flex items-start gap-2">
                    <span className="text-green-500">✓</span> 기본 캐릭터
                  </li>
                  <li className="t-body flex items-start gap-2">
                    <span className="text-green-500">✓</span> 학습 도우미 기능 지원
                  </li>
                  <li className="t-body flex items-start gap-2">
                    <span className="text-green-500">✓</span> 복습을 위한 요약, PDF 및 퀴즈 기능
                  </li>
                </ul>
              </div>

              {/* Basic */}
              <div className="flex-1 rounded-md border border-hairline p-5">
                <h3 className="t-item font-semibold mb-1">Basic</h3>
                <p className="t-caption text-muted mb-4">다양한 캐릭터를 사용해보세요</p>
                <div className="mb-5 flex items-end gap-1">
                  <span className="text-[24px] font-bold">4,990₩</span>
                  <span className="t-caption text-muted">/월</span>
                </div>
                <button
                  type="button"
                  className="mb-5 w-full rounded-md bg-coral py-2 text-center font-semibold text-ink transition-colors hover:bg-coral/80"
                >
                  Basic 체험하기
                </button>
                <ul className="flex flex-col gap-2">
                  <li className="t-body flex items-start gap-2">
                    <span className="text-green-500">✓</span> 무료 모델의 모든 기능 및
                  </li>
                  <li className="t-body flex items-start gap-2">
                    <span className="text-green-500">✓</span> 200개 이상의 다양한 캐릭터
                  </li>
                  <li className="t-body flex items-start gap-2">
                    <span className="text-green-500">✓</span> 100개 이상의 다양한 UI
                  </li>
                </ul>
              </div>

              {/* Pro */}
              <div className="flex-1 rounded-md border border-hairline p-5">
                <h3 className="t-item font-semibold mb-1">Pro</h3>
                <p className="t-caption text-muted mb-4">더 강력한 학습 도움을 받아보세요</p>
                <div className="mb-5 flex items-end gap-1">
                  <span className="text-[24px] font-bold">9,900₩</span>
                  <span className="t-caption text-muted">/월</span>
                </div>
                <button
                  type="button"
                  className="mb-5 w-full rounded-md bg-coral py-2 text-center font-semibold text-ink transition-colors hover:bg-coral/80"
                >
                  Pro 사용해보기
                </button>
                <ul className="flex flex-col gap-2">
                  <li className="t-body flex items-start gap-2">
                    <span className="text-green-500">✓</span> Basic 모델의 모든 기능 및
                  </li>
                  <li className="t-body flex items-start gap-2">
                    <span className="text-green-500">✓</span> 더 많은 메모리로 학습 지원
                  </li>
                  <li className="t-body flex items-start gap-2">
                    <span className="text-green-500">✓</span> 더 자세하고 정확한 요약과 학습 지원 기능
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── export characters for ShopCard preview ── */
export { CHARACTERS, SECTIONS }
