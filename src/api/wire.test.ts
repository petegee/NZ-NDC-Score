import { describe, expect, it } from 'vitest'
import { ApiError, buildQuery, request } from './wire'

const base = 'http://api.test'

function fetchJson(status: number, body: unknown) {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch
}

describe('buildQuery', () => {
  it('skips undefined, null and empty-string params', () => {
    expect(buildQuery({ a: 'x', b: undefined, c: null, d: '', e: 1, f: true })).toBe(
      '?a=x&e=1&f=true',
    )
  })
})

describe('request envelope unwrap', () => {
  it('returns a bare value with no warnings', async () => {
    const res = await request<string[]>(fetchJson(200, ['a', 'b']), base, 'GET', '/things')
    expect(res).toEqual({ value: ['a', 'b'], warnings: [] })
  })

  it('unwraps the {value, warnings} envelope', async () => {
    const res = await request(
      fetchJson(200, { value: 7, warnings: [{ code: 'draw.groupBelowMinimum', message: 'small group' }] }),
      base,
      'POST',
      '/draw-phase',
    )
    expect(res.value).toBe(7)
    expect(res.warnings).toEqual([{ code: 'draw.groupBelowMinimum', message: 'small group' }])
  })

  it('treats a typed-id body ({"value": "guid"}) as a bare value, not an envelope', async () => {
    const res = await request(fetchJson(200, { value: '018f-guid' }), base, 'POST', '/register-person')
    expect(res).toEqual({ value: { value: '018f-guid' }, warnings: [] })
  })

  it('drops malformed warnings instead of trusting them', async () => {
    const res = await request(
      fetchJson(200, { value: 1, warnings: [{ nope: true }, { code: 'c', message: 'm' }] }),
      base,
      'GET',
      '/x',
    )
    expect(res.warnings).toEqual([{ code: 'c', message: 'm' }])
  })
})

describe('request ProblemDetails mapping', () => {
  it.each([
    [400, 'captureMeasurement.valueInvalid'],
    [404, 'person.notFound'],
    [409, 'eventStore.uniqueConstraintViolation'],
  ])('maps %i to an ApiError with the stable code from title', async (status, title) => {
    const err = await request(fetchJson(status, {
      title,
      detail: 'human message',
      defects: [{ code: 'd1', path: 'value.number', message: 'bad' }],
    }), base, 'POST', '/capture-measurement').catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApiError)
    const apiErr = err as ApiError
    expect(apiErr.status).toBe(status)
    expect(apiErr.code).toBe(title)
    expect(apiErr.detail).toBe('human message')
    expect(apiErr.defects).toEqual([{ code: 'd1', path: 'value.number', message: 'bad' }])
  })

  it('falls back to http.<status> when the body is not ProblemDetails', async () => {
    const err = await request(
      fetchJson(502, { not: 'a problem' }),
      base,
      'GET',
      '/x',
    ).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).code).toBe('http.502')
  })

  it('tolerates a missing defects array', async () => {
    const err = await request(fetchJson(400, { title: 'x.y', detail: 'z' }), base, 'GET', '/x').catch(
      (e: unknown) => e,
    )
    expect((err as ApiError).defects).toEqual([])
  })
})
