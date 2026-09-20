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
