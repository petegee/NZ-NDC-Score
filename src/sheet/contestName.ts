import type { ClassDefinition } from '../api/types'

/** The contest identity Soarscore sees, fabricated from the sheet header —
 * the organiser never types a name (bug #4: the mandatory, must-be-unique
 * contest name). The same header always fabricates the same name, so a
 * re-calc finds the same competition; a second same-day event at the same
 * venue and class collides loudly, surfaced as Soarscore's duplicate.
 *
 * Format: `<ISO date> <location> <class label>` — e.g.
 * `2026-09-25 Matamata F5J`. The class label is the definition's FAI
 * designation when it declares one, else its own name — definition data,
 * never a client-side class branch (law 3). Blank parts drop out. */
export function fabricateContestName(input: {
  location: string
  date: string
  classDefinition: ClassDefinition
}): string {
  const parts = [
    input.date.trim(),
    input.location.trim(),
    classLabel(input.classDefinition),
  ]
  return parts.filter((part) => part !== '').join(' ')
}

function classLabel(definition: ClassDefinition): string {
  return definition.faiDesignation?.trim() || definition.name.trim()
}
