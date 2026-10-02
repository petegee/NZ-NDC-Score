import { SheetPage } from './sheet/SheetPage'
import { AuthGate } from './auth/AuthGate'

function App({ base, auth }: { base: string; auth: boolean }) {
  if (!auth) return <SheetPage base={base} />
  return (
    <AuthGate base={base}>
      {(fetchImpl, userName) => <SheetPage base={base} fetchImpl={fetchImpl} cdDefault={userName} />}
    </AuthGate>
  )
}

export default App
