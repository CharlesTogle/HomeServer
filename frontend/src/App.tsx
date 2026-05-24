import { AuthScreen } from './components/auth-screen.tsx'
import { HomeShell } from './components/home-shell.tsx'
import { useSessionStore } from './stores/session-store.ts'

function App(): React.JSX.Element {
  const accessToken = useSessionStore((state) => state.accessToken)

  return accessToken === null ? <AuthScreen /> : <HomeShell />
}

export default App
