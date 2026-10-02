import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PeoplePage } from './PeoplePage'
import type { FetchLike } from '../api/wire'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

interface PersonRow {
  id: { value: string }
  name: string
  email: string
  roles: (string | number)[]
}

/** Stub fetch routing on path, recording every call for body assertions. */
function stubFetch(whoAmIroles: (string | number)[], people: PersonRow[]) {
  const calls: { url: string; body: unknown }[] = []
  const impl: FetchLike = (async (input, init) => {
    const url = String(input)
    const rawBody = init?.body
    const body = typeof rawBody === 'string' ? (JSON.parse(rawBody) as unknown) : undefined
    calls.push({ url, body })
    if (url.endsWith('/who-am-i')) {
      return jsonResponse({
        isAuthenticated: true,
        personId: { value: '11111111-1111-4111-8111-111111111111' },
        roles: whoAmIroles,
        name: 'Pete',
      })
    }
    if (url.includes('/people')) return jsonResponse(people)
    if (url.endsWith('/grant-role') || url.endsWith('/revoke-role')) {
      return jsonResponse({ value: '22222222-2222-4222-8222-222222222222' })
    }
    throw new Error(`unexpected call ${url}`)
  }) as FetchLike
  return { calls, impl }
}

const tama: PersonRow = {
  id: { value: '33333333-3333-4333-8333-333333333333' },
  name: 'Tama',
  email: 'tama@example.org',
  roles: [],
}

describe('PeoplePage', () => {
  it('grants Organiser with the numeric wire role and a nested person id', async () => {
    const { calls, impl } = stubFetch([1], [tama])
    render(<PeoplePage base="https://api.example" fetchImpl={impl} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Search' }))
    fireEvent.change(screen.getByPlaceholderText('tester@example.org'), {
      target: { value: 'tama@example.org' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    const grant = await screen.findByRole('button', { name: 'Grant' })
    fireEvent.click(grant)

    await waitFor(() => {
      expect(screen.getByText(/Granted Organiser to Tama/)).toBeDefined()
    })
    const post = calls.find((c) => c.url.endsWith('/grant-role'))
    expect(post?.body).toEqual({
      personRef: { value: '33333333-3333-4333-8333-333333333333' },
      role: 1,
    })
  })

  it('revokes Organiser from someone who holds it', async () => {
    const { impl } = stubFetch([1], [{ ...tama, roles: [1] }])
    render(<PeoplePage base="https://api.example" fetchImpl={impl} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Search' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }))

    await waitFor(() => {
      expect(screen.getByText(/Revoked Organiser from Tama/)).toBeDefined()
    })
  })

  it('shows the ask-an-organiser note instead of the list without the role', async () => {
    const { impl } = stubFetch([], [])
    render(<PeoplePage base="https://api.example" fetchImpl={impl} />)

    expect(await screen.findByText(/Only organisers can manage people/)).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Search' })).toBeNull()
  })

  it('accepts the string role shape too', async () => {
    const { impl } = stubFetch(['Organiser'], [])
    render(<PeoplePage base="https://api.example" fetchImpl={impl} />)

    expect(await screen.findByRole('button', { name: 'Search' })).toBeDefined()
  })
})
