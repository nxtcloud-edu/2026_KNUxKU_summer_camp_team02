import { useEffect } from 'react'
import { useStore } from './store/useStore'
import { Toasts } from './components/ui'
import HomeScreen from './screens/HomeScreen_v1'
import LobbyScreen from './screens/LobbyScreen'
import StudyRoomScreen from './screens/StudyRoomScreen'
import EndingScreen from './screens/EndingScreen'
import SettingsDialog from './components/SettingsDialog'

export default function App() {
  const route = useStore((s) => s.route)
  const toasts = useStore((s) => s.toasts)

  useEffect(() => {
    document.title = 'AI 스터디룸 — 프로토타입'
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
