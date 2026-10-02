import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { request, type FetchLike } from '../api/wire'

type LinkState = { kind: 'pending' } | { kind: 'linked' } | { kind: 'failed'; message: string }

// Sign-in in front of the sheet: Auth0 Universal Login, then one
// POST /link-sign-in so the Soarscore API binds this login to a person (and
// grants Organiser to bootstrap emails) before any Calculate runs. Every API
// call after that carries the access token via the fetch handed to children.
export function AuthGate({
  base,
  children,
}: {
  base: string
  children: (fetchImpl: FetchLike) => ReactNode
}) {
  const { isLoading, isAuthenticated, error, user, loginWithRedirect, logout, getAccessTokenSilently } =
    useAuth0()
  const [link, setLink] = useState<LinkState>({ kind: 'pending' })

  const authedFetch = useCallback<FetchLike>(
    async (input, init) => {
      const token = await getAccessTokenSilently()
      const headers = new Headers(init?.headers)
      headers.set('Authorization', `Bearer ${token}`)
      return fetch(input, { ...init, headers })
    },
    [getAccessTokenSilently],
  )

  useEffect(() => {
    if (!isAuthenticated) return
    let cancelled = false
    request(authedFetch, base, 'POST', '/link-sign-in', { body: {} }).then(
      () => !cancelled && setLink({ kind: 'linked' }),
      (e: unknown) =>
        !cancelled && setLink({ kind: 'failed', message: String((e as Error)?.message ?? e) }),
    )
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, authedFetch, base])

  const signOut = () => logout({ logoutParams: { returnTo: window.location.origin } })

  if (isLoading) return <main className="auth-page">Signing in…</main>

  if (!isAuthenticated) {
    return (
      <main className="auth-page">
        <h1>NDC Scoresheet</h1>
        <p className="lede">Sign in to enter and score your contest.</p>
        {error && <p className="error-bar">{error.message}</p>}
        <button type="button" className="calculate" onClick={() => loginWithRedirect()}>
          Sign in
        </button>
      </main>
    )
  }

  if (link.kind === 'pending') return <main className="auth-page">Signing in…</main>

  if (link.kind === 'failed') {
    return (
      <main className="auth-page">
        <h1>NDC Scoresheet</h1>
        <p className="error-bar">Sign-in was not accepted by Soarscore — {link.message}</p>
        <button type="button" onClick={signOut}>
          Sign out
        </button>
      </main>
    )
  }

  return (
    <>
      <div className="session-bar">
        <span>{user?.email ?? user?.name}</span>
        <button type="button" className="reset" onClick={signOut}>
          Sign out
        </button>
      </div>
      {children(authedFetch)}
    </>
  )
}
