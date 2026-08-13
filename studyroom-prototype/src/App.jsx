import { useEffect } from 'react'
import { useStore } from './store/useStore'
import { db } from './store/db'
import { Toasts } from './components/ui'
import HomeScreen from './screens/HomeScreen'
import LobbyScreen from './screens/LobbyScreen'
import StudyRoomScreen from './screens/StudyRoomScreen'
import EndingScreen from './screens/EndingScreen'
import SettingsDialog from './components/SettingsDialog'

/**
 * [TEMP] EndingScreen UI 확인용 데모 세션 생성기.
 * `?demoEnding=1`로 접속하면 임의의 데모 데이터를 만들어 엔딩 화면으로 바로 이동한다.
 * 실제 기능이 아니며, 확인이 끝나면 제거할 임시 코드다.
 */
function seedDemoEndingSession() {
  const id = db.startSession()

  // 채팅 기록 — 캐릭터별 상호작용 횟수를 다르게 줘서 "가장 많이 말한 메이트" 판단도 확인
  db.addMessage(id, { sender_type: 'me', sender_id: null, body: '이 개념 잘 모르겠어', kind: 'text' })
  db.addMessage(id, { sender_type: 'mate', sender_id: 1, body: '단계별로 짚어볼까요?', kind: 'text' })
  db.addMessage(id, { sender_type: 'mate', sender_id: 1, body: '여기까지 이해되면 다음으로 가요.', kind: 'text' })
  db.addMessage(id, { sender_type: 'mate', sender_id: 2, body: '오 나도 궁금했어!', kind: 'text' })
  db.addMessage(id, { sender_type: 'me', sender_id: null, body: '확률과 통계 정리.pdf', kind: 'file' })

  // 심화 학습 포인트
  db.addStudyPoint(id, '정의와 조건을 분리해서 정리해두기', '확률과 통계 정리.pdf')
  db.addStudyPoint(id, '예외 사례를 한 개 이상 직접 만들어보기', '확률과 통계 정리.pdf')

  // 기습 질문 결과 — 성공 1 / 실패 1
  db.addQuizResult(id, { question: '방금 본 부분에서 가장 중요한 조건 하나만 말해볼래?', is_correct: true })
  db.addQuizResult(id, { question: '이 개념이 안 통하는 예외 상황이 뭐였지?', is_correct: false })

  // 세션 마감 — 공부 92분 · 집중 71분 · 이탈 3회 · 최장 집중 26분
  const studySec = 92 * 60
  const focusSec = 71 * 60
  const awaySec = studySec - focusSec
  const bestStreakSec = 26 * 60
  const snapshot = { studySec, focusSec, awaySec, awayCount: 3, bestStreakSec }

  db.endSession(id, {
    study_sec: studySec,
    focus_sec: focusSec,
    away_sec: awaySec,
    away_count: 3,
    best_streak_sec: bestStreakSec,
    score_mode: 'full',
    integrity: 'strict',
    topics: ['조건부 확률'],
    topic_source: 'document',
  })

  return { id, snapshot }
}

export default function App() {
  const route = useStore((s) => s.route)
  const toasts = useStore((s) => s.toasts)
  const go = useStore((s) => s.go)
  const setSessionId = useStore((s) => s.setSessionId)
  const setLastSessionId = useStore((s) => s.setLastSessionId)

  useEffect(() => {
    document.title = 'AI 스터디룸 — 프로토타입'
  }, [])

  // [TEMP] ?demoEnding=1 접속 시 데모 세션을 만들고 엔딩 화면으로 이동
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('demoEnding') !== '1') return
    const { id } = seedDemoEndingSession()
    setSessionId(null)
    setLastSessionId(id)
    go('ending')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      {route === 'home' && <HomeScreen />}
      {route === 'lobby' && <LobbyScreen />}
      {route === 'room' && <StudyRoomScreen />}
      {route === 'ending' && <EndingScreen />}
      <SettingsDialog />
      <Toasts items={toasts} />
    </>
  )
}
