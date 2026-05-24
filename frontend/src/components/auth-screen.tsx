import {
  ArrowRight,
  LoaderCircle,
  Lock,
} from 'lucide-react'
import { useState, type FormEvent } from 'react'
import {
  fieldInputClass,
  fieldLabelClass,
  glassPanelClass,
  pillClass,
  primaryButtonClass,
  sectionHeadingClass,
  sectionSubtextClass,
} from '../lib/ui.ts'
import { useLoginMutation } from '../hooks/use-auth.ts'

const defaultEmail = 'admin@homeserver.tailnet'
const defaultPassword = 'media-demo'

export function AuthScreen(): React.JSX.Element {
  const loginMutation = useLoginMutation()
  const [email, setEmail] = useState<string>(defaultEmail)
  const [password, setPassword] = useState<string>(defaultPassword)

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    await loginMutation.mutateAsync({
      email,
      password,
    })
  }

  return (
    <main className="relative min-h-screen overflow-hidden px-4 py-4 sm:px-6 lg:px-8">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(244,114,182,0.14),transparent_24%),radial-gradient(circle_at_82%_8%,rgba(253,208,234,0.48),transparent_18%),radial-gradient(circle_at_50%_120%,rgba(255,216,231,0.74),transparent_34%)]"
      />

      <div className="relative mx-auto flex min-h-[calc(100svh-2rem)] w-full max-w-[560px] items-center">
        <section className={`${glassPanelClass} w-full flex flex-col gap-6 p-6 sm:p-8 lg:p-10`}>
          <div className="space-y-4">
            <span className={pillClass}>
              <Lock className="size-4" />
              Sign In
            </span>

            <div className="space-y-3">
              <p className={sectionHeadingClass}>Private workspace access</p>
              <h2 className="text-[clamp(2.25rem,3vw,3.15rem)] font-semibold leading-[1.02] tracking-[-0.03em] text-[color:var(--on-surface)]">
                Enter your private library
              </h2>
              <p className={sectionSubtextClass}>
                Sign in with an in-memory access token and let the refresh cookie keep the session alive.
              </p>
            </div>
          </div>

          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <label className={fieldLabelClass} htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                aria-label="Email"
                className={fieldInputClass}
                value={email}
                onChange={(event) => setEmail(event.currentTarget.value)}
              />
              <span className="text-sm text-[color:var(--secondary)]">
                Suggested local account: {defaultEmail}
              </span>
            </div>

            <div className="space-y-2">
              <label className={fieldLabelClass} htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                aria-label="Password"
                className={fieldInputClass}
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
              />
              <span className="text-sm text-[color:var(--secondary)]">
                Suggested demo: {defaultPassword}
              </span>
            </div>

            {loginMutation.error !== null ? (
              <div
                className="rounded-[22px] border border-[color:var(--error-container)] bg-[color:var(--error-container)] px-4 py-3 text-sm text-[color:var(--on-error-container)]"
                role="alert"
              >
                {loginMutation.error.message}
              </div>
            ) : null}

            <button
              className={`${primaryButtonClass} w-full`}
              type="submit"
              disabled={loginMutation.isPending}
            >
              {loginMutation.isPending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <ArrowRight className="size-4" />
              )}
              Open private library
            </button>
          </form>

        </section>
      </div>
    </main>
  )
}
