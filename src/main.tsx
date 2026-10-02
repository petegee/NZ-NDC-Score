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
try {
  base = apiBaseFromEnv(import.meta.env.VITE_API_BASE)
  auth = authConfigFromEnv({
    domain: import.meta.env.VITE_AUTH0_DOMAIN,
    clientId: import.meta.env.VITE_AUTH0_CLIENT_ID,
    audience: import.meta.env.VITE_AUTH0_AUDIENCE,
  })
} catch (error) {
  // Fail fast but visibly — a blank page hides the problem.
  root.innerHTML = `
    <main>
      <h1>NdcScore — configuration error</h1>
      <pre style="white-space: pre-wrap; background: #fdecea; border: 1px solid #b3261e; padding: 0.75rem;">${
        (error as Error).message
      }</pre>
    </main>`
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
        <App base={base} auth />
      </Auth0Provider>
    ) : (
      <App base={base} auth={false} />
    )}
  </StrictMode>,
)
