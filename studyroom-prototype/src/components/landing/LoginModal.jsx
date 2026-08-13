/**
 * 로그인 오버레이 (랜딩 기획서 §10)
 * MVP는 Google 로그인 하나뿐이라 탭·이메일/비밀번호 폼을 만들지 않는다.
 * "Continue with Google"은 실제 OAuth를 붙이지 않은 목업이다 — 클릭하면 곧장 앱으로 들어간다.
 */
import { X } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { BRAND } from '../../lib/brand'
import { Button, Dialog } from '../ui'

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  )
}

export default function LoginModal({ open, onClose }) {
  const go = useStore((s) => s.go)

  const enter = () => {
    onClose()
    go('home')
  }

  return (
    <Dialog open={open} onClose={onClose} title="로그인" width={400} height={420} minWidth={0} plain>
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
        <p className="t-body text-subtle mt-3">{BRAND.login.prompt}</p>

        <Button variant="dark" shape="rounded" className="mt-7 w-full" onClick={enter} data-autofocus>
          <GoogleMark />
          {BRAND.login.google}
        </Button>

        <p className="t-caption text-muted mt-6">{BRAND.login.legal}</p>
      </div>
    </Dialog>
  )
}
