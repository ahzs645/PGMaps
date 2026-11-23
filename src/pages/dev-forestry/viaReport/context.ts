/**
 * The report's context from what the page holds: the scene's blocks and landform, the office fields, the saved views'
 * figures (through `documentFacts`), the run's assessment and the reviewer's record, and the settings each view was
 * saved with. One function, so the dialog's contents and the file read the same context. No DOM or network access.
 */
import { groupIdForName } from '../viewGroups'
import type { TimberMeasure } from '@/lib/forestry/viaFigure/timberScreen'
import type { SavedFigure } from '../FigureSheetPanel'
import { assessmentAlterationClipper } from '../assessmentMaskGeometry'
import { assessmentScope, type ScopeInput } from '../assessmentScope'
import { unitValues, type BadgeUnit } from '../inventoryBadge'
import type { ForestryScene } from '../scene'
import { findSceneLandform } from '../sceneInput'
import type { AlterationBreakdown, AssessmentMask, TargetPolygon } from '../types'
import type { ViaAssessment } from '../via'
import { atAssessmentStation, documentFacts } from '../viaDocument/facts'
import { resolveViaDocument, type DocumentFacts } from '../viaDocument/resolve'
import type { ClassCode } from '../viaDocument/scales'
import { pointInPolygon, polygonAreaMeters, polygonBounds, preparePolygons, type PolygonGeometry } from '../visibility'
import { EVQO_CODE_FOR_CLASS } from '../visualsNarrative'
import type { ReportFigure } from './model'
import type { InventoryUnitRow, OfficeFields, ReportBlockFacts, ReportContext, ReportEyes, ReportImages } from './parts'
import { recipeFormat, type ReportRecipe } from './recipes'
import type { ReportSetting } from './setting'

/** The facts with each sub-landform's parent as step 1 records it, so the discussion can say "in {parent} within". */
function withLandformParents(facts: DocumentFacts, scene: ForestryScene): DocumentFacts {
  const parents = Object.fromEntries(
    Object.entries(scene.viaReview?.landformRecords ?? {}).flatMap(([name, record]) =>
      record?.parent ? [[name, record.parent]] : [],
    ),
  )
  return Object.keys(parents).length ? { ...facts, landformParents: parents } : facts
}

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

/**
 * The block's hectares less the `retained` masks over it (wildlife tree patches / retention: the RESULTS reserves), as
 * clipped geometry in BC Albers hectares, the net area the 2001 forms print ("Block Area ha (No WTRAs/Reserves)").
 */
export function netOfReservesHa(block: TargetPolygon, masks: readonly AssessmentMask[]): number {
  const gross = polygonAreaMeters(block.geometry) / 10_000
  const reserves = masks.filter((mask) => mask.kind === 'retained')
  if (!reserves.length) return gross
  const net = assessmentAlterationClipper(reserves)(block.geometry)
  return net ? Math.min(gross, polygonAreaMeters(net) / 10_000) : 0
}

/** Reserve area below which a block reads as a plain clearcut: slivers where a mask only touches its edge. */
const MIN_RESERVE_HA = 0.05

export function reportBlockFacts(block: TargetPolygon, masks: readonly AssessmentMask[] = []): ReportBlockFacts {
  const areaHa = polygonAreaMeters(block.geometry) / 10_000
  const cut =
    block.harvestSystem === 'partial' && block.volumeRemovedPercent != null && block.residualHeightMeters != null
      ? { removedPercent: block.volumeRemovedPercent, residualHeightM: block.residualHeightMeters }
      : null
  const reservesHa = areaHa - netOfReservesHa(block, masks)
  const system = SYSTEM[block.harvestSystem ?? 'clearcut'] ?? 'Clearcut'
  return {
    name: block.name,
    areaHa,
    // A clearcut with mapped reserves (wildlife tree patches, retention) is printed as the VIAs print it.
    system: system === 'Clearcut' && reservesHa >= MIN_RESERVE_HA ? 'Clearcut with reserves' : system,
    retentionPercent: block.harvestSystem === 'retention' ? (block.retentionPercent ?? null) : null,
    partialCut: cut,
    islands: islandsIn(block, masks),
    reservesHa,
    plannedHarvestYear: block.plannedHarvestYear ?? null,
  }
}

/** Grid points inside a polygon, about `count` of them: what a block's share of each unit is sampled on. */
function gridInside(geometry: PolygonGeometry, count = 400): Array<[number, number]> {
  const [w, s, e, n] = polygonBounds(geometry)
  const side = Math.max(2, Math.ceil(Math.sqrt(count * 2)))
  const out: Array<[number, number]> = []
  const inside = preparePolygons([geometry]).contains
  for (let j = 0; j < side; j++)
    for (let i = 0; i < side; i++) {
      const lng = w + ((i + 0.5) / side) * (e - w)
      const lat = s + ((j + 0.5) / side) * (n - s)
      if (inside(lng, lat)) out.push([lng, lat])
    }
  return out
}

/**
 * The inventory units the report prints, one row each: every unit holding part of a block, with each block's
 * hectares in it (its BC Albers area times the share of grid samples inside the unit), largest first, then any unit a
 * viewpoint's figure chose that holds no block. With `masks`, a block holding a `retained` mask (a reserve) is also
 * split net of its reserves (`netBlocks`), on the grid samples outside them. Read from the live inventory only; no DOM
 * or network access.
 */
export function inventoryUnitRows(
  units: readonly BadgeUnit[],
  blocks: readonly TargetPolygon[],
  chosen: ReadonlyArray<string | undefined> = [],
  masks: readonly AssessmentMask[] = [],
): InventoryUnitRow[] {
  const held = new Map<BadgeUnit, Record<string, number>>()
  const heldNet = new Map<BadgeUnit, Record<string, number>>()
  const prepared = preparePolygons(units.map((unit) => unit.geometry))
  const reserves = masks.filter((mask) => mask.kind === 'retained')
  const inReserve = reserves.length ? preparePolygons(reserves.map((mask) => mask.geometry)).contains : null
  for (const block of blocks) {
    const points = gridInside(block.geometry)
    if (!points.length) continue
    const areaHa = polygonAreaMeters(block.geometry) / 10_000
    const counts = new Map<BadgeUnit, number>()
    const netCounts = new Map<BadgeUnit, number>()
    let netPoints = 0
    for (const [lng, lat] of points) {
      const unit = units[prepared.indexAt(lng, lat)]
      if (unit) counts.set(unit, (counts.get(unit) ?? 0) + 1)
      if (inReserve?.(lng, lat)) continue
      netPoints++
      if (unit) netCounts.set(unit, (netCounts.get(unit) ?? 0) + 1)
    }
    for (const [unit, count] of counts) {
      const row = held.get(unit) ?? {}
      row[block.name] = (row[block.name] ?? 0) + (areaHa * count) / points.length
      held.set(unit, row)
    }
    // Only a block with a reserve inside it has a net split; the rest print their area as is.
    if (netPoints === points.length) continue
    const netHa = netOfReservesHa(block, reserves)
    for (const unit of counts.keys()) {
      const row = heldNet.get(unit) ?? {}
      row[block.name] = (row[block.name] ?? 0) + (netPoints ? (netHa * (netCounts.get(unit) ?? 0)) / netPoints : 0)
      heldNet.set(unit, row)
    }
  }
  const rounded = (row: Record<string, number>) =>
    Object.fromEntries(Object.entries(row).map(([name, value]) => [name, Math.round(value * 100) / 100]))
  const total = (row: Record<string, number>) => Object.values(row).reduce((sum, ha) => sum + ha, 0)
  const rows: InventoryUnitRow[] = [...held]
    .sort((a, b) => total(b[1]) - total(a[1]))
    .map(([unit, ha]) => ({
      ...unitValues(unit),
      blocks: rounded(ha),
      ...(heldNet.has(unit) ? { netBlocks: rounded(heldNet.get(unit)!) } : {}),
    }))
  for (const vsu of chosen) {
    if (!vsu || rows.some((row) => row.vsu === vsu)) continue
    const unit = units.find((entry) => unitValues(entry).vsu === vsu)
    if (unit) rows.push(unitValues(unit))
  }
  return rows
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

/** Heights closer than this are one eye, metres: arithmetic noise, never a measured difference. */
const SAME_EYE_M = 1e-6

/**
 * Which eye each view stood at, read from its figure's camera information (what its picture and its sightline figure
 * were taken from): a surveyed elevation, or a height above the ground. `sceneEyeM` is the scene's eye height and
 * `runEyeM` the eye the current run used (its `settings.observerHeightMeters`, the stand's own where it had one), which
 * stands in for a view saved before its camera was recorded. The base is the scene's eye height while any view stood
 * at it, else the run's while any did, else none: every view is then named with its own.
 */
export function reportEyes(
  views: readonly Pick<ReportView, 'name' | 'figure'>[],
  sceneEyeM: number,
  runEyeM: number | null,
): ReportEyes {
  const metres = (value: number) => `${value.toFixed(1)} m`
  const read = views.map((view) => {
    const camera = view.figure.camera
    if (camera?.surveyed)
      return { view: view.name, heightM: null, eye: `a surveyed eye elevation of ${metres(camera.elevationM)}` }
    const heightM = camera ? camera.observerHeightM : (runEyeM ?? sceneEyeM)
    const above = camera?.above === 'lake level' ? 'lake level' : 'the ground'
    return { view: view.name, heightM, eye: `${metres(heightM)} above ${above}` }
  })
  const at = (eye: number) => read.some((entry) => entry.heightM !== null && Math.abs(entry.heightM - eye) < SAME_EYE_M)
  const baseM = !read.length
    ? (runEyeM ?? sceneEyeM)
    : at(sceneEyeM)
      ? sceneEyeM
      : runEyeM !== null && at(runEyeM)
        ? runEyeM
        : null
  return {
    baseM,
    own: read
      .filter((entry) => baseM === null || entry.heightM === null || Math.abs(entry.heightM - baseM) >= SAME_EYE_M)
      .map(({ view, eye }) => ({ view, eye })),
  }
}

export interface ReportView {
  name: string
  figure: SavedFigure
  /** The settings the view was saved with (`ViewpointPage.settings`), when its screenshot was kept. */
  settings?: ReadonlyArray<{ label: string; value: string }> | null
  /** PGMaps' with-timber measure of the view (`timberMeasureFor`), or why it has none; absent when not looked for. */
  timber?: TimberMeasure | null
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
  /**
   * The scene's visual inventory as read live (`queryVisualInventory`); absent when it has not been read. The views'
   * own units come with their figures (`withReadInventory` fills those saved before the read).
   */
  inventoryUnits?: readonly BadgeUnit[]
  /** Where the blocks are and what the land is like (`reportSetting`, `setting.ts`), when the page read it. */
  reportSetting?: ReportSetting | null
  /** What the run's existing openings' green-up rests on (`runGreenUpBasis(result).label`), when there is a run. */
  greenUp?: string | null
  /** What the run's existing disturbance rests on (`runExistingBasis(result).label`), when there is a run. */
  existing?: string | null
  date: Date
  /** Save & export's draft: a missing picture keeps its place with a box saying what goes there (`ReportContext.draft`). */
  draft?: boolean
  /** The run the figures come from, for the scope's denominators (`assessmentScope.ts`); absent before a run. */
  run?: ScopeInput['result']
}): ReportContext {
  const { scene } = input
  const landform = findSceneLandform(scene)
  const objective: ClassCode | null = landform ? EVQO_CODE_FOR_CLASS[landform.objectiveId] : null
  const blocks = scene.targets.filter((target) => target.role === 'block')
  const facts = documentFacts({
    project: blocks.length ? blocks.map((entry) => entry.name).join(', ') : 'the proposed blocks',
    objective,
    views: input.views.map((view) => ({
      name: view.name,
      figure: view.figure,
      ...(view.timber ? { timber: view.timber } : {}),
    })),
    assessmentStation: input.assessmentStation,
    review: scene.viaReview ?? null,
    assessment: input.assessment,
    breakdown: input.breakdown,
    greenUp: input.greenUp ?? null,
    existing: input.existing ?? null,
    // Each group of views of interest carries its own step 4 to its views.
    groupOf: (name) => groupIdForName(scene.viewsOfInterest ?? [], name),
    objectiveId: landform?.objectiveId ?? null,
  })
  const setting = (label: string) =>
    input.views.flatMap((view) => view.settings ?? []).find((row) => row.label === label)?.value ?? null
  const inventory =
    facts.viewpoints.find((vp) => atAssessmentStation(vp) && vp.inventory)?.inventory ??
    facts.viewpoints.find((vp) => vp.inventory)?.inventory ??
    null
  return {
    date: input.date,
    office: (scene.reportMetadata ?? {}) as OfficeFields,
    blocks: blocks.map((block) => reportBlockFacts(block, scene.masks ?? [])),
    // Every landform the scene holds, by the name the viewpoints read; descriptions and EVC overrides are the
    // reviewer's, so only names come from the scene, and a sub-landform's parent and divider from step 1's record.
    landforms: scene.targets
      .filter((target) => target.role === 'landscape')
      .map((target) => {
        const record = scene.viaReview?.landformRecords?.[target.name]
        return {
          name: target.name,
          ...(record?.parent ? { parent: record.parent } : {}),
          ...(record?.divider ? { divider: record.divider } : {}),
        }
      }),
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
    inventoryRead: !!input.inventoryUnits || input.views.some((view) => view.figure.inventoryRead),
    ...(input.inventoryUnits
      ? {
          inventoryUnits: inventoryUnitRows(
            input.inventoryUnits,
            blocks,
            facts.viewpoints.map((vp) => vp.inventory?.vsu),
            scene.masks ?? [],
          ),
        }
      : {}),
    facts,
    document: resolveViaDocument(recipeFormat(input.recipe), withLandformParents(facts, scene)),
    assessment: input.assessment,
    review: scene.viaReview ?? null,
    breakdown: input.breakdown,
    method: {
      terrain: setting('Terrain') ?? 'AWS Open Data terrain (CDEM/SRTM)',
      vegetation: setting('Timber') ?? 'the provincial vegetation inventory',
      eyeHeightM: scene.settings.observerHeightMeters,
      eyes: reportEyes(
        input.views,
        scene.settings.observerHeightMeters,
        input.run?.settings.observerHeightMeters ?? null,
      ),
      drawnBy: drawnBy(input.views),
    },
    measures: (scene.viaReview?.visualMeasures ?? '')
      .split('\n')
      .map((line) => line.replace(/^\s*[-•\d.)]+\s*/, '').trim())
      .filter(Boolean),
    figures: input.figures,
    ...(input.images ? { images: input.images } : {}),
    ...(input.reportSetting ? { setting: input.reportSetting } : {}),
    // What every figure is measured on: the run's landform, its units, the blocks gross and net, the denominators.
    scope: assessmentScope({
      targets: scene.targets,
      masks: scene.masks,
      settings: scene.settings,
      landformId: landform?.id ?? null,
      review: scene.viaReview,
      result: input.run ?? null,
      ...(input.inventoryUnits ? { inventoryUnits: input.inventoryUnits } : {}),
    }),
    ...(input.draft ? { draft: true } : {}),
  }
}
