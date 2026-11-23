/**
 * The scene as GIS layers (`@/lib/gis/layers.ts`), for Save & export's *Scene for GIS*: one layer per kind of shape
 * the scene holds, with the attributes a GIS user needs and nothing the scene does not record. The same layers feed
 * every format (GeoPackage, KMZ, shapefiles, GeoJSON; `sceneGisFiles.ts` writes them).
 *
 * Only the scene: no run, no visibility samples, no percentages, no inventory read live. So the file needs no run,
 * reading it stales nothing, and What goes in (`sceneGisPlan`) counts the very items the layers are built from.
 *
 * - **Blocks**, **landforms** and **existing openings**: the scene's targets by role. Areas are planar BC Albers
 *   (EPSG:3005) hectares, as the block map sheet measures them (`blockAreaHa`).
 * - **Masks**, one layer per kind, so each kind keeps its own colour in a GIS: the stored kind beside the wording the
 *   page shows for it (`MASK_LABELS`; `retained` stays `retained`, shown as *Wildlife tree patch / retention*).
 * - **Tree-free areas**: ground the road view draws without timber. Display only, and the layer says so.
 * - **The viewpoint**: the road as a line, or a spot as a point (with the surveyed eye elevation that applies there).
 * - **Views of interest** as points with the bearing they face, and their **view wedges**: the lens's width along
 *   that bearing as the plan map draws it (`viewsOfInterestPlan`). A plan and a drawing aid, never a sight line.
 *
 * Sub-landforms, dividers and lines of force are drawn from the terrain and never stored in the scene, so they are not
 * here. No DOM or network access.
 */
import type { GisField, GisLayer, GisPosition } from '@/lib/gis/layers'
import { blockAreaHa } from '@/lib/forestry/blockSheet/blockFacts'

import { MASK_LABELS } from './assessmentMasks'
import type { ForestryScene } from './scene'
import { findSceneLandform } from './sceneInput'
import type { AssessmentMaskKind, HarvestSystem, TargetPolygon } from './types'
import { surveyedEyeElevation } from './viewpointStand'
import { type ViewOfInterest } from './viewsOfInterest'
import { viewCaptureCamera } from './viewCamera'
import { placeCrsLabel, placeEntryOf } from './viewCoordinates'
import { viewConeLengthMeters, viewsOfInterestPlan, type PlannedViewMark } from './viewsOfInterestGeometry'
import { lineLengthMeters } from './visibility'
import { EVQO_CODE_FOR_CLASS, EVQO_NAMES } from './visualsNarrative'

/** The masks' kinds in the order their layers are written. */
export const SCENE_GIS_MASK_KINDS: readonly AssessmentMaskKind[] = ['natural', 'private', 'permanent', 'retained']

export type SceneGisLayerName =
  | 'blocks'
  | 'landforms'
  | 'existing_openings'
  | `masks_${AssessmentMaskKind}`
  | 'tree_free_areas'
  | 'road'
  | 'viewpoint'
  | 'views_of_interest'
  | 'view_wedges'

/** A layer as What goes in lists it: the same entry the layer is built from. */
export type SceneGisPlanEntry = {
  name: SceneGisLayerName
  title: string
  geometry: GisLayer['geometry']
  count: number
}

/** The page's wording for a harvest system, as the dialog and the notes print it. */
export const HARVEST_SYSTEM_WORDS: Record<HarvestSystem, string> = {
  clearcut: 'clearcut',
  retention: 'dispersed retention',
  partial: 'partial cut',
}

/** Hectares kept to four places (a square metre), so a dBase column holds them exactly. */
const AREA_DECIMALS = 4
const round = (value: number, places: number) => {
  const k = 10 ** places
  return Math.round(value * k) / k
}
const area = (geometry: TargetPolygon['geometry']) => round(blockAreaHa(geometry), AREA_DECIMALS)

/** A GeoJSON polygon or multipolygon as the layer model's polygons. */
const polygonsOf = (geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): GisPosition[][][] =>
  geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates

// Field names are at most ten characters, so a shapefile's dBase table keeps them as they are (in capitals).
const ID: GisField = { name: 'id', type: 'text', title: 'PGMaps id' }
const NAME: GisField = { name: 'name', type: 'text', title: 'Name' }
const AREA: GisField = {
  name: 'area_ha',
  type: 'real',
  title: 'Area (ha)',
  description: 'Planar area in BC Albers (EPSG:3005), hectares.',
  decimals: AREA_DECIMALS,
}
const SOURCE: GisField = { name: 'source', type: 'text', title: 'Source', description: 'Where the shape came from.' }

type LayerSpec<T> = {
  name: SceneGisLayerName
  title: string
  description: string
  geometry: GisLayer['geometry']
  fields: readonly GisField[]
  /** What the scene holds for this layer: the plan counts these, the layer draws one feature from each. */
  items: (scene: ForestryScene) => readonly T[]
  feature: (item: T, scene: ForestryScene) => { attributes: Record<string, unknown>; geometry: unknown }
}

const targetsOf = (scene: ForestryScene, role: TargetPolygon['role']) =>
  scene.targets.filter((target) => target.role === role)
const landformName = (scene: ForestryScene, id: string | null | undefined) =>
  (id && scene.targets.find((target) => target.role === 'landscape' && target.id === id)?.name) || null

const blocks: LayerSpec<TargetPolygon> = {
  name: 'blocks',
  title: 'Proposed blocks',
  description: 'The proposed cutblocks of the visual quality scene.',
  geometry: 'polygon',
  fields: [
    ID,
    NAME,
    {
      name: 'system',
      type: 'text',
      title: 'Harvest system',
      description: 'As stored: clearcut, retention or partial.',
    },
    { name: 'system_txt', type: 'text', title: 'Harvest system (as shown)' },
    {
      name: 'retain_pct',
      type: 'real',
      title: 'Retention (%)',
      description: 'Dispersed retention: share of the stand left standing.',
    },
    {
      name: 'remove_pct',
      type: 'real',
      title: 'Volume removed (%)',
      description: 'Partial cut: share of the volume removed.',
    },
    {
      name: 'residual_m',
      type: 'real',
      title: 'Residual height (m)',
      description: 'Partial cut: mean height of the trees left.',
    },
    { name: 'plan_year', type: 'integer', title: 'Planned harvest year' },
    AREA,
    { name: 'block_code', type: 'text', title: 'Block', description: 'The block id from the imported attributes.' },
    { name: 'licence', type: 'text', title: 'Licence' },
    { name: 'permit', type: 'text', title: 'Cutting permit' },
    { name: 'opening', type: 'text', title: 'Opening' },
    SOURCE,
  ],
  items: (scene) => targetsOf(scene, 'block'),
  feature: (block) => {
    const system = block.harvestSystem ?? 'clearcut'
    return {
      attributes: {
        id: block.id,
        name: block.name,
        system,
        system_txt: HARVEST_SYSTEM_WORDS[system],
        retain_pct: system === 'retention' ? (block.retentionPercent ?? null) : null,
        remove_pct: system === 'partial' ? (block.volumeRemovedPercent ?? null) : null,
        residual_m: system === 'partial' ? (block.residualHeightMeters ?? null) : null,
        plan_year: block.plannedHarvestYear ?? null,
        area_ha: area(block.geometry),
        block_code: block.planning?.blockId ?? null,
        licence: block.planning?.licenceId ?? null,
        permit: block.planning?.permitId ?? null,
        opening: block.planning?.openingId ?? null,
        source: block.source,
      },
      geometry: polygonsOf(block.geometry),
    }
  },
}

const landforms: LayerSpec<TargetPolygon> = {
  name: 'landforms',
  title: 'Landforms',
  description: 'The landforms the scene records; `assessed` marks the one the run assesses.',
  geometry: 'polygon',
  fields: [
    ID,
    NAME,
    {
      name: 'assessed',
      type: 'boolean',
      title: 'Assessed',
      description: 'The landform the visibility run assesses.',
    },
    { name: 'objective', type: 'text', title: 'Objective (code)', description: 'The visual quality objective.' },
    { name: 'obj_name', type: 'text', title: 'Objective' },
    { name: 'vac', type: 'text', title: 'Visual absorption capability' },
    AREA,
    { name: 'inv_unit', type: 'text', title: 'Inventory unit', description: 'The visual landscape inventory unit.' },
    SOURCE,
  ],
  items: (scene) => targetsOf(scene, 'landscape'),
  feature: (landform, scene) => {
    const code = EVQO_CODE_FOR_CLASS[landform.objectiveId]
    return {
      attributes: {
        id: landform.id,
        name: landform.name,
        assessed: findSceneLandform(scene)?.id === landform.id,
        objective: code,
        obj_name: EVQO_NAMES[code],
        vac: landform.vac,
        area_ha: area(landform.geometry),
        inv_unit: landform.inventoryUnitId ?? null,
        source: landform.source,
      },
      geometry: polygonsOf(landform.geometry),
    }
  },
}

const openings: LayerSpec<TargetPolygon> = {
  name: 'existing_openings',
  title: 'Existing openings',
  description: 'Openings already harvested, as the scene records them.',
  geometry: 'polygon',
  fields: [
    ID,
    NAME,
    { name: 'harv_year', type: 'integer', title: 'Harvest year' },
    {
      name: 'cc_pct',
      type: 'real',
      title: 'Clearcut (%)',
      description: 'The inventory’s percent clearcut, as recorded.',
    },
    AREA,
    SOURCE,
  ],
  items: (scene) => targetsOf(scene, 'harvested'),
  feature: (opening) => ({
    attributes: {
      id: opening.id,
      name: opening.name,
      harv_year: opening.harvestYear,
      cc_pct: opening.clearcutPercent,
      area_ha: area(opening.geometry),
      source: opening.source,
    },
    geometry: polygonsOf(opening.geometry),
  }),
}

type Mask = NonNullable<ForestryScene['masks']>[number]
const maskLayer = (kind: AssessmentMaskKind): LayerSpec<Mask> => ({
  name: `masks_${kind}`,
  title: `Mask: ${MASK_LABELS[kind]}`,
  description: `Assessment masks of the kind ${MASK_LABELS[kind]} (stored as "${kind}").`,
  geometry: 'polygon',
  fields: [
    ID,
    NAME,
    { name: 'kind', type: 'text', title: 'Kind (stored)', description: 'The kind as the scene stores it.' },
    { name: 'kind_label', type: 'text', title: 'Kind', description: 'The kind as the page shows it.' },
    {
      name: 'landform',
      type: 'text',
      title: 'Landform',
      description: 'The landform the mask was traced on; blank applies to every landform.',
    },
    ...(kind === 'natural' ? [{ name: 'mappedrock', type: 'boolean', title: 'Mapped rock' } satisfies GisField] : []),
    AREA,
    SOURCE,
  ],
  items: (scene) => (scene.masks ?? []).filter((mask) => mask.kind === kind),
  feature: (mask, scene) => ({
    attributes: {
      id: mask.id,
      name: mask.name,
      kind: mask.kind,
      kind_label: MASK_LABELS[mask.kind],
      landform: landformName(scene, mask.landformId),
      ...(kind === 'natural' ? { mappedrock: mask.mappedRock === true } : {}),
      area_ha: area(mask.geometry),
      source: mask.source,
    },
    geometry: polygonsOf(mask.geometry),
  }),
})

type TreeFree = NonNullable<ForestryScene['treeFreeAreas']>[number]
const treeFree: LayerSpec<TreeFree> = {
  name: 'tree_free_areas',
  title: 'Tree-free areas',
  description: 'Ground the road view draws without timber. Display only: never an input to the run.',
  geometry: 'polygon',
  fields: [ID, NAME, AREA],
  items: (scene) => scene.treeFreeAreas ?? [],
  feature: (entry) => ({
    attributes: { id: entry.id, name: entry.name, area_ha: area(entry.geometry) },
    geometry: polygonsOf(entry.geometry),
  }),
}

/** The road, when the viewpoint is one: a corridor of at least two points. */
const isRoad = (scene: ForestryScene) => scene.viewpoint.mode === 'corridor' && scene.viewpoint.coordinates.length > 1

const road: LayerSpec<ForestryScene['viewpoint']> = {
  name: 'road',
  title: 'Viewpoint road',
  description: 'The road the views are assessed from.',
  geometry: 'line',
  fields: [
    ID,
    NAME,
    { name: 'length_km', type: 'real', title: 'Length (km)', description: 'Along the line.', decimals: 3 },
  ],
  items: (scene) => (isRoad(scene) ? [scene.viewpoint] : []),
  feature: (viewpoint) => ({
    attributes: {
      id: viewpoint.id,
      name: viewpoint.name,
      length_km: round(lineLengthMeters(viewpoint.coordinates) / 1000, 3),
    },
    geometry: [viewpoint.coordinates],
  }),
}

const spot: LayerSpec<ForestryScene['viewpoint']> = {
  name: 'viewpoint',
  title: 'Viewpoint',
  description: 'The spot the views are assessed from.',
  geometry: 'point',
  fields: [
    ID,
    NAME,
    {
      name: 'eye_elev_m',
      type: 'real',
      title: 'Surveyed eye (m)',
      description: 'The surveyed eye elevation above sea level, where one applies.',
    },
  ],
  items: (scene) => (!isRoad(scene) && scene.viewpoint.coordinates.length ? [scene.viewpoint] : []),
  feature: (viewpoint) => ({
    attributes: { id: viewpoint.id, name: viewpoint.name, eye_elev_m: surveyedEyeElevation(viewpoint) },
    geometry: [viewpoint.coordinates[0]],
  }),
}

type PlannedView = { view: ViewOfInterest; mark: PlannedViewMark }
/** The views with their numbers and bearings as the plan map shows them, and the wedges it draws. */
function plannedViews(scene: ForestryScene) {
  const views = scene.viewsOfInterest ?? []
  const blockTargets = targetsOf(scene, 'block')
  const plan = viewsOfInterestPlan(views, blockTargets, null)
  const marks = new Map(plan.marks.map((mark) => [mark.id, mark]))
  const entries: PlannedView[] = views.map((view) => ({ view, mark: marks.get(view.id)! }))
  const wedges = plan.cones.features.flatMap((feature) => {
    const entry = entries.find((candidate) => candidate.view.id === feature.id)
    return entry && feature.geometry.type === 'Polygon' ? [{ ...entry, ring: feature.geometry.coordinates }] : []
  })
  return { entries, wedges }
}

/** A view's typed place, while it still stands there (`placeEntryOf`). */
function placeAttributes(view: ViewOfInterest) {
  const entry = placeEntryOf(view)
  return {
    coord_text: entry?.text ?? null,
    coord_crs: entry ? placeCrsLabel(entry) : null,
    coord_prec: entry ? round(entry.precisionMeters, 3) : null,
  }
}

const bearingValue = (bearing: number | null) => (bearing === null ? null : round(bearing, 1))
const blockName = (scene: ForestryScene, id: string) =>
  scene.targets.find((target) => target.role === 'block' && target.id === id)?.name ?? null

const views: LayerSpec<PlannedView> = {
  name: 'views_of_interest',
  title: 'Views of interest',
  description:
    'The views planned on the plan map: where to stand, which way to face and the lens. A plan, not a result.',
  geometry: 'point',
  fields: [
    ID,
    { name: 'number', type: 'integer', title: 'Number', description: 'The view’s number on the plan map.' },
    NAME,
    { name: 'block', type: 'text', title: 'Block', description: 'The block the view assesses.' },
    { name: 'block_id', type: 'text', title: 'Block id' },
    {
      name: 'facing',
      type: 'text',
      title: 'Faces',
      description: 'block: toward the block’s centre; bearing: a set compass bearing.',
    },
    {
      name: 'bearing',
      type: 'real',
      title: 'Bearing (°)',
      description: 'Degrees clockwise from north; blank when its block is gone.',
      decimals: 1,
    },
    { name: 'lens_mm', type: 'integer', title: 'Lens (mm)', description: 'Full-frame-equivalent focal length.' },
    { name: 'hfov_deg', type: 'real', title: 'Field across (°)', decimals: 1 },
    { name: 'framing', type: 'text', title: 'Framing', description: 'landform or single frame.' },
    { name: 'from', type: 'text', title: 'Placed from', description: 'map, vli (inventory viewpoint) or rec-site.' },
    { name: 'included', type: 'boolean', title: 'In the exports' },
    { name: 'landform', type: 'text', title: 'Landform', description: 'The landform adopted for this view.' },
    {
      name: 'coord_text',
      type: 'text',
      title: 'Coordinates entered',
      description: 'The place as typed, while the view still stands there; blank for a view placed on the map.',
    },
    { name: 'coord_crs', type: 'text', title: 'Entered in', description: 'The system and datum it was typed in.' },
    {
      name: 'coord_prec',
      type: 'real',
      title: 'Entered precision (± m)',
      description:
        'Half the last digit given, in metres: what the digits resolve, not how well the point was measured. NAD83 and WGS84 are taken as the same, with no shift.',
      decimals: 3,
    },
    {
      name: 'eye_ref',
      type: 'text',
      title: 'Eye',
      description:
        'elevation: a surveyed eye above sea level; ground: a height above the terrain model; blank: the run’s eye height.',
    },
    { name: 'eye_m', type: 'real', title: 'Eye (m)', description: 'The surveyed eye, metres.', decimals: 1 },
  ],
  items: (scene) => plannedViews(scene).entries,
  feature: ({ view, mark }, scene) => ({
    attributes: {
      id: view.id,
      number: mark.number,
      name: view.name,
      block: blockName(scene, view.blockId),
      block_id: view.blockId,
      facing: view.facing.kind,
      bearing: bearingValue(mark.bearing),
      lens_mm: Math.round(view.focalMm),
      hfov_deg: round(viewCaptureCamera(view).hfovDeg, 1),
      framing: view.framing,
      from: view.source.kind,
      included: mark.included,
      landform: landformName(scene, view.landformId),
      ...placeAttributes(view),
      eye_ref: view.eye && !view.photo ? view.eye.reference : null,
      eye_m: view.eye && !view.photo ? round(view.eye.meters, 1) : null,
    },
    geometry: [[view.lng, view.lat]],
  }),
}

const wedges: LayerSpec<PlannedView & { ring: GisPosition[][] }> = {
  name: 'view_wedges',
  title: 'View wedges',
  description:
    'Each view of interest’s lens width along the way it faces, reaching just past its block’s centre, as the plan map draws it. A drawing aid, not a sight line: it says nothing of what is seen.',
  geometry: 'polygon',
  fields: [
    ID,
    { name: 'number', type: 'integer', title: 'Number' },
    NAME,
    { name: 'bearing', type: 'real', title: 'Bearing (°)', decimals: 1 },
    { name: 'hfov_deg', type: 'real', title: 'Field across (°)', decimals: 1 },
    { name: 'reach_m', type: 'real', title: 'Drawn reach (m)', decimals: 0 },
  ],
  items: (scene) => plannedViews(scene).wedges,
  feature: ({ view, mark, ring }, scene) => ({
    attributes: {
      id: view.id,
      number: mark.number,
      name: view.name,
      bearing: bearingValue(mark.bearing),
      hfov_deg: round(viewCaptureCamera(view).hfovDeg, 1),
      reach_m: Math.round(
        viewConeLengthMeters(
          view,
          targetsOf(scene, 'block').find((block) => block.id === view.blockId),
        ),
      ),
    },
    geometry: [ring],
  }),
}

// Bottom first, as a GIS draws a list of layers top-down: the landform under the blocks, the views on top.
const SPECS: ReadonlyArray<LayerSpec<never>> = [
  landforms,
  openings,
  ...SCENE_GIS_MASK_KINDS.map(maskLayer),
  treeFree,
  blocks,
  road,
  spot,
  wedges,
  views,
] as unknown as ReadonlyArray<LayerSpec<never>>

/**
 * The layers the scene gives and how many features each holds, in the order they are written; `absent` names the
 * kinds the scene holds none of. What goes in reads this; `sceneGisLayers` builds the same items.
 */
export function sceneGisPlan(scene: ForestryScene): { layers: SceneGisPlanEntry[]; absent: string[] } {
  const layers: SceneGisPlanEntry[] = []
  const absent: string[] = []
  for (const spec of SPECS) {
    const count = spec.items(scene).length
    if (count) layers.push({ name: spec.name, title: spec.title, geometry: spec.geometry, count })
    // The viewpoint is a road or a spot, never both: only an empty viewpoint is named as absent.
    else if (spec.name === 'viewpoint' ? !isRoad(scene) : spec.name !== 'road') absent.push(spec.title)
  }
  return { layers, absent }
}

/** The scene's layers, each with at least one feature, in `sceneGisPlan`'s order. */
export function sceneGisLayers(scene: ForestryScene): GisLayer[] {
  return SPECS.flatMap((spec): GisLayer[] => {
    const items = spec.items(scene)
    if (!items.length) return []
    const built = items.map((item) => spec.feature(item, scene))
    const base = { name: spec.name, title: spec.title, description: spec.description, fields: spec.fields }
    if (spec.geometry === 'point')
      return [
        {
          ...base,
          geometry: 'point',
          features: built.map(({ attributes, geometry }) => ({ attributes, points: geometry as GisPosition[] })),
        },
      ]
    if (spec.geometry === 'line')
      return [
        {
          ...base,
          geometry: 'line',
          features: built.map(({ attributes, geometry }) => ({ attributes, lines: geometry as GisPosition[][] })),
        },
      ]
    return [
      {
        ...base,
        geometry: 'polygon',
        features: built.map(({ attributes, geometry }) => ({ attributes, polygons: geometry as GisPosition[][][] })),
      },
    ]
  })
}

/** Why the scene gives no layer at all, or null when it gives one. */
export function sceneGisUnavailable(plan: { layers: readonly SceneGisPlanEntry[] }): string | null {
  return plan.layers.length
    ? null
    : 'Draw or import a block, a landform or the road in step 1 first: the file holds the scene’s shapes.'
}

export type SceneGisFormat = 'gpkg' | 'kmz' | 'shp' | 'geojson'

/** The file each format writes. */
export const SCENE_GIS_FILES: Record<SceneGisFormat, { fileName: string; mime: string }> = {
  gpkg: { fileName: 'forestry-visual-quality-scene.gpkg', mime: 'application/geopackage+sqlite3' },
  kmz: { fileName: 'forestry-visual-quality-scene.kmz', mime: 'application/vnd.google-earth.kmz' },
  shp: { fileName: 'forestry-visual-quality-scene-shapefiles.zip', mime: 'application/zip' },
  geojson: { fileName: 'forestry-visual-quality-scene.geojson', mime: 'application/geo+json' },
}

export const isSceneGisFormat = (value: string): value is SceneGisFormat => value in SCENE_GIS_FILES
