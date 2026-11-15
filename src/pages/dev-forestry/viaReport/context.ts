/**
 * The report's context from what the page holds: the scene's blocks and landform, the office fields, the saved views'
 * figures (through `documentFacts`), the run's assessment and the reviewer's record, and the settings each view was
 * saved with. One function, so the dialog's contents and the file read the same context. No DOM or network access.
 */
import type { SavedFigure } from '../FigureSheetPanel'
import type { ForestryScene } from '../scene'
import { findSceneLandform } from '../sceneInput'
import type { AlterationBreakdown, AssessmentMask, TargetPolygon } from '../types'
import type { ViaAssessment } from '../via'
import { documentFacts } from '../viaDocument/facts'
import { resolveViaDocument } from '../viaDocument/resolve'
import type { ClassCode } from '../viaDocument/scales'
import { pointInPolygon, polygonAreaMeters, type PolygonGeometry } from '../visibility'
import { EVQO_CODE_FOR_CLASS } from '../visualsNarrative'
import type { ReportFigure } from './model'
import type { OfficeFields, ReportBlockFacts, ReportContext, ReportImages } from './parts'
import { recipeFormat, type ReportRecipe } from './recipes'

const SYSTEM: Record<string, string> = {
  clearcut: 'Clearcut',
  retention: 'Dispersed retention',
  partial: 'Partial cut',
}

/** A polygon's first ring's mean vertex: a point inside it for the compact shapes masks are drawn as. */
function ringMean(geometry: PolygonGeometry): [number, number] {
  const ring = geometry.type === 'Polygon' ? geometry.coordinates[0] : geometry.coordinates[0][0]
  const points = ring.slice(0, -1)
  return [
    points.reduce((sum, p) => sum + p[0], 0) / Math.max(1, points.length),
    points.reduce((sum, p) => sum + p[1], 0) / Math.max(1, points.length),
  ]
}

/** Internal retention patches ("islands"): `retained` masks standing inside the block. */
export function islandsIn(block: TargetPolygon, masks: readonly AssessmentMask[]): number {
  return masks.filter((mask) => mask.kind === 'retained' && pointInPolygon(block.geometry, ...ringMean(mask.geometry)))
    .length
}

export function reportBlockFacts(block: TargetPolygon, masks: readonly AssessmentMask[] = []): ReportBlockFacts {
  const cut =
    block.harvestSystem === 'partial' && block.volumeRemovedPercent != null && block.residualHeightMeters != null
      ? { removedPercent: block.volumeRemovedPercent, residualHeightM: block.residualHeightMeters }
      : null
  return {
    name: block.name,
    areaHa: polygonAreaMeters(block.geometry) / 10_000,
    system: SYSTEM[block.harvestSystem ?? 'clearcut'] ?? 'Clearcut',
    retentionPercent: block.harvestSystem === 'retention' ? (block.retentionPercent ?? null) : null,
    partialCut: cut,
    islands: islandsIn(block, masks),
  }
}

/** Who drew the views' figures when another engine did, with its final render's samples. */
function drawnBy(views: readonly ReportView[]): string | null {
  const drawn = views.map((view) => view.figure.illustration).filter((entry) => !!entry)
  if (!drawn.length) return null
  const names = [...new Set(drawn.map((entry) => entry.renderer))]
  const samples = drawn.find((entry) => entry.final)?.final?.samples
  return `${names.join(' and ')}${samples ? ` at final quality (${samples} samples a frame)` : ''}${
    drawn.length < views.length ? `, for ${drawn.length} of the ${views.length} views` : ''
  }`
}

export interface ReportView {
  name: string
  figure: SavedFigure
  /** The settings the view was saved with (`ViewpointPage.settings`), when its screenshot was kept. */
  settings?: ReadonlyArray<{ label: string; value: string }> | null
}

export function buildReportContext(input: {
  recipe: ReportRecipe
  scene: ForestryScene
  views: readonly ReportView[]
  assessmentStation: number | null
  assessment: ViaAssessment | null
  breakdown: AlterationBreakdown | null
  figures: readonly ReportFigure[]
  /** Maps and extra pictures the page captured for the report file; absent for the dialog's own context. */
  images?: ReportImages
  date: Date
}): ReportContext {
  const { scene } = input
  const landform = findSceneLandform(scene)
  const objective: ClassCode | null = landform ? EVQO_CODE_FOR_CLASS[landform.objectiveId] : null
  const blocks = scene.targets.filter((target) => target.role === 'block')
  const facts = documentFacts({
    project: blocks.length ? blocks.map((entry) => entry.name).join(', ') : 'the proposed blocks',
    objective,
    views: input.views.map((view) => ({ name: view.name, figure: view.figure })),
    assessmentStation: input.assessmentStation,
    review: scene.viaReview ?? null,
    assessment: input.assessment,
    breakdown: input.breakdown,
  })
  const setting = (label: string) =>
    input.views.flatMap((view) => view.settings ?? []).find((row) => row.label === label)?.value ?? null
  const inventory =
    facts.viewpoints.find((vp) => vp.review && vp.inventory)?.inventory ??
    facts.viewpoints.find((vp) => vp.inventory)?.inventory ??
    null
  return {
    date: input.date,
    office: (scene.reportMetadata ?? {}) as OfficeFields,
    blocks: blocks.map((block) => reportBlockFacts(block, scene.masks ?? [])),
    // Every landform the scene holds, by the name the viewpoints read; descriptions and EVC overrides are the
    // reviewer's, so only names come from the scene.
    landforms: scene.targets.filter((target) => target.role === 'landscape').map((target) => ({ name: target.name })),
    landform: landform
      ? {
          name: landform.name,
          objective,
          vac: landform.vac,
          areaHa: polygonAreaMeters(landform.geometry) / 10_000,
          source: landform.source || 'drawn in step 1',
        }
      : null,
    inventory,
    inventoryRead: input.views.some((view) => view.figure.inventoryRead),
    facts,
    document: resolveViaDocument(recipeFormat(input.recipe), facts),
    assessment: input.assessment,
    review: scene.viaReview ?? null,
    breakdown: input.breakdown,
    method: {
      terrain: setting('Terrain') ?? 'AWS Open Data terrain (CDEM/SRTM)',
      vegetation: setting('Timber') ?? 'the provincial vegetation inventory',
      eyeHeightM: scene.settings.observerHeightMeters,
      drawnBy: drawnBy(input.views),
    },
    measures: (scene.viaReview?.visualMeasures ?? '')
      .split('\n')
      .map((line) => line.replace(/^\s*[-•\d.)]+\s*/, '').trim())
      .filter(Boolean),
    figures: input.figures,
    ...(input.images ? { images: input.images } : {}),
  }
}
