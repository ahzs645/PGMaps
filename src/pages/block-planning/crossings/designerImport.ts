/**
 * Crossings from the road designer: the register points of its GeoJSON export
 * (`src/lib/forestry/designerCrossings.ts`), read in the browser as candidates for one block and
 * schedule. Each row is offered with its road and station, where it came from (a mapped stream, a
 * modelled flow line or both), the structure and its sizing, the stream's riparian class and its
 * status, and the crossing's skew and straight approaches, all in its `designer` evidence. A row
 * becomes a crossing record of origin `designer` only on the reviewer's click.
 *
 * A row inside the block's footprint is offered on the block's own road; one outside it is offered
 * with its road not stated, for the reviewer to say whether it is the block's access.
 *
 * DOM- and network-free.
 */
import {
  readDesignerCrossings,
  type DesignerCrossing,
  type DesignerCrossingFile,
} from '@/lib/forestry/designerCrossings'
import { distanceToPolygonsM, polygonParts, roundPoint } from './geometry'
import type { CrossingCandidate, CrossingRead } from './candidates'
import type { CrossingStructure } from './record'

/** Rows farther than this from the block are left out of its read. */
export const DESIGNER_REACH_M = 20_000

const SOURCE_WORDS: Record<DesignerCrossing['source'], string> = {
  mapped: 'a mapped stream',
  modelled: 'a flow line modelled over the terrain',
  both: 'a mapped stream and a modelled flow line',
}
const RECORD_KIND: Record<string, CrossingStructure['kind']> = {
  bridge: 'bridge',
  'open-bottom': 'other',
  'embedded-culvert': 'culvert',
  'closed-bottom-culvert': 'culvert',
  ford: 'ford',
}

const metres = (v: number) => `${Math.round(v * 10) / 10} m`

function structureOf(c: DesignerCrossing): CrossingStructure | undefined {
  if (c.structure.kind === 'culvert') {
    const s: CrossingStructure = { kind: 'culvert' }
    if (c.structure.diameterM !== undefined) s.spanOrDiameterM = c.structure.diameterM
    if (c.structure.lengthM !== undefined) s.lengthM = c.structure.lengthM
    return s
  }
  if (c.structure.kind === 'record' && c.structure.record && RECORD_KIND[c.structure.record]) {
    const s: CrossingStructure = { kind: RECORD_KIND[c.structure.record] }
    if (c.structure.record === 'open-bottom') s.openBottom = true
    return s
  }
  return undefined
}

/** What the register says about the row, in one paragraph. */
export function designerSummary(c: DesignerCrossing): string {
  const parts = [`${c.road} at ${c.station}: ${SOURCE_WORDS[c.source]} (${c.stream}).`]
  parts.push(
    `Structure: ${c.structure.label}${c.structure.outstanding.length && c.structure.kind !== 'none' ? ` (${c.structure.outstanding.join(', ')})` : ''}.`,
  )
  if (c.structure.kind === 'culvert' && c.structure.capacity !== 'not-applicable')
    parts.push(`Capacity ${c.structure.capacity === 'unchecked' ? 'not checked' : c.structure.capacity}.`)
  if (c.riparianClass)
    parts.push(`Riparian class ${c.riparianClass} (${c.classStatus === 'reviewed' ? 'reviewed' : 'not reviewed'}).`)
  else if (c.source !== 'modelled') parts.push('No riparian class.')
  if (c.catchmentHa !== undefined)
    parts.push(`Modelled catchment ${c.catchmentHa.toFixed(c.catchmentHa < 10 ? 2 : 1)} ha.`)
  if (c.separationM !== undefined) parts.push(`Mapped and modelled ${metres(c.separationM)} apart along the road.`)
  if (c.onCurve) parts.push('On a curve: no straight approach (Engineering Manual §2.3.3.1 asks for 15 m each side).')
  else if (c.approachBackM !== undefined && c.approachAheadM !== undefined)
    parts.push(`Straight road ${metres(c.approachBackM)} before and ${metres(c.approachAheadM)} after.`)
  if (c.skewDegrees !== undefined)
    parts.push(c.skewDegrees === null ? 'Skew not read.' : `${Math.round(c.skewDegrees)}° off square.`)
  return parts.join(' ')
}

/** One register row as a candidate for the block. */
export function designerCandidate(
  c: DesignerCrossing,
  footprint: { type: string; coordinates: unknown },
  readOn: string,
  file: string,
): CrossingCandidate {
  const distanceM = distanceToPolygonsM(c.point, polygonParts(footprint))
  const values: Record<string, string | number | boolean> = {
    register_id: c.id,
    road: c.road,
    station: c.station,
    source: c.source,
    structure: c.structure.label,
    capacity: c.structure.capacity,
  }
  if (c.structure.diameterM !== undefined) values.culvert_diameter_m = c.structure.diameterM
  if (c.structure.lengthM !== undefined) values.culvert_length_m = c.structure.lengthM
  if (c.riparianClass) values.riparian_class = c.riparianClass
  if (c.classStatus) values.class_status = c.classStatus
  if (c.catchmentHa !== undefined) values.catchment_ha = c.catchmentHa
  if (typeof c.skewDegrees === 'number') values.skew_deg = c.skewDegrees
  const candidate: CrossingCandidate = {
    id: `designer:${c.roadId}:${c.id}`,
    origin: 'designer',
    label: `${c.road} ${c.station} · ${c.stream}`.slice(0, 200),
    point: roundPoint(c.point),
    role: distanceM === 0 ? 'own' : 'unknown',
    road: { name: c.road.slice(0, 200), chainageM: Math.round(c.chainageM * 10) / 10 },
    aliases: [{ source: 'designer', id: `${c.roadId}/${c.id}`, seenOn: readOn }],
    evidence: [
      {
        kind: 'designer',
        source: `Road designer export ${file}`,
        readOn,
        summary: designerSummary(c),
        reference: `${c.road} ${c.station}`,
        values,
      },
    ],
    sightings: [],
    distanceM: Math.round(distanceM),
  }
  if (c.source !== 'modelled') candidate.stream = { name: c.stream.slice(0, 200) }
  const structure = structureOf(c)
  if (structure) candidate.structure = structure
  return candidate
}

/**
 * A read of the designer's register for one block: every row within `DESIGNER_REACH_M` of the
 * block, nearest first. Throws when the file is not a GeoJSON feature collection.
 */
export function designerRead(
  text: string,
  file: string,
  at: {
    block: string
    schedule: string
    shape: string
    footprint: string
    geometry: { type: string; coordinates: unknown }
  },
  readOn: string,
): { read: CrossingRead; file: DesignerCrossingFile; beyond: number } {
  const parsed = readDesignerCrossings(text)
  const all = parsed.crossings.map((c) => designerCandidate(c, at.geometry, readOn, file))
  const candidates = all.filter((c) => c.distanceM <= DESIGNER_REACH_M).sort((a, b) => a.distanceM - b.distanceM)
  const count = parsed.crossings.length
  return {
    file: parsed,
    beyond: all.length - candidates.length,
    read: {
      block: at.block,
      schedule: at.schedule,
      shape: at.shape,
      footprint: at.footprint,
      source: 'designer',
      readOn,
      basis: `Crossing register in ${file}`.slice(0, 500),
      layers: [
        {
          id: 'designer-register',
          label: 'Road designer crossing register',
          status: count ? 'read' : 'skipped',
          count: candidates.length,
          message: !count
            ? 'The file holds no register points: export GeoJSON again from the road designer.'
            : parsed.skipped
              ? `${parsed.skipped} point${parsed.skipped === 1 ? '' : 's'} did not read (${parsed.firstProblem}).`
              : undefined,
        },
      ],
      candidates,
    },
  }
}
