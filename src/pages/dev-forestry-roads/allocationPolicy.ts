/** Persistent material suitability and construction constraints. No terrain or UI dependencies. */
import type { AlignmentEngineering, FillRequirement, HaulSettings, GroundMaterial } from './engineeringTypes'
import { EngineeringInputError, requireStationRange, type EngineeringInputList } from './inputErrors'

export const MAX_FILL_REQUIREMENTS = 200
export const MAX_HAUL_DIRECTION_RANGES = 100
export const MAX_SIDECAST_RANGES = 100
export const materialDemandKey = (layer: string, materialId?: string, subgrade = false) =>
  JSON.stringify([subgrade ? 'component' : 'surface', layer, materialId ?? null])
const bounded = (v: unknown, low: number, high: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= low && v <= high
const object = (v: unknown, label: string) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error(`${label} must be an object.`)
  return v as Record<string, unknown>
}
const text = (v: unknown, label: string) => {
  if (typeof v !== 'string' || !v.trim() || v.length > 100) throw Error(`${label} needs 1–100 characters.`)
  return v.trim()
}
const ranges = (v: unknown, limit: number, label: string) => {
  if (v === undefined) return undefined
  if (!Array.isArray(v) || v.length > limit) throw Error(`${label} supports at most ${limit} ranges.`)
  const rows: Array<Record<string, unknown> & { id: string; start: number; end: number }> = v.map((entry) => {
    const r = object(entry, label)
    if (!bounded(r.start, 0, 100000) || !bounded(r.end, 0, 100000) || r.end <= r.start)
      throw Error(`${label} needs increasing stations from 0–100,000 m.`)
    return { ...r, id: text(r.id, `${label} id`), start: r.start, end: r.end }
  })
  if (new Set(rows.map((r) => r.id)).size !== rows.length) throw Error(`${label} ids must be unique.`)
  return rows
}

/** Parse only this extension; the caller still parses the original engineering contract. */
export function parseAllocationPolicy(input: unknown): {
  fillRequirements?: FillRequirement[]
  haul: Pick<HaulSettings, 'allocation' | 'directionRanges' | 'sidecastRanges'>
} {
  const e = object(input, 'Engineering inputs')
  const h = e.haul === undefined ? {} : object(e.haul, 'Haul')
  const fillRequirements = ranges(e.fillRequirements, MAX_FILL_REQUIREMENTS, 'Fill requirements')?.map((r) => {
    if (typeof r.replaceable !== 'boolean') throw Error('Choose exact or replaceable fill material.')
    if (r.minQuality !== undefined && !bounded(r.minQuality, 0, 100)) throw Error('Fill quality must be 0–100.')
    return {
      id: r.id,
      start: r.start,
      end: r.end,
      layer: text(r.layer, 'Demand layer'),
      replaceable: r.replaceable,
      ...(r.materialId === undefined ? {} : { materialId: text(r.materialId, 'Required material') }),
      ...(r.minQuality === undefined ? {} : { minQuality: r.minQuality }),
    }
  })
  if (h.allocation !== undefined && !['nearest', 'economic'].includes(h.allocation as string))
    throw Error('Choose nearest or economic material allocation.')
  const directionRanges = ranges(h.directionRanges, MAX_HAUL_DIRECTION_RANGES, 'Haul direction')?.map((r) => {
    if (!['forward', 'backward', 'blocked'].includes(r.direction as string)) throw Error('Invalid haul direction.')
    return { id: r.id, start: r.start, end: r.end, direction: r.direction as 'forward' | 'backward' | 'blocked' }
  })
  const sidecastRanges = ranges(h.sidecastRanges, MAX_SIDECAST_RANGES, 'Sidecast')?.map((r) => {
    if (!bounded(r.capacityBankM3PerM, 0, 10000) || !bounded(r.unitRate, 0, 100000))
      throw Error('Sidecast capacity must be 0–10,000 bank m³/m and rate 0–100,000 $/bank m³.')
    if (r.materialIds !== undefined && (!Array.isArray(r.materialIds) || r.materialIds.length > 32))
      throw Error('Sidecast accepts at most 32 material ids.')
    return {
      id: r.id,
      start: r.start,
      end: r.end,
      capacityBankM3PerM: r.capacityBankM3PerM,
      unitRate: r.unitRate,
      ...(r.materialIds === undefined
        ? {}
        : { materialIds: (r.materialIds as unknown[]).map((v) => text(v, 'Sidecast material')) }),
    }
  })
  return {
    ...(fillRequirements === undefined ? {} : { fillRequirements }),
    haul: {
      ...(h.allocation === undefined ? {} : { allocation: h.allocation as 'nearest' | 'economic' }),
      ...(directionRanges === undefined ? {} : { directionRanges }),
      ...(sidecastRanges === undefined ? {} : { sidecastRanges }),
    },
  }
}

/** Station order, and overlap where the same physical thing would be counted twice, per range. */
function requireRanges(
  rows: readonly { id: string; start: number; end: number }[] | undefined,
  list: EngineeringInputList,
  label: string,
  clash?: (a: number, b: number) => string | null,
): void {
  rows?.forEach((r, i) => {
    const owner = `${label} ${i + 1}`,
      target = { list, id: r.id }
    requireStationRange(r.start, r.end, owner, target)
    for (let j = 0; clash && j < i; j++) {
      const from = Math.max(r.start, rows[j].start),
        to = Math.min(r.end, rows[j].end)
      const reason = to > from + 1e-7 ? clash(i, j) : null
      if (reason !== null)
        throw new EngineeringInputError(
          `${owner} and ${label.toLowerCase()} ${j + 1} overlap between ${Number(from.toFixed(3))} and ${Number(to.toFixed(3))} m${reason} Change a start or end station.`,
          target,
        )
    }
  })
}

export function validateAllocationPolicy(e: AlignmentEngineering): void {
  const requirements = Array.isArray(e.fillRequirements) ? e.fillRequirements : undefined
  requireRanges(requirements, 'fillRequirements', 'Requirement', (a, b) =>
    requirements![a].layer === requirements![b].layer ? ' on the same layer.' : null,
  )
  requireRanges(
    Array.isArray(e.haul?.directionRanges) ? e.haul.directionRanges : undefined,
    'directionRanges',
    'Direction',
  )
  requireRanges(
    Array.isArray(e.haul?.sidecastRanges) ? e.haul.sidecastRanges : undefined,
    'sidecastRanges',
    'Sidecast',
    () => '; the same disposal capacity would be counted twice.',
  )
  const p = parseAllocationPolicy(e)
  const ids = new Set(e.materials.map((m) => m.id))
  for (const material of e.materials)
    if (material.quality !== undefined && !bounded(material.quality, 0, 100))
      throw Error('Material quality must be 0–100.')
  for (const site of e.sites)
    if (site.materialId !== undefined) {
      if (!ids.has(site.materialId)) throw Error('Haul site references an unknown material.')
      if (site.kind === 'borrow' && e.materials.find((m) => m.id === site.materialId)?.purpose === 'stripping')
        throw Error('A stripping material cannot be a borrow fill supply.')
    }
  const reqs = p.fillRequirements ?? []
  reqs.forEach((r, i) => {
    const owner = `Requirement ${i + 1}`,
      target = { list: 'fillRequirements' as const, id: r.id }
    const fail = (message: string, field: string) =>
      new EngineeringInputError(`${owner}: ${message}`, { ...target, field })
    if (r.materialId !== undefined && !ids.has(r.materialId))
      throw fail('choose one of the ground materials. Fill requirement references an unknown material.', 'materialId')
    if (e.materials.find((m) => m.id === r.materialId)?.purpose === 'stripping')
      throw fail('A stripping material cannot be required as fill.', 'materialId')
    if (!r.replaceable && !r.materialId) throw fail('Exact fill requires a named material.', 'materialId')
    if (r.replaceable && !r.materialId && r.minQuality === undefined)
      throw fail('Replaceable fill requires a material or minimum quality.', 'minQuality')
  })
  for (let i = 0; i < reqs.length; i++)
    for (let j = i + 1; j < reqs.length; j++)
      if (
        reqs[i].layer === reqs[j].layer &&
        Math.min(reqs[i].end, reqs[j].end) > Math.max(reqs[i].start, reqs[j].start) + 1e-7
      )
        throw Error('Fill requirements overlap on the same layer.')
  const sidecast = p.haul.sidecastRanges ?? []
  for (let i = 0; i < sidecast.length; i++) {
    if (sidecast[i].materialIds?.some((id) => !ids.has(id))) throw Error('Sidecast references an unknown material.')
    for (let j = i + 1; j < sidecast.length; j++)
      if (Math.min(sidecast[i].end, sidecast[j].end) > Math.max(sidecast[i].start, sidecast[j].start) + 1e-7)
        throw Error('Sidecast ranges overlap; do not count physical disposal capacity twice.')
  }
}

export function requiredFillAt(e: AlignmentEngineering, chainage: number, layer: string): FillRequirement | undefined {
  return e.fillRequirements?.find((r) => r.layer === layer && chainage >= r.start && chainage < r.end)
}

export function acceptsFill(
  materialId: string | null,
  requirement: FillRequirement | undefined,
  materials: GroundMaterial[],
): boolean {
  if (!requirement) return true
  const quality = materials.find((m) => m.id === materialId)?.quality
  if (
    materialId &&
    materialId === requirement.materialId &&
    (requirement.minQuality === undefined || (quality !== undefined && quality >= requirement.minQuality))
  )
    return true
  if (!requirement.replaceable) return false
  const minimum = requirement.minQuality ?? materials.find((m) => m.id === requirement.materialId)?.quality
  return minimum !== undefined && quality !== undefined && quality >= minimum
}

/** Every intersected construction range applies; same-station handling crosses no barrier. */
export function haulDirectionAllowed(h: HaulSettings, from: number, to: number): boolean {
  if (Math.abs(to - from) < 1e-7) return true
  const lo = Math.min(from, to),
    hi = Math.max(from, to)
  return !(h.directionRanges ?? []).some(
    (r) =>
      Math.min(hi, r.end) > Math.max(lo, r.start) + 1e-7 &&
      (r.direction === 'blocked' ||
        (r.direction === 'forward' && to < from) ||
        (r.direction === 'backward' && to > from)),
  )
}
