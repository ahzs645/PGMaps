import type { AssessmentMask } from './types'
import { pointInPolygon, polygonAreaMeters, polygonBounds } from './visibility'

export const MASK_LABELS = {
  natural: 'Natural non-green ground',
  private: 'Private land',
  permanent: 'Permanent non-forestry disturbance',
  retained: 'Retained forest patch',
} as const

export function maskAt(masks: AssessmentMask[], lng: number, lat: number) {
  const present = masks.filter((m) => pointInPolygon(m.geometry, lng, lat))
  return {
    excludeGreen: present.some((m) => m.kind === 'natural'),
    excludeAlteration: present.some((m) => m.kind === 'private' || m.kind === 'permanent'),
    retained: present.some((m) => m.kind === 'retained'),
    forceGreen: present.some((m) => m.kind === 'private' || m.kind === 'permanent' || m.kind === 'retained'),
  }
}

export function parseMasks(raw: unknown): AssessmentMask[] {
  if (raw == null) return []
  if (!Array.isArray(raw) || raw.length > 100) throw new Error('Use at most 100 assessment masks.')
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
