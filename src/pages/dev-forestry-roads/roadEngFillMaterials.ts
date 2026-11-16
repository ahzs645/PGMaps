/**
 * A road's subgrade fill requirements written back as RoadEng's fill material by range (Fill Types
 * Assignments, field 12 of each `[LocationParms]` row, index 11): the inverse of the fill part of
 * `roadEngMaterialsFor` (`roadEngDesignSettings.ts`).
 *
 * - Nothing is written while the road's subgrade requirements read as the design gave them, so an
 *   unedited design keeps every row byte for byte.
 * - Otherwise the rows (as the template-range writer left them) are split at each requirement's
 *   start and end inside the road, each piece keeping every other field of the row it lies in.
 *   Where the requirement in force is the one read there, the row keeps its own text (`*2` stays
 *   `*2`); where it changed, the row takes the material's ground type code (from the ground types
 *   `roadEngHaulRecords` writes), and `*1` where the requirement was removed. Rows that end up the
 *   same as their neighbour are joined, and `nparams` counts them.
 *
 * Not written, and said: a requirement on any layer other than subgrade (RoadEng keeps a template
 * layer's material per template table, not per range: `RoadSurfaceCodes-<n>`, read as
 * `templateLayerMaterials`), an exact requirement or a minimum quality other than the material's own
 * (a plain row is RoadEng's Replaceable, quality-based fill, as Softree's V11 tutorial shows; where an
 * unticked, exact range is marked no sample shows), and a requirement with no material. A road with
 * no RoadEng original has no rows to write into.
 *
 * Pure: no DOM or network access.
 */
import {
  parseRoadEngSettings,
  readRoadEngIni,
  roadEngDefaultGroundType,
  roadEngFillMaterialCode,
  roadEngMaterialsFor,
  type RoadEngRangeOptions,
  type RoadEngStationRange,
} from './roadEngDesignSettings'
import type { RoadEngDsnOverrides } from './roadEngExport'
import { roadEngMaterialId } from './roadEngHaul'
import { roadEngNumber, type RoadEngOriginal } from './roadEngSectionExport'
import type { FillRequirement } from './engineeringTypes'
import type { Alignment } from './types'

export interface RoadEngFillWriteBack {
  /** Keys for the alignment's own `.dsn` (`[LocationParms]`). */
  alignment: RoadEngDsnOverrides
  written: string[]
  notWritten: string[]
}

/** RoadEng's fill material field in a `[LocationParms]` row. */
export const ROADENG_FILL_FIELD = 11
/** Two stations this close, m, are one boundary. */
const SAME_STATION_M = 1e-6

const fmt = (v: number) => (Math.round(v * 1000) / 1000).toString()

/** The subgrade requirement in force at a chainage. */
function requirementAt(list: readonly FillRequirement[], chainage: number): FillRequirement | null {
  return list.find((r) => chainage >= r.start - 1e-9 && chainage < r.end - 1e-9) ?? null
}

/** What a requirement means for the comparison: its material and how strictly it is held. */
const meaning = (r: FillRequirement | null) =>
  r ? JSON.stringify([r.materialId ?? null, r.replaceable, r.minQuality ?? null]) : null

/** The requirements as a comparable list, rounded to the micrometre. */
const canonical = (list: readonly FillRequirement[]) =>
  JSON.stringify(
    [...list]
      .sort((a, b) => a.start - b.start)
      .map((r) => [Math.round(r.start * 1e6), Math.round(r.end * 1e6), meaning(r)]),
  )

/**
 * The `[LocationParms]` keys that carry the road's subgrade fill requirements into the design
 * `original` it was read from. `alignmentDsnText` is the alignment's `.dsn` as the other writers have
 * left it (template ranges); `codes` gives each material's ground type code as written.
 */
export function roadEngFillWriteBack(
  alignment: Pick<Alignment, 'engineering' | 'name'>,
  original: Pick<
    RoadEngOriginal,
    'dsnText' | 'ds2Text' | 'projectDsnText' | 'unitM' | 'startStation' | 'endStation' | 'stationScale'
  > & {
    /**
     * The frame the road was read in (`RoadEngSource`), when it is written in another: what was read
     * is compared in it, and a requirement end nobody moved finds its row's boundary in it.
     */
    readFrame?: RoadEngRangeOptions
  },
  alignmentDsnText: string,
  codes: Readonly<Record<string, string>>,
): RoadEngFillWriteBack {
  const result: RoadEngFillWriteBack = { alignment: {}, written: [], notWritten: [] }
  const all = alignment.engineering?.fillRequirements ?? []
  const other = all.filter((r) => r.layer !== 'subgrade')
  if (other.length)
    result.notWritten.push(
      `${alignment.name}: ${other.length} fill requirement${other.length === 1 ? '' : 's'} on layers other than subgrade (${[...new Set(other.map((r) => r.layer))].join(', ')}); RoadEng's fill by range is the subgrade's.`,
    )
  const now = all.filter((r) => r.layer === 'subgrade')
  const unitM = original.unitM
  const extra = original.projectDsnText !== undefined ? { projectDsnText: original.projectDsnText } : {}
  const before = parseRoadEngSettings(original.dsnText, original.ds2Text, unitM, extra)
  const options = {
    startStation: original.startStation,
    endStation: original.endStation,
    ...(original.stationScale !== undefined ? { stationScale: original.stationScale } : {}),
  }
  const readFrame = original.readFrame ?? options
  const read = roadEngMaterialsFor(before, readFrame).fillRequirements
  if (canonical(read) === canonical(now)) return result

  const current = parseRoadEngSettings(alignmentDsnText, original.ds2Text, unitM, extra)
  const ranges = current.stationRanges
  if (!ranges.length) {
    result.notWritten.push(`${alignment.name}: subgrade fill requirements; the design has no station ranges.`)
    return result
  }
  const scale = options.stationScale ?? 1
  const station = (chainage: number) => options.startStation + chainage / scale
  const chainageOf = (s: number) => (s - options.startStation) * scale

  // Ground type codes: as the haul writer wrote them, else the design's own.
  const designCode = new Map(before.materials.map((m) => [roadEngMaterialId(m.code), m.code]))
  const codeOf = (materialId: string | undefined) =>
    materialId === undefined ? null : (codes[materialId] ?? designCode.get(materialId) ?? null)
  const fallback = roadEngDefaultGroundType(current.materials)?.code ?? null
  const resolved = (r: RoadEngStationRange) => {
    const code = roadEngFillMaterialCode(r)
    return code === '**' ? fallback : code
  }

  // Boundaries, metres, with the text each is written as.
  const bounds = new Map<number, string>()
  for (const r of ranges) if (r.toStation !== null) bounds.set(r.toStation, r.raw[0])
  const near = (s: number) => [...bounds.keys()].find((b) => Math.abs(b - s) < SAME_STATION_M)
  const readStation = (chainage: number) => readFrame.startStation + chainage / (readFrame.stationScale ?? 1)
  for (const r of now)
    for (const c of [r.start, r.end]) {
      // An end at a boundary it was read from stays there.
      if (near(readStation(c)) !== undefined) continue
      const s = station(c)
      if (s <= options.startStation + SAME_STATION_M || s >= options.endStation - SAME_STATION_M) continue
      if (near(s) === undefined) bounds.set(s, roadEngNumber(s / unitM))
    }
  const ends = [...bounds.keys()].sort((a, b) => a - b)
  const notWritten = new Set<string>()
  const changed: string[] = []
  const rows: string[][] = []
  let from = -Infinity
  // Past the last row's end only when that row runs to the end of the road.
  const tail = ranges.at(-1)!.toStation === null ? [Infinity] : []
  for (const end of [...ends, ...tail]) {
    const source = ranges.find((r) => r.toStation === null || r.toStation > from + SAME_STATION_M) ?? ranges.at(-1)!
    const row = [...source.raw]
    row[0] = Number.isFinite(end) ? bounds.get(end)! : source.toStation === null ? source.raw[0] : '999999999'
    // The piece's part on the road decides it; a piece wholly off the road keeps its row.
    const lo = Math.max(from, options.startStation),
      hi = Math.min(end, options.endStation)
    if (hi > lo + SAME_STATION_M) {
      const mid = chainageOf((lo + hi) / 2)
      const want = requirementAt(now, mid)
      const was = requirementAt(read, mid)
      if (meaning(want) !== meaning(was)) {
        const span = `${fmt(lo)}–${fmt(hi)} m`
        if (!want) {
          if (resolved(source) !== null) {
            row[ROADENG_FILL_FIELD] = '*1'
            changed.push(`*1 ${span}`)
          }
        } else {
          const code = codeOf(want.materialId)
          if (code === null)
            notWritten.add(
              `${alignment.name}: the fill requirement over ${span}, whose ${want.materialId ? 'material is not a ground type written to RoadEng' : 'minimum quality names no material'}; RoadEng keeps the range's fill as read.`,
            )
          else {
            if (resolved(source) !== code) {
              row[ROADENG_FILL_FIELD] = code
              changed.push(`${code} ${span}`)
            }
            // RoadEng's fill type takes its material or any of the same or higher quality: an exact
            // requirement, or a minimum quality other than the material's own, has no field there.
            const ownQuality = alignment.engineering?.materials.find((m) => m.id === want.materialId)?.quality
            if (!want.replaceable || (want.minQuality !== undefined && want.minQuality !== ownQuality))
              notWritten.add(
                `${alignment.name}: the fill requirement over ${span} ${want.replaceable ? `asks for quality ${want.minQuality} or better` : 'takes that material only'}; RoadEng's fill type takes ${code} or any material of the same or higher quality there.`,
              )
          }
        }
      }
    }
    const last = rows.at(-1)
    if (last && last.slice(1).join(',') === row.slice(1).join(',')) last[0] = row[0]
    else rows.push(row)
    from = end
  }
  result.notWritten.push(...notWritten)

  const section = readRoadEngIni(alignmentDsnText).get('LocationParms') ?? new Map<string, string>()
  const keys: Record<string, string | null> = {}
  for (const key of section.keys()) if (/^\d+$/.test(key) && Number(key) >= rows.length) keys[key] = null
  rows.forEach((row, k) => (keys[String(k)] = row.join(',')))
  if (section.has('nparams')) keys.nparams = String(rows.length)
  for (const [key, value] of Object.entries(keys)) if ((section.get(key) ?? null) === value) delete keys[key]
  if (Object.keys(keys).length) {
    result.alignment.LocationParms = keys
    result.written.push(`${alignment.name}: subgrade fill material by range (${changed.join(', ') || 'rows joined'})`)
  }
  return result
}
