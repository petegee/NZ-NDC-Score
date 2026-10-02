export interface AuthConfig {
  domain: string
  clientId: string
  audience: string
}

export interface AuthEnv {
  domain?: string
  clientId?: string
  audience?: string
}

// All three unset → null: the app runs anonymously against a Soarscore API in
// Auth:Mode=none (local dev). A partial set is a config typo, thrown at
// startup rather than discovered as a 401 on Calculate.
export function authConfigFromEnv(env: AuthEnv): AuthConfig | null {
  const domain = env.domain?.trim() ?? ''
  const clientId = env.clientId?.trim() ?? ''
  const audience = env.audience?.trim() ?? ''
  if (!domain && !clientId && !audience) return null

  const missing = [
    !domain && 'VITE_AUTH0_DOMAIN',
    !clientId && 'VITE_AUTH0_CLIENT_ID',
    !audience && 'VITE_AUTH0_AUDIENCE',
  ].filter(Boolean)
  if (missing.length > 0) {
    throw new Error(
      `${missing.join(', ')} not set. Sign-in needs all three of VITE_AUTH0_DOMAIN, ` +
        'VITE_AUTH0_CLIENT_ID and VITE_AUTH0_AUDIENCE — or none of them to run ' +
        'anonymously against an API in Auth:Mode=none.',
    )
  }
  return { domain, clientId, audience }
}
