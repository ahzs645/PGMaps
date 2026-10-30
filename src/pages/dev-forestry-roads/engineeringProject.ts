/** Bounded validation for optional engineering inputs in v1 road projects. */
import type { AlignmentEngineering, RoadTemplate } from './types'
import { validateEngineering } from './templates'

const record = (v: unknown, label: string): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error(`${label} must be an object.`)
  return v as Record<string, unknown>
}
const items = (v: unknown, label: string, max: number): unknown[] => {
  if (!Array.isArray(v) || v.length > max) throw Error(`${label} must contain at most ${max} entries.`)
  return v
}
const numeric = (v: unknown, label: string, min = 0, max = 100000): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
    throw Error(`${label} must be between ${min} and ${max}.`)
  return v
}
const name = (v: unknown, label: string, max = 200): string => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw Error(`${label} must contain 1–${max} characters.`)
  return v.trim()
}
const key = (v: unknown, label: string) => {
  const value = name(v, label, 100)
  if (!/^[a-zA-Z0-9_.:-]+$/.test(value)) throw Error(`${label} contains unsupported characters.`)
  return value
}
const range = (r: Record<string, unknown>, label: string) => {
  const start = numeric(r.start, `${label} start`),
    end = numeric(r.end, `${label} end`)
  if (end <= start) throw Error(`${label} end must be after its start.`)
  return { start, end }
}
const oneOf = <T extends string>(v: unknown, values: readonly T[], label: string): T => {
  if (typeof v !== 'string' || !values.includes(v as T)) throw Error(`${label} must be ${values.join(', ')}.`)
  return v as T
}
function unique(values: { id: string }[], label: string) {
  if (new Set(values.map((v) => v.id)).size !== values.length) throw Error(`${label} IDs must be unique.`)
}

export function parseEngineering(raw: unknown, parseTemplate: (raw: unknown) => RoadTemplate): AlignmentEngineering {
  const r = record(raw, 'Engineering design')
  const templates = items(r.templates, 'Template library', 50).map((raw) => {
    const v = record(raw, 'Template definition')
    return { id: key(v.id, 'Template ID'), name: name(v.name, 'Template name'), template: parseTemplate(v.template) }
  })
  const assignments = items(r.assignments, 'Template assignments', 200).map((raw) => {
    const v = record(raw, 'Template assignment')
    return {
      id: key(v.id, 'Template assignment ID'),
      ...range(v, 'Template assignment'),
      templateId: key(v.templateId, 'Assigned template'),
      side: oneOf(v.side, ['left', 'right', 'both'] as const, 'Template side'),
      transitionM: numeric(v.transitionM, 'Template transition', 0, 1000),
    }
  })
  const materials = items(r.materials, 'Ground materials', 32).map((raw) => {
    const v = record(raw, 'Ground material'),
      color = name(v.color, 'Material color', 7)
    if (!/^#[a-f0-9]{6}$/i.test(color)) throw Error('Material colors must use #RRGGBB.')
    return {
      id: key(v.id, 'Material ID'),
      name: name(v.name, 'Material name'),
      color,
      cutRate: numeric(v.cutRate, 'Material excavation rate', 0, 10000),
      reusableFraction: numeric(v.reusableFraction, 'Reusable material fraction', 0, 1),
      compactionFactor: numeric(v.compactionFactor, 'Compaction factor', 0.1, 2),
      ...(v.purpose === undefined
        ? {}
        : { purpose: oneOf(v.purpose, ['earthwork', 'stripping'] as const, 'Material purpose') }),
    }
  })
  const strata = items(r.strata, 'Material horizons', 200).map((raw) => {
    const v = record(raw, 'Material horizon'),
      topDepthM = numeric(v.topDepthM, 'Horizon top depth', 0, 1000),
      bottomDepthM = v.bottomDepthM === null ? null : numeric(v.bottomDepthM, 'Horizon bottom depth', 0, 1000)
    if (bottomDepthM !== null && bottomDepthM <= topDepthM)
      throw Error('Horizon bottom depth must exceed its top depth.')
    return {
      id: key(v.id, 'Horizon ID'),
      ...range(v, 'Material horizon'),
      materialId: key(v.materialId, 'Horizon material'),
      topDepthM,
      bottomDepthM,
    }
  })
  const culverts = items(r.culverts, 'Culverts', 100).map((raw) => {
    const v = record(raw, 'Culvert')
    const invert = (value: unknown, label: string) => (value === null ? null : numeric(value, label, -12000, 12000))
    return {
      id: key(v.id, 'Culvert ID'),
      name: name(v.name, 'Culvert name'),
      chainage: numeric(v.chainage, 'Culvert station'),
      skewDegrees: numeric(v.skewDegrees, 'Culvert skew', -80, 80),
      lengthM: numeric(v.lengthM, 'Culvert length', 0.2, 500),
      diameterM: numeric(v.diameterM, 'Culvert diameter', 0.1, 20),
      inletInvertM: invert(v.inletInvertM, 'Inlet invert'),
      outletInvertM: invert(v.outletInvertM, 'Outlet invert'),
      minCoverM: numeric(v.minCoverM, 'Minimum cover', 0, 100),
      ...(v.ditchDipPercent === undefined || v.ditchDipPercent === null
        ? {}
        : { ditchDipPercent: numeric(v.ditchDipPercent, 'Ditch dip grade', 0.1, 50) }),
      unitCost: numeric(v.unitCost, 'Culvert cost per metre', 0, 1000000),
      fixedCost: numeric(v.fixedCost, 'Culvert fixed cost', 0, 1e9),
      ...(v.kind === undefined ? {} : { kind: oneOf(v.kind, ['stream', 'cross-drain'] as const, 'Culvert kind') }),
      ...(v.sourceFeatureId === undefined ? {} : { sourceFeatureId: key(v.sourceFeatureId, 'Culvert source feature') }),
    }
  })
  const sites = items(r.sites, 'Borrow and waste sites', 100).map((raw) => {
    const v = record(raw, 'Haul site')
    if (v.enabled !== undefined && typeof v.enabled !== 'boolean') throw Error('Haul site enabled must be a boolean.')
    return {
      id: key(v.id, 'Haul site ID'),
      name: name(v.name, 'Haul site name'),
      kind: oneOf(v.kind, ['borrow', 'waste'] as const, 'Haul site kind'),
      ...(v.enabled === undefined ? {} : { enabled: v.enabled as boolean }),
      ...(v.sourceNotes === undefined
        ? {}
        : {
            sourceNotes:
              typeof v.sourceNotes === 'string' && v.sourceNotes.length <= 2000
                ? v.sourceNotes
                : name(v.sourceNotes, 'Source notes', 2000),
          }),
      chainage: numeric(v.chainage, 'Haul site station'),
      accessDistanceM: numeric(v.accessDistanceM, 'Site access distance', 0, 100000),
      capacityM3: v.capacityM3 === null ? null : numeric(v.capacityM3, 'Site capacity', 0, 1e12),
      unitRate: numeric(v.unitRate, 'Site unit rate', 0, 100000),
      fixedCost: numeric(v.fixedCost, 'Site fixed cost', 0, 1e9),
    }
  })
  const h = record(r.haul, 'Haul settings')
  if (typeof h.enabled !== 'boolean') throw Error('Haul enabled must be a boolean.')
  const haul = {
    enabled: h.enabled,
    ...(h.siteSelection === undefined
      ? {}
      : { siteSelection: oneOf(h.siteSelection, ['nearest', 'delivered-cost'] as const, 'Site selection') }),
    freeHaulDistanceM: numeric(h.freeHaulDistanceM, 'Free-haul distance'),
    overhaulDistanceM: numeric(h.overhaulDistanceM, 'Overhaul limit'),
    // Added later: older files have no free-haul or loading rates, which means zero.
    freeHaulRate: h.freeHaulRate === undefined ? 0 : numeric(h.freeHaulRate, 'Free-haul rate'),
    overhaulRate: numeric(h.overhaulRate, 'Overhaul rate'),
    endHaulRate: numeric(h.endHaulRate, 'End-haul rate'),
    freeHaulLoadingRate:
      h.freeHaulLoadingRate === undefined ? 0 : numeric(h.freeHaulLoadingRate, 'Free-haul loading rate'),
    overhaulLoadingRate:
      h.overhaulLoadingRate === undefined ? 0 : numeric(h.overhaulLoadingRate, 'Overhaul loading rate'),
    endHaulLoadingRate: h.endHaulLoadingRate === undefined ? 0 : numeric(h.endHaulLoadingRate, 'End-haul loading rate'),
    borrowRate: numeric(h.borrowRate, 'Borrow rate'),
    wasteRate: numeric(h.wasteRate, 'Waste rate'),
    mobilizationCost: numeric(h.mobilizationCost, 'Mobilization', 0, 1e9),
    contingencyPercent: numeric(h.contingencyPercent, 'Contingency percent', 0, 100),
  }
  if (haul.overhaulDistanceM < haul.freeHaulDistanceM)
    throw Error('Overhaul limit must be at least the free-haul distance.')
  for (const [values, label] of [
    [templates, 'Templates'],
    [assignments, 'Assignments'],
    [materials, 'Materials'],
    [strata, 'Horizons'],
    [culverts, 'Culverts'],
    [sites, 'Haul sites'],
  ] as const)
    unique(values, label)
  if (assignments.some((a) => !templates.some((t) => t.id === a.templateId)))
    throw Error('A template assignment references a missing template.')
  if (strata.some((s) => !materials.some((m) => m.id === s.materialId)))
    throw Error('A horizon references a missing material.')
  for (const material of materials)
    if (material.purpose === 'stripping' && material.reusableFraction !== 0)
      throw Error('Excavated stripping must have a zero reusable fraction.')
  for (let i = 0; i < assignments.length; i++)
    for (let j = i + 1; j < assignments.length; j++) {
      const a = assignments[i],
        b = assignments[j]
      if (
        Math.min(a.end, b.end) > Math.max(a.start, b.start) &&
        (a.side === b.side || a.side === 'both' || b.side === 'both')
      )
        throw Error('Template assignments on the same side cannot overlap. Split their station ranges.')
    }
  for (let i = 0; i < strata.length; i++)
    for (let j = i + 1; j < strata.length; j++) {
      const a = strata[i],
        b = strata[j]
      if (
        Math.min(a.end, b.end) > Math.max(a.start, b.start) &&
        Math.min(a.bottomDepthM ?? Infinity, b.bottomDepthM ?? Infinity) > Math.max(a.topDepthM, b.topDepthM)
      )
        throw Error('Material horizons cannot overlap in station and depth. Split their ranges.')
    }
  const surfacingSupply =
    r.surfacingSupply === undefined
      ? undefined
      : (() => {
          const s = record(r.surfacingSupply, 'Surfacing supply')
          if (typeof s.enabled !== 'boolean') throw Error('Surfacing supply enabled must be a boolean.')
          if (typeof s.sourceNotes !== 'string' || s.sourceNotes.length > 2000)
            throw Error('Surfacing source notes must contain at most 2,000 characters.')
          return {
            enabled: s.enabled,
            name: name(s.name, 'Surfacing source name'),
            acquisitionRate: numeric(s.acquisitionRate, 'Aggregate acquisition rate'),
            processingRate: numeric(s.processingRate, 'Aggregate processing rate'),
            loadingRate: numeric(s.loadingRate, 'Aggregate loading rate'),
            haulDistanceKm: numeric(s.haulDistanceKm, 'Aggregate one-way haul distance', 0, 1000),
            haulRate: numeric(s.haulRate, 'Aggregate haul rate'),
            placementRate: numeric(s.placementRate, 'Aggregate placement rate'),
            capacityM3: s.capacityM3 === null ? null : numeric(s.capacityM3, 'Aggregate capacity', 0, 1e12),
            sourceNotes: s.sourceNotes,
          }
        })()
  const result = {
    templates,
    assignments,
    materials,
    strata,
    culverts,
    sites,
    haul,
    ...(surfacingSupply ? { surfacingSupply } : {}),
  }
  validateEngineering(result)
  return result
}
