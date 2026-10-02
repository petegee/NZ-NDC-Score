import { useEffect, useMemo, useState } from 'react'
import { createApi } from '../api/client'
import { holdsRole, personRoleLabel, type PersonSummary } from '../api/types'
import { ApiError, type FetchLike } from '../api/wire'

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
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
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

  const search = async (overrides?: { email?: string; name?: string }) => {
    setError(null)
    setNotice(null)
    try {
      const { value } = await api.findPeople({
        email: overrides?.email ?? email.trim() ?? undefined,
        name: overrides?.name ?? name.trim() ?? undefined,
      })
      setRows(value)
      if (value.length === 0) setNotice('No people match that search.')
    } catch (e: unknown) {
      setError(messageOf(e))
    }
  }

  // Pre-register a tester who has never signed in: when they later sign in
  // with the same email, sign-in links to this person (D5 email match), and
  // the Grant button below then works. A duplicate email (409) just means
  // they are already registered — show them for granting.
  const addPerson = async () => {
    const personName = newName.trim()
    const personEmail = newEmail.trim()
    if (!personName || !personEmail) {
      setError('Name and email are both required to add someone.')
      return
    }
    setError(null)
    setNotice(null)
    setBusy('add')
    try {
      await api.registerPerson({ name: personName, contact: { email: personEmail }, club: null })
      setNewName('')
      setNewEmail('')
      setEmail(personEmail)
      setName('')
      await search({ email: personEmail })
      setNotice(`Registered ${personName}.`)
    } catch (e: unknown) {
      if (e instanceof ApiError && e.code === 'eventStore.uniqueConstraintViolation') {
        setEmail(personEmail)
        setName('')
        await search({ email: personEmail })
        setNotice(`${personEmail} is already registered — grant them below.`)
      } else {
        setError(messageOf(e))
      }
    } finally {
      setBusy(null)
    }
  }

  const changeRole = async (row: PersonSummary, grant: boolean) => {
    setError(null)
    setNotice(null)
    setBusy(row.id.value)
    try {
      if (grant) {
        await api.grantRole(row.id.value, 'Organiser')
      } else {
        await api.revokeRole(row.id.value, 'Organiser')
      }
      const { value } = await api.findPeople({
        email: email.trim() || undefined,
        name: name.trim() || undefined,
      })
      setRows(value)
      setNotice(grant ? `Granted Organiser to ${row.name}.` : `Revoked Organiser from ${row.name}.`)
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
        <p>Pre-register a tester, or find them by email or name and grant Organiser so they can score.</p>
        <div className="people-search">
          <label>
            New name{' '}
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Full name"
            />
          </label>
          <label>
            New email{' '}
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="new.tester@example.org"
            />
          </label>
          <button type="button" disabled={busy === 'add'} onClick={addPerson}>
            {busy === 'add' ? '…' : 'Add person'}
          </button>
        </div>
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
          <button type="button" onClick={() => search()}>
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
