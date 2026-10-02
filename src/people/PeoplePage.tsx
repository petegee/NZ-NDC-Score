import { useEffect, useMemo, useState } from 'react'
import { createApi } from '../api/client'
import { holdsRole, personRoleLabel, type PersonSummary } from '../api/types'
import type { FetchLike } from '../api/wire'

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// Organiser self-service for the beta cohort: find people by email or name
// and grant or revoke the Organiser role, replacing per-tester Fly secrets.
// /people and both role commands are organiser-only on the API, so anyone
// without the role gets the ask-an-organiser note instead of the list.
export function PeoplePage({ base, fetchImpl }: { base: string; fetchImpl?: FetchLike }) {
  const api = useMemo(() => createApi(base, fetchImpl), [base, fetchImpl])
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [rows, setRows] = useState<PersonSummary[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api.whoAmI().then(
      ({ value }) => {
        if (!cancelled) setAllowed(value.isAuthenticated && holdsRole(value.roles, 'Organiser'))
      },
      (e: unknown) => {
        if (!cancelled) {
          setAllowed(false)
          setError(messageOf(e))
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [api])

  const search = async () => {
    setError(null)
    setNotice(null)
    try {
      const { value } = await api.findPeople({
        email: email.trim() || undefined,
        name: name.trim() || undefined,
      })
      setRows(value)
      if (value.length === 0) setNotice('No people match that search.')
    } catch (e: unknown) {
      setError(messageOf(e))
    }
  }

  const changeRole = async (row: PersonSummary, grant: boolean) => {
    setError(null)
    setNotice(null)
    setBusy(row.id.value)
    try {
      if (grant) {
        await api.grantRole(row.id.value, 'Organiser')
        setNotice(`Granted Organiser to ${row.name}.`)
      } else {
        await api.revokeRole(row.id.value, 'Organiser')
        setNotice(`Revoked Organiser from ${row.name}.`)
      }
      const { value } = await api.findPeople({
        email: email.trim() || undefined,
        name: name.trim() || undefined,
      })
      setRows(value)
    } catch (e: unknown) {
      setError(messageOf(e))
    } finally {
      setBusy(null)
    }
  }

  if (allowed === null) {
    return (
      <main>
        <p>Loading…</p>
      </main>
    )
  }

  if (!allowed) {
    return (
      <main>
        <section className="panel">
          <h2 className="panel-title">People</h2>
          {error ? (
            <p className="error-bar">{error}</p>
          ) : (
            <p>Only organisers can manage people — ask an organiser to grant you access.</p>
          )}
        </section>
      </main>
    )
  }

  return (
    <main>
      <section className="panel">
        <h2 className="panel-title">People</h2>
        <p>Find testers by email or name, then grant them Organiser so they can score.</p>
        <div className="people-search">
          <label>
            Email{' '}
            <input
              type="search"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tester@example.org"
            />
          </label>
          <label>
            Name{' '}
            <input
              type="search"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tester"
            />
          </label>
          <button type="button" onClick={search}>
            Search
          </button>
        </div>
        {error && <p className="error-bar">{error}</p>}
        {notice && <p className="warning-bar">{notice}</p>}
        {rows !== null && (
          <table className="people-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Roles</th>
                <th>Organiser</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isOrg = holdsRole(row.roles, 'Organiser')
                const pending = busy === row.id.value
                return (
                  <tr key={row.id.value}>
                    <td>{row.name}</td>
                    <td>{row.email}</td>
                    <td>{row.roles.map((r) => personRoleLabel(r)).join(', ') || '—'}</td>
                    <td>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => changeRole(row, !isOrg)}
                      >
                        {pending ? '…' : isOrg ? 'Revoke' : 'Grant'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>
    </main>
  )
}
