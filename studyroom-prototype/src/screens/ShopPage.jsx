/**
 * 상점 페이지 — 캐릭터 판매
 */

import { useEffect, useState } from 'react'
import { ArrowLeft, X } from 'lucide-react'

/* ── 캐릭터 데이터 ────────────────────────────────────────── */

// 폴더명에 공백·한글이 있어 브라우저 요청 전에 encodeURI로 감싼다
const shopImg = (name) => encodeURI(`/alongside 상점/${name}.png`)
const sevImg = (name) => encodeURI(`/alongside 상점/alongside 상점 파일-세븐틴/${name}.png`)
const iveImg = (name) => encodeURI(`/alongside 상점/alongside 상점 파일-ive/${name}.png`)

/** New Collaboration 하위 그룹 — 히어로 캐러셀 + 탭에서 참조.
 *  logos 두 장이 슬라이드 하나에 나란히 표시된다 (레퍼런스 위버스 참고). */
const NEW_COLLAB_GROUPS = [
  {
    key: 'seventeen',
    label: 'Seventeen',
    logos: ['/seventeen logo.jpeg', '/seventeen logo 2.jpeg'],
  },
  {
    key: 'ive',
    label: 'IVE',
    logos: ['/ive logo.jpg', '/ive logo 2.png'],
  },
]
const CAROUSEL_MS = 5000

const CHARACTERS = {
  newCollab: [
    // ── Seventeen — 멤버 사진 4명 ────────────────────────────
    {
      id: 'sev-esk-p',
      group: 'seventeen',
      type: 'person',
      name: '에스쿱스',
      image: sevImg('에스쿱스'),
      desc: '든든한 팀의 리더',
      personality: '따뜻하고 포용력 있다',
      message: '네 속도대로 가면 돼, 내가 옆에 있을게.',
    },
    {
      id: 'sev-jun-p',
      group: 'seventeen',
      type: 'person',
      name: '준',
      image: sevImg('준'),
      desc: '조용하지만 다재다능한 매력',
      personality: '책임감 강하고 카리스마 있다',
      message: '목표를 정했으면 끝까지 가는 거야.',
    },
    {
      id: 'sev-wonwoo-p',
      group: 'seventeen',
      type: 'person',
      name: '원우',
      image: sevImg('원우'),
      desc: '허당미 가득한 반전 매력',
      personality: '냉철하고 논리적이다',
      message: '문제를 쪼개서 하나씩 풀어보자.',
    },
    {
      id: 'sev-hoshi-p',
      group: 'seventeen',
      type: 'person',
      name: '호시',
      image: sevImg('호시'),
      desc: '폭발적 에너지',
      personality: '열정적이고 추진력 있다',
      message: '자, 불태우자! 오늘 끝장 보는 거야!',
    },
    // ── Seventeen — 캐릭터 4개 ───────────────────────────────
    {
      id: 'sev-esk-c',
      group: 'seventeen',
      type: 'character',
      name: '쵯체리',
      image: sevImg('쵯체리_에스쿱스'),
      desc: '',
      personality: '따뜻하고 다정하다',
      message: '천천히, 같이 가자.',
    },
    {
      id: 'sev-jun-c',
      group: 'seventeen',
      type: 'character',
      name: '열닫잠',
      image: sevImg('열닫잠_준'),
      desc: '',
      personality: '든든하고 다재다능하다',
      message: '오늘도 열심히 해보자!',
    },
    {
      id: 'sev-wonwoo-c',
      group: 'seventeen',
      type: 'character',
      name: '폭덩이',
      image: sevImg('폭덩이_원우'),
      desc: '',
      personality: '조용하지만 강단있다',
      message: '하나씩 풀어가면 돼.',
    },
    {
      id: 'sev-hoshi-c',
      group: 'seventeen',
      type: 'character',
      name: '탐탐',
      image: sevImg('탐탐_호시'),
      desc: '',
      personality: '에너제틱하고 즐겁다',
      message: '오늘도 화이팅!',
    },
    // ── IVE — 멤버 사진 4명 ──────────────────────────────────
    {
      id: 'ive-yujin-p',
      group: 'ive',
      type: 'person',
      name: '안유진',
      image: iveImg('안유진'),
      desc: '댕댕미 폭발하는 리더',
      personality: '차분하고 든든하다',
      message: '천천히 하나씩 해나가자.',
    },
    {
      id: 'ive-rei-p',
      group: 'ive',
      type: 'person',
      name: '레이',
      image: iveImg('레이'),
      desc: '다정한 매력',
      personality: '따뜻하고 세심하다',
      message: '무리하지 말고 편하게 해요.',
    },
    {
      id: 'ive-wony-p',
      group: 'ive',
      type: 'person',
      name: '장원영',
      image: iveImg('장원영'),
      desc: '완벽 그 자체의 미녀',
      personality: '밝고 자신감 있다',
      message: '오늘도 반짝반짝 빛나요!',
    },
    {
      id: 'ive-liz-p',
      group: 'ive',
      type: 'person',
      name: '리즈',
      image: iveImg('리즈'),
      desc: '감성 가득한 메인보컬',
      personality: '발랄하고 유쾌하다',
      message: '함께 즐겁게 해봐요!',
    },
    // ── IVE — 캐릭터 4개 ────────────────────────────────────
    {
      id: 'ive-yujin-c',
      group: 'ive',
      type: 'character',
      name: '강안지',
      image: iveImg('강안지-안유진'),
      desc: '',
      personality: '차분하고 든든하다',
      message: '함께라면 든든하죠.',
    },
    {
      id: 'ive-rei-c',
      group: 'ive',
      type: 'character',
      name: '나오리',
      image: iveImg('나오리-레이'),
      desc: '',
      personality: '다정하고 따뜻하다',
      message: '천천히 함께해요.',
    },
    {
      id: 'ive-wony-c',
      group: 'ive',
      type: 'character',
      name: '체리',
      image: iveImg('체리-장원영'),
      desc: '',
      personality: '반짝이고 활기차다',
      message: '반짝이는 하루 만들어요!',
    },
    {
      id: 'ive-liz-c',
      group: 'ive',
      type: 'character',
      name: '치즈',
      image: iveImg('치즈-리즈'),
      desc: '',
      personality: '유쾌하고 발랄하다',
      message: '재밌게 가자!',
    },
  ],
  alongside: [
    {
      id: 'along-basic-1',
      name: '강두리',
      image: '/characters/persona1/idle-open.png',
      desc: '차분한 조력자',
      personality: '성실하고 조용하다',
      message: '천천히 정리해가면 돼요.',
    },
    {
      id: 'along-basic-2',
      name: '고범수',
      image: '/characters/persona3/idle-open.png',
      desc: '활력 넘치는 메이트',
      personality: '친근하고 활발하다',
      message: '오늘도 같이 달려보자!',
    },
    {
      id: 'along-basic-3',
      name: '신유연',
      image: '/characters/persona2/idle-open.png',
      desc: '유연한 관찰자',
      personality: '느긋하고 독특한 관점을 던진다',
      message: '너만의 방식으로 가면 돼.',
    },
    {
      id: 'along-1',
      name: '콩이',
      image: shopImg('콩이'),
      desc: '깜찍한 도우미',
      personality: '장난기 많고 유쾌하다',
      message: '지루할 틈 없이 같이 해보자!',
    },
    {
      id: 'along-2',
      name: '하루',
      image: shopImg('하루'),
      desc: '꾸준함의 아이콘',
      personality: '성실하고 묵묵하다',
      message: '매일 조금씩이면 충분해.',
    },
  ],
  twoDCollab: [],
}

const SECTIONS = [
  { key: 'newCollab', title: 'New Collaboration', subtitle: '세븐틴' },
  { key: 'alongside', title: 'Alongside Character', subtitle: 'BASIC' },
  { key: 'twoDCollab', title: '2D Collaboration', subtitle: 'COMING SOON', disabled: true },
]

/* ── 캐릭터 카드 ──────────────────────────────────────────── */

function CharCard({ char, onClick, fit = 'cover' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-[180px] shrink-0 rounded-lg border border-hairline bg-[var(--hover-bg)] p-4 text-left transition-colors duration-200 hover:bg-white hover:shadow-soft"
    >
      {/* 이미지 — 파일이 있으면 표시, 없으면 ? 플레이스홀더 */}
      <div
        className={[
          'mb-3 flex h-[120px] w-full items-center justify-center overflow-hidden rounded-md',
          fit === 'contain' ? 'bg-white p-3' : 'bg-gray-200',
        ].join(' ')}
      >
        {char.image ? (
          <img
            src={char.image}
            alt=""
            draggable={false}
            className={`h-full w-full select-none ${fit === 'contain' ? 'object-contain' : 'object-cover'}`}
          />
        ) : (
          <div className="flex select-none flex-col items-center">
            <span className="text-[48px] font-bold leading-none text-gray-400">?</span>
            <span className="mt-1 text-[11px] tracking-wide text-gray-400">coming soon</span>
          </div>
        )}
      </div>
      <div className="t-item font-semibold">{char.name}</div>
      {char.desc && <div className="t-caption mt-1">{char.desc}</div>}
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

        {/* 이미지 — 파일이 있으면 표시, 없으면 ? 플레이스홀더 */}
        <div className="mx-auto mb-5 flex h-[160px] w-[160px] items-center justify-center overflow-hidden rounded-lg bg-gray-200">
          {char.image ? (
            <img
              src={char.image}
              alt=""
              draggable={false}
              className="h-full w-full select-none object-cover"
            />
          ) : (
            <div className="flex select-none flex-col items-center">
              <span className="text-[64px] font-bold leading-none text-gray-400">?</span>
              <span className="mt-2 text-[13px] tracking-wide text-gray-400">coming soon</span>
            </div>
          )}
        </div>

        <h2 className="t-section text-center mb-2">{char.name}</h2>
        {char.desc && <p className="t-help text-center mb-4">{char.desc}</p>}

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

/**
 * @param {Object} props
 * @param {() => void} props.onBack
 * @param {'newCollab'|'twoDCollab'|'alongside'} [props.category]
 *   특정 카테고리만 렌더할 때 지정. 생략하면 세 섹션을 모두 렌더한다(레거시 호환용).
 */
export default function ShopPage({ onBack, category }) {
  const [showBasicPopup, setShowBasicPopup] = useState(false)
  const [selectedChar, setSelectedChar] = useState(null)
  // New Collaboration: 하위 그룹 탭 + 히어로 캐러셀
  const [activeGroup, setActiveGroup] = useState(NEW_COLLAB_GROUPS[0].key)
  const [carouselIdx, setCarouselIdx] = useState(0)

  const showsNewCollab = !category || category === 'newCollab'
  useEffect(() => {
    if (!showsNewCollab) return
    const id = setInterval(() => {
      setCarouselIdx((i) => (i + 1) % NEW_COLLAB_GROUPS.length)
    }, CAROUSEL_MS)
    return () => clearInterval(id)
  }, [showsNewCollab])

  const sections = category
    ? SECTIONS.filter((s) => s.key === category)
    : SECTIONS

  const pageTitle = category
    ? sections[0]?.title || '상점'
    : '다양한 캐릭터를 만나보세요'

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
          <h1 className="t-section text-[22px] text-center mb-10">{pageTitle}</h1>

          {/* 섹션들 */}
          {sections.map((section) => {
            const chars = CHARACTERS[section.key] || []
            const filteredChars =
              section.key === 'newCollab' ? chars.filter((c) => c.group === activeGroup) : chars
            const fitFor = (char) => {
              if (char.type === 'character') return 'contain'
              if (section.key === 'alongside') return 'contain'
              return 'cover'
            }
            return (
              <div key={section.key} className="mb-10 last:mb-0">
                {!category && <h2 className="t-item font-semibold mb-4">{section.title}</h2>}

                {/* New Collaboration 상단 — 그룹 로고 캐러셀 (5초마다 그룹 전환, 슬라이드 트랙) */}
                {section.key === 'newCollab' && (
                  <>
                    <div className="relative mb-8 h-[260px] overflow-hidden rounded-md border border-hairline bg-[var(--hover-bg)]">
                      <div
                        className="flex h-full transition-transform duration-700 ease-in-out"
                        style={{
                          width: `${NEW_COLLAB_GROUPS.length * 100}%`,
                          transform: `translateX(-${carouselIdx * (100 / NEW_COLLAB_GROUPS.length)}%)`,
                        }}
                      >
                        {NEW_COLLAB_GROUPS.map((g) => (
                          <div
                            key={g.key}
                            className="flex h-full shrink-0 gap-4 p-4"
                            style={{ width: `${100 / NEW_COLLAB_GROUPS.length}%` }}
                          >
                            {g.logos.map((logo, i) => (
                              <div
                                key={i}
                                className="flex flex-1 items-center justify-center overflow-hidden rounded-md bg-white"
                              >
                                <img
                                  src={encodeURI(logo)}
                                  alt={g.label}
                                  draggable={false}
                                  className="h-full w-full select-none object-contain"
                                />
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>

                      {/* 페이지 인디케이터 — 현재 슬라이드만 진하게 */}
                      <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
                        {NEW_COLLAB_GROUPS.map((g, i) => (
                          <span
                            key={g.key}
                            className={[
                              'h-1 w-6 rounded-full transition-colors',
                              i === carouselIdx ? 'bg-[var(--text-strong)]' : 'bg-hairline',
                            ].join(' ')}
                          />
                        ))}
                      </div>
                    </div>

                    {/* Products 라벨 (좌측 정렬 소제목) */}
                    <h3 className="t-section mb-4 text-left font-bold">Products</h3>

                    {/* 하위 그룹 탭 */}
                    <div className="mb-5 flex items-center gap-2">
                      {NEW_COLLAB_GROUPS.map((g) => (
                        <button
                          key={g.key}
                          type="button"
                          onClick={() => setActiveGroup(g.key)}
                          className={[
                            'rounded-full px-4 py-1.5 t-caption font-semibold transition-colors',
                            activeGroup === g.key
                              ? 'bg-[var(--text-strong)] !text-white'
                              : 'border border-hairline text-subtle hover:bg-[var(--hover-bg)]',
                          ].join(' ')}
                        >
                          {g.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {filteredChars.length > 0 ? (
                  <div className="grid grid-cols-5 justify-items-center gap-4">
                    {filteredChars.map((char) => (
                      <CharCard
                        key={char.id}
                        char={char}
                        fit={fitFor(char)}
                        onClick={() => setSelectedChar(char)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex h-[160px] items-center justify-center rounded-md bg-gray-100">
                    <span className="t-help text-gray-400 tracking-wide">COMING SOON</span>
                  </div>
                )}
              </div>
            )
          })}
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
            className="relative w-[820px] rounded-lg border border-hairline bg-surface px-8 pt-14 pb-8 shadow-soft"
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
