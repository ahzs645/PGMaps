/**
 * The prescribed stands as files: one row per tree, the same tree before and after harvest, with what
 * the prescription does with it (RxGaming's pre- and post-treatment tree lists, in one file).
 * Written from the same stand and result the road view draws. DOM-free.
 */

import { snagFates } from './snagDecay'
import { readClumps } from './standMetrics'
import { KEPT, type PrescriptionResult, type StandPrescription } from './prescription'
import type { Stand } from './standTrees'

export type PrescribedStandFile = {
  blockName: string
  stand: Stand
  result: PrescriptionResult
  prescription: StandPrescription
}

const KEPT_NAMES: Record<number, string> = {
  [KEPT.chosen]: 'kept',
  [KEPT.protected]: 'protected',
  [KEPT.diameterLimit]: 'diameter limit',
  [KEPT.notRemovable]: 'not removable',
  [KEPT.missed]: 'missed by crew',
}

const OUTCOME_NAMES: Record<StandPrescription['outcome'], string> = {
  hauled: 'stump',
  felled: 'felled, crown left',
  limbed: 'felled, limbed log',
}

type TreeRow = {
  block: string
  tree_id: string
  longitude: number
  latitude: number
  species: string
  dbh_cm: number
  height_m: number
  crown_width_m: number
  expansion: number
  before: 'standing'
  after: 'standing' | 'cut'
  why_kept: string
  left_as: string
  felling_bearing_deg: number | null
  clump_size_after: number | null
  /** A snag's fall, years after harvest, from its species' published curve (`snagDecay.ts`). */
  snag_falls_after_years: number | string | null
}

function rowsOf(files: ReadonlyArray<PrescribedStandFile>): TreeRow[] {
  const rows: TreeRow[] = []
  for (const { blockName, stand, result, prescription } of files) {
    const keptIndex: number[] = []
    stand.trees.forEach((_, i) => {
      if (!result.removed[i]) keptIndex.push(i)
    })
    const clumps = readClumps(
      keptIndex.map((i) => stand.trees[i]),
      prescription.clumpDistanceMeters,
    )
    const clumpOf = new Map(keptIndex.map((tree, k) => [tree, clumps.sizes[k]]))
    const fallOf = new Map(snagFates(stand, result).map((fate) => [fate.index, fate.fallsAfterYears]))
    stand.trees.forEach((tree, i) => {
      const cut = result.removed[i] === 1
      rows.push({
        block: blockName,
        tree_id: tree.id,
        longitude: Math.round(tree.lng * 1e7) / 1e7,
        latitude: Math.round(tree.lat * 1e7) / 1e7,
        species: tree.species,
        dbh_cm: Math.round(tree.dbhCm * 10) / 10,
        height_m: Math.round(tree.heightMeters * 10) / 10,
        crown_width_m: Math.round(tree.crownWidthMeters * 10) / 10,
        expansion: Math.round(tree.expansion * 100) / 100,
        before: 'standing',
        after: cut ? 'cut' : 'standing',
        why_kept: cut ? '' : (KEPT_NAMES[result.keptBecause[i]] ?? 'kept'),
        left_as: cut ? (result.snags[i] ? 'snag' : OUTCOME_NAMES[prescription.outcome]) : '',
        felling_bearing_deg:
          cut && Number.isFinite(result.fellingBearings[i]) ? Math.round(result.fellingBearings[i]) : null,
        clump_size_after: cut ? null : (clumpOf.get(i) ?? null),
        snag_falls_after_years: fallOf.has(i)
          ? Number.isFinite(fallOf.get(i)!)
            ? Math.round(fallOf.get(i)! * 10) / 10
            : 'outlasts the curve'
          : null,
      })
    })
  }
  return rows
}

const csvCell = (value: unknown) => {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Every prescribed tree, one row each. */
export function standTreeCsv(files: ReadonlyArray<PrescribedStandFile>): string {
  const rows = rowsOf(files)
  const header: Array<keyof TreeRow> = [
    'block',
    'tree_id',
    'longitude',
    'latitude',
    'species',
    'dbh_cm',
    'height_m',
    'crown_width_m',
    'expansion',
    'before',
    'after',
    'why_kept',
    'left_as',
    'felling_bearing_deg',
    'clump_size_after',
    'snag_falls_after_years',
  ]
  return [header.join(','), ...rows.map((row) => header.map((key) => csvCell(row[key])).join(','))].join('\n') + '\n'
}

/** Every prescribed tree as a GeoJSON point (WGS84), with the CSV's columns as properties. */
export function standTreeGeoJson(files: ReadonlyArray<PrescribedStandFile>): string {
  const features = rowsOf(files).map((row) => {
    const { longitude, latitude, ...properties } = row
    return { type: 'Feature', geometry: { type: 'Point', coordinates: [longitude, latitude] }, properties }
  })
  return JSON.stringify({ type: 'FeatureCollection', features })
}

/** What the export's "What goes in" lists for each block. */
export function standFileSummary(files: ReadonlyArray<PrescribedStandFile>): Array<{ label: string; value: string }> {
  return files.map(({ blockName, stand, result }) => {
    const cut = result.removed.reduce((sum, flag) => sum + flag, 0)
    return {
      label: blockName,
      value: `${stand.trees.length} trees: ${stand.trees.length - cut} standing after harvest, ${cut} cut (${Math.round(result.removedBasalAreaPercent)}% of basal area)`,
    }
  })
}
