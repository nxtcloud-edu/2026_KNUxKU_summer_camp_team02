/**
 * 공통 컴포넌트 — 통합 설계서 §13
 * 선택 상태는 항상 3중 신호: 코랄 tint + 3:1 이상 테두리 + 아이콘/굵기 변화 (§4-1)
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { Check, X, Minus, Plus, ChevronDown, AlertTriangle } from 'lucide-react'
import { characterImage, characterImagePng } from '../../lib/presets'
import {
  ANIM_TIMING,
  PERSONA_FRAMES,
  STATE_TO_BASE,
  allFramesOf,
  personaOf,
  resolveBase,
} from '../../lib/personaFrames'
import { onSpeakerChange } from '../../lib/ttsQueue'

/* ── 레이아웃 ─────────────────────────────────────────────── */

export function Section({ title, help, children }) {
  return (
    <section className="mb-8">
      {title && <h3 className="t-section mb-1">{title}</h3>}
      {help && <p className="t-help mb-3">{help}</p>}
      <div className="rounded-lg bg-surface border border-hairline overflow-hidden">{children}</div>
    </section>
  )
}

export function Row({ title, help, children, disabled, disabledReason, last }) {
  return (
    <div
      className={[
        'flex items-start gap-6 px-5 py-4 transition-colors duration-300',
        last ? '' : 'border-b border-hairline',
        disabled ? 'opacity-55' : '',
      ].join(' ')}
    >
      <div className="min-w-0 flex-1">
        <div className="t-item">{title}</div>
        {help && <div className="t-help mt-0.5">{help}</div>}
        {disabled && disabledReason && (
          <div className="t-caption mt-1 inline-flex items-center gap-1 text-[var(--danger)]">
            <AlertTriangle size={13} /> {disabledReason}
          </div>
        )}
      </div>
      <div className={['shrink-0 pt-0.5', disabled ? 'pointer-events-none' : ''].join(' ')}>{children}</div>
    </div>
  )
}

export function SubRow({ children }) {
  return (
    <div className="px-5 py-3 border-b border-hairline bg-[var(--hover-bg)]/60 flex flex-wrap items-center gap-x-6 gap-y-3">
      {children}
    </div>
  )
}

/* ── 토글 ─────────────────────────────────────────────────── */

export function Toggle({ checked, onChange, label, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        'group inline-flex items-center gap-2 rounded-full transition-colors duration-300',
        disabled ? 'cursor-not-allowed' : '',
      ].join(' ')}
    >
      <span
        className={[
          'relative h-6 w-11 rounded-full border transition-colors duration-300',
          checked
            ? 'bg-[var(--text-strong)] border-[var(--text-strong)]'
            : 'bg-white border-[var(--disabled)]',
        ].join(' ')}
      >
        <span
          className={[
            'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all duration-300 ease-soft',
            checked ? 'left-[22px]' : 'left-0.5 border border-hairline',
          ].join(' ')}
        />
      </span>
      {/* 색만으로 구분하지 않는다 (§11) */}
      <span className="t-caption w-7 text-left">{checked ? '켜짐' : '꺼짐'}</span>
    </button>
  )
}

/* ── 세그먼트 · 칩 · 선택 카드 ─────────────────────────────── */

export function Segmented({ value, onChange, options, ariaLabel }) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex rounded-full bg-[var(--hover-bg)] p-1 gap-1"
    >
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={[
              'px-3.5 py-1.5 rounded-full text-[13px] transition-all duration-300 border whitespace-nowrap',
              on
                ? 'bg-coral border-[var(--text-dark)] font-semibold text-ink'
                : 'bg-transparent border-transparent text-subtle hover:bg-white',
            ].join(' ')}
          >
            {on && <Check size={13} className="inline mr-1 -mt-0.5" />}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function Chips({ values, onChange, options, ariaLabel }) {
  const toggle = (v) => onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v])
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = values.includes(o)
        return (
          <button
            key={o}
            aria-pressed={on}
            onClick={() => toggle(o)}
            className={[
              'px-3.5 py-1.5 rounded-full text-[13px] border transition-all duration-300',
              on
                ? 'bg-coral border-[var(--text-dark)] font-semibold text-ink'
                : 'bg-white border-hairline text-subtle hover:bg-[var(--hover-bg)]',
            ].join(' ')}
          >
            {on && <Check size={13} className="inline mr-1 -mt-0.5" />}
            {o}
          </button>
        )
      })}
    </div>
  )
}

export function CardChoice({ value, onChange, options, columns = 2, ariaLabel }) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="grid gap-2 w-full"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))` }}
    >
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={[
              'text-left px-4 py-3 rounded-sm border transition-all duration-300',
              on
                ? 'bg-peach border-[var(--text-dark)] shadow-soft'
                : 'bg-white border-hairline hover:bg-[var(--hover-bg)]',
            ].join(' ')}
          >
            <div className={['t-item flex items-center gap-1.5', on ? 'font-semibold' : ''].join(' ')}>
              <span
                className={[
                  'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                  on ? 'bg-[var(--text-strong)] border-[var(--text-strong)]' : 'border-[var(--disabled)]',
                ].join(' ')}
              >
                {on && <Check size={11} className="text-white" />}
              </span>
              {o.label}
            </div>
            {o.help && <div className="t-help mt-1 pl-[22px]">{o.help}</div>}
          </button>
        )
      })}
    </div>
  )
}

/* ── 입력 ─────────────────────────────────────────────────── */

export function TextInput({ value, onChange, maxLength, placeholder, error, ariaLabel, className = '' }) {
  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <input
          aria-label={ariaLabel}
          aria-invalid={!!error}
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={[
            'w-full rounded-full bg-white px-4 py-2 t-body border transition-colors duration-300',
            error ? 'border-[var(--danger)]' : 'border-hairline focus:border-coral',
          ].join(' ')}
        />
        {maxLength && (
          <span className="t-caption tnum shrink-0">
            {value.length}/{maxLength}
          </span>
        )}
      </div>
      {error && <div className="t-caption mt-1 text-[var(--danger)]">{error}</div>}
    </div>
  )
}

export function Stepper({ value, onChange, min = 1, max = 9, ariaLabel }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-hairline bg-white p-1">
      <IconBtn
        label={`${ariaLabel} 줄이기`}
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
      >
        <Minus size={15} />
      </IconBtn>
      <span className="t-item tnum w-7 text-center">{value}</span>
      <IconBtn
        label={`${ariaLabel} 늘리기`}
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
      >
        <Plus size={15} />
      </IconBtn>
    </div>
  )
}

export function Select({ value, onChange, options, ariaLabel }) {
  return (
    <div className="relative inline-block">
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none rounded-full border border-hairline bg-white pl-4 pr-9 py-2 t-body cursor-pointer hover:bg-[var(--hover-bg)] transition-colors"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={15}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-subtle"
      />
    </div>
  )
}

export function TimeInput({ value, onChange, ariaLabel }) {
  return (
    <input
      type="time"
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-full border border-hairline bg-white px-4 py-2 t-body"
    />
  )
}

export function MinuteField({ value, onChange, label, min = 1, max = 240 }) {
  return (
    <label className="inline-flex items-center gap-2">
      <span className="t-help">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))}
        className="w-16 rounded-full border border-hairline bg-white px-3 py-1.5 t-body tnum text-center"
      />
      <span className="t-help">분</span>
    </label>
  )
}

/* ── 버튼 ─────────────────────────────────────────────────── */

export function Button({ variant = 'secondary', shape = 'pill', children, className = '', ...rest }) {
  const base =
    'inline-flex items-center justify-center gap-2 px-6 py-3 t-item transition-all duration-300 ease-soft disabled:opacity-45 disabled:cursor-not-allowed'
  // shape='rounded'는 랜딩 CTA처럼 카드 radius에 맞춰야 하는 자리용 — 기본은 기존 화면 전부가 쓰는 pill 그대로.
  // md(16px)를 쓴다: 이 버튼 높이(~46px)에서 lg(24px)는 height/2에 근접해 시각적으로 pill과 구분이 안 된다.
  const shapes = { pill: 'rounded-full', rounded: 'rounded-md' }
  const styles = {
    /* 주요 액션 — 기조의 hero CTA가 `bg-[#FFB7B2] text-stone-900 hover:-translate-y-1`이다.
       코랄 위에 진한 글자를 얹으면 9.1:1이라 접근성도 문제없다.
       (이전에 "코랄은 1.66:1이라 solid 불가"라고 본 것은 흰 글자를 전제한 오판이었다) */
    primary:
      'bg-coral text-strong font-semibold hover:-translate-y-0.5 shadow-[0_6px_20px_rgba(255,183,178,.45)]',
    /* 대비가 더 필요한 자리 — 기조의 footer CTA가 stone-900이다 */
    dark: 'bg-[var(--text-strong)] text-[var(--bg-warm)] hover:-translate-y-0.5 shadow-soft',
    secondary: 'bg-white/70 backdrop-blur-md border border-white/60 text-ink hover:bg-white shadow-soft',
    ghost: 'bg-transparent text-subtle hover:bg-[var(--hover-bg)]',
    danger: 'bg-[var(--danger)] text-white hover:brightness-110 hover:-translate-y-0.5 shadow-soft',
  }
  return (
    <button
      className={`${base} ${shapes[shape] || shapes.pill} ${styles[variant] || styles.secondary} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}

export function IconBtn({ children, label, active, tone = 'default', className = '', ...rest }) {
  const tones = {
    default: active
      ? 'bg-[var(--text-strong)] text-[var(--bg-warm)]'
      : 'bg-white border border-hairline text-ink hover:bg-[var(--hover-bg)]',
    danger: 'bg-[var(--danger)] text-white hover:brightness-110',
    plain: 'text-subtle hover:bg-[var(--hover-bg)]',
    // 밝은 면 위에 떠 있는 유리 컨트롤
    glass: `glass text-ink hover:-translate-y-0.5 ${active ? 'glass-coral' : ''}`,
    // 영상처럼 어두운 면 위에 얹는 유리
    glassDark: 'glass-dark hover:-translate-y-0.5',
  }
  return (
    <button
      aria-label={label}
      title={label}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition-all duration-300 disabled:opacity-40 ${tones[tone]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}

/* ── 오버레이 ─────────────────────────────────────────────── */

/** ESC · 바깥 클릭 · 닫기 버튼으로 닫히고, 포커스가 뒤로 새지 않는다 (§6-5, §11) */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  width = 1100,
  height = 760,
  minWidth = 900,
  plain = false,
  labelledBy,
}) {
  const ref = useRef(null)
  const prevFocus = useRef(null)

  useEffect(() => {
    if (!open) return
    prevFocus.current = document.activeElement
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
      if (e.key === 'Tab') trapFocus(e, ref.current)
    }
    document.addEventListener('keydown', onKey, true)
    const t = setTimeout(() => ref.current?.querySelector('[data-autofocus]')?.focus(), 30)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      clearTimeout(t)
      prevFocus.current?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center fade-in"
      style={{ background: 'var(--scrim)' }}
      onMouseDown={onClose}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-labelledby={labelledBy}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex flex-col overflow-hidden rounded-lg shadow-pop"
        style={{
          width: `min(88vw, ${width}px)`,
          height: `min(86vh, ${height}px)`,
          minWidth,
          // 유리(좌측 메뉴·하단 바)가 읽히려면 뒤에 색이 있어야 한다 (§4-3)
          // plain: 로그인 모달처럼 유리 컨트롤이 없는 작은 대화상자는 장식용 그라데이션이 필요 없다
          background: plain
            ? 'var(--surface)'
            : 'radial-gradient(680px 300px at 6% 4%, rgba(239,237,244,.9), transparent 60%),' +
              'radial-gradient(620px 280px at 96% 96%, rgba(255,240,237,.9), transparent 58%),' +
              'var(--bg-warm)',
        }}
      >
        {children}
        {footer}
      </div>
    </div>
  )
}

function trapFocus(e, root) {
  if (!root) return
  const items = root.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )
  if (!items.length) return
  const first = items[0]
  const last = items[items.length - 1]
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  }
}

export function Drawer({ open, onClose, title, children, width = 420 }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-[60] flex justify-end"
      style={{ background: 'var(--scrim)' }}
      onMouseDown={onClose}
    >
      <aside
        role="dialog"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className="h-full bg-warm shadow-pop flex flex-col enter-up"
        style={{ width }}
      >
        <header className="flex items-center justify-between px-6 py-4 border-b border-hairline">
          <h2 className="t-section">{title}</h2>
          <IconBtn label="닫기" tone="plain" onClick={onClose}>
            <X size={18} />
          </IconBtn>
        </header>
        <div className="flex-1 overflow-y-auto scroll-soft p-6">{children}</div>
      </aside>
    </div>
  )
}

export function Confirm({ open, title, body, confirmLabel = '확인', tone = 'primary', onConfirm, onCancel }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onCancel()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onCancel])
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center fade-in"
      style={{ background: 'var(--scrim)' }}
      onMouseDown={onCancel}
    >
      <div
        role="alertdialog"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className="w-[440px] rounded-lg bg-surface p-7 shadow-pop"
      >
        <h3 className="t-section mb-2">{title}</h3>
        <p className="t-body text-subtle whitespace-pre-line">{body}</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            취소
          </Button>
          <Button variant={tone} onClick={onConfirm} data-autofocus>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function Toasts({ items }) {
  return (
    <div className="fixed bottom-6 right-6 z-[80] flex flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          className={[
            'enter-up rounded-full px-5 py-3 t-body shadow-pop',
            t.tone === 'danger'
              ? 'bg-[var(--danger)] text-white'
              : 'bg-[var(--text-strong)] text-[var(--bg-warm)]',
          ].join(' ')}
        >
          {t.msg}
        </div>
      ))}
    </div>
  )
}

/* ── 캐릭터 스프라이트 ────────────────────────────────────── */

const CSS_ANIM = {
  studying: 'anim-idle',
  writing: 'anim-write',
  reading: 'anim-idle',
  drinking: 'anim-drink',
  stretching: 'anim-stretch',
  resting: 'anim-rest',
  distracted: 'anim-distract',
  typing: 'anim-type',
  away: '',
  cameraOff: '',
}

// 프리로드된 URL 집합 (한 번 로드하면 브라우저 캐시에 남는다)
const _preloaded = new Set()
function preload(urls) {
  for (const u of urls) {
    if (_preloaded.has(u)) continue
    _preloaded.add(u)
    const img = new Image()
    img.src = u
  }
}

/**
 * 페르소나 프레임 애니메이션 훅.
 *
 * 우선순위: reaction(일회성) > talking(overlay) > base loop.
 * `personaId`가 null이면 아무 것도 하지 않고 null을 반환한다(정적 폴백).
 */
function initialFrameFor(personaId, state) {
  if (!personaId) return null
  const persona = PERSONA_FRAMES[personaId]
  if (!persona) return null
  const baseName = resolveBase(personaId, STATE_TO_BASE[state] || ANIM_TIMING.defaultBase)
  const base = baseName ? persona.base[baseName] : null
  if (!base) return null
  if (base.loop) return base.loop[0]
  return base.open
}

function usePersonaFrame({ personaId, state, talking, reaction }) {
  const [frame, setFrame] = useState(() => initialFrameFor(personaId, state))

  useEffect(() => {
    if (!personaId) {
      setFrame(null)
      return
    }
    const persona = PERSONA_FRAMES[personaId]
    if (!persona) {
      setFrame(null)
      return
    }
    preload(allFramesOf(personaId))

    const timers = new Set()
    const setT = (fn, ms) => {
      const id = setTimeout(() => {
        timers.delete(id)
        fn()
      }, ms)
      timers.add(id)
      return id
    }
    const setI = (fn, ms) => {
      const id = setInterval(fn, ms)
      timers.add(id)
      return id
    }
    const clearAll = () => {
      for (const id of timers) {
        clearTimeout(id)
        clearInterval(id)
      }
      timers.clear()
    }

    // 1) reaction: 시퀀스 재생 후 종료 (자동 복귀는 부모가 reaction=null로 되돌리면 된다)
    if (reaction && persona.reactions?.[reaction]) {
      const seq = persona.reactions[reaction]
      let i = 0
      const step = () => {
        if (i >= seq.length) return
        setFrame(seq[i].src)
        const ms = seq[i].ms
        i += 1
        setT(step, ms)
      }
      step()
      return clearAll
    }

    // 2) talking overlay: 두 프레임을 talkingFrameMs로 교차
    if (talking && persona.talking?.length >= 2) {
      let i = 0
      setFrame(persona.talking[0])
      setI(() => {
        i = (i + 1) % persona.talking.length
        setFrame(persona.talking[i])
      }, ANIM_TIMING.talkingFrameMs)
      return clearAll
    }

    // 3) base loop
    const baseName = resolveBase(personaId, STATE_TO_BASE[state] || ANIM_TIMING.defaultBase)
    const base = baseName ? persona.base[baseName] : null
    if (!base) {
      setFrame(null)
      return clearAll
    }

    // 3-a) 다중 프레임 loop (listening / dozing)
    if (base.loop) {
      let i = 0
      setFrame(base.loop[0])
      if (base.loop.length > 1) {
        setI(() => {
          i = (i + 1) % base.loop.length
          setFrame(base.loop[i])
        }, base.frameMs || 500)
      }
      return clearAll
    }

    // 3-b) open ↔ blink
    setFrame(base.open)
    const scheduleBlink = () => {
      const { blinkIntervalMinMs: lo, blinkIntervalMaxMs: hi, blinkHoldMs } = ANIM_TIMING
      const wait = lo + Math.random() * (hi - lo)
      setT(() => {
        if (base.blink) setFrame(base.blink)
        setT(() => {
          setFrame(base.open)
          scheduleBlink()
        }, blinkHoldMs)
      }, wait)
    }
    scheduleBlink()

    return clearAll
  }, [personaId, state, talking, reaction])

  return frame
}

/**
 * 캐릭터 스프라이트.
 *
 * 페르소나 매핑이 있으면(bear/tiger/duck 등) 프레임 애니메이션이 자기완결적으로 재생된다
 * (studying 자세 + 3~6s 랜덤 눈 깜빡임이 기본). 매핑이 없으면 기존처럼 PNG→SVG 폴백.
 *
 * 선택적 상태 훅:
 *   - `talking`(bool): true면 말하기 두 프레임을 200ms로 교차한다.
 *   - `reaction`(string): 'surprised' | 'idea' | 'thinking' 등, 페르소나가 가진 리액션 이름.
 *     시퀀스 재생 후에는 자동으로 종료되므로 부모가 setTimeout으로 null로 되돌리면 된다.
 *
 * 기존 사용처는 시그니처 변경 없이 그대로 동작한다.
 */
export function CharacterSprite({
  imageKey,
  size = 120,
  state,
  className = '',
  style,
  talking = false,
  reaction = null,
  speakerId = null,
}) {
  const personaId = personaOf(imageKey)

  // TTS 재생 중인 화자와 이 스프라이트의 speakerId가 일치하면 talking을 유지한다
  // (typing 인디케이터 → 답변 표시 → TTS 재생 구간 동안 끊김 없이 입이 움직인다)
  const [ttsSpeaking, setTtsSpeaking] = useState(false)
  useEffect(() => {
    if (speakerId === null || speakerId === undefined) {
      setTtsSpeaking(false)
      return
    }
    return onSpeakerChange((sid) => setTtsSpeaking(sid !== null && sid === speakerId))
  }, [speakerId])

  // 기존 프로토타입의 typingSlots는 응답을 준비 중인 상태를 나타낸다 → talking overlay로 매핑
  const effectiveTalking = talking || state === 'typing' || ttsSpeaking
  const personaFrame = usePersonaFrame({ personaId, state, talking: effectiveTalking, reaction })

  // 페르소나 매핑이 없으면 기존 PNG→SVG 폴백 유지
  const [fallbackSrc, setFallbackSrc] = useState(characterImagePng(imageKey))
  const onErr = useCallback(() => setFallbackSrc(characterImage(imageKey)), [imageKey])
  useEffect(() => {
    if (!personaId) setFallbackSrc(characterImagePng(imageKey))
  }, [imageKey, personaId])

  const src = personaFrame || fallbackSrc
  // 페르소나 PNG(512×512)는 여백이 있어 같은 size로도 SVG보다 작아 보인다.
  // hero 사이즈에서만 시각적으로 스케일업 — layout box(size×size)는 그대로 유지.
  // 프레임 스왑이 이미 움직임을 제공하므로 CSS wiggle은 페르소나에서 생략(transform 충돌 방지).
  const isPersona = !!personaId
  const scale = isPersona && size >= 100 ? 1.35 : 1
  const anim = isPersona ? '' : CSS_ANIM[state] ?? 'anim-idle'

  return (
    <img
      src={src}
      onError={personaId ? undefined : onErr}
      alt=""
      width={size}
      height={size}
      draggable={false}
      className={`select-none ${anim} ${className}`}
      style={{
        width: size,
        height: size,
        objectFit: 'contain',
        ...(scale !== 1 && { transform: `scale(${scale})`, transformOrigin: 'center' }),
        ...style,
      }}
    />
  )
}
