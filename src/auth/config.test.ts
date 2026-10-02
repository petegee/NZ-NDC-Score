import { describe, expect, it } from 'vitest'
import { authConfigFromEnv } from './config'

describe('authConfigFromEnv', () => {
  it('is null when nothing is set (anonymous API)', () => {
    expect(authConfigFromEnv({})).toBeNull()
    expect(authConfigFromEnv({ domain: ' ', clientId: '', audience: undefined })).toBeNull()
  })

  it('returns the trimmed config when all three are set', () => {
    expect(authConfigFromEnv({ domain: ' t.auth0.com ', clientId: 'abc', audience: 'api' })).toEqual({
      domain: 't.auth0.com',
      clientId: 'abc',
      audience: 'api',
    })
  })

  it('throws naming what is missing from a partial set', () => {
    expect(() => authConfigFromEnv({ domain: 't.auth0.com' })).toThrow(
      /VITE_AUTH0_CLIENT_ID, VITE_AUTH0_AUDIENCE not set/,
    )
  })
})
