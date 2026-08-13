import { useEffect } from 'react'
import { useStore } from './store/useStore'
import { Toasts } from './components/ui'
import LandingScreen from './screens/LandingScreen'
import HomeScreen from './screens/HomeScreen'
import LobbyScreen from './screens/LobbyScreen'
import StudyRoomScreen from './screens/StudyRoomScreen'
import EndingScreen from './screens/EndingScreen'
import SettingsDialog from './components/SettingsDialog'

export default function App() {
  const route = useStore((s) => s.route)
  const toasts = useStore((s) => s.toasts)

  useEffect(() => {
    document.title = 'Alongside — AI 스터디 메이트'
  }, [])

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
