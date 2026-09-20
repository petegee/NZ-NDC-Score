import { describe, expect, it } from 'vitest'
import { createApi } from '../api/client'
import { ApiError } from '../api/wire'

declare const process: { env: Record<string, string | undefined> }

const BASE = process.env.LIVE_API_BASE ?? 'http://localhost:5000'
const LIVE = process.env.LIVE_API === '1'
const d = describe.skipIf(!LIVE)

const stamp = Date.now()
const email = (n: string) => `${stamp}-${n.toLowerCase().replace(/[^a-z0-9]/g, '')}@mfnz.invalid`

async function registerPilot(api: ReturnType<typeof createApi>, name: string, clubNo: string) {
  const person = await api.registerPerson({
    name,
    contact: { email: email(name) },
    club: { clubName: 'Test Club', membershipNumber: clubNo },
  })
  return person.value
}

/** Competitor registrations append to the competition stream — concurrent
 * commands to one stream conflict, so they run strictly one at a time. */
async function registerCompetitors(api: ReturnType<typeof createApi>, compId: string, personIds: string[]) {
  const competitorIds: string[] = []
  for (const personId of personIds) {
    const r = await api.registerCompetitor(compId, personId)
    competitorIds.push(r.value)
  }
  return competitorIds
}

d('WI-2 scripted setup flow against a live API', () => {
  it('ALES 200 (NDC): create, bind minNewGroup, draw 4 rounds, fold shows schedule+groups', async () => {
    const api = createApi(BASE)
    const classes = await api.findClassDefinitions({ activeOnly: true })
    const ales = classes.value.find((c) => c.name.includes('ALES 200') && c.name.includes('NDC'))
    expect(ales).toBeDefined()

    const comp = await api.createCompetition({
      name: `WI2 ALES smoke ${stamp}`,
      location: 'Test Field',
      startDate: '2026-09-17',
      endDate: '2026-09-17',
      classContentHash: ales!.contentHash,
    })
    const compId = comp.value
    expect(compId).toMatch(/^[0-9a-f-]{36}$/)

    const bound = await api.bindParameter({
      competitionRef: compId,
      parameterName: 'minNewGroup',
      value: { kind: 'Number', number: 5 },
      by: 'CI Smoke CD',
    })
    expect(bound.value).toBe(compId)

    const personIds = await Promise.all(
      ['Alice A', 'Bob B', 'Carol C'].map((n, i) => registerPilot(api, n, String(100 + i))),
    )
    const competitorIds = await registerCompetitors(api, compId, personIds)
    expect(competitorIds).toHaveLength(3)

    await api.drawPhase(compId, 4)
    const fold = await api.getCompetition(compId)
    const phases = fold.value.competition.phases
    expect(phases).toHaveLength(1)
    expect(phases[0].ordinal).toBe(0)
    expect(phases[0].rounds).toHaveLength(4)
    for (const round of phases[0].rounds) {
      expect(round.taskRounds).toHaveLength(1)
      expect(round.taskRounds[0].taskRef).toBe('D')
      for (const group of round.taskRounds[0].groups) {
        expect(group.competitorRefs).toHaveLength(3)
      }
    }
    const bindings = fold.value.competition.parameterBindings
    expect(bindings.some((b) => b.parameterName === 'minNewGroup')).toBe(true)
  }, 30000)

  it('F3K NDC: catalogue draw with per-round task choices', async () => {
    const api = createApi(BASE)
    const classes = await api.findClassDefinitions({ activeOnly: true })
    const f3k = classes.value.find((c) => c.name.includes('Hand-Launch') && c.name.includes('NDC'))
    expect(f3k).toBeDefined()

    const comp = await api.createCompetition({
      name: `WI2 F3K smoke ${stamp}`,
      location: 'Test Field',
      startDate: '2026-09-17',
      endDate: '2026-09-17',
      classContentHash: f3k!.contentHash,
    })
    const compId = comp.value

    const personIds = await Promise.all(
      ['Dave D', 'Eve E', 'Frank F', 'Gina G', 'Hal H'].map((n, i) => registerPilot(api, n, String(200 + i))),
    )
    await registerCompetitors(api, compId, personIds)

    await api.drawPhase(compId, 4, ['B', 'D', 'G', 'H'])
    const fold = await api.getCompetition(compId)
    const rounds = fold.value.competition.phases[0].rounds
    expect(rounds).toHaveLength(4)
    expect(rounds.map((r) => r.taskRounds[0].taskRef)).toEqual(['B', 'D', 'G', 'H'])
    for (const round of rounds) {
      for (const group of round.taskRounds[0].groups) {
        expect(group.competitorRefs).toHaveLength(5)
      }
    }
  }, 30000)

  it('WI-3: known + unknown pilots, duplicate adoption, email search', async () => {
    const api = createApi(BASE)
    const comp = await api.createCompetition({
      name: `WI3 pilots smoke ${stamp}`,
      location: 'Test Field',
      startDate: '2026-09-17',
      endDate: '2026-09-17',
      classContentHash: (await api.findClassDefinitions({ activeOnly: true })).value[0].contentHash,
    })
    const compId = comp.value

    const placeholderEmail = `unknown-wi3-${stamp}@mfnz.invalid`
    const miss = await api.findPeople({ email: placeholderEmail })
    expect(miss.value).toHaveLength(0)

    const unknown = await api.registerPerson({
      name: 'Nora New',
      contact: { email: placeholderEmail },
      club: { clubName: 'Test Club', membershipNumber: 'MFNZ-9' },
    })
    const personId = unknown.value
    expect(personId).toMatch(/^[0-9a-f-]{36}$/)

    const foundByEmail = await api.findPeople({ email: placeholderEmail })
    expect(foundByEmail.value).toHaveLength(1)
    expect(foundByEmail.value[0].name).toBe('Nora New')

    const competitor = await api.registerCompetitor(compId, personId)
    expect(competitor.value).toMatch(/^[0-9a-f-]{36}$/)

    const dupCompetitor = await api.registerCompetitor(compId, personId).catch((e: unknown) => e)
    expect(dupCompetitor).toBeInstanceOf(ApiError)
    expect((dupCompetitor as ApiError).code).toBe('competition.competitor.alreadyRegistered')

    const dupEmail = await api
      .registerPerson({
        name: 'Nora Again',
        contact: { email: placeholderEmail },
        club: null,
      })
      .catch((e: unknown) => e)
    expect(dupEmail).toBeInstanceOf(ApiError)
    expect((dupEmail as ApiError).code).toBe('eventStore.uniqueConstraintViolation')

    const noCriteria = await api.findPeople({}).catch((e: unknown) => e)
    expect(noCriteria).toBeInstanceOf(ApiError)
    expect((noCriteria as ApiError).code).toBe('findPeople.noCriteria')

    const person = await api.getPerson(personId)
    expect(person.value.name).toBe('Nora New')
    expect(person.value.club?.membershipNumber).toBe('MFNZ-9')

    const fold = await api.getCompetition(compId)
    expect(fold.value.competition.competitors).toHaveLength(1)
    expect(fold.value.competition.competitors[0].competitorNumber).toBe(1)
  }, 30000)
})
