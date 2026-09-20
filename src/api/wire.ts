export interface ApiWarning {
  code: string
  message: string
}

export interface ApiDefect {
  code: string
  path?: string
  message: string
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly detail: string | undefined
  readonly defects: ApiDefect[]

  constructor(status: number, code: string, detail: string | undefined, defects: ApiDefect[]) {
    super(detail ?? code)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.detail = detail
    this.defects = defects
  }
}

export interface ApiResult<T> {
  value: T
  warnings: ApiWarning[]
}

export type FetchLike = typeof fetch

export type QueryParams = Record<string, string | number | boolean | undefined | null>

export function buildQuery(params: QueryParams): string {
  const search = new URLSearchParams()
  for (const [name, raw] of Object.entries(params)) {
    if (raw === undefined || raw === null || raw === '') continue
    search.set(name, String(raw))
  }
  const encoded = search.toString()
  return encoded ? `?${encoded}` : ''
}

export function apiBaseFromEnv(raw: string | undefined): string {
  const trimmed = raw?.trim()
  if (!trimmed) {
    throw new Error(
      'VITE_API_BASE is not set. Copy .env.example to .env and point it at the ' +
        'running Soarscore API (e.g. VITE_API_BASE=http://localhost:5000), then restart the dev server.',
    )
  }
  return trimmed.replace(/\/+$/, '')
}

type UnknownRecord = Record<string, unknown>

function isPlainObject(body: unknown): body is UnknownRecord {
  return body !== null && typeof body === 'object' && !Array.isArray(body)
}

function isEnvelope(body: unknown): body is { value: unknown; warnings: unknown } {
  if (!isPlainObject(body)) return false
  const keys = Object.keys(body)
  return keys.length === 2 && 'value' in body && 'warnings' in body
}

function asWarnings(raw: unknown): ApiWarning[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((w) => {
    if (!isPlainObject(w) || typeof w.code !== 'string' || typeof w.message !== 'string') return []
    return [{ code: w.code, message: w.message }]
  })
}

function asDefects(raw: unknown): ApiDefect[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((d) => {
    if (!isPlainObject(d) || typeof d.code !== 'string' || typeof d.message !== 'string') return []
    return [
      {
        code: d.code,
        path: typeof d.path === 'string' ? d.path : undefined,
        message: d.message,
      },
    ]
  })
}

async function throwProblem(res: Response): Promise<never> {
  let text: string | undefined
  let body: unknown = null
  try {
    text = await res.text()
    body = JSON.parse(text) as unknown
  } catch {
    text ??= res.statusText
  }
  if (isPlainObject(body) && typeof body.title === 'string') {
    throw new ApiError(
      res.status,
      body.title,
      typeof body.detail === 'string' ? body.detail : undefined,
      asDefects(body.defects),
    )
  }
  throw new ApiError(res.status, `http.${res.status}`, text ?? res.statusText, [])
}

export async function request<T>(
  fetchImpl: FetchLike,
  base: string,
  method: 'GET' | 'POST',
  path: string,
  opts: { query?: QueryParams; body?: unknown } = {},
): Promise<ApiResult<T>> {
  const url = `${base}${path}${buildQuery(opts.query ?? {})}`
  // Single attachment point for a future bearer header: add
  // headers.set('Authorization', `Bearer ${token}`) here when sign-in lands.
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetchImpl(url, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  if (!res.ok) await throwProblem(res)
  const body = (await res.json()) as unknown
  if (isEnvelope(body)) {
    return { value: body.value as T, warnings: asWarnings(body.warnings) }
  }
  return { value: body as T, warnings: [] }
}
