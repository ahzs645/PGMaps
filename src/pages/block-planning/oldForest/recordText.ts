/**
 * The sentences the panel and the printed summary share about what an old forest record left out
 * and which corridors it read, so both say the same thing. DOM- and network-free.
 */
import type { OldForestRecord } from '../records'
import { EXCLUDED_LABELS } from './landBase'
import { CORRIDOR_LABELS } from './reads'

const ha = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 0 })

/** What left the unit because the order does not apply there, by kind. */
export function excludedSentence(record: Pick<OldForestRecord, 'excluded'>): string {
  if (record.excluded === undefined)
    return 'Private land and excluded tenures were not read for this record: its CFLB includes them.'
  const shown = record.excluded.filter((e) => e.grossHa >= 0.5)
  if (!shown.length)
    return 'No private or other non-Crown land, woodlot, community forest or TFL lies in the unit. First Nations woodland licences are kept: the order does not name them.'
  const parts = shown.map(
    (e) => `${EXCLUDED_LABELS[e.kind]} ${ha.format(e.grossHa)} ha (${ha.format(e.cflbHa)} ha of it on the proxy CFLB)`,
  )
  const cflb = shown.reduce((s, e) => s + e.cflbHa, 0)
  return `Left out because the order does not apply there: ${parts.join('; ')}; ${ha.format(cflb)} ha left the CFLB in all. Old forest there shapes interior but is never counted. First Nations woodland licences are kept: the order does not name them.`
}

/** The corridor features read, by kind. */
export function corridorSentence(record: Pick<OldForestRecord, 'counts' | 'corridorKinds'>): string {
  const kinds = record.corridorKinds
  if (!kinds) return `${record.counts.corridors} corridor features (pipelines not read).`
  const listed = (Object.keys(CORRIDOR_LABELS) as (keyof typeof CORRIDOR_LABELS)[])
    .map((k) => `${CORRIDOR_LABELS[k].toLowerCase()} ${kinds[k] ?? 0}`)
    .join(', ')
  return `${record.counts.corridors} corridor features (${listed}).`
}
