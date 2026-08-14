/**
 * 기습 질문 창.
 *
 * 답을 **눌러서** 낸다. 채팅으로 답하지 않는 것이 핵심이다 —
 * 예전에는 퀴즈가 뜬 뒤 사용자가 무슨 말을 하든 답안으로 채점돼서,
 * "이 자료 요약해줘"라고 물어도 퀴즈 답으로 처리되고 원래 질문이 사라졌다.
 *
 * 창을 닫아도 벌을 주지 않는다. 문서가 "재촉하지 않는다"를 못 박았고,
 * 답하기 싫은 순간에 창이 안 닫히면 그다음부터는 아예 안 푼다.
 */
import { useEffect, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import { CharacterSprite, Dialog } from './ui'
import { PRESETS } from '../lib/presets'

export default function QuizPanel({ open, quiz, seat, onClose, onAnswered }) {
  const [picked, setPicked] = useState(null)
  const firstRef = useRef(null)

  // 새 문제가 오면 앞 문제의 선택을 지운다. 안 지우면 정답이 미리 보인다
  useEffect(() => {
    if (open) setPicked(null)
  }, [open, quiz])

  useEffect(() => {
    if (open && picked === null) firstRef.current?.focus()
  }, [open, picked])

  if (!quiz) return null

  const answered = picked !== null
  const correct = picked === quiz.answerIndex
  const preset = PRESETS[seat?.preset] || PRESETS.mina

  const choose = (i) => {
    if (answered) return
    setPicked(i)
    onAnswered?.({ index: i, correct: i === quiz.answerIndex, quiz })
  }

  return (
    <Dialog open={open} onClose={onClose} title="확인 문제" width={520} minWidth={0} plain>
      <div className="flex h-full flex-col px-8 py-7">
        <div className="flex items-start gap-3">
          <div className="shrink-0 opacity-90">
            <CharacterSprite imageKey={seat?.imageKey || preset.imageKey} size={44} state="talking" />
          </div>
          <div className="min-w-0">
            <p className="t-caption text-muted">{seat?.name || '메이트'}</p>
            <h3 className="t-body mt-1 font-semibold leading-relaxed">{quiz.question}</h3>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-2">
          {quiz.choices.map((c, i) => {
            const isAnswer = i === quiz.answerIndex
            const isPicked = i === picked
            // 답하기 전에는 전부 같은 모습이어야 한다. 정답만 다르게 보이면 찍힌다
            const tone = !answered
              ? 'border-hairline hover:border-[var(--text-strong)] hover:bg-[var(--hover-bg)]'
              : isAnswer
                ? 'border-[var(--ok,#2F6B51)] bg-[var(--ok-soft,#E1EEE7)]'
                : isPicked
                  ? 'border-[var(--danger)] bg-[var(--danger-soft,#F7E4E1)]'
                  : 'border-hairline opacity-55'
            return (
              <button
                key={i}
                ref={i === 0 ? firstRef : null}
                type="button"
                disabled={answered}
                onClick={() => choose(i)}
                className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors duration-200 ${tone}`}
              >
                <span className="t-caption text-muted w-4 shrink-0 tabular-nums">{i + 1}</span>
                <span className="t-body min-w-0 flex-1">{c}</span>
                {answered && isAnswer && <Check size={17} className="shrink-0 text-[var(--ok,#2F6B51)]" />}
                {answered && isPicked && !isAnswer && <X size={17} className="text-danger shrink-0" />}
              </button>
            )
          })}
        </div>

        {answered && (
          <div className="mt-5">
            <p className="t-body font-semibold">
              {correct ? '맞았어. 확실히 잡고 있네.' : '아쉽다. 여기 한 번 더 보고 가자.'}
            </p>
            {quiz.explanation && (
              <p className="t-body text-subtle mt-2 leading-relaxed">{quiz.explanation}</p>
            )}
          </div>
        )}

        <div className="mt-7 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="t-body rounded-full px-5 py-2 transition-colors duration-200 hover:bg-[var(--hover-bg)]"
          >
            {answered ? '닫기' : '나중에'}
          </button>
        </div>
      </div>
    </Dialog>
  )
}
