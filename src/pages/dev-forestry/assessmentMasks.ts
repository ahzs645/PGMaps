import type { AssessmentMask } from './types'
import { pointInPolygon, polygonAreaMeters, polygonBounds } from './visibility'

/**
 * What each mask kind is called wherever it is shown. The stored kind values
 * never change, so saved scenes keep loading: `retained` is a wildlife tree
 * patch or other retention — the strategic patch that stays standing and can
 * screen the opening.
 */
export const MASK_LABELS = {
  natural: 'Natural non-green ground',
  private: 'Private land',
  permanent: 'Permanent non-forestry disturbance',
  retained: 'Wildlife tree patch / retention',
} as const

/** The most masks a scene keeps (`parseMasks`). */
export const MAX_ASSESSMENT_MASKS = 100

export function maskAt(masks: AssessmentMask[], lng: number, lat: number) {
  const present = masks.filter((m) => pointInPolygon(m.geometry, lng, lat))
  return {
    excludeGreen: present.some((m) => m.kind === 'natural'),
    excludeAlteration: present.some((m) => m.kind === 'private' || m.kind === 'permanent'),
    retained: present.some((m) => m.kind === 'retained'),
    privateLand: present.some((m) => m.kind === 'private'),
    forceGreen: present.some((m) => m.kind === 'private' || m.kind === 'permanent' || m.kind === 'retained'),
  }
}

export function parseMasks(raw: unknown): AssessmentMask[] {
  if (raw == null) return []
  if (!Array.isArray(raw) || raw.length > MAX_ASSESSMENT_MASKS)
    throw new Error(`Use at most ${MAX_ASSESSMENT_MASKS} assessment masks.`)
  if (new Set(raw.map((m) => m?.id)).size !== raw.length) throw new Error('Assessment mask IDs must be unique.')
  return raw.map((value) => {
    const m = value as AssessmentMask
    if (
      !m ||
      typeof m.id !== 'string' ||
      typeof m.name !== 'string' ||
      !Object.prototype.hasOwnProperty.call(MASK_LABELS, m.kind) ||
      !m.geometry ||
      !['Polygon', 'MultiPolygon'].includes(m.geometry.type) ||
      !(polygonAreaMeters(m.geometry) > 0)
    )
      throw new Error('An assessment mask has invalid geometry or classification.')
    return {
      id: m.id,
      name: m.name.slice(0, 200),
      kind: m.kind,
      geometry: m.geometry,
      source: typeof m.source === 'string' ? m.source.slice(0, 1000) : '',
    }
  })
}

/** "Wildlife tree patch 3": the next unused number for a drawn patch. */
export function nextWildlifeTreePatchName(masks: ReadonlyArray<AssessmentMask>): string {
  const taken = new Set(masks.map((m) => m.name))
  let n = masks.filter((m) => m.kind === 'retained').length + 1
  while (taken.has(`Wildlife tree patch ${n}`)) n += 1
  return `Wildlife tree patch ${n}`
}

/**
 * The masks with one drawn on the plan added, checked by the same parser a
 * saved scene goes through (count, unique ID, polygon with area). Throws with
 * the parser's message when the drawing cannot be kept.
 */
export function withDrawnMask(
  masks: ReadonlyArray<AssessmentMask>,
  mask: Pick<AssessmentMask, 'id' | 'kind' | 'geometry'> & { name?: string; source?: string },
): AssessmentMask[] {
  const name = mask.name ?? (mask.kind === 'retained' ? nextWildlifeTreePatchName(masks) : MASK_LABELS[mask.kind])
  return parseMasks([...masks, { ...mask, name, source: mask.source ?? 'Drawn on the plan map' }])
}

/** Precomputed bounds keep mask checks cheap inside a sightline's canopy loop. */
export function assessmentMaskSampler(masks: AssessmentMask[]) {
  const indexed = masks.map((m) => ({ mask: m, bounds: polygonBounds(m.geometry) }))
  return (lng: number, lat: number) =>
    maskAt(
      indexed.filter(({ bounds: b }) => lng >= b[0] && lng <= b[2] && lat >= b[1] && lat <= b[3]).map((m) => m.mask),
      lng,
      lat,
    )
}
