import type { AlignmentEngineering, RoadTemplate, SectionComponent, SectionLayer, SitePreparationRange } from './types'

const number = (v: unknown, min: number, max: number, name: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
    throw Error(`${name} must be between ${min} and ${max}.`)
  return v
}
const text = (v: unknown, name: string, max = 200): string => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw Error(`${name} is missing or too long.`)
  return v.trim()
}
const records = (v: unknown, name: string, max: number): Record<string, unknown>[] => {
  if (!Array.isArray(v) || v.length > max || v.some((r) => !r || typeof r !== 'object' || Array.isArray(r)))
    throw Error(`${name} supports at most ${max} records.`)
  return v as Record<string, unknown>[]
}
const unique = (rows: { id: string }[], name: string) => {
  if (new Set(rows.map((r) => r.id)).size !== rows.length) throw Error(`${name} IDs must be unique.`)
}

/** Shared strict parsing for project files and calculation inputs. */
export function parseSectionComponents(input: unknown, allowAlternativeKeys = false): SectionComponent[] {
  const rows = records(input, 'Section components', 40).map((r): SectionComponent => {
    if (
      !['left', 'right'].includes(String(r.side)) ||
      !['bench', 'slope', 'wall', 'key'].includes(String(r.kind)) ||
      !['always', 'cut', 'fill'].includes(String(r.condition))
    )
      throw Error('Choose a component side, kind and condition.')
    return {
      id: text(r.id, 'Component ID', 100),
      name: text(r.name, 'Component name'),
      side: r.side as SectionComponent['side'],
      kind: r.kind as SectionComponent['kind'],
      condition: r.condition as SectionComponent['condition'],
      widthM: number(r.widthM, 0.01, 50, 'Component width'),
      riseM: number(r.riseM, -30, 30, 'Component rise'),
      ...(r.depthM !== undefined ? { depthM: number(r.depthM, 0, 20, 'Key depth') } : {}),
      ...(r.offsetM !== undefined ? { offsetM: number(r.offsetM, 0, 50, 'Key offset') } : {}),
      ...(r.materialId !== undefined ? { materialId: text(r.materialId, 'Component material', 100) } : {}),
      ...(r.code !== undefined ? { code: text(r.code, 'Component point code', 100) } : {}),
      ...(r.referenceFeatureId !== undefined
        ? { referenceFeatureId: text(r.referenceFeatureId, 'Reference feature ID', 200) }
        : {}),
      ...(r.referenceSurfaceId !== undefined
        ? { referenceSurfaceId: text(r.referenceSurfaceId, 'Reference surface ID', 200) }
        : {}),
      ...(r.referenceOffsetM !== undefined
        ? { referenceOffsetM: number(r.referenceOffsetM, -100, 100, 'Reference horizontal offset') }
        : {}),
      ...(r.referenceElevationM !== undefined
        ? { referenceElevationM: number(r.referenceElevationM, -100, 100, 'Reference vertical offset') }
        : {}),
    }
  })
  unique(rows, 'Section component')
  if (rows.some((r) => ['subgrade', 'surfacing'].includes(r.id)))
    throw Error('Component IDs cannot use the reserved subgrade or surfacing demand names.')
  for (const side of allowAlternativeKeys ? [] : ['left', 'right']) {
    const keys = rows.filter((r) => r.side === side && r.kind === 'key')
    for (let i = 0; i < keys.length; i++)
      for (let j = 0; j < i; j++)
        if (
          Math.min((keys[i].offsetM ?? 0) + keys[i].widthM, (keys[j].offsetM ?? 0) + keys[j].widthM) >
          Math.max(keys[i].offsetM ?? 0, keys[j].offsetM ?? 0)
        )
          throw Error('Key excavations cannot overlap on one side.')
  }
  return rows
}

export function parseSectionLayers(input: unknown): SectionLayer[] {
  const rows = records(input, 'Surface layers', 20).map((r): SectionLayer => {
    if (!['left', 'right', 'both'].includes(String(r.side))) throw Error('Choose a layer side.')
    return {
      id: text(r.id, 'Layer ID', 100),
      name: text(r.name, 'Layer name'),
      side: r.side as SectionLayer['side'],
      depthM: number(r.depthM, 0, 2, 'Layer depth'),
      ...(r.materialId !== undefined ? { materialId: text(r.materialId, 'Layer material', 100) } : {}),
    }
  })
  unique(rows, 'Layer')
  if (rows.some((r) => r.id === 'subgrade'))
    throw Error('Surface course IDs cannot use the reserved subgrade demand name.')
  for (const side of ['left', 'right'])
    if (rows.filter((r) => r.side === side || r.side === 'both').reduce((s, r) => s + r.depthM, 0) > 5)
      throw Error('The surface course stack cannot exceed 5 m per side.')
  return rows
}

export function parseSitePreparation(input: unknown): SitePreparationRange[] {
  const rows = records(input, 'Site preparation', 100).map((r): SitePreparationRange => {
    const start = number(r.start, 0, 100000, 'Site preparation start'),
      end = number(r.end, 0, 100000, 'Site preparation end')
    if (end <= start) throw Error('Site preparation needs an increasing station range.')
    return {
      id: text(r.id, 'Site preparation ID', 100),
      start,
      end,
      depthM: number(r.depthM, 0, 20, 'Stripping depth'),
      materialId: text(r.materialId, 'Stripping material', 100),
      leftInsideM: number(r.leftInsideM, 0, 100, 'Left inside offset'),
      rightInsideM: number(r.rightInsideM, 0, 100, 'Right inside offset'),
      leftOutsideM: number(r.leftOutsideM, 0, 50, 'Left outside offset'),
      rightOutsideM: number(r.rightOutsideM, 0, 50, 'Right outside offset'),
    }
  })
  unique(rows, 'Site preparation')
  for (let i = 0; i < rows.length; i++)
    for (let j = 0; j < i; j++)
      if (Math.min(rows[i].end, rows[j].end) > Math.max(rows[i].start, rows[j].start) + 1e-7)
        throw Error('Site preparation station ranges cannot overlap.')
  return rows
}

export function validateSectionAssembly(t: RoadTemplate) {
  if (t.components !== undefined) parseSectionComponents(t.components)
  if (t.layers !== undefined) parseSectionLayers(t.layers)
  if (t.components?.some((c) => t.layers?.some((l) => l.id === c.id)))
    throw Error('A component and a surface course cannot share a demand ID.')
}

export function validateSectionMaterials(t: RoadTemplate, e?: AlignmentEngineering) {
  for (const c of [...(t.components ?? []), ...(t.layers ?? [])])
    if (c.materialId) {
      const material = e?.materials.find((m) => m.id === c.materialId)
      if (!material) throw Error('Section assembly refers to an unknown material.')
      if (material.purpose === 'stripping')
        throw Error('Stripping material cannot be required as component or surface-course fill.')
    }
  const all = [t, ...(e?.templates.map((d) => d.template) ?? [])]
  const componentIds = new Set(all.flatMap((s) => (s.components ?? []).map((c) => c.id)))
  if (all.some((s) => s.layers?.some((l) => componentIds.has(l.id))))
    throw Error('Component and surface layer demand IDs cannot collide across templates.')
}

export function validatePreparation(e: AlignmentEngineering) {
  if (e.sitePreparation !== undefined) {
    parseSitePreparation(e.sitePreparation)
    for (const r of e.sitePreparation) {
      const material = e.materials.find((m) => m.id === r.materialId)
      if (!material || material.purpose !== 'stripping' || material.reusableFraction !== 0)
        throw Error('Site preparation requires an existing stripping material with zero reusable fraction.')
    }
  }
  for (const m of e.materials)
    for (const field of ['cutSlope', 'fillSlope'] as const)
      if (m[field] !== undefined) number(m[field], 0.1, 10, `${m.name} ${field} H:V`)
  const templates = e.templates.map((d) => d.template)
  const componentIds = new Set(templates.flatMap((t) => (t.components ?? []).map((c) => c.id)))
  if (templates.some((t) => t.layers?.some((l) => componentIds.has(l.id))))
    throw Error('Component and surface layer demand IDs cannot collide across templates.')
  for (const t of templates) validateSectionMaterials(t, e)
}

/** Course demands; explicit layers replace rather than add to the old surface depth. */
export function surfaceLayerAreas(t: RoadTemplate, leftWidth: number, rightWidth: number) {
  if (t.layers !== undefined) {
    const areas = new Map<string, { id: string; name: string; materialId?: string; areaM2: number }>()
    for (const layer of t.layers) {
      const key = `${layer.id}:${layer.materialId ?? ''}`
      const areaM2 =
        layer.depthM *
        (layer.side === 'left' ? leftWidth : layer.side === 'right' ? rightWidth : leftWidth + rightWidth)
      const old = areas.get(key)
      if (old) old.areaM2 += areaM2
      else
        areas.set(key, {
          id: layer.id,
          name: layer.name,
          ...(layer.materialId ? { materialId: layer.materialId } : {}),
          areaM2,
        })
    }
    return [...areas.values()]
  }
  return [
    {
      id: 'surfacing',
      name: 'Surfacing',
      areaM2: leftWidth * (t.leftSurfaceDepth ?? t.surfaceDepth) + rightWidth * (t.rightSurfaceDepth ?? t.surfaceDepth),
    },
  ]
}
