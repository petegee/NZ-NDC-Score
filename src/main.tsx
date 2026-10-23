import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Auth0Provider } from '@auth0/auth0-react'
import App from './App'
import './index.css'
import { apiBaseFromEnv } from './api/config'
import { authConfigFromEnv, type AuthConfig } from './auth/config'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

let base: string
let auth: AuthConfig | null
let mockAuth: boolean
try {
  base = apiBaseFromEnv(import.meta.env.VITE_API_BASE)
  mockAuth = import.meta.env.VITE_AUTH_MODE?.trim() === 'mock'
  if (mockAuth && !import.meta.env.DEV) {
    throw new Error('VITE_AUTH_MODE=mock works only in development. A production build signs in through Auth0.')
  }
  auth = authConfigFromEnv({
    domain: import.meta.env.VITE_AUTH0_DOMAIN,
    clientId: import.meta.env.VITE_AUTH0_CLIENT_ID,
    audience: import.meta.env.VITE_AUTH0_AUDIENCE,
  })
} catch (error) {
  // Fail fast but visibly — a blank page hides the problem.
  const main = document.createElement('main')
  const heading = document.createElement('h1')
  heading.textContent = 'NdcScore — configuration error'
  const detail = document.createElement('pre')
  detail.className = 'config-error'
  detail.textContent = (error as Error).message
  main.append(heading, detail)
  root.replaceChildren(main)
  throw error
}

createRoot(root).render(
  <StrictMode>
    {auth ? (
      <Auth0Provider
        domain={auth.domain}
        clientId={auth.clientId}
        authorizationParams={{
          redirect_uri: window.location.origin,
          audience: auth.audience,
          scope: 'openid profile email offline_access',
        }}
        // Refresh-token rotation, persisted so a reload mid-evening keeps the
        // organiser signed in (iframe silent auth is blocked by third-party
        // cookie rules on the default Auth0 domain).
        useRefreshTokens
        cacheLocation="localstorage"
      >
        <App base={base} auth mockAuth={mockAuth} />
      </Auth0Provider>
    ) : (
      <App base={base} auth={false} mockAuth={mockAuth} />
    )}
  </StrictMode>,
)
