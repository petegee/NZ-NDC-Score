import type { CompetitionEventLog, EventLogEvent, MeasuredValue } from '../api/types'
import { cellKey, entryProgress, type CaptureState, type EntryProgress, type TaskRoundRef } from './capture'

type Payload = Record<string, unknown>

function isPayload(e: EventLogEvent): e is EventLogEvent & { payload: Payload } {
  return e.payload !== null && typeof e.payload === 'object'
}

function idValue(v: unknown): string | undefined {
  if (v && typeof v === 'object' && 'value' in v) {
    const guid = (v as { value?: unknown }).value
    if (typeof guid === 'string') return guid
  }
  return undefined
}

function measuredValue(v: unknown): MeasuredValue | undefined {
  if (!v || typeof v !== 'object') return undefined
  const kind = (v as { kind?: unknown }).kind
  if (kind === 'Number') return { kind: 'Number', number: (v as { number?: unknown }).number as number | undefined }
  if (kind === 'Flag') return { kind: 'Flag', flag: (v as { flag?: unknown }).flag as boolean | undefined }
  return undefined
}

export interface RebuildOptions {
  /** Limit to one group when set. */
  groupRef?: string
}

/** Rebuild committed capture state from the competition's event log — the
 * only client-side source of committed cell values (there is no per-entry
 * measurement query). Uncommitted text and the live queue are restored
 * separately; they never come from the log. */
export function rebuildFromEventLog(
  log: CompetitionEventLog,
  coordinate: TaskRoundRef,
  options: RebuildOptions = {},
): Pick<CaptureState, 'entries' | 'cells'> {
  const entries: CaptureState['entries'] = {}
  const cells: CaptureState['cells'] = {}

  const matches = (payload: Payload): boolean =>
    idValue(payload.competitionRef) === log.id.value &&
    payload.phaseOrdinal === coordinate.phaseOrdinal &&
    payload.roundOrdinal === coordinate.roundOrdinal &&
    payload.taskRoundOrdinal === coordinate.taskRoundOrdinal &&
    (options.groupRef === undefined || idValue(payload.groupRef) === options.groupRef)

  for (const stream of log.streams) {
    if (stream.kind !== 'entry') continue
    let opened = false
    let competitorId: string | undefined
    for (const event of stream.events) {
      if (!isPayload(event) || !event.payload) continue
      const p = event.payload
      const kind = event.name
      if (kind === 'entryOpened') {
        if (!matches(p)) break
        competitorId = idValue(p.competitorRef)
        if (!competitorId) break
        opened = true
        const progress = entries[competitorId] ?? entryProgress()
        entries[competitorId] = {
          ...progress,
          entryId: idValue(p.id) ?? stream.streamId,
          role: (p.role as EntryProgress['role']) ?? 'Original',
        }
        continue
      }
      if (!opened || !competitorId) continue
      switch (kind) {
        case 'flightOpened': {
          const seq = p.sequence
          if (typeof seq === 'number') {
            const progress = entries[competitorId] ?? entryProgress()
            entries[competitorId] = {
              ...progress,
              openedFlights: { ...progress.openedFlights, [seq]: true },
            }
          }
          break
        }
        case 'measurementCaptured': {
          const seq = p.flightSequence
          const m = p.measurement as Payload | undefined
          const metric = typeof m?.metric === 'string' ? m.metric : undefined
          const value = measuredValue(m?.value)
          if (typeof seq === 'number' && metric && value) {
            cells[cellKey(competitorId, seq, metric)] = {
              text: '',
              status: 'committed',
              value,
              amended: Array.isArray(m?.amendments) && m.amendments.length > 0 ? true : undefined,
            }
          }
          break
        }
        case 'measurementAmended': {
          const seq = p.flightSequence
          const metric = typeof p.metric === 'string' ? p.metric : undefined
          const a = p.amendment as Payload | undefined
          const value = measuredValue(a?.newValue)
          if (typeof seq === 'number' && metric && value) {
            cells[cellKey(competitorId, seq, metric)] = {
              text: '',
              status: 'committed',
              value,
              amended: true,
            }
          }
          break
        }
        case 'entryAnnulled': {
          const progress = entries[competitorId] ?? entryProgress()
          entries[competitorId] = { ...progress, annulled: true }
          break
        }
        case 'penaltyRecorded': {
          const penalty = p.penalty as Payload | undefined
          const infractionType =
            penalty && typeof penalty.infractionType === 'string' ? penalty.infractionType : undefined
          if (penalty && infractionType) {
            const progress = entries[competitorId] ?? entryProgress()
            entries[competitorId] = {
              ...progress,
              penalties: [...progress.penalties, { infractionType, by: (penalty.by as string | undefined) }],
            }
          }
          break
        }
      }
    }
  }

  return { entries, cells }
}
