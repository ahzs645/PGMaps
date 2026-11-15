/** The tools' document and job builders are independent of React, DOM and network. */
import { parseScene, type ForestryScene } from './scene'
import { findSceneLandform, sceneFingerprint } from './sceneInput'
import { polygonAreaMeters } from './visibility'
import { parseRasters } from './localRaster'
import type { LocalRaster } from './types'
import type { AnalysisResult, Viewpoint } from './types'
import { assessVia, type ViaAssessment } from './via'
import { heightCurveProblem, MAX_LIBRARY_CURVES, type LibraryCurve } from './castorCurves'
import { greenUpReading } from './greenUp'
import { runHeadline, type HeadlineScale } from './runRevision'

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
  /**
   * The landform's figure on each scale against the objective's range, as the Results panel reads it
   * (`runHeadline`). Absent on runs recorded before it, and when the run had no active landform.
   */
  scales?: HeadlineScale[]
}
export const TOOL_JOB_KINDS = ['comparison', 'matrix', 'stability', 'timeline', 'greenup'] as const
export type ToolJobKind = (typeof TOOL_JOB_KINDS)[number]
export type ToolJob = {
  id: string
  name: string
  scene: ForestryScene
  kind: ToolJobKind
  viewId?: string
  year?: number
  /** A green-up sensitivity job's green-up age, years. */
  greenUpAgeYears?: number
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
  /** Height–age curves loaded from a Castor scenario (`castorCurves.ts`), for blocks to take one each. */
  curveLibrary: LibraryCurve[]
  /** Block target ID → the library curve it grows on. A block not listed grows on the supplied curve. */
  blockCurves: Record<string, string>
}
export const emptyTools = (): ToolsDocument => ({
  version: 1,
  options: [],
  views: [],
  fields: [],
  runs: [],
  growthCurve: [],
  growthSource: '',
  curveLibrary: [],
  blockCurves: {},
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
      !(TOOL_JOB_KINDS as readonly string[]).includes(v.kind) ||
      (v.greenUpAgeYears !== undefined &&
        !(Number.isInteger(v.greenUpAgeYears) && v.greenUpAgeYears >= 1 && v.greenUpAgeYears <= 100)) ||
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
  const curveLibrary = parseCurveLibrary((d as { curveLibrary?: unknown }).curveLibrary)
  const known = new Set(curveLibrary.map((c) => c.id))
  const rawAssignments = (d as { blockCurves?: unknown }).blockCurves
  if (rawAssignments !== undefined && (typeof rawAssignments !== 'object' || rawAssignments === null))
    throw new Error('Invalid block curve assignments.')
  // An assignment whose curve was removed falls back to the supplied curve rather than failing the workspace.
  const blockCurves = Object.fromEntries(
    Object.entries((rawAssignments ?? {}) as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && known.has(entry[1]),
    ),
  )
  return {
    version: 1,
    ...(d.currentScene ? { currentScene: scene(d.currentScene) } : {}),
    options,
    views,
    fields,
    runs,
    growthCurve,
    growthSource: typeof d.growthSource === 'string' ? d.growthSource : '',
    curveLibrary,
    blockCurves,
  }
}
function parseCurveLibrary(raw: unknown): LibraryCurve[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.length > MAX_LIBRARY_CURVES) throw new Error('Invalid or too many loaded curves.')
  const curves = raw.map((entry) => {
    const c = entry as LibraryCurve
    if (
      !c ||
      typeof c.id !== 'string' ||
      !c.id ||
      c.id.length > 200 ||
      typeof c.label !== 'string' ||
      c.label.length > 200 ||
      typeof c.source !== 'string' ||
      c.source.length > 500 ||
      !Array.isArray(c.points)
    )
      throw new Error('A loaded height–age curve is missing its name or source.')
    const points = c.points.map((p) => ({ age: Number(p?.age), height: Number(p?.height) }))
    const problem = heightCurveProblem(points)
    if (problem) throw new Error(`Loaded curve ${c.label} ${problem}.`)
    return { id: c.id, label: c.label, source: c.source, points }
  })
  if (new Set(curves.map((c) => c.id)).size !== curves.length) throw new Error('Duplicate loaded curve IDs.')
  return curves
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
/**
 * What a design is: its proposed blocks (geometry and harvest system) and its
 * retained patches — exactly what `comparisonScene` takes from an alternative.
 */
function designSignature(scene: ForestryScene): string {
  return JSON.stringify([
    scene.targets
      .filter((target) => target.role === 'block')
      .map((target) => [
        target.geometry,
        target.harvestSystem ?? null,
        target.retentionPercent ?? null,
        target.volumeRemovedPercent ?? null,
      ]),
    (scene.masks ?? []).filter((mask) => mask.kind === 'retained').map((mask) => mask.geometry),
  ])
}

/**
 * The saved design alternative the scene currently shows, by name, or null
 * when it shows none of them (an unsaved or edited design). A saved view
 * records it, so a report can set the same view under two designs side by side.
 */
export function matchingDesign(scene: ForestryScene, options: ReadonlyArray<ToolOption>): ToolOption | null {
  const current = designSignature(scene)
  return options.find((option) => designSignature(option.scene) === current) ?? null
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
/**
 * Scheduling is separate from ordinary assessment. Recovery never uses a mean-slope shortcut.
 *
 * Each block grows on its own loaded curve (`byBlock`, from a Castor yield table) when it has one,
 * else on the supplied curve. Green-up is the curve's height at the opening's age against the
 * block's own area-weighted Table 6 height (`requiredHeightById`); outside the curve's recorded
 * ages the scene's stated green-up age applies, as for any existing opening.
 *
 * A partial cut harvested in an earlier year stays a partial cut, so its Table 6 figure (volume
 * removed against residual height, as recorded) keeps counting until the same green-up test says
 * the regeneration in its gaps has reached green-up height; from then it counts nothing. The
 * residual trees are never grown: Table 6 rises with residual height, so growing them would make
 * an older partial cut read as a larger alteration.
 */
export function timelineScene(
  base: ForestryScene,
  year: number,
  curve: ToolsDocument['growthCurve'],
  requiredHeightById: Record<string, number | null>,
  byBlock: Readonly<Record<string, LibraryCurve>> = {},
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
      const own = byBlock[t.id]
      const points = own?.points ?? curve
      const curveName = own ? `Castor curve ${own.label}` : 'supplied height curve'
      const height = points.length ? heightAtAge(points, year - date) : null,
        required = requiredHeightById[t.id]
      const tested = height !== null && required != null
      const basis = tested
        ? `${height.toFixed(2)} m on the ${curveName}; ${required.toFixed(2)} m required`
        : `stated ${base.settings.greenUpAgeYears}-year green-up age`
      if (t.harvestSystem === 'partial') {
        const greenedUp = tested ? height >= required : year - date >= base.settings.greenUpAgeYears
        if (!greenedUp)
          return [
            { ...t, source: `Partial cut harvested ${date}, not yet greened up (${basis}); Table 6 still counts` },
          ]
        return [
          {
            ...t,
            role: 'harvested' as const,
            harvestYear: date,
            clearcutPercent: 100,
            recoveryPercent: 100,
            source: `Partial cut harvested ${date}, greened up (${basis})`,
          },
        ]
      }
      return [
        {
          ...t,
          role: 'harvested' as const,
          harvestYear: date,
          clearcutPercent: 100,
          recoveryPercent: tested ? (height >= required ? 100 : 0) : null,
          source: `Scheduled harvest; ${basis}`,
        },
      ]
    }),
  }
}

/** The green-up ages the sensitivity compares, either side of the scene's own. */
export const GREEN_UP_SENSITIVITY_OFFSETS = [-10, -5, 0, 5, 10] as const

export function greenUpSensitivityAges(current: number): number[] {
  return [...new Set(GREEN_UP_SENSITIVITY_OFFSETS.map((offset) => current + offset))].filter(
    (age) => Number.isInteger(age) && age >= 1 && age <= 100,
  )
}

/**
 * Existing openings whose count changes somewhere across `ages`: ones the model reads by the
 * green-up age alone (no field check in use, no supplied recovery estimate) and whose age at the
 * assessment year lies between the shortest and longest age compared.
 */
export function greenUpSensitiveOpenings(
  scene: ForestryScene,
  ages: readonly number[],
  year: number,
): Array<{ id: string; name: string; harvestYear: number; ageYears: number }> {
  if (!ages.length) return []
  const shortest = Math.min(...ages),
    longest = Math.max(...ages)
  return scene.targets.flatMap((t) => {
    if (t.role !== 'harvested' || t.harvestYear == null) return []
    const reading = greenUpReading(t, year, scene.settings.greenUpAgeYears)
    if (reading.used !== 'modelled' || reading.modelled.basis !== 'age') return []
    const ageYears = year - t.harvestYear
    return ageYears >= shortest && ageYears < longest
      ? [{ id: t.id, name: t.name, harvestYear: t.harvestYear, ageYears }]
      : []
  })
}

/**
 * One run per green-up age either side of the scene's own: the same scene with only
 * `settings.greenUpAgeYears` changed. Openings with a field check or a supplied recovery
 * estimate keep their share, as in any run. The scene's own age is never changed.
 */
export function greenUpJobs(scene: ForestryScene): ToolJob[] {
  if (!scene.targets.some((t) => t.role === 'harvested' && t.harvestYear != null))
    throw new Error('No existing opening has a harvest year, so the green-up age changes nothing here.')
  const current = scene.settings.greenUpAgeYears
  return greenUpSensitivityAges(current).map((age) => ({
    id: `greenup-${age}`,
    name: `Green-up age ${age} years${age === current ? ' (scene)' : ''}`,
    kind: 'greenup' as const,
    greenUpAgeYears: age,
    scene: { ...scene, settings: { ...scene.settings, greenUpAgeYears: age }, viaReview: {} },
  }))
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
    ...scalesFor(scene, result),
  }
}
function scalesFor(scene: ForestryScene, result: AnalysisResult): { scales?: HeadlineScale[] } {
  const headline = runHeadline(result, findSceneLandform(scene), scene.thresholds)
  return headline ? { scales: headline.scales } : {}
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
  if (
    s.scales !== undefined &&
    (!Array.isArray(s.scales) ||
      s.scales.length > 2 ||
      s.scales.some(
        (scale) =>
          !scale ||
          (scale.basis !== 'perspective' && scale.basis !== 'planimetric') ||
          !finiteOrNull(scale.percent) ||
          (scale.classId !== null && typeof scale.classId !== 'string') ||
          (scale.met !== null && typeof scale.met !== 'boolean') ||
          ![scale.floorPercent, scale.maxPercent].every((v) => typeof v === 'number' && Number.isFinite(v)),
      ))
  )
    throw new Error('A saved objective reading is invalid.')
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
