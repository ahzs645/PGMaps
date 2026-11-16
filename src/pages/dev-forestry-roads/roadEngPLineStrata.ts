/**
 * A road's P-line horizons made again (`roadEngPLine.ts`): when its P-line is read after the design
 * (a `.tr1` chosen for a road whose P-line was not given), or when Between/Ahead is changed. The
 * road's ranges are read again from the design it keeps (`RoadEngSource`), exactly as at import
 * (`roadEngMaterialsFor` with the P-line), and only the horizons made from the P-line
 * (`roadeng-pline-…`) are replaced; every other horizon, and every edit to them, stays.
 *
 * Pure: no DOM or network access (the `.tr1` reader is passed in).
 */
import { parseRoadEngSettings, roadEngDefaultGroundType, roadEngMaterialsFor } from './roadEngDesignSettings'
import { ROADENG_UNITS, roadEngSourceDs2Text } from './roadEngImport'
import {
  isPLineStratum,
  keptPLine,
  pLineApplyOf,
  pLineGroundStations,
  roadEngPLineReference,
  roadEngPStations,
  type PLineApply,
  type RoadEngPLineSource,
} from './roadEngPLine'
import type { NativeTraverse } from './softreeNativeTraverse'
import type { Alignment } from './types'

export interface PLineRefreshOptions {
  /** `parseNativeTraverse`. */
  parse: (text: string) => NativeTraverse
  /** A `.tr1` read now (Latin-1 text), and the `.tr2` beside it. */
  tr1?: { name: string; text: string }
  tr2?: { name: string; text: string } | null
  apply?: PLineApply
}

/** The road with its P-line horizons made again from its kept design and P-line. Throws when it has no P-line. */
export function refreshPLineStrata(
  alignment: Alignment,
  options: PLineRefreshOptions,
): { alignment: Alignment; horizons: number; notes: string[] } {
  const source = alignment.roadEngSource
  const kept = source?.pLine
  if (!source || !kept) throw Error('This road names no P-line.')
  const unitM = ROADENG_UNITS[source.unitCode] ?? 1
  const reference = roadEngPLineReference(source.dsn)
  const own = reference?.apply ?? 'between'
  const notes: string[] = []
  if (options.tr1) options.parse(options.tr1.text)
  if (options.tr1 && options.tr1.name.toLowerCase() !== kept.name.toLowerCase())
    notes.push(`The design names its P-line ${kept.name}; ${options.tr1.name} was read and goes back under that name.`)
  const apply = options.apply ?? pLineApplyOf(kept, source.dsn)
  const { apply: _was, ...rest } = kept
  void _was
  const pLine: RoadEngPLineSource = {
    ...rest,
    ...(options.tr1 ? { tr1: options.tr1.text, tr2: options.tr2 ?? kept.tr2 } : {}),
    ...(apply !== own ? { apply } : {}),
  }
  const read = keptPLine(pLine, unitM, options.parse)
  const engineering = alignment.engineering
  const others = (engineering?.strata ?? []).filter((s) => !isPLineStratum(s))
  if (!read || !engineering)
    return {
      alignment: { ...alignment, roadEngSource: { ...source, pLine } },
      horizons: 0,
      notes,
    }
  const ds2 = roadEngSourceDs2Text(source)
  const pairs = pLine.stations.length >= 2 ? pLine.stations : roadEngPStations(ds2, unitM, read).pairs
  if (pairs !== pLine.stations) pLine.stations = pairs
  const settings = parseRoadEngSettings(source.dsn, ds2, unitM, {
    ...(source.projectDsn !== undefined ? { projectDsnText: source.projectDsn } : {}),
  })
  const defaultCode = roadEngDefaultGroundType(settings.materials)?.code ?? 'OB'
  const mapped = roadEngMaterialsFor(settings, {
    startStation: source.startStation,
    endStation: source.endStation ?? source.startStation,
    stationScale: source.stationScale ?? 1,
    materialBatters: false,
    pLine: {
      name: kept.name,
      ground:
        pairs.length >= 2
          ? { stations: pLineGroundStations(read.traverse, read.unitM, defaultCode), pairs, apply }
          : null,
    },
  })
  const materials = new Set(engineering.materials.map((m) => m.id))
  const made = mapped.strata.filter(isPLineStratum)
  const kept2 = made.filter((s) => materials.has(s.materialId))
  if (kept2.length < made.length)
    notes.push(
      `${made.length - kept2.length} P-line horizons name a ground type the road no longer has as a material, and were left out.`,
    )
  const room = Math.max(0, 200 - others.length)
  if (kept2.length > room) notes.push(`Only ${room} of ${kept2.length} P-line horizons fit the road's 200 horizons.`)
  return {
    alignment: {
      ...alignment,
      engineering: { ...engineering, strata: [...others, ...kept2.slice(0, room)] },
      roadEngSource: { ...source, pLine },
    },
    horizons: Math.min(room, kept2.length),
    notes,
  }
}
