import { useState } from 'react'
import { SheetPage } from './sheet/SheetPage'
import { AuthGate } from './auth/AuthGate'
import { PeoplePage } from './people/PeoplePage'
import type { FetchLike } from './api/wire'

function App({ base, auth }: { base: string; auth: boolean }) {
  if (!auth) return <SheetPage base={base} />
  return (
    <AuthGate base={base}>
      {(fetchImpl, userName) => <AuthedApp base={base} fetchImpl={fetchImpl} cdDefault={userName} />}
    </AuthGate>
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
