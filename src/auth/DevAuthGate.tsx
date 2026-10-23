import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { request, type FetchLike } from '../api/wire'

// Development only: sign in with a `mock` persona token pasted from the
// engine's console (an engine in Auth:Mode=mock prints one per persona at
// startup) — the same flow SoarscoreUI uses. The token lives in this tab's
// sessionStorage so a reload stays signed in. App.tsx loads this module only
// when import.meta.env.DEV, so a production build never contains it.
const STORAGE_KEY = 'ndcscore:dev-token'

const TOKEN_SHAPE = /^[\w-]+\.[\w-]+\.[\w-]+$/

function cleanToken(text: string): string {
  return text.trim().replace(/^(Authorization:\s*)?Bearer\s+/i, '')
}

function readToken(): string | undefined {
  try {
    return sessionStorage.getItem(STORAGE_KEY) ?? undefined
  } catch {
    return undefined
  }
}

function writeToken(token: string | undefined): void {
  try {
    if (token) sessionStorage.setItem(STORAGE_KEY, token)
    else sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // no storage: the token lasts until the next reload
  }
}

// Display only (defaults the Contest Director field) — never trusted.
function nameFromToken(token: string): string {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const claims = JSON.parse(atob(payload)) as { name?: string; email?: string }
    return claims.name ?? claims.email ?? ''
  } catch {
    return ''
  }
}

export default function DevAuthGate({
  base,
  onAuth0Login,
  children,
}: {
  base: string
  /** Set when Auth0 is configured too — adds a "Sign in with Auth0" button. */
  onAuth0Login?: () => void
  children: (fetchImpl: FetchLike, userName: string) => ReactNode
}) {
  const [token, setToken] = useState<string | undefined>(readToken)
  const [text, setText] = useState('')
  const [failure, setFailure] = useState<string | undefined>()
  const [linked, setLinked] = useState(false)

  const signOut = () => {
    writeToken(undefined)
    setToken(undefined)
    setLinked(false)
    setFailure(undefined)
  }

  const authedFetch = useCallback<FetchLike>(
    async (input, init) => {
      const headers = new Headers(init?.headers)
      headers.set('Authorization', `Bearer ${token}`)
      return fetch(input, { ...init, headers })
    },
    [token],
  )

  useEffect(() => {
    if (!token) return
    let cancelled = false
    request(authedFetch, base, 'POST', '/link-sign-in', { body: {} }).then(
      () => !cancelled && setLinked(true),
      (e: unknown) => {
        if (cancelled) return
        writeToken(undefined)
        setToken(undefined)
        setFailure(String((e as Error)?.message ?? e))
      },
    )
    return () => {
      cancelled = true
    }
  }, [token, authedFetch, base])

  const pasted = cleanToken(text)
  const looksLikeToken = TOKEN_SHAPE.test(pasted)

  if (!token) {
    const submit = (event: FormEvent) => {
      event.preventDefault()
      if (!looksLikeToken) return
      writeToken(pasted)
      setFailure(undefined)
      setToken(pasted)
    }
    return (
      <main className="auth-page">
        <h1>
          <img className="brand-logo" src="/logo.svg" alt="" width={36} height={36} />
          NDC Scoresheet
        </h1>
        <p className="lede">
          Development sign-in. The engine is in mock auth mode — paste one of the persona tokens it
          printed at startup (the text after <code>Authorization: Bearer</code>).
        </p>
        {failure && <p className="error-bar">Token was not accepted by Soarscore — {failure}</p>}
        <form onSubmit={submit} className="dev-form">
          <textarea
            aria-label="Persona token"
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="dev-token"
          />
          <button type="submit" className="calculate" disabled={!looksLikeToken}>
            Sign in with token
          </button>
        </form>
        {onAuth0Login && (
          <button type="button" onClick={onAuth0Login}>
            Sign in with Auth0
          </button>
        )}
      </main>
    )
  }

  if (!linked) return <main className="auth-page">Signing in…</main>

  const userName = nameFromToken(token)
  return (
    <>
      <div className="session-bar">
        <span>{userName}</span>
        <button type="button" className="reset" onClick={signOut}>
          Sign out
        </button>
      </div>
      {children(authedFetch, userName)}
    </>
  )
}
