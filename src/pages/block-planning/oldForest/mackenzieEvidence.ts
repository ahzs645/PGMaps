/**
 * The Mackenzie calculation as evidence beside the Mackenzie pack's questions (`old-margin`,
 * `interior-margin`, `younger-share`): one line under each, in the fact's own unit, for the year
 * the block is harvested in the schedule under review. It never answers a question: the margins
 * stay the reviewer's, and a record out of date says so.
 *
 * DOM- and network-free.
 */
import { entryOf, periodYears, type Plan } from '../plan'
import { heldOld, type MackenzieRowYear } from './mackenzie'
import { mackenzieOldForestCurrent } from './mackenzieRecord'
import { mackenzieUnit, rowName } from './mackenzieUnits'

const points = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 1, signDisplay: 'exceptZero' })
const share = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 1 })

/** The period year the margins are read at: the block's harvest year in the schedule under review, else the first. */
export function evidenceYear(plan: Plan, blockId: string): { year: number; why: string } {
  const years = periodYears(plan.area.startYear)
  const harvest = entryOf(plan, plan.reviewSchedule, blockId).year
  if (harvest === null) return { year: years[0], why: `${years[0]}, the block not being harvested in the schedule` }
  const year = years.find((y) => y >= harvest) ?? years.at(-1)!
  return { year, why: `${year}, the first period from the block’s harvest in ${harvest}` }
}

/** Old forest held as a share of the row's CFLB, less the Table 2 share (percentage points). */
export const oldMargin = (r: MackenzieRowYear, oldPercent: number) =>
  r.cflbHa > 0 ? (heldOld(r) / r.cflbHa) * 100 - oldPercent : null

/** Old interior as a share of the row's required old forest, less the Table 3 share (percentage points). */
export const interiorMargin = (r: MackenzieRowYear, interiorPercent: number | null) =>
  interiorPercent === null || r.interiorHa === null || r.requiredOldHa <= 0
    ? null
    : (r.interiorHa / r.requiredOldHa) * 100 - interiorPercent

/** The share of the live old forest part of the target younger stands make up (2(b)). */
export const youngerShare = (r: MackenzieRowYear) => {
  const live = r.requiredOldHa - r.nfaHa
  return r.youngerHa === undefined || live <= 0 ? null : (r.youngerHa / live) * 100
}

/** A hint by fact id, or none when nothing has been calculated. */
export function mackenzieEvidence(plan: Plan, blockId: string): Partial<Record<string, string>> {
  const record = plan.checks?.mackenzieOldForest
  const unit = record ? mackenzieUnit(record.unit) : null
  if (!record || !unit) return {}
  const run = record.schedules.find((s) => s.schedule === plan.reviewSchedule)
  if (!run) return {}
  const { year, why } = evidenceYear(plan, blockId)
  const at = run.years.find((y) => y.year === year)
  if (!at) return {}
  const stale = mackenzieOldForestCurrent(plan) ? '' : ' Out of date: calculate again before relying on it.'
  const lead = `PGMaps calculated ${unit.asPrinted} on ${record.ranOn} (${why}); evidence only, the answer is yours.`
  const rows = at.rows.flatMap((r) => {
    const row = unit.rows.find((x) => x.id === r.row)
    return row && r.cflbHa > 0 ? [{ r, row }] : []
  })
  const old = rows.map(({ r, row }) => {
    const m = oldMargin(r, row.oldPercent)
    return `${rowName(row)}: ${share.format((heldOld(r) / r.cflbHa) * 100)}% old${record.younger ? ' with younger stands counted' : ''} against ${row.oldPercent}% (${points.format(m ?? 0)} points)`
  })
  const interior = rows.map(({ r, row }) => {
    if (row.interiorPercent === null) return `${rowName(row)}: Table 3 leaves the share open`
    const m = interiorMargin(r, row.interiorPercent)
    return m === null
      ? `${rowName(row)}: interior not calculated for ${year}`
      : `${rowName(row)}: ${share.format(m + row.interiorPercent)}% of the required old forest interior against ${row.interiorPercent}% (${points.format(m)} points)`
  })
  const hints: Partial<Record<string, string>> = {
    'old-margin': `${lead} ${old.join('; ')}.${stale}`,
    'interior-margin': `${lead} ${interior.join('; ')}.${stale}`,
  }
  if (record.younger) {
    const younger = rows.map(({ r, row }) => {
      const s = youngerShare(r)
      return `${rowName(row)}: ${s === null ? 'none' : `${share.format(s)}%`}`
    })
    hints['younger-share'] =
      `${lead} Younger stands from ${record.younger.fromAge} years make up ${younger.join('; ')} of the live old forest part.${stale}`
  }
  return hints
}
