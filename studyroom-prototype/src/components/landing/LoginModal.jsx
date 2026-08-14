/**
 * 로그인 오버레이 (랜딩 기획서 §10)
 *
 * 로그인이 하는 일은 **데이터 칸을 가르는 것**이다. 계정마다 학습 기록·캐릭터 설정·
 * 올린 자료가 따로 저장된다 (lib/auth.js, store/db.js).
 *
 * 구글 버튼은 구글이 직접 그린다. 우리 디자인의 버튼으로 ID 토큰을 받는 공식 경로가
 * 없어서다 — 자세한 이유는 lib/googleAuth.js 주석에 적었다.
 *
 * ⚠️ **로그인이 막혀도 앱에 들어갈 수 있어야 한다.** 우리 공개 주소는 재시작마다 바뀌는
 *    임시 터널이고, 구글은 등록되지 않은 주소를 거절한다. 시연 도중 주소가 바뀌었다는
 *    이유로 아무도 못 들어가는 일은 없어야 한다. 그래서 게스트 입장이 항상 열려 있다.
 */
import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { BRAND } from '../../lib/brand'
import { Button, Dialog } from '../ui'
import { authConfig, mountGoogleButton, verifyCredential } from '../../lib/googleAuth'
import { isGuest } from '../../lib/auth'

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  )
}

export default function LoginModal({ open, onClose }) {
  const go = useStore((s) => s.go)
  const signIn = useStore((s) => s.signIn)
  const account = useStore((s) => s.account)
  const toast = useStore((s) => s.toast)

  // idle · loading(구글 버튼 준비) · ready(버튼 떴음) · verifying(토큰 확인 중) · unavailable
  const [phase, setPhase] = useState('idle')
  const [error, setError] = useState('')
  const slotRef = useRef(null)

  const enterAsGuest = () => {
    onClose()
    go('home')
  }

  useEffect(() => {
    if (!open) {
      setPhase('idle')
      setError('')
      return
    }

    let dead = false
    let cleanup = null
    setPhase('loading')
    setError('')
    ;(async () => {
      try {
        const { googleClientId } = await authConfig()
        if (dead) return
        if (!googleClientId) {
          // 아직 클라이언트 ID 를 안 받았다. 잘못이 아니라 미설정 상태다
          setPhase('unavailable')
          return
        }
        if (!slotRef.current) return
        cleanup = await mountGoogleButton(slotRef.current, {
          clientId: googleClientId,
          width: 300,
          onError: (e) => {
            if (dead) return
            setError(e?.message || '구글 로그인에 실패했습니다')
          },
          onCredential: async (credential) => {
            if (dead) return
            setPhase('verifying')
            setError('')
            try {
              const profile = await verifyCredential(credential)
              if (dead) return
              signIn(profile)
              toast(`${profile.name || '환영합니다'}님으로 로그인했어요`)
              onClose()
              go('home')
            } catch (e) {
              if (dead) return
              setPhase('ready')
              setError(e?.message || '로그인 확인에 실패했습니다')
            }
          },
        })
        if (dead) return
        setPhase('ready')
      } catch (e) {
        if (dead) return
        setPhase('unavailable')
        setError(e?.message || '')
      }
    })()

    return () => {
      dead = true
      cleanup?.()
    }
  }, [open, signIn, go, onClose, toast])

  const signedIn = !isGuest(account)

  return (
    <Dialog open={open} onClose={onClose} title="로그인" width={400} height={460} minWidth={0} plain>
      <div className="relative flex h-full flex-col items-center justify-center px-10 py-9 text-center">
        <button
          type="button"
          aria-label="닫기"
          onClick={onClose}
          className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full text-subtle transition-colors duration-300 hover:bg-[var(--hover-bg)]"
        >
          <X size={18} />
        </button>

        <h2 className="t-section">
          <span className="text-coral opacity-[.82]">{BRAND.name.slice(0, 2)}</span>
          {BRAND.name.slice(2)}
        </h2>
        <p className="t-body text-subtle mt-3">
          {signedIn ? `${account.name || account.email}으로 로그인되어 있어요` : BRAND.login.prompt}
        </p>

        {signedIn ? (
          <Button
            variant="dark"
            shape="rounded"
            className="mt-7 w-full"
            onClick={enterAsGuest}
            data-autofocus
          >
            이어서 하기
          </Button>
        ) : (
          <>
            {/* 구글이 그린 버튼이 여기 들어온다. 자리를 미리 잡아 둬야 화면이 덜컹거리지 않는다 */}
            <div ref={slotRef} className="mt-7 flex min-h-[44px] w-full items-center justify-center" />

            {phase === 'loading' && <p className="t-caption text-muted mt-3">구글 로그인을 준비하는 중…</p>}
            {phase === 'verifying' && <p className="t-caption text-muted mt-3">확인하는 중…</p>}

            {phase === 'unavailable' && (
              <Button variant="dark" shape="rounded" className="w-full" onClick={enterAsGuest} data-autofocus>
                <GoogleMark />
                게스트로 계속하기
              </Button>
            )}

            {/* 구글이 떠 있어도 게스트 문은 열어 둔다 — 주소가 바뀌면 구글 쪽이 막힌다 */}
            {phase !== 'unavailable' && (
              <button
                type="button"
                onClick={enterAsGuest}
                className="t-caption text-muted mt-4 underline underline-offset-4 transition-colors duration-300 hover:text-subtle"
              >
                게스트로 계속하기
              </button>
            )}
          </>
        )}

        {error && <p className="t-caption mt-3 text-coral">{error}</p>}

        <p className="t-caption text-muted mt-6">{BRAND.login.legal}</p>
      </div>
    </Dialog>
  )
}
