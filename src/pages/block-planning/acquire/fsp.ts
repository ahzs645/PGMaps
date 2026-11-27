/**
 * The forest stewardship plan a block's permit relied on, as far as public data names it, for the
 * review step's FSP panel. Every read is on the reviewer's click and kept for the session only.
 *
 * - **Units over the block**: the ground catalogue's `fsp-fdu` layer, read by the block's own
 *   parts through the ground screen's reader (`readGroundLayer`) with the catalogue's own
 *   instruments, or taken from a ground read already kept for the block.
 * - **Amendments**: the same layer and fields, asked by `FSP_ID` for every status (approved,
 *   previous, submitted), so each plan's amendment history shows as the layer holds it. The layer
 *   misses amendments: the first held is printed, a skipped number is flagged, and the amendment
 *   approved by a stated permit issue date is a candidate, never the answer.
 * - **Stocking standards**: the opening's `STANDARDS_REGIME_ID`s from RESULTS, to find in the
 *   plan's stocking standards, which names the plan; never its amendment.
 *
 * No holder's or plan's name is requested or kept: every record is cut to the catalogue's fields
 * on arrival (`keepFields`). DOM- and network-free: `fetch` is passed in.
 */
import { groundLayer, groundInstrument } from '@/lib/legal/groundInstruments'
import { readGroundLayer, valueText } from '@/lib/legal/groundLayerRead'
import { keepFields, wfsRead, type Fetch, type Shape } from '@/lib/forestry/wfsReads'
import { STANDARDS_UNIT_LAYER } from '../ground/precedent'
import type { GroundRead } from '../ground/record'

export const FSP_LAYER = 'fsp-fdu'
/** The catalogue's instruments read from the FDU layer: approved plans' units and those submitted. */
const FSP_INSTRUMENTS = ['fsp-forest-development-unit', 'fsp-forest-development-unit-submitted']
export const MAX_FSP_ROWS = 2000
export const STANDARDS_FIELDS = ['OPENING_ID', 'STANDARDS_UNIT_ID', 'STANDARDS_REGIME_ID', 'VARIANCE_IND'] as const

export interface FspUnit {
  fspId: string
  fduId?: string
  amendment?: string
  status?: string
}

export interface FspAmendment {
  number: number
  status: string
  approved?: string
  decided?: string
  starts?: string
  ends?: string
}

export interface FspHistory {
  fspId: string
  amendments: FspAmendment[]
  /** Numbers between the first and last held that the layer skips. */
  skipped: number[]
  /** The first amendment the layer holds, when it is not the original plan. */
  firstHeld?: number
  /** The latest amendment approved on or before the stated permit issue date, as the layer holds them. */
  atIssue?: FspAmendment
}

const date = (v: unknown) => {
  const t = valueText(v)
  return t ? t.replace(/Z$/, '').slice(0, 10) : undefined
}

/** The plans' units a ground read already holds for the block, one per plan and unit. */
export function unitsFromGroundRead(read: GroundRead | undefined): FspUnit[] | null {
  if (!read) return null
  const rows = read.instruments.filter((r) => FSP_INSTRUMENTS.includes(r.instrument) && r.status !== 'failed')
  if (rows.length < FSP_INSTRUMENTS.length) return null
  const out: FspUnit[] = []
  for (const r of rows)
    for (const f of r.features) {
      const get = (label: string) => f.identifiers.find((i) => i.label === label)?.value
      const fspId = get('FSP')
      if (!fspId) continue
      out.push({
        fspId,
        fduId: get('FDU'),
        amendment: get('Amendment'),
        status: r.instrument.endsWith('submitted') ? 'SUBMITTED' : 'APPROVED',
      })
    }
  return dedupe(out)
}

const dedupe = (units: FspUnit[]) => {
  const seen = new Set<string>()
  return units.filter((u) => {
    const key = `${u.fspId}|${u.fduId ?? ''}|${u.status ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Reads the plans' units over the footprint through the ground screen's reader. */
export async function readFspUnits({
  footprint,
  fetch,
  signal,
}: {
  footprint: Shape
  fetch: Fetch
  signal?: AbortSignal
}): Promise<{ units: FspUnit[]; truncated: boolean }> {
  const layer = groundLayer(FSP_LAYER)
  const instruments = FSP_INSTRUMENTS.map((id) => groundInstrument(id)).filter((x) => x !== undefined)
  if (!layer || instruments.length !== FSP_INSTRUMENTS.length) throw Error('The ground catalogue has no FSP layer.')
  const answer = await readGroundLayer({ layer, instruments, footprint, fetch, signal, cap: MAX_FSP_ROWS })
  const units = answer.rows.flatMap((row) => {
    const fspId = valueText(row.properties.FSP_ID)
    if (!fspId) return []
    return [
      {
        fspId,
        fduId: valueText(row.properties.FDU_ID) ?? undefined,
        amendment: valueText(row.properties.FSP_AMENDMENT_NUMBER) ?? undefined,
        status: valueText(row.properties.LIFE_CYCLE_STATUS_CODE) ?? undefined,
      },
    ]
  })
  return { units: dedupe(units), truncated: answer.status === 'truncated' }
}

/** Each plan's amendments as the layer's rows hold them; `permitIssued` picks the candidate in force then. */
export function fspHistory(fspId: string, rows: readonly Record<string, unknown>[], permitIssued?: string): FspHistory {
  const byNumber = new Map<number, FspAmendment>()
  for (const p of rows) {
    if (valueText(p.FSP_ID) !== fspId) continue
    const n = Number(valueText(p.FSP_AMENDMENT_NUMBER))
    if (!Number.isInteger(n) || n < 0) continue
    const status = valueText(p.LIFE_CYCLE_STATUS_CODE) ?? 'UNKNOWN'
    const previous = byNumber.get(n)
    // An amendment's rows can differ by unit; the approved row's dates win over another status's.
    if (previous && previous.status === 'APPROVED') continue
    byNumber.set(n, {
      number: n,
      status,
      approved: date(p.AMENDMENT_APPROVAL_DATE),
      decided: date(p.PLAN_DECISION_DATE),
      starts: date(p.PLAN_START_DATE),
      ends: date(p.PLAN_END_DATE),
    })
  }
  const amendments = [...byNumber.values()].sort((a, b) => a.number - b.number)
  const numbers = amendments.map((a) => a.number)
  const skipped: number[] = []
  for (let n = numbers[0]; n < numbers[numbers.length - 1]; n++) if (!numbers.includes(n)) skipped.push(n)
  const first = numbers[0]
  const atIssue = permitIssued
    ? amendments
        .filter(
          (a) => a.status !== 'SUBMITTED' && (a.approved ?? a.decided) && (a.approved ?? a.decided)! <= permitIssued,
        )
        .at(-1)
    : undefined
  return {
    fspId,
    amendments,
    skipped,
    ...(first !== undefined && first > 0 ? { firstHeld: first } : {}),
    ...(atIssue ? { atIssue } : {}),
  }
}

/** Reads every status of the plans' rows by id, cut to the catalogue's fields (no names). */
export async function readFspAmendments({
  fspIds,
  fetch,
  signal,
}: {
  fspIds: readonly string[]
  fetch: Fetch
  signal?: AbortSignal
}): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
  const layer = groundLayer(FSP_LAYER)
  if (!layer) throw Error('The ground catalogue has no FSP layer.')
  const ids = [...new Set(fspIds)].filter((id) => /^\d{1,7}$/.test(id))
  if (!ids.length) return { rows: [], truncated: false }
  const fields = layer.fields.filter((f) => !/^LICENCE|MORE_LICENCE/.test(f))
  const answer = await wfsRead({
    fetch,
    signal,
    layer: layer.typeName,
    filter: `FSP_ID IN (${ids.join(',')})`,
    propertyName: fields.join(','),
    sortBy: layer.key,
    cap: MAX_FSP_ROWS,
  })
  return { rows: answer.features.map((f) => keepFields(f.properties, fields)), truncated: answer.truncated }
}

export interface StandardsRegime {
  unit: string
  regime: string
  variance: boolean
}

/** The opening's standards units and their regime ids, from RESULTS, cut to those fields. */
export async function readStandardsRegimes({
  opening,
  fetch,
  signal,
}: {
  opening: string
  fetch: Fetch
  signal?: AbortSignal
}): Promise<StandardsRegime[]> {
  if (!/^\d{1,10}$/.test(opening)) throw Error('A RESULTS opening id is a number.')
  const answer = await wfsRead({
    fetch,
    signal,
    layer: STANDARDS_UNIT_LAYER,
    filter: `OPENING_ID = ${opening}`,
    propertyName: STANDARDS_FIELDS.join(','),
    sortBy: 'STANDARDS_UNIT_ID',
    cap: 200,
  })
  return answer.features.flatMap((f) => {
    const p = keepFields(f.properties, STANDARDS_FIELDS)
    const regime = valueText(p.STANDARDS_REGIME_ID)
    return regime
      ? [{ unit: valueText(p.STANDARDS_UNIT_ID) ?? '?', regime, variance: valueText(p.VARIANCE_IND) === 'Y' }]
      : []
  })
}
