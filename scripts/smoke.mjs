// Dev smoke: proves base URL + envelope + CORS against a running Soarscore API.
// Usage: npm run smoke [base]   (default from VITE_API_BASE, then localhost:5199)
const base = (process.argv[2] ?? process.env.VITE_API_BASE ?? 'http://localhost:5000').replace(/\/+$/, '')

const origin = 'http://localhost:5173'
const res = await fetch(`${base}/class-definitions`, { headers: { Origin: origin } })
if (!res.ok) {
  console.error(`GET /class-definitions -> ${res.status} ${res.statusText}`)
  process.exit(1)
}

const cors = res.headers.get('access-control-allow-origin')
console.log(`CORS: ${cors ? `allow-origin ${cors}` : 'no allow-origin header (check SOARSCORE_CORS_ORIGINS)'}`)

const body = await res.json()
const classes = Array.isArray(body) ? body : body.value
console.log(`Seeded classes (${classes.length}):`)
for (const c of classes) {
  console.log(`  ${c.contentHash.slice(0, 12)}  ${c.name}  [${c.version}]${c.retiredAt ? ' (retired)' : ''}`)
}

for (const param of ['activeOnly=true', 'ActiveOnly=true']) {
  const probe = await fetch(`${base}/class-definitions?${param}`, { headers: { Origin: origin } })
  console.log(`GET /class-definitions?${param} -> ${probe.status}`)
}
