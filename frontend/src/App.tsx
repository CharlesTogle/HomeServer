import { LoaderCircle } from 'lucide-react'
import { AuthScreen } from './components/auth-screen.tsx'
import { HomeShell } from './components/home-shell.tsx'
import { useRestoreSessionQuery } from './hooks/use-auth.ts'
import { useSessionStore } from './stores/session-store.ts'

function App(): React.JSX.Element {
  const accessToken = useSessionStore((state) => state.accessToken)
  const restoreSessionQuery = useRestoreSessionQuery(accessToken === null)

  if (accessToken === null && restoreSessionQuery.isPending) {
    return (
      <main className="relative min-h-screen overflow-hidden px-4 py-4 sm:px-6 lg:px-8">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(244,114,182,0.14),transparent_24%),radial-gradient(circle_at_82%_8%,rgba(253,208,234,0.48),transparent_18%),radial-gradient(circle_at_50%_120%,rgba(255,216,231,0.74),transparent_34%)]"
        />

        <div className="relative mx-auto flex min-h-[calc(100svh-2rem)] w-full max-w-[560px] items-center justify-center">
          <section className="flex w-full flex-col items-center gap-4 rounded-[32px] border border-white/50 bg-white/78 px-8 py-10 text-center shadow-[0_32px_80px_rgba(84,66,73,0.12)] backdrop-blur-xl">
            <LoaderCircle className="size-6 animate-spin text-[color:var(--primary)]" />
            <div className="space-y-2">
              <p className="text-lg font-semibold text-[color:var(--on-surface)]">
                Restoring your private session
              </p>
              <p className="text-sm text-[color:var(--on-surface-variant)]">
                Checking the refresh cookie before showing the sign-in screen.
              </p>
            </div>
          </section>
        </div>
      </main>
    )
  }

  return accessToken === null ? <AuthScreen /> : <HomeShell />
}

export default App
