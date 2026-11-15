/**
 * A RoadEng project brought in whole: its design (`.dsnx`), its terrain (`.terx`), or both, given
 * as separate files or inside one ZIP (RoadEng's "Zipped RoadEng Project"). The content of each file
 * decides what it is, never its name.
 *
 * - **Where it goes.** RoadEng keeps the coordinate system on the terrain (`[main] CoordSys` in its
 *   `.tlt`), not the design, so the design is placed in its terrain's CRS. A project whose terrain
 *   names none, whose CRS this workspace does not convert, or that has no terrain, is laid on the
 *   local plane (`localPlane.ts`) and keeps where its coordinates came from, so **Place on map**
 *   can put it in its CRS later.
 * - **Ground.** The terrain's own TIN (RoadEng's triangles over its points) becomes the project's
 *   terrain grid through `rasterizeTin`, at a cell from the TIN's point spacing; triangles longer
 *   than RoadEng's own limit were never made, so none is dropped for length.
 * - **What was drawn.** Each terrain feature is classed (`classifyRoadEngFeature`) and becomes the
 *   project object that holds that kind of thing: streams are streams, roads are existing roads,
 *   D-lines are D-lines (yarder 18 m, tailhold 8 m, 5 % deflection, as one drawn here), closed
 *   felling boundaries are proposed harvest blocks, and landings, rock bluffs, other boundaries,
 *   breaklines and anything else are reference layers. Contours, point sets and the TIN boundary
 *   are the terrain itself and are counted, not drawn. A road line lying on an imported alignment
 *   is that alignment and is left out. The project's limits (500 context features and 50,000
 *   vertices, 500 reference features and 50,000 vertices, 100 D-lines) are filled in file order and
 *   whatever is left over is counted.
 * - **Units.** Coordinates and levels in feet are converted to metres; the terrain takes the
 *   design's unit, and metres without a design.
 *
 * Pure: no DOM or network access.
 */
import { unzipSync } from 'fflate'
import { projectedCrsDefinition } from '@/lib/geo/projectedCrs'
import { distance } from './engine'
import { alignmentCrs, gridToLonLat, type XY } from './landXmlImport'
import { LOCAL_PLANE_EPSG, localPlaneOffset, localPlaneProjection, type LocalPlacement } from './localPlane'
import {
  isRoadEngDesign,
  parseRoadEngDesign,
  roadEngImportSummary,
  roadEngRoads,
  type RoadEngRoad,
} from './roadEngImport'
import {
  classifyRoadEngFeature,
  isRoadEngTerrain,
  readRoadEngTerrainArchive,
  type RoadEngCoordSys,
  type RoadEngFeatureClass,
  type RoadEngTerrainFeature,
} from './roadEngTerrain'
import { rasterizeTin } from './tinSurface'
import { readRoadEngSettings, roadEngEngineeringFor } from './roadEngDesignSettings'
import { validateTemplate } from './templates'
import type { LocalRaster } from '../dev-forestry/types'
import type { Alignment, CableLine, Coordinate, ContextFeature, RoadTemplate, TerrainMetadata } from './types'
import type { ReferenceFeature } from './referenceFeatures'

export const MAX_ROADENG_PROJECT_BYTES = 300_000_000
const MAX_CONTEXT = 500,
  MAX_CONTEXT_VERTICES = 50_000,
  MAX_REFERENCE = 500,
  MAX_REFERENCE_VERTICES = 50_000,
  MAX_CABLES = 100
/** The finest terrain cell made from a TIN, m; coarser where its points are sparse. */
export const ROADENG_TERRAIN_MIN_CELL_M = 1
/** A road line within this of an imported alignment's stations is that alignment. */
const ON_ALIGNMENT_M = 0.05

export interface RoadEngFile {
  name: string
  bytes: Uint8Array
}

/** The designs and terrains among some files, unpacking any ZIP that holds them. */
export function collectRoadEngFiles(files: readonly RoadEngFile[]): {
  designs: RoadEngFile[]
  terrains: RoadEngFile[]
} {
  const designs: RoadEngFile[] = [],
    terrains: RoadEngFile[] = []
  const sort = (file: RoadEngFile, depth: number) => {
    const head = file.bytes.subarray(0, 4096)
    if (isRoadEngDesign(head)) designs.push(file)
    else if (isRoadEngTerrain(head)) terrains.push(file)
    else if (depth === 0 && head[0] === 0x50 && head[1] === 0x4b) {
      let entries: Record<string, Uint8Array>
      try {
        entries = unzipSync(file.bytes, {
          filter: (entry) => /\.(dsnx|terx)$/i.test(entry.name) && entry.originalSize <= MAX_ROADENG_PROJECT_BYTES,
        })
      } catch {
        throw Error(`${file.name} could not be unpacked: the archive is damaged.`)
      }
      const inside = Object.entries(entries)
      if (!inside.length) throw Error(`${file.name} holds no RoadEng design (.dsnx) or terrain (.terx).`)
      for (const [name, bytes] of inside) sort({ name: name.split('/').pop() ?? name, bytes }, 1)
    } else throw Error(`${file.name} is not a RoadEng design or terrain.`)
  }
  for (const file of files) sort(file, 0)
  if (!designs.length && !terrains.length)
    throw Error('Choose a RoadEng design (.dsnx), its terrain (.terx) or a zipped RoadEng project.')
  return { designs, terrains }
}

export interface RoadEngProjectOptions {
  newId: () => string
  color: (index: number) => string
  template: RoadTemplate
  /** The terrain's vertical datum, as the person stated it; RoadEng does not record one. */
  verticalReference: string
  /** SHA-256 of a terrain archive, for the terrain's provenance (the page hashes; this module cannot). */
  sha256Of?: (file: RoadEngFile) => string | undefined
  /**
   * When no terrain states a CRS this workspace converts: `plane` (the default) lays the project
   * on a new flat plane; a placement puts it on that plane (the open project's, the same file
   * coordinates); `ask` raises {@link AlignmentCrsQuestion}, answered through `epsg`.
   */
  noCrs?: 'plane' | 'ask' | LocalPlacement
  /** The CRS the person gave, when asked. A CRS a terrain states is never overridden. */
  epsg?: number
}

export interface RoadEngProject {
  name: string
  /** The CRS the project is in: the terrain's, or the local plane. */
  epsg: number
  localPlane: LocalPlacement | null
  coordSys: RoadEngCoordSys | null
  roads: RoadEngRoad[]
  terrain: TerrainMetadata
  context: ContextFeature[]
  cables: CableLine[]
  reference: ReferenceFeature[]
  /** One sentence each, for the import notice. */
  notes: string[]
  /** The roads' own summaries (also in `notes`), for an import that takes only the roads. */
  roadNotes: string[]
}

const stem = (name: string) => name.replace(/\.(dsnx|terx|zip)$/i, '')

/** Everything a RoadEng project brings into a new road project. */
export function roadEngProject(files: readonly RoadEngFile[], options: RoadEngProjectOptions): RoadEngProject {
  const { designs, terrains } = collectRoadEngFiles(files)
  if (designs.length > 1) throw Error('Choose one RoadEng design at a time, with its terrain.')
  const designFile = designs[0] ?? null
  const design = designFile ? parseRoadEngDesign(designFile.bytes) : null
  const notes: string[] = []

  // The design's terrain is the one it names, else the only one given.
  let terrainFile: RoadEngFile | null = null
  if (terrains.length) {
    const named = design?.terrain?.toLowerCase()
    terrainFile = terrains.find((t) => t.name.toLowerCase() === named) ?? (terrains.length === 1 ? terrains[0] : null)
    if (!terrainFile)
      throw Error(`The design uses ${design?.terrain ?? 'no named terrain'}; choose that terrain, or only one terrain.`)
    if (design?.terrain && terrainFile.name.toLowerCase() !== design.terrain.toLowerCase())
      notes.push(`The design names its terrain ${design.terrain}; ${terrainFile.name} was used.`)
  } else if (design?.terrain) notes.push(`Its terrain, ${design.terrain}, was not given, so the project has no ground.`)
  const archive = terrainFile ? readRoadEngTerrainArchive(terrainFile.bytes) : null
  const unitM = design?.unitM ?? 1
  const m = (v: number) => v * unitM

  // Where it goes.
  const coordSys = archive?.coordSys ?? null
  let epsg: number, toLonLat: (xy: XY) => Coordinate, localPlane: LocalPlacement | null
  const stated = coordSys?.epsg ?? null
  if (stated !== null && projectedCrsDefinition(stated) && unitM === 1) {
    epsg = stated
    toLonLat = gridToLonLat(stated)
    localPlane = null
  } else if (options.epsg !== undefined && options.noCrs === 'ask') {
    if (unitM !== 1) throw Error('This design is in feet, and every coordinate system offered is in metres.')
    epsg = options.epsg
    toLonLat = gridToLonLat(options.epsg)
    localPlane = null
  } else if (typeof options.noCrs === 'object') {
    if (Math.abs(options.noCrs.unitM - unitM) > 1e-12)
      throw Error('This project is on a plane in other units; these files cannot share it.')
    epsg = LOCAL_PLANE_EPSG
    localPlane = options.noCrs
    toLonLat = localPlaneProjection(localPlane.offsetM).toLonLat
  } else {
    if (options.noCrs === 'ask') {
      const points: XY[] = (design?.alignments ?? []).flatMap((a) => a.stations.map((s) => s.xy))
      if (archive) {
        const [x0, x1, y0, y1] = archive.terrain.bbox
        points.push([m(x0), m(y0)], [m(x1), m(y1)])
      }
      alignmentCrs(null, undefined, { unitM, points, what: (terrainFile ?? designFile)!.name })
    }
    if (stated !== null)
      notes.push(
        `Its terrain states EPSG:${stated}, which this workspace does not ${unitM === 1 ? 'convert' : 'read in feet'}.`,
      )
    const extent: XY[] = []
    for (const a of design?.alignments ?? []) for (const s of a.stations) extent.push(s.xy)
    if (archive) {
      const [x0, x1, y0, y1] = archive.terrain.bbox
      extent.push([m(x0), m(y0)], [m(x1), m(y1)])
    }
    const offsetM = localPlaneOffset(extent)
    localPlane = { offsetM, unitM, source: (terrainFile ?? designFile)!.name.slice(0, 200) }
    epsg = LOCAL_PLANE_EPSG
    toLonLat = localPlaneProjection(offsetM).toLonLat
    notes.push(
      `It is on a flat plane: ${archive ? 'its terrain names no coordinate system this workspace converts' : 'no terrain says where it is'}. Use Place on map to put it in its coordinate system.`,
    )
  }

  // Roads, with the cross-section, template ranges, curve rule and ground types RoadEng gives them
  // (`roadEngDesignSettings.ts`). RoadEng's profile is the finished surface and this workspace's the
  // subgrade, so a road that takes RoadEng's template is lowered by that template's surfacing.
  const placedRoads = designFile
    ? roadEngRoads(designFile.bytes, {
        fileName: designFile.name,
        newId: options.newId,
        color: options.color,
        template: options.template,
        placement: { epsg, toLonLat },
      }).roads
    : []
  const settings = designFile ? readRoadEngSettings(designFile.bytes) : null
  const sectionNotes: string[] = []
  const roads = placedRoads.map((road) => {
    // A design this workspace wrote carries its own section and surfacing back.
    const own = road.source.pgmaps
    if (own) {
      let template: RoadTemplate | null = null
      try {
        if (own.template && typeof own.template === 'object') {
          validateTemplate(own.template as RoadTemplate)
          template = own.template as RoadTemplate
        }
      } catch {
        sectionNotes.push(`${road.alignment.name}'s saved section could not be read; it takes the open road's.`)
      }
      return {
        ...road,
        alignment: {
          ...road.alignment,
          ...(template ? { template } : {}),
          // Checked with the rest of the road when the project is parsed (`parseEngineering`).
          ...(own.engineering && typeof own.engineering === 'object'
            ? { engineering: own.engineering as Alignment['engineering'] }
            : {}),
          ...(own.curveDesign && typeof own.curveDesign === 'object'
            ? { curveDesign: own.curveDesign as Alignment['curveDesign'] }
            : {}),
          vertical: road.alignment.vertical.map((v) => ({
            ...v,
            elevation: Math.round((v.elevation - own.surfacingM) * 1000) / 1000,
          })),
        },
      }
    }
    const part = settings?.parts.find((p) => p.part === road.source.part)
    if (!part) return road
    const mapped = roadEngEngineeringFor(part.settings, {
      startStation: road.source.startStation,
      endStation: road.source.endStation,
      stationScale: road.stationScale,
      fallback: options.template,
    })
    const depth = mapped.template ? (mapped.subgradeDepthM.left + mapped.subgradeDepthM.right) / 2 : 0
    if (mapped.template)
      sectionNotes.push(
        `${road.alignment.name} takes RoadEng's section${depth > 0 ? `; its profile is lowered ${depth.toFixed(2)} m from the finished surface to the subgrade` : ''}.`,
      )
    if (mapped.notes.length) sectionNotes.push(...mapped.notes)
    if (mapped.unmapped.length) sectionNotes.push(`Not carried over: ${mapped.unmapped.join('; ')}.`)
    return {
      ...road,
      alignment: {
        ...road.alignment,
        ...(mapped.template ? { template: mapped.template } : {}),
        ...(mapped.curveDesign ? { curveDesign: mapped.curveDesign } : {}),
        engineering: mapped.engineering,
        vertical: road.alignment.vertical.map((v) => ({
          ...v,
          elevation: Math.round((v.elevation - depth) * 1000) / 1000,
        })),
      },
    }
  })
  // The summary names a terrain it did not read; here the terrain was read, or its absence is said above.
  const summaryDesign = design ? { ...design, terrain: null } : null
  const roadNotes = [
    ...(summaryDesign ? roads.map((road) => roadEngImportSummary(road, summaryDesign)) : []),
    ...sectionNotes,
  ]
  notes.push(...roadNotes)

  // Ground.
  let terrain: TerrainMetadata
  const verticalReference = options.verticalReference.trim() || 'Not stated'
  const sha256 = (terrainFile && options.sha256Of?.(terrainFile)) || '0'.repeat(64)
  const grid = (xyM: XY): XY => (localPlane ? [xyM[0] - localPlane.offsetM[0], xyM[1] - localPlane.offsetM[1]] : xyM)
  const tin = archive?.terrain.tin
  if (archive && tin && tin.triangles.length) {
    const coords = new Float64Array(tin.coords.length),
      z = new Float64Array(tin.z.length)
    for (let i = 0; i < tin.z.length; i++) {
      const [x, y] = grid([m(tin.coords[i * 2]), m(tin.coords[i * 2 + 1])])
      coords[i * 2] = x
      coords[i * 2 + 1] = y
      z[i] = m(tin.z[i])
    }
    // Half the TIN's median edge, so the grid keeps what its densest points say; rasterizeTin
    // coarsens it only as far as the cell limit needs.
    const ground = rasterizeTin(
      { coords, z, triangles: tin.triangles, cloudPoints: tin.z.length, totalPoints: tin.z.length },
      {
        cellM: Math.max(ROADENG_TERRAIN_MIN_CELL_M, medianEdge(coords, tin.triangles) / 2),
        maxEdgeM: Number.MAX_VALUE,
      },
    )
    const raster: LocalRaster = {
      id: `terrain-${sha256.slice(0, 16)}`,
      name: `${terrainFile!.name} (RoadEng TIN)`.slice(0, 200),
      kind: 'terrain',
      epsg,
      origin: ground.origin,
      pixelSize: ground.pixelSize,
      width: ground.width,
      height: ground.height,
      values: ground.values,
      acquired: '',
      verticalReference,
      sha256,
    }
    terrain = {
      kind: 'geotiff',
      name: raster.name,
      resolutionM: ground.cellM,
      verticalReference,
      epsg,
      sha256,
      raster,
      ...(localPlane ? { localPlane } : {}),
    }
    notes.push(
      `Its ground is RoadEng's TIN, ${(tin.triangles.length / 3).toLocaleString('en-CA')} triangles, on ${ground.cellM.toFixed(2)} m cells.`,
    )
  } else {
    // No ground: a grid with no levels over what was read, so the plane has an extent.
    const points: XY[] = (design?.alignments ?? []).flatMap((a) => a.stations.map((s) => grid(s.xy)))
    if (archive) {
      const [x0, x1, y0, y1] = archive.terrain.bbox
      points.push(grid([m(x0), m(y0)]), grid([m(x1), m(y1)]))
    }
    if (points.length < 2) throw Error('Nothing in these files has a place: no alignment, no terrain points.')
    const xs = points.map((p) => p[0]),
      ys = points.map((p) => p[1])
    const pad = 50
    const raster: LocalRaster = {
      id: 'terrain-none',
      name: 'No terrain',
      kind: 'terrain',
      epsg,
      origin: [Math.min(...xs) - pad, Math.max(...ys) + pad],
      pixelSize: [Math.max(...xs) - Math.min(...xs) + 2 * pad, -(Math.max(...ys) - Math.min(...ys) + 2 * pad)],
      width: 2,
      height: 2,
      values: [null, null, null, null],
      acquired: '',
      verticalReference,
      sha256,
    }
    terrain = {
      kind: 'geotiff',
      name: 'No terrain',
      // As the project checks it: the larger side of a cell.
      resolutionM: Math.max(...raster.pixelSize.map(Math.abs)),
      verticalReference,
      epsg,
      sha256,
      raster,
      ...(localPlane ? { localPlane } : {}),
    }
    if (archive) notes.push('Its terrain holds no TIN, so the project has no ground.')
  }

  // What was drawn, in every terrain given: a design can draw on background terrains too. They are
  // read in the same grid as the design's own terrain.
  const others = terrains.filter((t) => t !== terrainFile)
  const archives = [...(archive ? [archive] : []), ...others.map((t) => readRoadEngTerrainArchive(t.bytes))]
  const layers = archives.length
    ? drawnLayers(
        archives.flatMap((a, k) => a.terrain.features.map((feature) => ({ feature, layers: a.layers, from: k }))),
        roads,
        (xy) => toLonLat(xy),
        m,
      )
    : null
  if (others.length) notes.push(`Drawn features were also read from ${others.map((t) => t.name).join(', ')}.`)
  if (layers) notes.push(...layers.notes)
  // The archive's first line repeats what was read, and a terrain with no CRS is on the plane, said above.
  if (archive)
    notes.push(
      ...archive.warnings
        .slice(1)
        .filter((w) => localPlane === null || !/names no coordinate system|states no coordinate system/.test(w)),
    )

  return {
    name: stem(designFile?.name ?? terrainFile!.name).slice(0, 120),
    epsg,
    localPlane,
    coordSys,
    roads,
    terrain,
    context: layers?.context ?? [],
    cables: layers?.cables ?? [],
    reference: layers?.reference ?? [],
    notes,
    roadNotes,
  }
}

const LABEL: Partial<Record<RoadEngFeatureClass, string>> = {
  landing: 'Landing',
  'rock-bluff': 'Rock bluff',
  boundary: 'Boundary',
  breakline: 'Breakline',
  other: 'Feature',
}

/** Terrain features as the project objects that hold them, within the project's limits. */
function drawnLayers(
  features: readonly {
    feature: RoadEngTerrainFeature
    layers: Parameters<typeof classifyRoadEngFeature>[1]
    from: number
  }[],
  roads: readonly RoadEngRoad[],
  toLonLat: (xyM: XY) => Coordinate,
  m: (v: number) => number,
) {
  const context: ContextFeature[] = [],
    cables: CableLine[] = [],
    reference: ReferenceFeature[] = []
  let contextVertices = 0,
    referenceVertices = 0,
    terrainParts = 0,
    onAlignment = 0,
    leftOut = 0
  const stations = roads.flatMap((road) => road.source.stations.map((s) => s.xy))
  const byClass = new Map<string, number>()
  for (const { feature, layers, from } of features) {
    const kind = classifyRoadEngFeature(feature, layers)
    const id = `roadeng-${from}-${feature.index}`
    if (kind === 'contour' || kind === 'source-contour' || kind === 'mass-points' || kind === 'tin-boundary') {
      terrainParts++
      continue
    }
    const xyM: XY[] = []
    for (let i = 0; i < feature.points.length; i += 3) xyM.push([m(feature.points[i]), m(feature.points[i + 1])])
    if (!xyM.length) continue
    const coords = xyM.map(toLonLat)
    const closed = feature.type === 'closed-line' || feature.type === 'polygon'
    const name = (feature.name || LABEL[kind] || 'Feature').slice(0, 200)
    const attributes = { roadEngClass: kind, ...(feature.attributes ?? {}) }
    if (kind === 'road' && stations.length && onRoad(xyM, stations)) {
      onAlignment++
      continue
    }
    let placed = false
    if ((kind === 'stream' || kind === 'road') && coords.length >= 2) {
      if (context.length < MAX_CONTEXT && contextVertices + coords.length <= MAX_CONTEXT_VERTICES) {
        context.push({
          id,
          name,
          kind: kind === 'stream' ? 'stream' : 'existing-road',
          attributes,
          geometry: { type: 'LineString', coordinates: coords },
        })
        contextVertices += coords.length
        placed = true
      }
    } else if (kind === 'd-line' && coords.length >= 2) {
      if (cables.length < MAX_CABLES) {
        cables.push({
          id,
          name,
          start: coords[0],
          end: coords[coords.length - 1],
          startHeight: 18,
          endHeight: 8,
          deflectionPercent: 5,
        })
        placed = true
      }
    } else if (kind === 'boundary' && closed && /fall/i.test(feature.name) && coords.length >= 4) {
      if (context.length < MAX_CONTEXT && contextVertices + coords.length <= MAX_CONTEXT_VERTICES) {
        context.push({
          id,
          name,
          kind: 'harvest',
          attributes,
          harvestEvidence: { source: 'user', status: 'proposed', yearMethod: 'unknown' },
          geometry: { type: 'Polygon', coordinates: [ring(coords)] },
        })
        contextVertices += coords.length
        placed = true
      }
    } else if (reference.length < MAX_REFERENCE && referenceVertices + coords.length <= MAX_REFERENCE_VERTICES) {
      const geometry: ReferenceFeature['geometry'] =
        coords.length === 1 || kind === 'landing'
          ? { type: 'Point', coordinates: kind === 'landing' && coords.length > 1 ? centroid(coords) : coords[0] }
          : closed && coords.length >= 4
            ? { type: 'Polygon', coordinates: [ring(coords)] }
            : { type: 'LineString', coordinates: coords }
      reference.push({ id, name, geometry, attributes, source: 'RoadEng terrain' })
      referenceVertices += geometry.type === 'Point' ? 1 : coords.length
      placed = true
    }
    if (placed) byClass.set(kind, (byClass.get(kind) ?? 0) + 1)
    else leftOut++
  }
  const notes: string[] = []
  const count = (n: number) => n.toLocaleString('en-CA')
  const counted = [...byClass].map(([kind, n]) => `${count(n)} ${kind.replace('-', ' ')}${n === 1 ? '' : 's'}`)
  if (counted.length) notes.push(`Drawn features read: ${counted.join(', ')}.`)
  if (terrainParts)
    notes.push(
      `${count(terrainParts)} contours, point sets and boundaries make up its terrain and are not drawn as layers.`,
    )
  if (onAlignment)
    notes.push(`${onAlignment} road line${onAlignment === 1 ? ' is' : 's are'} an imported alignment and left out.`)
  if (leftOut) notes.push(`${leftOut} drawn features are over the project's layer limits and left out.`)
  return { context, cables, reference, notes }
}

/** Whether most of a line's points sit on an alignment's stations. */
function onRoad(line: readonly XY[], stations: readonly XY[]) {
  let on = 0
  for (const p of line)
    if (stations.some((s) => Math.abs(s[0] - p[0]) < ON_ALIGNMENT_M && Math.abs(s[1] - p[1]) < ON_ALIGNMENT_M)) on++
  return on >= 0.9 * line.length
}

/** Median triangle edge of a TIN, m, from up to 20,000 triangles spread through it. */
function medianEdge(coords: Float64Array, triangles: Uint32Array) {
  const count = triangles.length / 3,
    step = Math.max(1, Math.floor(count / 20_000))
  const edges: number[] = []
  for (let t = 0; t < count; t += step) {
    const a = triangles[t * 3],
      b = triangles[t * 3 + 1]
    edges.push(Math.hypot(coords[a * 2] - coords[b * 2], coords[a * 2 + 1] - coords[b * 2 + 1]))
  }
  edges.sort((x, y) => x - y)
  return edges[Math.floor(edges.length / 2)] ?? ROADENG_TERRAIN_MIN_CELL_M
}

const ring = (coords: Coordinate[]) =>
  distance(coords[0], coords[coords.length - 1]) < 1e-6 ? coords : [...coords, coords[0]]
const centroid = (coords: Coordinate[]): Coordinate => [
  coords.reduce((s, c) => s + c[0], 0) / coords.length,
  coords.reduce((s, c) => s + c[1], 0) / coords.length,
]
