import type { Api } from '../api/client'
import type { CompetitionScore } from '../api/types'

/** The fetch layer for score read-back. Scores, totals, ranks and
 * normalisation come only from the service; nothing here computes, rounds
 * or transforms a value (CLAUDE.md law 2). Rendering is verbatim. */

export async function fetchStandings(api: Api, competitionId: string): Promise<CompetitionScore> {
  const res = await api.scoreCompetition(competitionId)
  return res.value
}
