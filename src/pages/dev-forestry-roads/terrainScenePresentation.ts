/** Presentation-only assembly. All terrain samples and design faces have already been calculated. */
import type { TerrainFace } from './TerrainGround'
import type { TerrainVertex } from './terrainMesh'
import type { TerrainGpuData } from './terrainGpuTypes'
import {
  cutTerrainToDesign,
  terrainSeamBlendRadius,
  terrainSkirtDepth,
  unfinishedBatterCurtains,
  type DesignSeam,
  type TerrainSceneGeometry,
  type TerrainSkirtEdge,
} from './terrainSceneGeometry'
import type { Coordinate, RoadAnalysis } from './types'
import { culvertBarrel } from './culvertBarrel'
import { culvertBarrels, culvertRiseM, culvertShapeOf, culvertSpanM } from './culverts/culvertShape'
import type { Culvert } from './engineeringTypes'
import type { TerrainBackgroundLayer } from './terrainPreparation'
import { roadProjection } from './terrain'
import { gradeBreachBetween, type GradeSpan } from './designStandards'

interface Geometry {
  frame: { point: (coordinate: Coordinate) => [number, number]; coordinate: (x: number, y: number) => Coordinate }
  ground: TerrainFace[]
  road: TerrainFace[]
  earthwork: TerrainFace[]
  ditches: Array<{ a: TerrainVertex; b: TerrainVertex; chainage: number }>
  /** The formation's outline edges where its batters met the ground (`previewEarthwork`'s seams). */
  seams?: DesignSeam[]
  /** The formation's batter edges that stopped short of the ground, with the ground under each end. */
  unfinishedEdges?: Array<{ a: TerrainVertex; b: TerrainVertex; groundA: number; groundB: number }>
  /** The coarse display mesh's cell size, m: it sets how far the skirt hangs. */
  meshSpacing?: number
  /** The finer cell size along the road, m, when the ground has a band: it sets how far the ground is eased to a seam. */
  detailSpacing?: number | null
  line: Array<{ vertex: TerrainVertex | null; chainage: number; connected: boolean }>
  groundLow: number
  groundHigh: number
  low: number
  bounds: number[]
}

export interface TerrainScenePresentationInput {
  geometry: Geometry
  design: TerrainSceneGeometry | null
  analysis: RoadAnalysis
  culvertDesigns?: Culvert[]
  terrainOnly: boolean
  colour: TerrainGpuData['colour']
  ortho?: TerrainBackgroundLayer
  showEarthwork: boolean
  maxGradePercent?: number
  gradeSpan?: GradeSpan
}

export interface TerrainScenePresentation {
  data: TerrainGpuData
  notice?: string
  requiresCanvas?: boolean
  /** The fine band's ground passed a drawing budget, so the scene is drawn on the coarse ground instead. */
  bandDropped?: boolean
}

/** Said when the band along the road is left out to keep the scene within its drawing budgets. */
export const BAND_DROPPED_NOTICE =
  'The finer ground along the road needs more drawing than this view allows, so the ground is drawn at its coarse spacing.'

export function terrainScenePresentation({
  geometry,
  design,
  analysis,
  culvertDesigns,
  terrainOnly,
  colour,
  ortho,
  showEarthwork,
  maxGradePercent,
  gradeSpan = 'behind',
}: TerrainScenePresentationInput): TerrainScenePresentation {
  let exact = design?.indices.length ? design : null
  let notice = design?.status === 'ready' || terrainOnly ? undefined : (design?.reason ?? design?.notice)
  let ground = geometry.ground
  let skirt: TerrainSkirtEdge[] = []
  let requiresCanvas = false
  try {
    if (!terrainOnly) {
      const exactShown = showEarthwork ? exact : null
      const cut = cutTerrainToDesign(
        ground,
        exactShown
          ? exactShown.footprint
          : [...geometry.road, ...(showEarthwork ? geometry.earthwork : [])].map((face) => face.vertices),
        // With the batters drawn, the outline edges where they reached the ground are seams: the display ground is
        // brought to them, eased over a cell or two of the ground beside them. A road drawn alone stands above or
        // below the ground, which stays where it is.
        {
          seams: !showEarthwork ? [] : exactShown ? exactShown.seams : (geometry.seams ?? []),
          blendM: terrainSeamBlendRadius(geometry.detailSpacing ?? geometry.meshSpacing ?? 0),
        },
      )
      ground = cut.faces
      skirt = cut.skirt
    }
  } catch (error) {
    // A too-complex display remains usable and says which drawing it can show. Never lose source
    // ground or hand a partially cut mesh to the renderer after a budget is reached.
    exact = null
    requiresCanvas = true
    notice = `${error instanceof Error ? error.message : 'The exact surface could not be drawn.'} Showing the simplified formation.`
  }
  const frame = geometry.frame
  const stations = analysis.stations.flatMap((station) => {
    const z = terrainOnly ? station.groundElevation : station.designElevation
    if (z == null || !Number.isFinite(z)) return []
    const [x, y] = frame.point(station.coordinate)
    return [{ x, y, z, station: station.chainage }]
  })
  const surfaceLevels = new Map<string, number>()
  const xyKey = (x: number, y: number) => `${Math.round(x * 1000)}:${Math.round(y * 1000)}`
  // At named centreline points the selected exact surface gives the displayed level. This keeps
  // the centreline on top of a finished road instead of buried in its surfacing courses.
  if (exact)
    for (const face of exact.footprint)
      for (const v of face) {
        const key = xyKey(v.x, v.y)
        surfaceLevels.set(key, Math.max(surfaceLevels.get(key) ?? -Infinity, v.z))
      }
  const atSurface = (point: TerrainVertex) => ({ ...point, z: surfaceLevels.get(xyKey(point.x, point.y)) ?? point.z })
  for (const point of stations) point.z = atSurface(point).z
  const byChainage = new Map(analysis.stations.map((station) => [station.chainage, station]))
  const lines: TerrainGpuData['lines'] = geometry.line.slice(1).flatMap((item, i) => {
    const previous = geometry.line[i]
    if (!previous.vertex || !item.vertex || !item.connected) return []
    const first = byChainage.get(previous.chainage)
    const last = byChainage.get(item.chainage)
    const overGrade =
      maxGradePercent !== undefined &&
      first !== undefined &&
      last !== undefined &&
      gradeBreachBetween(analysis.stations, first.index, last.index, gradeSpan)
    return [
      {
        a: atSurface(previous.vertex),
        b: atSurface(item.vertex),
        station: item.chainage,
        color: terrainOnly ? '#4e7c55' : overGrade ? '#dc5a51' : '#1e8790',
      },
    ]
  })
  if (showEarthwork)
    for (const ditch of geometry.ditches) lines.push({ ...ditch, station: ditch.chainage, color: '#67bdd4' })

  const culverts: TerrainGpuData['culverts'] = []
  if (!terrainOnly)
    for (const result of analysis.engineering?.culverts ?? []) {
      const entered = culvertDesigns?.find((culvert) => culvert.id === result.id)
      const reference = result.profile.find((p) => p.crownElevation != null && p.invertElevation != null)
      const rise = entered
        ? culvertRiseM(entered)
        : reference
          ? reference.crownElevation! - reference.invertElevation!
          : 0
      const span = entered ? culvertSpanM(entered) : rise
      const barrel = culvertBarrel({
        profile: result.profile,
        riseM: rise,
        spanM: span,
        shape: entered ? culvertShapeOf(entered) : 'round',
        point: frame.point,
        exaggeration: 1,
      })
      if (!barrel) continue
      const [a, b] = barrel.centres
      const length = Math.hypot(b.x - a.x, b.y - a.y)
      const across = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length }
      const count = entered ? culvertBarrels(entered) : 1
      const faces: TerrainFace[] = []
      for (let n = 0; n < count; n++) {
        // Installation spacing is not a model field. Show the count with explicitly schematic spacing.
        const offset = (n - (count - 1) / 2) * span * 1.25
        const shifted = (v: TerrainVertex) => ({ x: v.x + across.x * offset, y: v.y + across.y * offset, z: v.z })
        for (let r = 0; r + 1 < barrel.rings.length; r++)
          for (let i = 0; i < barrel.rings[r].length; i++) {
            const j = (i + 1) % barrel.rings[r].length
            faces.push({
              vertices: [barrel.rings[r][i], barrel.rings[r][j], barrel.rings[r + 1][j], barrel.rings[r + 1][i]].map(
                shifted,
              ),
              fill: '#60a5fa',
            })
          }
      }
      culverts.push({ id: result.id, station: result.chainage, faces })
    }
  let imagePoint: TerrainGpuData['imagePoint']
  if (ortho) {
    const projection = roadProjection(ortho.epsg)
    const west = ortho.origin[0] - ortho.pixelSize[0] / 2
    const north = ortho.origin[1] - ortho.pixelSize[1] / 2
    imagePoint = (x, y) => {
      const [easting, northing] = projection.forward([...frame.coordinate(x, y)])
      return [
        (easting - west) / (ortho.width * ortho.pixelSize[0]),
        (northing - north) / (ortho.height * ortho.pixelSize[1]),
      ]
    }
  }
  // A batter that stopped short of the ground is drawn to it, where the formation itself is drawn.
  const unfinishedEdges = !terrainOnly && showEarthwork && !exact ? (geometry.unfinishedEdges ?? []) : []
  return {
    notice,
    requiresCanvas,
    data: {
      ground,
      skirt,
      skirtDepth: terrainSkirtDepth(geometry.meshSpacing ?? 0),
      unfinished: unfinishedEdges.length
        ? {
            faces: unfinishedBatterCurtains(unfinishedEdges),
            edges: unfinishedEdges.map(({ a, b }) => ({ a, b })),
          }
        : null,
      road: terrainOnly ? [] : geometry.road,
      earthwork: terrainOnly ? [] : geometry.earthwork,
      // With batters hidden retain the established formation-only drawing; it is a display switch.
      design: showEarthwork ? exact : null,
      lines,
      culverts,
      stations,
      colour,
      ortho,
      imagePoint,
      low: geometry.groundLow,
      high: geometry.groundHigh,
      originZ: Math.floor(geometry.low),
    },
  }
}

/**
 * The accelerated scene drawn on ground with a fine band along the road. If cutting that ground passes one of the
 * drawing budgets (`MAX_TERRAIN_SCENE_*`), the scene is tried again on `coarseGround`, the same ground without the
 * band, before anything falls back to the canvas preview; only then does the notice say the band was left out.
 */
export function bandedScenePresentation({
  coarseGround,
  ...input
}: TerrainScenePresentationInput & { coarseGround?: TerrainFace[] }): TerrainScenePresentation {
  const banded = terrainScenePresentation(input)
  if (!banded.requiresCanvas || !coarseGround || coarseGround === input.geometry.ground) return banded
  const coarse = terrainScenePresentation({
    ...input,
    geometry: { ...input.geometry, ground: coarseGround, detailSpacing: null },
  })
  if (coarse.requiresCanvas) return coarse
  return {
    ...coarse,
    bandDropped: true,
    notice: [BAND_DROPPED_NOTICE, coarse.notice].filter(Boolean).join(' '),
  }
}
