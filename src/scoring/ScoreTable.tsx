import type { ApiError } from '../api/wire'
import type { CompetitionScore, GroupScore } from '../api/types'

/** Verbatim value rendering — String(value), no arithmetic, no formatting.
 * The number the server sent is the number the screen shows. */
export function Verbatim({ value }: { value: number | string }) {
  return <>{String(value)}</>
}

export function ScoreTable({ scores, names }: { scores: GroupScore[]; names?: Map<string, string> }) {
  if (scores.length === 0) {
    return <p className="hint">No scores yet — groups with no flown entries are absent, never zero.</p>
  }
  return (
    <table className="grid">
      <thead>
        <tr>
          <th>Pilot</th>
          <th>State</th>
          <th>Score</th>
          <th>Pre-normalisation</th>
          <th>Awaiting capture</th>
        </tr>
      </thead>
      <tbody>
        {scores.map((group) =>
          group.results.map((r) => {
            const differs = String(r.preNormalisationScore) !== String(r.rawScore)
            return (
              <tr key={`${group.groupRef.value}:${r.competitorRef.value}:${r.role}`}>
                <td>
                  {names?.get(r.competitorRef.value) ?? r.competitorRef.value}
                  {group.winnerRef?.value === r.competitorRef.value ? ' ★' : null}
                </td>
                <td>
                  {r.state === 'NoResult' ? 'no result' : 'valid'}
                  {group.isAnnulled ? ' · annulled' : null}
                </td>
                <td>
                  <Verbatim value={r.rawScore} />
                </td>
                <td>{differs ? <Verbatim value={r.preNormalisationScore} /> : <span className="hint">same</span>}</td>
                <td>
                  {r.awaitingCapture.map((a) => (
                    <em key={`${a.flightSequence}:${a.awaitedMetric}`} className="hint">
                      flight {a.flightSequence}: {a.awaitedMetric}{' '}
                    </em>
                  ))}
                </td>
              </tr>
            )
          }),
        )}
      </tbody>
    </table>
  )
}

export function Standings({ standings, names }: { standings: CompetitionScore; names?: Map<string, string> }) {
  const unplaced = Number.MAX_SAFE_INTEGER
  const rows = [...standings.scores].sort((a, b) => {
    const pa = a.placing ?? unplaced
    const pb = b.placing ?? unplaced
    if (pa < pb) return -1
    if (pa > pb) return 1
    return 0
  })
  return (
    <table className="grid">
      <thead>
        <tr>
          <th>Placing</th>
          <th>Pilot</th>
          <th>Score</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => (
          <tr key={s.competitorRef.value}>
            <td>{s.disqualified ? 'DQ' : s.placing ?? '—'}</td>
            <td>{names?.get(s.competitorRef.value) ?? s.competitorRef.value}</td>
            <td>
              <Verbatim value={s.score} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function ScoreError({ error }: { error: ApiError }) {
  return (
    <p role="alert">
      <code>{error.code}</code>: {error.detail ?? error.message}
    </p>
  )
}
