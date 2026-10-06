/** The tools' document and job builders are independent of React, DOM and network. */
import { parseScene, type ForestryScene } from './scene'
import { findSceneLandform, sceneFingerprint } from './sceneInput'
import { polygonAreaMeters } from './visibility'
import { parseRasters } from './localRaster'
import type { LocalRaster } from './types'
import type { AnalysisResult, Viewpoint } from './types'
import { assessVia, type ViaAssessment } from './via'

export const MAX_TOOL_JOBS = 12
export type ToolOption = { id: string; name: string; scene: ForestryScene }
export type ToolView = { id: string; name: string; viewpoint: Viewpoint; landformId: string | null; notes: string }
export type FieldRecord = {
  id: string
  name: string
  viewId: string | null
  kind: 'photo' | 'simulation' | 'map' | 'design'
  image: string
  width: number
  height: number
  captured: string
  notes: string
  lng: number | null
  lat: number | null
  altitude: number | null
  bearing: number | null
  pitch: number
  roll: number
  hfov: number | null
  verticalReference?: string
  focalMm: number | null
  focal35Mm: number | null
  originalName: string
  alignmentChecked: boolean
  annotations: Array<{ x: number; y: number; label: string }>
}
export type RunSummary = Pick<
  AnalysisResult,
  | 'perspectiveByStation'
  | 'perspectiveAlteration'
  | 'planimetricAlteration'
  | 'assessmentStationIndex'
  | 'quality'
  | 'demResolutionMeters'
  | 'actualSightlineCount'
  | 'sourceNotes'
> & {
  stations: Array<{ lng: number; lat: number; groundElevationMeters: number | null; distanceAlongMeters: number }>
  blockAreaHa: number
  visibleHa: number
  numericalClass: string | null
  via: ViaAssessment
}
export type ToolJob = {
  id: string
  name: string
  scene: ForestryScene
  kind: 'comparison' | 'matrix' | 'stability' | 'timeline'
  viewId?: string
  year?: number
}
export type ToolRun = ToolJob & { summary: RunSummary | null; error: string | null; generatedAt: string }
export type ToolsDocument = {
  version: 1
  currentScene?: ForestryScene
  options: ToolOption[]
  views: ToolView[]
  fields: FieldRecord[]
  runs: ToolRun[]
  growthCurve: Array<{ age: number; height: number }>
  growthSource: string
}
export const emptyTools = (): ToolsDocument => ({
  version: 1,
  options: [],
  views: [],
  fields: [],
  runs: [],
  growthCurve: [],
  growthSource: '',
})
export function parseTools(raw: unknown): ToolsDocument {
  const d = raw as ToolsDocument
  if (
    !d ||
    d.version !== 1 ||
    !Array.isArray(d.options) ||
    !Array.isArray(d.views) ||
    !Array.isArray(d.fields) ||
    !Array.isArray(d.runs) ||
    d.options.length > 12 ||
    d.views.length > 12 ||
    d.fields.length > 24 ||
    d.runs.length > MAX_TOOL_JOBS
  )
    throw new Error('Invalid assessment tools document or too many records.')
  const pool = new Map<string, LocalRaster>()
  const wire = raw as ToolsDocument & { localRasterPool?: Array<{ key: string; raster: LocalRaster }> }
  if (wire.localRasterPool !== undefined) {
    if (!Array.isArray(wire.localRasterPool) || wire.localRasterPool.length > 50)
      throw new Error('Invalid workspace raster pool.')
    for (const asset of wire.localRasterPool) {
      if (typeof asset?.key !== 'string' || pool.has(asset.key))
        throw new Error('Invalid or duplicate raster reference.')
      pool.set(asset.key, parseRasters([asset.raster])[0])
    }
  }
  const scene = (value: unknown) => {
    const raw = value as ForestryScene & { localRasterRefs?: string[] }
    let restored: unknown = value
    if (raw?.localRasterRefs !== undefined) {
      if (!Array.isArray(raw.localRasterRefs) || raw.localRasterRefs.length > 2 || raw.localRasters?.length)
        throw new Error('Invalid scene raster references.')
      restored = {
        ...raw,
        localRasters: raw.localRasterRefs.map((key) => {
          const raster = pool.get(key)
          if (!raster) throw new Error('A scene references a missing local raster.')
          return raster
        }),
      }
    }
    const parsed = parseScene(restored)
    if (
      !parsed ||
      !Array.isArray(raw.targets) ||
      raw.targets.length > 3000 ||
      parsed.targets.length !== raw.targets.length ||
      !Array.isArray(raw.viewpoint?.coordinates) ||
      parsed.viewpoint.coordinates.length !== raw.viewpoint.coordinates.length ||
      !sceneFingerprint(parsed) ||
      parsed.targets.some((t) => !(polygonAreaMeters(t.geometry) > 0))
    )
      throw new Error('A saved assessment scene is invalid.')
    return parsed
  }
  const identity = (v: { id: string; name: string }) => {
    if (
      !v ||
      typeof v.id !== 'string' ||
      !v.id ||
      v.id.length > 200 ||
      typeof v.name !== 'string' ||
      v.name.length > 200
    )
      throw new Error('A saved record is missing its name or ID.')
  }
  const fields = d.fields.map((f) => {
    identity(f)
    if (
      !['photo', 'simulation', 'map', 'design'].includes(f.kind) ||
      typeof f.image !== 'string' ||
      !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(f.image) ||
      f.image.length > 2_000_000 ||
      !Number.isFinite(f.width) ||
      !Number.isFinite(f.height) ||
      f.width <= 0 ||
      f.height <= 0 ||
      !Array.isArray(f.annotations) ||
      f.annotations.length > 50 ||
      f.annotations.some(
        (a) =>
          !Number.isFinite(a.x) ||
          !Number.isFinite(a.y) ||
          a.x < 0 ||
          a.x > 1 ||
          a.y < 0 ||
          a.y > 1 ||
          typeof a.label !== 'string',
      )
    )
      throw new Error('A field attachment or annotation is invalid.')
    for (const [value, min, max] of [
      [f.lng, -180, 180],
      [f.lat, -85, 85],
      [f.altitude, -1000, 10000],
      [f.bearing, 0, 360],
      [f.hfov, 1, 179],
    ] as const)
      if (value != null && (!Number.isFinite(value) || value < min || value > max))
        throw new Error('A field camera value is out of range.')
    if (
      ![f.pitch, f.roll].every(Number.isFinite) ||
      typeof f.notes !== 'string' ||
      typeof f.captured !== 'string' ||
      (f.verticalReference !== undefined && typeof f.verticalReference !== 'string')
    )
      throw new Error('Invalid field observation.')
    return f
  })
  const options = d.options.map((v) => {
    identity(v)
    return { ...v, scene: scene(v.scene) }
  })
  const views = d.views.map((v) => {
    identity(v)
    const parsed = scene({ viewpoint: v.viewpoint, targets: [] })
    if (!parsed.viewpoint.coordinates.length) throw new Error('A saved viewpoint is empty.')
    return { ...v, viewpoint: parsed.viewpoint, notes: typeof v.notes === 'string' ? v.notes : '' }
  })
  const runs = d.runs.map((v) => {
    identity(v)
    if (
      !['comparison', 'matrix', 'stability', 'timeline'].includes(v.kind) ||
      typeof v.generatedAt !== 'string' ||
      !Number.isFinite(Date.parse(v.generatedAt))
    )
      throw new Error('A saved run has invalid metadata.')
    if (v.summary != null) validateRunSummary(v.summary)
    return {
      ...v,
      scene: scene(v.scene),
      summary: v.summary ?? null,
      error: typeof v.error === 'string' ? v.error : null,
    }
  })
  for (const group of [options, views, fields, runs])
    if (new Set(group.map((v) => v.id)).size !== group.length) throw new Error('Duplicate record IDs in this document.')
  const growthCurve = Array.isArray(d.growthCurve)
    ? parseGrowthCurve(d.growthCurve.map((p) => `${p.age},${p.height}`).join('\n'))
    : []
  return {
    version: 1,
    ...(d.currentScene ? { currentScene: scene(d.currentScene) } : {}),
    options,
    views,
    fields,
    runs,
    growthCurve,
    growthSource: typeof d.growthSource === 'string' ? d.growthSource : '',
  }
}
export function parseGrowthCurve(text: string) {
  if (!text.trim()) return []
  const points = text
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      const cells = line.split(/[,;\t]/)
      if (cells.length !== 2 || cells.some((c) => !c.trim()))
        throw new Error('Enter a complete age,height pair on each line.')
      const [age, height, ...rest] = cells.map(Number)
      if (
        rest.length ||
        !Number.isFinite(age) ||
        !Number.isFinite(height) ||
        age < 0 ||
        age > 300 ||
        height < 0 ||
        height > 100
      )
        throw new Error('Enter one age,height pair per line, using metres and ages 0–300.')
      return { age, height }
    })
    .sort((a, b) => a.age - b.age)
  if (
    points.length < 2 ||
    points.length > 300 ||
    points.some((p, i) => i > 0 && (p.age === points[i - 1].age || p.height < points[i - 1].height))
  )
    throw new Error('Use at least two distinct ages with non-decreasing heights.')
  return points
}
export function heightAtAge(curve: ToolsDocument['growthCurve'], age: number): number | null {
  if (!curve.length || age < curve[0].age || age > curve[curve.length - 1].age) return null
  const hi = curve.findIndex((p) => p.age >= age)
  if (hi === 0) return curve[0].height
  const a = curve[hi - 1],
    b = curve[hi]
  return a.height + ((b.height - a.height) * (age - a.age)) / (b.age - a.age)
}
export function comparisonScene(base: ForestryScene, option: ForestryScene): ForestryScene {
  return {
    ...base,
    targets: [...base.targets.filter((t) => t.role !== 'block'), ...option.targets.filter((t) => t.role === 'block')],
    masks: [
      ...(base.masks ?? []).filter((m) => m.kind !== 'retained'),
      ...(option.masks ?? []).filter((m) => m.kind === 'retained'),
    ],
    viaReview: {},
  }
}
export function matrixJobs(base: ForestryScene, views: ToolView[], landformIds: string[]): ToolJob[] {
  if (!views.length || !landformIds.length || views.length * landformIds.length > MAX_TOOL_JOBS)
    throw new Error(`Select viewpoints and landforms for at most ${MAX_TOOL_JOBS} independent assessments.`)
  return views.flatMap((v) =>
    landformIds.map((id) => {
      const land = base.targets.find((t) => t.id === id && t.role === 'landscape')
      if (!land) throw new Error('A selected landform is no longer in this scene.')
      return {
        id: `matrix-${v.id}-${id}`,
        name: `${v.name} · ${land.name}`,
        kind: 'matrix',
        viewId: v.id,
        scene: { ...base, activeLandformId: id, viewpoint: v.viewpoint, viaReview: {} },
      }
    }),
  )
}
export function stabilityJobs(scene: ForestryScene): ToolJob[] {
  const variants: Array<[string, Partial<ForestryScene['settings']>]> = [
    ['Baseline', {}],
    ['Finer area sampling', { sampleBudget: Math.min(20000, scene.settings.sampleBudget * 2) }],
    ['Closer viewing stations', { stationSpacingMeters: Math.max(10, scene.settings.stationSpacingMeters / 2) }],
    ['Eye 0.5 m lower', { observerHeightMeters: Math.max(0.1, scene.settings.observerHeightMeters - 0.5) }],
    ['Eye 0.5 m higher', { observerHeightMeters: scene.settings.observerHeightMeters + 0.5 }],
    ['Vegetation screening comparison', { screeningEnabled: !scene.settings.screeningEnabled }],
  ]
  const jobs: ToolJob[] = variants.map(([name, settings], i) => ({
    id: `stability-${i}`,
    name,
    kind: 'stability',
    scene: { ...scene, settings: { ...scene.settings, ...settings }, viaReview: {} },
  }))
  if (scene.localRasters?.some((r) => r.kind === 'terrain'))
    jobs.push({
      id: 'stability-default-terrain',
      name: 'AWS terrain comparison',
      kind: 'stability',
      scene: { ...scene, localRasters: scene.localRasters.filter((r) => r.kind !== 'terrain'), viaReview: {} },
    })
  return jobs
}
/** Scheduling is separate from ordinary assessment. Recovery never uses a mean-slope shortcut. */
export function timelineScene(
  base: ForestryScene,
  year: number,
  curve: ToolsDocument['growthCurve'],
  requiredHeightById: Record<string, number | null>,
): ForestryScene {
  return {
    ...base,
    assessmentYear: year,
    viaReview: {},
    targets: base.targets.flatMap((t) => {
      if (t.role !== 'block') return [t]
      const date = t.plannedHarvestYear
      if (date == null || !Number.isInteger(date) || date < 1900 || date > 2200)
        throw new Error(`Record the planned harvest year for ${t.name}.`)
      if (date > year) return []
      if (date === year) return [t]
      if (t.harvestSystem === 'partial')
        throw new Error(
          'Future partial-cut recovery requires a supported stand model. Compare its harvest year separately.',
        )
      const height = heightAtAge(curve, year - date),
        required = requiredHeightById[t.id]
      return [
        {
          ...t,
          role: 'harvested' as const,
          harvestYear: date,
          clearcutPercent: 100,
          recoveryPercent: height !== null && required != null ? (height >= required ? 100 : 0) : null,
          source: `Scheduled harvest; ${height === null ? 'stated age assumption' : `${height.toFixed(2)} m supplied height curve; ${required ?? 'unknown'} m required`}`,
        },
      ]
    }),
  }
}
export function proposedAreaHa(scene: ForestryScene) {
  return scene.targets.filter((t) => t.role === 'block').reduce((n, t) => n + polygonAreaMeters(t.geometry) / 10000, 0)
}
export function objectiveFor(scene: ForestryScene) {
  return findSceneLandform(scene)?.objectiveId ?? 'partial-retention'
}
export function summarizeRun(scene: ForestryScene, result: AnalysisResult): RunSummary {
  const via = assessVia({
    objectiveId: objectiveFor(scene),
    result,
    review: scene.viaReview,
    blocks: scene.targets.filter((t) => t.role === 'block'),
  })
  return {
    stations: result.stations.map((s) => ({
      ...s,
      groundElevationMeters: Number.isFinite(s.groundElevationMeters) ? s.groundElevationMeters : null,
    })),
    perspectiveByStation: result.perspectiveByStation,
    perspectiveAlteration: result.perspectiveAlteration,
    planimetricAlteration: result.planimetricAlteration,
    assessmentStationIndex: result.assessmentStationIndex,
    quality: result.quality,
    demResolutionMeters: result.demResolutionMeters,
    actualSightlineCount: result.actualSightlineCount,
    sourceNotes: result.sourceNotes,
    blockAreaHa: proposedAreaHa(scene),
    visibleHa: result.targets.filter((t) => t.role === 'block').reduce((n, t) => n + t.visibleAreaMeters / 10000, 0),
    numericalClass: via.initialClass?.id ?? null,
    via,
  }
}

/** Imported summaries are historical data, but must be safe to display and export. */
function validateRunSummary(s: RunSummary) {
  const finiteOrNull = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v))
  const breakdown = (v: AnalysisResult['perspectiveAlteration']) =>
    v === null ||
    (!!v &&
      ['existingPercent', 'proposedPercent', 'disturbancePercent', 'cumulativePercent'].every(
        (k) => typeof v[k as keyof typeof v] === 'number' && Number.isFinite(v[k as keyof typeof v]),
      ))
  const strings = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string')
  if (
    !s ||
    !Array.isArray(s.stations) ||
    !s.stations.length ||
    s.stations.length > 400 ||
    s.stations.some(
      (p) => ![p.lng, p.lat, p.distanceAlongMeters].every(Number.isFinite) || !finiteOrNull(p.groundElevationMeters),
    ) ||
    !Array.isArray(s.perspectiveByStation) ||
    s.perspectiveByStation.length !== s.stations.length ||
    !s.perspectiveByStation.every(breakdown) ||
    !breakdown(s.perspectiveAlteration) ||
    !breakdown(s.planimetricAlteration) ||
    !Number.isInteger(s.assessmentStationIndex) ||
    s.assessmentStationIndex < 0 ||
    s.assessmentStationIndex >= s.stations.length ||
    ![s.blockAreaHa, s.visibleHa, s.demResolutionMeters].every(
      (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0,
    ) ||
    !s.quality ||
    typeof s.quality.numericalReady !== 'boolean' ||
    !strings(s.quality.warnings) ||
    (s.sourceNotes !== undefined && !strings(s.sourceNotes))
  )
    throw new Error('A saved numerical summary is invalid.')
  if (s.numericalClass !== null && typeof s.numericalClass !== 'string')
    throw new Error('Invalid saved numerical class.')
  const v = s.via
  if (
    !v ||
    typeof v.objective?.label !== 'string' ||
    !finiteOrNull(v.initialPercent) ||
    !finiteOrNull(v.designTotal) ||
    !finiteOrNull(v.roads) ||
    !finiteOrNull(v.retentionFactor) ||
    !finiteOrNull(v.y) ||
    typeof v.rationaleWritten !== 'boolean' ||
    (v.rating !== null && typeof v.rating?.label !== 'string') ||
    (v.adjusted !== null && !finiteOrNull(v.adjusted?.percent)) ||
    (v.initialClass !== null && typeof v.initialClass?.id !== 'string') ||
    (v.ocular !== null && typeof v.ocular?.classId !== 'string')
  )
    throw new Error('A saved VIA reviewer summary is invalid.')
}

/** Store raster cells once on the wire, even when twelve assessments share them. */
export function serializeTools(document: ToolsDocument): string {
  const d = parseTools(document),
    assets: Array<{ key: string; raster: LocalRaster }> = [],
    keys = new Map<string, string>()
  const scene = (value: ForestryScene) => {
    const { localRasters, ...rest } = value
    const refs = (localRasters ?? []).map((raster) => {
      const signature = JSON.stringify(raster),
        known = keys.get(signature)
      if (known) return known
      const key = `raster-${assets.length + 1}`
      keys.set(signature, key)
      assets.push({ key, raster })
      return key
    })
    return { ...rest, ...(refs.length ? { localRasterRefs: refs } : {}) }
  }
  const payload = {
    ...d,
    currentScene: d.currentScene ? scene(d.currentScene) : undefined,
    options: d.options.map((o) => ({ ...o, scene: scene(o.scene) })),
    runs: d.runs.map((r) => ({ ...r, scene: scene(r.scene) })),
    localRasterPool: assets,
  }
  const text = JSON.stringify(payload, null, 2)
  if (new TextEncoder().encode(text).length > 100_000_000)
    throw new Error(
      'Workspace exceeds 100 MB. Export the scene separately and remove unused attachments or saved designs before exporting this workspace.',
    )
  return text
}
