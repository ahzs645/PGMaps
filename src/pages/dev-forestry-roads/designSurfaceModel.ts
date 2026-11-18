/**
 * The road's design surfaces as a 3D model (`.glb`, `.obj`, `.stl`) to look at in Blender, SketchUp
 * or a CAD viewer: the **subgrade** and the **finished surface** as separate named parts, and the
 * ground beside the road. The surfaces are exactly the LandXML TINs (`designSurface`,
 * `designSurfaceExport.ts`): the same points and the same faces, never triangulated again, so the
 * model and the machine-control file are one surface. Where an incomplete section breaks the TIN
 * into pieces the model breaks too: one part per piece, named as the LandXML names its `<Surface>`.
 *
 * The **ground** is the terrain each calculated section was sampled on (`RoadStation.section`'s
 * `ground`), outside its catch points and out to the section's own reach, joined section to section
 * as the surfaces are. It is not read from the terrain again: where a section has no catch point on
 * a side, or a sample has no ground, the ground stops there. It is left out under the road, where in
 * cut it would cover the design surfaces.
 *
 * Grid metres of the road's projected CRS less an origin (the plan's centre to the metre and the
 * lowest level, rounded down), so shape is true and nothing is rotated or scaled; the origin's
 * easting, northing, EPSG code and elevation go with the model. Every part is flat-shaded (no
 * normals): a designed surface is planes meeting at break lines, and smoothing would round the
 * shoulders and ditches off. Faces are double-sided because a face that folds over on the inside of
 * a tight curve faces down.
 *
 * Pure: no DOM or network access.
 */
import { hexColor, type MeshPart, type Model3d, type ModelFormat } from '@/lib/model3d/model'
import { writeModel, type ModelExport } from '@/lib/model3d/writeModel'
import { stationOffsetCoordinate, type ToGrid } from './designExports'
import {
  designSurface,
  designSurfaceNotice,
  VERTICAL_FACE_INSET_M,
  type DesignSurface,
  type DesignSurfaceKind,
} from './designSurfaceExport'
import { formatStationLabel } from './roadStationing'
import type { Alignment, RoadAnalysis, RoadStation, TerrainMetadata } from './types'

/** The model's colours, sRGB hex: compacted soil, gravel and the ground's muted green. */
export const DESIGN_SURFACE_MODEL_COLOURS = {
  subgrade: '#b5916a',
  finished: '#8f8f8a',
  ground: '#6b7a4b',
} as const

export type DesignSurfaceModelPart = keyof typeof DESIGN_SURFACE_MODEL_COLOURS

const PART_LABEL: Record<DesignSurfaceKind, string> = { subgrade: 'Subgrade', finished: 'Finished surface' }
/** A ground face whose plan area is at or below this is degenerate and left out, m² (as the TIN's). */
const MIN_FACE_AREA_M2 = 1e-6

export interface DesignSurfaceModelInput {
  alignment: Alignment
  analysis: RoadAnalysis
  /** The terrain the road was calculated on: its vertical reference goes with the origin. */
  terrain: Pick<TerrainMetadata, 'verticalReference'>
  /** The same grid the LandXML export uses (`exportGrid(terrain, at)` in `terrain.ts`). */
  toGrid: ToGrid
  epsg: number
  /** The project's name, kept in the model's record. */
  projectName?: string
  /** Which surfaces to include (default both). */
  surfaces?: DesignSurfaceKind[]
  /** The ground beside the road from the sections' own samples (default true). */
  ground?: boolean
  /** Colours in place of `DESIGN_SURFACE_MODEL_COLOURS`, `#rrggbb`. */
  colours?: Partial<Record<DesignSurfaceModelPart, string>>
}

interface GroundVertex {
  offset: number
  z: number
}

/**
 * A section's ground outside its catch point on one side, ordered by offset (left: outer edge to the
 * catch; right: catch to outer edge), or null when there is none to draw.
 */
function groundSide(station: RoadStation, side: 'left' | 'right'): GroundVertex[] | null {
  const samples = [...station.section].sort((a, b) => a.offset - b.offset)
  const first = samples.findIndex((s) => s.design != null && Number.isFinite(s.design))
  if (first < 0) return null
  const last =
    samples.length - 1 - [...samples].reverse().findIndex((s) => s.design != null && Number.isFinite(s.design))
  const line: GroundVertex[] = []
  // From the catch point outward while the ground is known: a gap ends the ground on that side.
  const step = side === 'left' ? -1 : 1
  for (let k = side === 'left' ? first : last; k >= 0 && k < samples.length; k += step) {
    const g = samples[k].ground
    if (g == null || !Number.isFinite(g)) break
    line.push({ offset: samples[k].offset, z: g })
  }
  if (side === 'left') line.reverse()
  return line.length >= 2 ? line : null
}

/** Faces between two lines ordered by offset, pairing points by their share of each line's width. */
function zip(a: GroundVertex[], b: GroundVertex[]): [0 | 1, number][][] {
  const ta = (i: number) => (a[i].offset - a[0].offset) / (a[a.length - 1].offset - a[0].offset || 1),
    tb = (j: number) => (b[j].offset - b[0].offset) / (b[b.length - 1].offset - b[0].offset || 1)
  const faces: [0 | 1, number][][] = []
  let i = 0,
    j = 0
  // The same advance rule as the TIN's strips, so the ground winds as the surfaces do.
  while (i < a.length - 1 || j < b.length - 1) {
    if (j === b.length - 1 || (i < a.length - 1 && ta(i + 1) <= tb(j + 1))) {
      faces.push([
        [0, i],
        [0, i + 1],
        [1, j],
      ])
      i++
    } else {
      faces.push([
        [0, i],
        [1, j + 1],
        [1, j],
      ])
      j++
    }
  }
  return faces
}

interface GridMesh {
  /** Grid easting, northing and level. */
  points: [number, number, number][]
  faces: [number, number, number][]
}

/** The ground beside each piece of the road, joined from section to section, in grid coordinates. */
function groundMesh(
  stations: RoadStation[],
  pieces: { from: number; to: number }[],
  toGrid: ToGrid,
): GridMesh & { folded: number } {
  const points: [number, number, number][] = []
  const faces: [number, number, number][] = []
  let folded = 0
  for (const piece of pieces) {
    const run = stations.filter((s) => s.chainage >= piece.from - 1e-9 && s.chainage <= piece.to + 1e-9)
    for (const side of ['left', 'right'] as const) {
      let previous: { line: GroundVertex[]; ids: number[] } | null = null
      for (const station of run) {
        const line = groundSide(station, side)
        if (!line) {
          previous = null
          continue
        }
        const ids = line.map((v) => {
          const [x, y] = toGrid(stationOffsetCoordinate(station, v.offset))
          points.push([x, y, v.z])
          return points.length - 1
        })
        if (previous) {
          const before = previous.ids
          for (const face of zip(previous.line, line)) {
            const tri = face.map(([which, i]) => (which === 0 ? before : ids)[i]) as [number, number, number]
            const [p, q, r] = tri.map((i) => points[i])
            const area = ((q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1])) / 2
            if (Math.abs(area) <= MIN_FACE_AREA_M2) continue
            if (area < 0) folded++
            faces.push(tri)
          }
        }
        previous = { line, ids }
      }
    }
  }
  return { points, faces, folded }
}

/** The road's design surfaces (and the ground beside them) as a model in local grid metres. */
export function designSurfaceModel(input: DesignSurfaceModelInput): Model3d {
  const { alignment, analysis, toGrid, epsg } = input
  const kinds = input.surfaces ?? (['subgrade', 'finished'] as DesignSurfaceKind[])
  const colour = (part: DesignSurfaceModelPart) => hexColor(input.colours?.[part] ?? DESIGN_SURFACE_MODEL_COLOURS[part])
  const at = (chainage: number) => formatStationLabel(chainage, alignment.stationing)
  const surfaces: DesignSurface[] = kinds.map((kind) => designSurface(kind, alignment, analysis, toGrid))
  if (!surfaces.some((s) => s.pieces.length))
    throw Error(`${alignment.name} has no two complete sections in a row, so there is no design surface to model.`)

  const stations = [...analysis.stations].sort((a, b) => a.chainage - b.chainage)
  const ground =
    input.ground === false ? null : groundMesh(stations, surfaces.find((s) => s.pieces.length)?.pieces ?? [], toGrid)

  // The origin: the plan's centre to the metre and the lowest level rounded down, so every z is at or above 0.
  const all = [...surfaces.flatMap((s) => s.pieces.flatMap((p) => p.points)), ...(ground?.points ?? [])]
  let minE = Infinity,
    maxE = -Infinity,
    minN = Infinity,
    maxN = -Infinity,
    minZ = Infinity
  for (const [e, n, z] of all) {
    minE = Math.min(minE, e)
    maxE = Math.max(maxE, e)
    minN = Math.min(minN, n)
    maxN = Math.max(maxN, n)
    minZ = Math.min(minZ, z)
  }
  const origin = {
    kind: 'grid' as const,
    epsg,
    // `+ 0` turns a rounded −0 into 0, which JSON and the notes would otherwise print as "-0".
    easting: Math.round((minE + maxE) / 2) + 0,
    northing: Math.round((minN + maxN) / 2) + 0,
    elevation: Math.floor(minZ) + 0,
    verticalDatum: input.terrain.verticalReference,
  }
  const local = (mesh: GridMesh) => ({
    positions: Float32Array.from(
      mesh.points.flatMap(([e, n, z]) => [e - origin.easting, n - origin.northing, z - origin.elevation]),
    ),
    indices: Uint32Array.from(mesh.faces.flat()),
  })

  const parts: MeshPart[] = []
  for (const surface of surfaces) {
    const label = PART_LABEL[surface.kind]
    surface.pieces.forEach((piece, index) => {
      parts.push({
        // The LandXML `<Surface>` name, so a piece is found by the same name in both files.
        name: `${alignment.name} ${label}${surface.pieces.length > 1 ? ` part ${index + 1}` : ''}`,
        ...local(piece),
        color: colour(surface.kind),
        doubleSided: true,
        attributes: {
          road: alignment.name,
          surface: surface.kind,
          from: at(piece.from),
          to: at(piece.to),
          fromChainageM: piece.from,
          toChainageM: piece.to,
          faces: piece.faces.length,
          folded: piece.folded,
        },
      })
    })
  }
  if (ground?.faces.length)
    parts.push({
      name: `${alignment.name} Ground beside the road`,
      ...local(ground),
      color: colour('ground'),
      doubleSided: true,
      attributes: { road: alignment.name, surface: 'ground', faces: ground.faces.length, folded: ground.folded },
    })

  const verticalFaces = Math.max(0, ...surfaces.map((s) => s.verticalFaces))
  const notes = [
    'Preliminary planning geometry; not a construction design.',
    ...surfaces.map((s) => designSurfaceNotice(s, alignment)),
    'The surfaces are the LandXML design surface TINs, face for face. Offsets are negative to the left looking up-station.',
    ...(kinds.length > 1
      ? [
          'The finished surface lies on the subgrade beyond the formation edges, so the two coincide there: hide one part to see the other.',
        ]
      : []),
    ...(verticalFaces
      ? [
          `Vertical faces (square course edges, steps) are drawn ${VERTICAL_FACE_INSET_M * 1000} mm wide, as in the TIN.`,
        ]
      : []),
    input.ground === false
      ? 'Ground left out.'
      : ground?.faces.length
        ? 'Ground beside the road: the terrain each section was sampled on, outside its catch points and out to the section reach, not read from the terrain again; none under the road, and none where a section has no catch point on that side or its ground has a gap.'
        : 'Ground left out: no section had ground samples outside its catch points.',
    'Flat-shaded; faces drawn from both sides, since a face that folds over on the inside of a tight curve faces down.',
  ]
  return {
    name: `${alignment.name} design surfaces`,
    parts,
    origin,
    notes,
    extras: {
      ...(input.projectName ? { project: input.projectName } : {}),
      road: alignment.name,
      source: 'PGMaps forest road design',
    },
  }
}

/** One call from a calculated road to the model's files in a format. */
export function designSurfaceModelExport(input: DesignSurfaceModelInput, format: ModelFormat): ModelExport {
  const model = designSurfaceModel(input)
  return writeModel(model, format, `${input.alignment.name} design surfaces`)
}
