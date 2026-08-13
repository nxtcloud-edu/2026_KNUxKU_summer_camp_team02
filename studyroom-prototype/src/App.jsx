import { useEffect, useState } from 'react'
import { useStore } from './store/useStore'
import { Toasts } from './components/ui'
import HomeScreen from './screens/HomeScreen'
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
    document.title = 'AI 스터디룸 — 프로토타입'
  }, [])

  if (hash === '#bench') return <BenchScreen />

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
