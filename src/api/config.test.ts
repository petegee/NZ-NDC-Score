import { describe, expect, it } from 'vitest'
import { apiBaseFromEnv } from './config'

describe('apiBaseFromEnv', () => {
  it('throws a helpful error when unset', () => {
    expect(() => apiBaseFromEnv(undefined)).toThrow(/VITE_API_BASE/)
    expect(() => apiBaseFromEnv('   ')).toThrow(/VITE_API_BASE/)
  })

  it('trims trailing slashes', () => {
    expect(apiBaseFromEnv('http://localhost:5000/')).toBe('http://localhost:5000')
    expect(apiBaseFromEnv(' http://localhost:5000 ')).toBe('http://localhost:5000')
  })
})
