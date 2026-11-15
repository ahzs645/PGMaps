/**
 * A flat plane for designs whose coordinate system is unknown, and placing such a project on the
 * map afterwards.
 *
 * A design that states no CRS is laid on {@link LOCAL_PLANE_EPSG}: a transverse Mercator on the road
 * engine's own sphere through 0°, 0° with scale 1, so its lengths, radii and grades agree with the
 * file's to about a millionth within 15 km. The file's coordinates are moved by `offsetM` (the
 * centre of what was read) so the design sits at the plane's origin; `offsetM` and the file's unit
 * are kept on the terrain (`TerrainMetadata.localPlane`), which is what lets the project be placed
 * exactly later.
 *
 * **Place on map** moves everything with coordinates: roads (through `gridAlignmentRoad`, which
 * keeps each curve's tangent points and moves profile stations with the road's length), context,
 * reference layers, D-lines, terrain profiles, map notes and the terrain. Either
 *
 * - by **coordinate system**: the file's own coordinates are read in the chosen CRS, exactly, and
 *   the terrain grid is relabelled, not resampled; or
 * - by **control points**: two or more design points matched to map positions give a similarity
 *   (shift, rotation, one scale) fitted by least squares in the target's UTM zone, with each
 *   point's residual; the terrain is resampled into that zone.
 *
 * A project part this does not know how to move refuses the placement and is named.
 *
 * Pure: no DOM or network access.
 */
import proj4 from 'proj4'
import { LOCAL_PLANE_DEFINITION, LOCAL_PLANE_EPSG, projectedCrsDefinition } from '@/lib/geo/projectedCrs'
import { alignmentLength } from './engine'
import { gridAlignmentRoad, type XY } from './landXmlImport'
import type { LocalRaster } from '../dev-forestry/types'
import type { Alignment, Coordinate, RoadProject, TerrainMetadata } from './types'

export { LOCAL_PLANE_EPSG }

/** Where a local plane's coordinates came from: file metres = plane metres + `offsetM`. */
export interface LocalPlacement {
  offsetM: [number, number]
  /** Metres per file unit (0.3048 for a design in feet). */
  unitM: number
  /** The file the plane was made from, for the notice and the report. */
  source: string
}

/** Cells a resampled terrain may have, as for any road terrain raster. */
export const MAX_PLACED_RASTER_CELLS = 4_194_304
/** Control points accepted at most. */
export const MAX_CONTROL_POINTS = 20

const plane = proj4('EPSG:4326', LOCAL_PLANE_DEFINITION)

export const isLocalPlane = (terrain: Pick<TerrainMetadata, 'epsg'>) => terrain.epsg === LOCAL_PLANE_EPSG

/** The offset that puts a set of file points (metres) around the plane's origin: their extent's centre, to the metre. */
export function localPlaneOffset(pointsM: readonly XY[]): [number, number] {
  if (!pointsM.length) return [0, 0]
  const xs = pointsM.map((p) => p[0]),
    ys = pointsM.map((p) => p[1])
  return [Math.round((Math.min(...xs) + Math.max(...xs)) / 2), Math.round((Math.min(...ys) + Math.max(...ys)) / 2)]
}

/** File metres ↔ longitude/latitude on a local plane. */
export function localPlaneProjection(offsetM: readonly [number, number]) {
  return {
    toLonLat: (xy: XY): Coordinate => plane.inverse([xy[0] - offsetM[0], xy[1] - offsetM[1]]) as Coordinate,
    toFile: (c: Coordinate): XY => {
      const [x, y] = plane.forward([...c])
      return [x + offsetM[0], y + offsetM[1]]
    },
  }
}

/** Plane metres of a longitude/latitude (no offset). */
export const toPlane = (c: Coordinate): XY => plane.forward([...c]) as XY

// ---- Control points -------------------------------------------------------------------------------

export interface Similarity {
  /** x' = a·x − b·y + tx, y' = b·x + a·y + ty */
  a: number
  b: number
  tx: number
  ty: number
  scale: number
  rotationDeg: number
  /** Distance between each control point's fitted and given position, m. */
  residualsM: number[]
  rmsM: number
}

/** The least-squares similarity taking `from` onto `to`; two distinct points at least. */
export function fitSimilarity(pairs: readonly { from: XY; to: XY }[]): Similarity {
  if (pairs.length < 2) throw Error('Give at least two control points.')
  if (pairs.length > MAX_CONTROL_POINTS) throw Error(`Use at most ${MAX_CONTROL_POINTS} control points.`)
  const n = pairs.length
  const mean = (pick: (p: (typeof pairs)[number]) => XY) =>
    pairs.reduce<XY>((s, p) => [s[0] + pick(p)[0] / n, s[1] + pick(p)[1] / n], [0, 0])
  const f0 = mean((p) => p.from),
    t0 = mean((p) => p.to)
  let sxx = 0,
    num = 0,
    den = 0
  for (const p of pairs) {
    const fx = p.from[0] - f0[0],
      fy = p.from[1] - f0[1],
      tx = p.to[0] - t0[0],
      ty = p.to[1] - t0[1]
    sxx += fx * fx + fy * fy
    num += fx * tx + fy * ty
    den += fx * ty - fy * tx
  }
  if (sxx < 1e-6) throw Error('The control points are in one place on the design: pick points apart from each other.')
  const a = num / sxx,
    b = den / sxx
  const tx = t0[0] - (a * f0[0] - b * f0[1]),
    ty = t0[1] - (b * f0[0] + a * f0[1])
  const residualsM = pairs.map((p) => {
    const x = a * p.from[0] - b * p.from[1] + tx,
      y = b * p.from[0] + a * p.from[1] + ty
    return Math.hypot(x - p.to[0], y - p.to[1])
  })
  return {
    a,
    b,
    tx,
    ty,
    scale: Math.hypot(a, b),
    rotationDeg: (Math.atan2(b, a) * 180) / Math.PI,
    residualsM,
    rmsM: Math.sqrt(residualsM.reduce((s, r) => s + r * r, 0) / n),
  }
}

const applySimilarity = (s: Similarity, p: XY): XY => [s.a * p[0] - s.b * p[1] + s.tx, s.b * p[0] + s.a * p[1] + s.ty]

/** WGS84 UTM zone (north or south) of a longitude/latitude. */
function utmZone(c: Coordinate) {
  const zone = Math.max(1, Math.min(60, Math.floor((c[0] + 180) / 6) + 1))
  return c[1] < 0 ? 32700 + zone : 32600 + zone
}

// ---- Placement ------------------------------------------------------------------------------------

export type Placement =
  | { kind: 'crs'; epsg: number }
  /** `from` is a position on the plane (as the project shows it), `to` where it belongs on the map. */
  | { kind: 'control'; pairs: { from: Coordinate; to: Coordinate }[] }

export interface PlacedProject {
  project: RoadProject
  /** The CRS the terrain and road geometry are now in. */
  epsg: number
  similarity: Similarity | null
  notes: string[]
}

/** Project parts with coordinates this does not move; placing refuses while any holds something. */
const UNMOVED: [keyof RoadProject, string][] = [
  ['drainage', 'drainage runs'],
  ['provincialStreamData', 'provincial stream evidence'],
  ['surveyBooks', 'survey field books'],
  ['cutblockBuffers', 'cutblock buffers'],
  ['networkPlanning', 'network planning'],
  ['accessHistory', 'access history'],
  ['haulDestination', 'a haul destination'],
  ['investigation', 'an access investigation'],
]
const present = (value: unknown) => value !== undefined && value !== null && (!Array.isArray(value) || value.length > 0)

/**
 * What a placement would do, without moving anything: the target CRS, the fit of control points
 * and any reason it cannot be made. Cheap enough to run on every edit of the dialog.
 */
export function preparePlacement(project: RoadProject, placement: Placement) {
  const local = project.terrain.localPlane
  if (!isLocalPlane(project.terrain) || !local) throw Error('This project is already on the map.')
  const held = UNMOVED.filter(([key]) => present(project[key])).map(([, label]) => label)
  if (held.length)
    throw Error(`Placing moves roads, layers, D-lines, notes and terrain. Remove ${held.join(', ')} first.`)
  if (project.terrain.preparation || project.terrain.backgrounds?.length || project.terrain.referenceSurfaces?.length)
    throw Error(
      'Placing moves the terrain grid only. Remove its preparation, backgrounds and reference surfaces first.',
    )
  const local2file = localPlaneProjection(local.offsetM)
  const notes: string[] = []

  // Each placement is a map from plane coordinates (file metres) to the target grid, and the target.
  let epsg: number, toGrid: (file: XY) => XY, scale: number, similarity: Similarity | null
  if (placement.kind === 'crs') {
    if (!projectedCrsDefinition(placement.epsg))
      throw Error(`EPSG:${placement.epsg} is not a CRS this workspace converts.`)
    if (Math.abs(local.unitM - 1) > 1e-12)
      throw Error(
        'This design is in feet, and every coordinate system offered is in metres. Place it with control points instead.',
      )
    epsg = placement.epsg
    toGrid = (file) => file
    scale = 1
    similarity = null
  } else {
    const targets = placement.pairs.map((p) => p.to)
    const centre: Coordinate = [
      targets.reduce((s, c) => s + c[0], 0) / targets.length,
      targets.reduce((s, c) => s + c[1], 0) / targets.length,
    ]
    epsg = utmZone(centre)
    const utm = proj4('EPSG:4326', projectedCrsDefinition(epsg)!)
    similarity = fitSimilarity(
      placement.pairs.map((p) => ({ from: local2file.toFile(p.from), to: utm.forward([...p.to]) as XY })),
    )
    const fitted = similarity
    toGrid = (file) => applySimilarity(fitted, file)
    scale = similarity.scale
    notes.push(
      `Fitted ${placement.pairs.length} control points: scale ${similarity.scale.toFixed(5)}, rotation ${similarity.rotationDeg.toFixed(3)}°, RMS ${similarity.rmsM.toFixed(3)} m.`,
    )
  }
  return { local, local2file, epsg, toGrid, scale, similarity, notes }
}

/**
 * The project placed on the map. Only a project on the local plane can be placed; its terrain
 * says where the plane came from.
 */
export function placeProject(project: RoadProject, placement: Placement): PlacedProject {
  const { local, local2file, epsg, toGrid, scale, similarity, notes } = preparePlacement(project, placement)
  const target = proj4('EPSG:4326', projectedCrsDefinition(epsg)!)
  const targetLonLat = (xy: XY) => target.inverse([...xy]) as Coordinate
  const move = (c: Coordinate): Coordinate => targetLonLat(toGrid(local2file.toFile(c)))

  // A road read from RoadEng keeps its design's parts, now in the target CRS: placed by CRS its file
  // coordinates are unchanged; placed by control points, its kept curve records no longer lie on it.
  const alignments = project.alignments.map((road) => {
    const placed = placeAlignment(road, move, toGrid, local2file.toFile, targetLonLat, scale)
    return placed.roadEngSource ? { ...placed, roadEngSource: { ...placed.roadEngSource, epsg } } : placed
  })
  if (similarity && project.alignments.some((road) => road.roadEngSource?.piRecords.length))
    notes.push(
      "Roads read from RoadEng keep their RoadEng settings; their curves were moved by the fit, so a RoadEng file written from them takes each curve's design from RoadEng's tables.",
    )
  const moved: RoadProject = {
    ...project,
    alignments,
    context: project.context.map((feature) => ({ ...feature, geometry: moveGeometry(feature.geometry, move) })),
    cables: project.cables.map((cable) => ({ ...cable, start: move(cable.start), end: move(cable.end) })),
    ...(project.reference
      ? {
          reference: project.reference.map((feature) => ({
            ...feature,
            geometry: moveGeometry(feature.geometry, move),
          })),
        }
      : {}),
    ...(project.profiles ? { profiles: project.profiles.map((p) => ({ ...p, points: p.points.map(move) })) } : {}),
    ...(project.notes ? { notes: project.notes.map((note) => ({ ...note, points: note.points.map(move) })) } : {}),
    terrain: placeTerrain(project.terrain, local, epsg, placement.kind === 'crs' ? null : toGrid, notes),
  }
  return { project: moved, epsg, similarity, notes }
}

function moveGeometry<G extends GeoJSON.Geometry>(geometry: G, move: (c: Coordinate) => Coordinate): G {
  const point = (p: GeoJSON.Position) => move([p[0], p[1]]) as GeoJSON.Position
  switch (geometry.type) {
    case 'Point':
      return { ...geometry, coordinates: point(geometry.coordinates) }
    case 'LineString':
    case 'MultiPoint':
      return { ...geometry, coordinates: geometry.coordinates.map(point) }
    case 'Polygon':
    case 'MultiLineString':
      return { ...geometry, coordinates: geometry.coordinates.map((ring) => ring.map(point)) }
    case 'MultiPolygon':
      return { ...geometry, coordinates: geometry.coordinates.map((poly) => poly.map((ring) => ring.map(point))) }
    default:
      throw Error(`A ${geometry.type} cannot be placed.`)
  }
}

/**
 * A road in target grid terms: its PIs in the grid, radii and stations scaled by the similarity's
 * scale (1 for a CRS), and rebuilt on the sphere keeping each curve's tangent points. Ids, template,
 * overrides and everything else stay; profile chainages and curve lengths move with the road's length.
 */
function placeAlignment(
  road: Alignment,
  move: (c: Coordinate) => Coordinate,
  toGrid: (file: XY) => XY,
  toFile: (c: Coordinate) => XY,
  toLonLat: (xy: XY) => Coordinate,
  scale: number,
): Alignment {
  const length = alignmentLength(road)
  const built = gridAlignmentRoad(
    {
      name: road.name,
      points: road.points.map((p) => ({
        xy: toGrid(toFile(p.coordinate)),
        radiusM: p.radiusM * scale,
        spiralM: (p.spiralM ?? 0) * scale,
      })),
      profile: road.vertical.map((v) => ({
        station: v.chainage * scale,
        elevation: v.elevation,
        curveLength: v.curveLength * scale,
      })),
      startStation: 0,
      fileLengthM: length * scale,
    },
    toLonLat,
    { id: road.id, color: road.color, template: road.template },
  )
  const stretch = built.stationScale * scale
  const restation = (v: Alignment['vertical'][number]) => ({
    ...v,
    chainage: Math.round(v.chainage * stretch * 1000) / 1000,
    curveLength: Math.round(v.curveLength * stretch * 1000) / 1000,
  })
  return {
    ...road,
    points: road.points.map((p, k) => ({
      ...p,
      coordinate: built.alignment.points[k].coordinate,
      radiusM: built.alignment.points[k].radiusM,
      ...(p.spiralM ? { spiralM: built.alignment.points[k].spiralM ?? 0 } : {}),
    })),
    vertical: road.vertical.map(restation),
    ...(road.fileGround
      ? {
          fileGround: {
            ...road.fileGround,
            points: road.fileGround.points.map(([c, z]): [number, number] => [
              Math.round(c * stretch * 1000) / 1000,
              z,
            ]),
          },
        }
      : {}),
    ...(road.verticalAlternatives
      ? {
          verticalAlternatives: road.verticalAlternatives.map((alt) => ({
            ...alt,
            vertical: alt.vertical.map(restation),
          })),
        }
      : {}),
    ...(road.fsrConnection
      ? {
          fsrConnection: {
            ...road.fsrConnection,
            targetCoordinate: move(road.fsrConnection.targetCoordinate),
            originCoordinate: move(road.fsrConnection.originCoordinate),
          },
        }
      : {}),
  }
}

/** The terrain in the target: relabelled for a CRS (exact), resampled for control points. */
function placeTerrain(
  terrain: TerrainMetadata,
  local: LocalPlacement,
  epsg: number,
  similarity: ((file: XY) => XY) | null,
  notes: string[],
): TerrainMetadata {
  const { localPlane: _dropped, ...rest } = terrain
  void _dropped
  if (!terrain.raster) return { ...rest, epsg }
  const r = terrain.raster
  if (!similarity) {
    // The grid was laid in plane metres; the file's own coordinates are those plus the offset.
    const raster: LocalRaster = {
      ...r,
      epsg,
      origin: [r.origin[0] + local.offsetM[0], r.origin[1] + local.offsetM[1]],
    }
    return { ...rest, epsg, raster }
  }
  const raster = resampleRaster(r, local, epsg, similarity)
  // A project opened without terrain holds an empty grid only to give the plane an extent.
  if (r.values.some((v) => v !== null))
    notes.push(
      `The terrain was resampled to ${raster.pixelSize[0].toFixed(2)} m cells in EPSG:${epsg} (${raster.width} × ${raster.height}).`,
    )
  return { ...rest, epsg, resolutionM: raster.pixelSize[0], raster }
}

/** Bilinear resampling of a plane raster into the target grid through the similarity. */
function resampleRaster(r: LocalRaster, local: LocalPlacement, epsg: number, toGrid: (file: XY) => XY): LocalRaster {
  const file = (col: number, row: number): XY => [
    r.origin[0] + col * r.pixelSize[0] + local.offsetM[0],
    r.origin[1] + row * r.pixelSize[1] + local.offsetM[1],
  ]
  const corners = [file(0, 0), file(r.width - 1, 0), file(0, r.height - 1), file(r.width - 1, r.height - 1)].map(toGrid)
  // The inverse of the similarity, from two mapped points.
  const o = toGrid([0, 0]),
    e = toGrid([1, 0])
  const a = e[0] - o[0],
    b = e[1] - o[1],
    k = a * a + b * b
  const fromGrid = (g: XY): XY => {
    const dx = g[0] - o[0],
      dy = g[1] - o[1]
    return [(a * dx + b * dy) / k, (a * dy - b * dx) / k]
  }
  let cell = Math.abs(r.pixelSize[0]) * Math.sqrt(k)
  const minX = Math.min(...corners.map((c) => c[0])),
    maxX = Math.max(...corners.map((c) => c[0])),
    minY = Math.min(...corners.map((c) => c[1])),
    maxY = Math.max(...corners.map((c) => c[1]))
  while ((Math.floor((maxX - minX) / cell) + 1) * (Math.floor((maxY - minY) / cell) + 1) > MAX_PLACED_RASTER_CELLS)
    cell *= 1.25
  const width = Math.max(2, Math.floor((maxX - minX) / cell) + 1),
    height = Math.max(2, Math.floor((maxY - minY) / cell) + 1)
  const values: (number | null)[] = new Array(width * height).fill(null)
  for (let row = 0; row < height; row++)
    for (let col = 0; col < width; col++) {
      const [fx, fy] = fromGrid([minX + col * cell, maxY - row * cell])
      const c = (fx - local.offsetM[0] - r.origin[0]) / r.pixelSize[0],
        q = (fy - local.offsetM[1] - r.origin[1]) / r.pixelSize[1]
      if (c < 0 || q < 0 || c > r.width - 1 || q > r.height - 1) continue
      const c0 = Math.min(r.width - 2, Math.floor(c)),
        q0 = Math.min(r.height - 2, Math.floor(q))
      const v = [
        r.values[q0 * r.width + c0],
        r.values[q0 * r.width + c0 + 1],
        r.values[(q0 + 1) * r.width + c0],
        r.values[(q0 + 1) * r.width + c0 + 1],
      ]
      if (v.some((x) => x === null)) continue
      const u = c - c0,
        w = q - q0
      values[row * width + col] =
        Math.round((v[0]! * (1 - u) * (1 - w) + v[1]! * u * (1 - w) + v[2]! * (1 - u) * w + v[3]! * u * w) * 1000) /
        1000
    }
  return { ...r, epsg, origin: [minX, maxY], pixelSize: [cell, -cell], width, height, values }
}

// ---- Display ---------------------------------------------------------------------------------------

/** Grid spacing for a plane extent: 10, 20, 50, 100… m, about ten lines across. */
export function gridSpacingM(extentM: number) {
  const target = Math.max(1, extentM / 10)
  const power = 10 ** Math.floor(Math.log10(target))
  return [1, 2, 5, 10].map((m) => m * power).find((s) => s >= target) ?? 10 * power
}

/**
 * Grid lines over a plane extent in longitude/latitude, at round file coordinates, so a reader
 * can find a design point by the coordinates RoadEng shows.
 */
export function localPlaneGrid(
  local: Pick<LocalPlacement, 'offsetM' | 'unitM'>,
  bounds: [west: number, south: number, east: number, north: number],
  maxLines = 80,
): GeoJSON.FeatureCollection<GeoJSON.LineString, { label: string }> {
  const projection = localPlaneProjection(local.offsetM)
  const [x0, y0] = projection.toFile([bounds[0], bounds[1]]),
    [x1, y1] = projection.toFile([bounds[2], bounds[3]])
  const spacing = gridSpacingM(Math.max(x1 - x0, y1 - y0))
  const features: GeoJSON.Feature<GeoJSON.LineString, { label: string }>[] = []
  const label = (m: number) => `${Math.round(m / local.unitM).toLocaleString('en-CA')}`
  for (let x = Math.ceil(x0 / spacing) * spacing; x <= x1 && features.length < maxLines; x += spacing)
    features.push({
      type: 'Feature',
      properties: { label: `E ${label(x)}` },
      geometry: { type: 'LineString', coordinates: [projection.toLonLat([x, y0]), projection.toLonLat([x, y1])] },
    })
  for (let y = Math.ceil(y0 / spacing) * spacing; y <= y1 && features.length < maxLines * 2; y += spacing)
    features.push({
      type: 'Feature',
      properties: { label: `N ${label(y)}` },
      geometry: { type: 'LineString', coordinates: [projection.toLonLat([x0, y]), projection.toLonLat([x1, y])] },
    })
  return { type: 'FeatureCollection', features }
}
