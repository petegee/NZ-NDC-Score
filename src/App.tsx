import { lazy, Suspense, useState } from 'react'
import { SheetPage } from './sheet/SheetPage'
import { useAuth0 } from '@auth0/auth0-react'
import { AuthGate } from './auth/AuthGate'
import { PeoplePage } from './people/PeoplePage'
import type { FetchLike } from './api/wire'

// import.meta.env.DEV is false in a production build, so the bundler drops this
// import and the development token source never ships.
const DevAuthGate = import.meta.env.DEV ? lazy(() => import('./auth/DevAuthGate')) : undefined

function App({ base, auth, mockAuth = false }: { base: string; auth: boolean; mockAuth?: boolean }) {
  if (mockAuth && DevAuthGate) {
    return (
      <Suspense fallback={null}>
        {auth ? <DevOrAuth0 base={base} DevGate={DevAuthGate} /> : <DevAuthGate base={base}>{authed(base)}</DevAuthGate>}
      </Suspense>
    )
  }
  if (!auth) return <SheetPage base={base} />
  return (
    <AuthGate base={base}>
      {(fetchImpl, userName) => <AuthedApp base={base} fetchImpl={fetchImpl} cdDefault={userName} />}
    </AuthGate>
  )
}

const authed = (base: string) => (fetchImpl: FetchLike, userName: string) => (
  <AuthedApp base={base} fetchImpl={fetchImpl} cdDefault={userName} />
)

// Development with Auth0 configured too: the sign-in page offers both ways in.
// Once Auth0 is loading or signed in, the normal Auth0 gate takes over.
function DevOrAuth0({ base, DevGate }: { base: string; DevGate: NonNullable<typeof DevAuthGate> }) {
  const { isLoading, isAuthenticated, loginWithRedirect } = useAuth0()
  if (isLoading || isAuthenticated) return <AuthGate base={base}>{authed(base)}</AuthGate>
  return (
    <DevGate base={base} onAuth0Login={() => loginWithRedirect()}>
      {authed(base)}
    </DevGate>
  )
}

function AuthedApp({
  base,
  fetchImpl,
  cdDefault = '',
}: {
  base: string
  fetchImpl: FetchLike
  cdDefault?: string
}) {
  const [tab, setTab] = useState<'sheet' | 'people'>('sheet')
  return (
    <>
      <nav className="app-tabs" aria-label="Sections">
        <button type="button" aria-current={tab === 'sheet' ? 'page' : undefined} onClick={() => setTab('sheet')}>
          Scoresheet
        </button>
        <button type="button" aria-current={tab === 'people' ? 'page' : undefined} onClick={() => setTab('people')}>
          People
        </button>
      </nav>
      {tab === 'sheet' ? (
        <SheetPage base={base} fetchImpl={fetchImpl} cdDefault={cdDefault} />
      ) : (
        <PeoplePage base={base} fetchImpl={fetchImpl} />
      )}
    </>
  )
}

export default App
