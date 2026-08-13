import { useEffect, useState } from 'react'
import { useStore } from './store/useStore'
import { Toasts } from './components/ui'
import LandingScreen from './screens/LandingScreen'
// 홈 화면은 김규태 님이 새로 만든 v1 을 쓴다. 예전 HomeScreen.jsx 는 남겨 둔다
import HomeScreen from './screens/HomeScreen_v1'
import LobbyScreen from './screens/LobbyScreen'
import StudyRoomScreen from './screens/StudyRoomScreen'
import EndingScreen from './screens/EndingScreen'
import SettingsDialog from './components/SettingsDialog'
import BenchScreen from './screens/BenchScreen'

export default function App() {
  const route = useStore((s) => s.route)
  const toasts = useStore((s) => s.toasts)

  // 개발용 측정 페이지 — #bench (§ 시각 신호 성능 확인)
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const onHash = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    document.title = 'Alongside — AI 스터디 메이트'
  }, [])

  if (hash === '#bench') return <BenchScreen />

  return (
    <>
      {route === 'landing' && <LandingScreen />}
      {route === 'home' && <HomeScreen />}
      {route === 'lobby' && <LobbyScreen />}
      {route === 'room' && <StudyRoomScreen />}
      {route === 'ending' && <EndingScreen />}
      <SettingsDialog />
      <Toasts items={toasts} />
    </>
  )
}
