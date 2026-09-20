import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { apiBaseFromEnv } from './api/config'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

let base: string
try {
  base = apiBaseFromEnv(import.meta.env.VITE_API_BASE)
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
    <App base={base} />
  </StrictMode>,
)
