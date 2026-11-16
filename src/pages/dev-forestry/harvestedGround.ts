/**
 * What a cutblock looks like after harvest, beyond the trees taken off it.
 *
 * The road view already leaves a block's ground bare and fills it the colour
 * of soil. Seen from a road, three more things make an opening read as one
 * rather than as a pale patch:
 *
 * - **Slash and stumps** on the ground: low, dark, broken texture against the
 *   soil, which is what tells a fresh cutblock from a meadow at a few hundred
 *   metres. `placeDebris` scatters piles over the opening; `debrisMesh` is one
 *   pile (stumps and a few lying logs).
 * - **A hard edge.** Where the block meets standing timber, the edge trees
 *   stand as a wall against open ground. Up close the stand is drawn stem for
 *   stem and the edge is already hard; past about 250 m each drawn stem stands
 *   for several, so the edge goes ragged by half a band's spacing. A row of
 *   edge stems along the opening's boundary (`placeEdgeTrees`) keeps it crisp.
 * - **Road cut and fill.** A road across a slope cuts a bank on the uphill
 *   side and spills fill down the other, and both are bare. `roadScar` works
 *   out how wide each is from the side slope.
 *
 * All display only: nothing here changes a figure the run reports. DOM-free,
 * like `forest.ts`, so it is unit-tested.
 */

import { metersPerDegree, preparePolygons, type PolygonGeometry } from './visibility'
import {
  CONE_BASE_DIAMETER,
  REGIONAL_STAND,
  crownWidthForClosure,
  speciesFromMix,
  type InventoryStand,
  type TreeInstance,
} from './forest'
import type { ForestMesh } from './forest'

/** Deterministic noise, seeded per cell so a pile never moves as the camera does. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function cellSeed(x: number, y: number, seed: number): number {
  return (Math.imul(x, 73_856_093) ^ Math.imul(y, 19_349_663) ^ Math.imul(seed, 83_492_791)) >>> 0
}

/**
 * One debris pile: two stumps and a handful of logs and limbs lying at random.
 * Unit height is a metre, so it is drawn at height 1 and its footprint set by
 * the width scale. All wood (`bark` 1): slash is grey-brown, not green.
 */
export function debrisMesh(seed = 1): ForestMesh {
  const positions: number[] = []
  const normals: number[] = []
  const bark: number[] = []
  const indices: number[] = []
  const random = mulberry32(seed * 2_654_435_761)
  /**
   * A six-sided log or stump from a to b, its far end capped (a cut face).
   * Six sides are enough to read as round at the size a pile is seen.
   */
  const log = (a: number[], b: number[], radius: number) => {
    const axis = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const length = Math.hypot(axis[0], axis[1], axis[2]) || 1
    const w = axis.map((value) => value / length)
    const helper = Math.abs(w[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
    const u = [
      w[1] * helper[2] - w[2] * helper[1],
      w[2] * helper[0] - w[0] * helper[2],
      w[0] * helper[1] - w[1] * helper[0],
    ]
    const ul = Math.hypot(u[0], u[1], u[2]) || 1
    for (let i = 0; i < 3; i += 1) u[i] /= ul
    const v = [w[1] * u[2] - w[2] * u[1], w[2] * u[0] - w[0] * u[2], w[0] * u[1] - w[1] * u[0]]
    const sides = 6
    const ring = (centre: number[], i: number) => {
      const angle = (i / sides) * Math.PI * 2
      const radial = [0, 1, 2].map((k) => Math.cos(angle) * u[k] + Math.sin(angle) * v[k])
      return { point: [0, 1, 2].map((k) => centre[k] + radial[k] * radius), radial }
    }
    const push = (point: number[], normal: number[]) => {
      positions.push(point[0], point[1], point[2])
      normals.push(normal[0], normal[1], normal[2])
      bark.push(1)
      return positions.length / 3 - 1
    }
    for (let i = 0; i < sides; i += 1) {
      const p0 = ring(a, i)
      const p1 = ring(a, i + 1)
      const q0 = ring(b, i)
      const q1 = ring(b, i + 1)
      const i0 = push(p0.point, p0.radial)
      const i1 = push(p1.point, p1.radial)
      const j0 = push(q0.point, q0.radial)
      const j1 = push(q1.point, q1.radial)
      indices.push(i0, i1, j0, j0, i1, j1)
    }
    const centre = push(b, w)
    for (let i = 0; i < sides; i += 1) indices.push(centre, push(ring(b, i).point, w), push(ring(b, i + 1).point, w))
  }
  // Two stumps, cut a little above the ground.
  for (let i = 0; i < 2; i += 1) {
    const radius = 0.05 + random() * 0.03
    const height = 0.3 + random() * 0.2
    const x = (random() - 0.5) * 0.7
    const y = (random() - 0.5) * 0.7
    log([x, y, 0], [x, y, height], radius)
  }
  // Logs and limbs, lying at any angle, some propped up on others.
  for (let i = 0; i < 7; i += 1) {
    const half = 0.18 + random() * 0.32
    const radius = 0.012 + random() * 0.02
    const yaw = random() * Math.PI * 2
    const rise = (random() - 0.5) * 0.5
    const centre = [(random() - 0.5) * 0.8, (random() - 0.5) * 0.8, radius + random() * 0.12]
    const along = [Math.cos(yaw) * Math.cos(rise), Math.sin(yaw) * Math.cos(rise), Math.sin(rise)]
    log(
      centre.map((c, k) => c - along[k] * half),
      centre.map((c, k) => c + along[k] * half),
      radius,
    )
  }
  return {
    attributes: {
      positions: { size: 3, value: new Float32Array(positions) },
      normals: { size: 3, value: new Float32Array(normals) },
      bark: { size: 1, value: new Float32Array(bark) },
    },
    indices: { size: 1, value: new Uint16Array(indices) },
  }
}

/** A debris pile's footprint, metres, as drawn. */
export const DEBRIS_FOOTPRINT_METERS = 4

/**
 * Piles of slash over the opened ground inside `bounds` [west, south, east,
 * north]: about one per `spacingMeters` square, jittered, seeded by absolute
 * cell so the same ground always carries the same piles. Each comes back as a
 * stem the solid layer can draw with `debrisMesh`: a metre tall, its crown
 * width the pile's footprint.
 */
export function placeDebris(
  openings: ReadonlyArray<PolygonGeometry>,
  bounds: [number, number, number, number],
  spacingMeters = 12,
  seed = 1,
): TreeInstance[] {
  if (openings.length === 0 || spacingMeters <= 0) return []
  const [west, south, east, north] = bounds
  const inside = preparePolygons(openings, bounds)
  if (inside.partCount === 0) return []
  const scale = metersPerDegree((south + north) / 2)
  const stepLng = spacingMeters / scale.lng
  const stepLat = spacingMeters / scale.lat
  const piles: TreeInstance[] = []
  for (let cy = Math.floor(south / stepLat); cy * stepLat < north; cy += 1) {
    for (let cx = Math.floor(west / stepLng); cx * stepLng < east; cx += 1) {
      const random = mulberry32(cellSeed(cx, cy, seed))
      const lng = (cx + 0.5 + (random() - 0.5) * 0.9) * stepLng
      const lat = (cy + 0.5 + (random() - 0.5) * 0.9) * stepLat
      if (lng < west || lng >= east || lat < south || lat >= north) continue
      if (!inside.contains(lng, lat)) continue
      const footprint = DEBRIS_FOOTPRINT_METERS * (0.6 + random() * 0.8)
      piles.push({
        lng,
        lat,
        elevationMeters: 0,
        heightMeters: 1,
        // The solid layer's width scale is height × slenderness / cone base.
        slenderness: footprint * CONE_BASE_DIAMETER,
        tone: random(),
        species: 'pine',
        variant: 0,
      })
    }
  }
  return piles
}

export type EdgeTreeOptions = {
  /** Cut ground whose edge the row follows: blocks after harvest, openings still counting. */
  openings: ReadonlyArray<PolygonGeometry>
  /** Ground nothing grows on (water, road, the openings themselves). */
  clearings: ReadonlyArray<PolygonGeometry>
  /** Only grow inside this [west, south, east, north] box, as a patch does. */
  bounds: [number, number, number, number]
  /** Recorded stands, for species and height where the inventory has them. */
  inventory?: ReadonlyArray<InventoryStand>
  /** Height where no stand is recorded. */
  heightMeters?: number
  /** Distance between edge stems along the boundary. */
  spacingMeters?: number
  /** How far into the standing timber the row stands. */
  setbackMeters?: number
  seed?: number
}

/**
 * A row of stems just inside the standing timber along each opening's edge,
 * for the coarse distance bands. Each is the species and height the
 * inventory records there (the regional stand where it records none), with
 * the crown a closed edge carries at this spacing. Stems that would land in a
 * clearing, in another opening, or on ground the inventory says is not forest
 * are left out.
 */
export function placeEdgeTrees({
  openings,
  clearings,
  bounds,
  inventory = [],
  heightMeters = REGIONAL_STAND.heightMeters,
  spacingMeters = 6,
  setbackMeters = 2.5,
  seed = 1,
}: EdgeTreeOptions): TreeInstance[] {
  if (openings.length === 0) return []
  const [west, south, east, north] = bounds
  const scale = metersPerDegree((south + north) / 2)
  const pad = (setbackMeters + spacingMeters) / scale.lat
  const blocked = preparePolygons([...clearings, ...openings], [west - pad, south - pad, east + pad, north + pad])
  const cut = preparePolygons(openings, [west - pad, south - pad, east + pad, north + pad])
  const surveyed = preparePolygons(
    inventory.map((stand) => stand.geometry),
    bounds,
  )
  const trees: TreeInstance[] = []
  const crown = crownWidthForClosure(REGIONAL_STAND.crownClosurePercent, 1 / (spacingMeters * spacingMeters))

  const rings = openings.flatMap((geometry) =>
    geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat(),
  )
  rings.forEach((ring, ringIndex) => {
    for (let i = 0; i + 1 < ring.length; i += 1) {
      const [x0, y0] = ring[i]
      const [x1, y1] = ring[i + 1]
      // Skip edges nowhere near this patch.
      if (Math.max(x0, x1) < west - pad || Math.min(x0, x1) > east + pad) continue
      if (Math.max(y0, y1) < south - pad || Math.min(y0, y1) > north + pad) continue
      const dx = (x1 - x0) * scale.lng
      const dy = (y1 - y0) * scale.lat
      const length = Math.hypot(dx, dy)
      if (length === 0) continue
      const steps = Math.max(1, Math.round(length / spacingMeters))
      // Both perpendiculars: whichever side is not cut is the timber side.
      const nx = -dy / length
      const ny = dx / length
      for (let k = 0; k < steps; k += 1) {
        const random = mulberry32(cellSeed(ringIndex * 100_003 + i, k, seed))
        const t = (k + 0.5 + (random() - 0.5) * 0.4) / steps
        const baseLng = x0 + (x1 - x0) * t
        const baseLat = y0 + (y1 - y0) * t
        for (const side of [1, -1]) {
          const setback = setbackMeters * (0.7 + random() * 0.6)
          const lng = baseLng + (side * nx * setback) / scale.lng
          const lat = baseLat + (side * ny * setback) / scale.lat
          if (lng < west || lng >= east || lat < south || lat >= north) continue
          if (cut.contains(lng, lat) || blocked.contains(lng, lat)) continue
          const stand = inventory[surveyed.indexAt(lng, lat)] ?? null
          if (stand?.cover && stand.cover !== 'shrubTall') continue
          const mix = stand?.speciesMix && stand.speciesMix.length > 0 ? stand.speciesMix : null
          const species = mix ? speciesFromMix(random(), mix) : (stand?.species ?? speciesFromMix(random()))
          const standHeight = stand?.heightMeters ?? heightMeters
          if (!(standHeight > 0)) continue
          trees.push({
            lng,
            lat,
            elevationMeters: 0,
            heightMeters: standHeight * (0.8 + random() * 0.35),
            slenderness: Math.min(0.6, (crown / standHeight) * (0.85 + random() * 0.3)),
            tone: random(),
            species,
            variant: Math.floor(random() * 4),
          })
        }
      }
    }
  })
  return trees
}

export type RoadScarOptions = {
  /** Road surface width, metres. */
  roadWidthMeters: number
  /** Cut bank slope as rise over run: 1 is 1:1, a common bank in competent soil. */
  cutSlope?: number
  /** Fill slope as rise over run: 1/1.5 is the usual 1.5H:1V spill. */
  fillSlope?: number
  /** Widest a cut or fill is drawn, metres; past it the slope is too steep for this simple bench. */
  maxReachMeters?: number
  /** How far either side of the road the ground is read to find its side slope. */
  sampleMeters?: number
}

/** One side's bare strip: a polygon ring along the road, and which kind it is. */
export type RoadScarStrip = { kind: 'cut' | 'fill'; geometry: GeoJSON.Polygon }

/**
 * The cut bank and fill slope a road leaves across sloping ground, as strips
 * either side of it. For a bench of half-width b on ground of side slope s,
 * the cut reaches b·s/(c − s) past the uphill edge and the fill b·s/(f − s)
 * past the downhill one (c and f the cut and fill slopes); flat ground gets
 * neither. A simple bench section, not a road design: enough to show where a
 * road would scar a hillside seen from across the valley.
 */
export function roadScar(
  coordinates: ReadonlyArray<[number, number]>,
  elevationAt: (lng: number, lat: number) => number,
  { roadWidthMeters, cutSlope = 1, fillSlope = 1 / 1.5, maxReachMeters = 30, sampleMeters = 15 }: RoadScarOptions,
): RoadScarStrip[] {
  if (coordinates.length < 2 || !(roadWidthMeters > 0)) return []
  const half = roadWidthMeters / 2
  const scale = metersPerDegree(coordinates[0][1])
  // At each vertex: the road's left normal, and how far cut or fill reaches on each side.
  const stations = coordinates.map((point, index) => {
    const previous = coordinates[Math.max(0, index - 1)]
    const next = coordinates[Math.min(coordinates.length - 1, index + 1)]
    const dx = (next[0] - previous[0]) * scale.lng
    const dy = (next[1] - previous[1]) * scale.lat
    const length = Math.hypot(dx, dy) || 1
    const left = [-dy / length, dx / length]
    const at = (side: number, meters: number) =>
      elevationAt(point[0] + (side * left[0] * meters) / scale.lng, point[1] + (side * left[1] * meters) / scale.lat)
    const leftZ = at(1, sampleMeters)
    const rightZ = at(-1, sampleMeters)
    // Rise toward the left, per metre across the road.
    const slope = Number.isFinite(leftZ) && Number.isFinite(rightZ) ? (leftZ - rightZ) / (2 * sampleMeters) : 0
    const steep = Math.abs(slope)
    const cut = steep >= cutSlope ? maxReachMeters : Math.min(maxReachMeters, (half * steep) / (cutSlope - steep))
    const fill = steep >= fillSlope ? maxReachMeters : Math.min(maxReachMeters, (half * steep) / (fillSlope - steep))
    // Uphill is the left when the ground rises to the left.
    const uphill = slope >= 0 ? 1 : -1
    return { point, left, reach: { [uphill]: cut, [-uphill]: fill } as Record<number, number>, uphill }
  })
  const strips: RoadScarStrip[] = []
  for (const side of [1, -1]) {
    // Runs of consecutive vertices where this side is the same kind and wide enough to draw.
    let run: typeof stations = []
    let runKind: 'cut' | 'fill' | null = null
    const flush = () => {
      if (run.length >= 2 && runKind) {
        const offset = (station: (typeof stations)[number], meters: number): [number, number] => [
          station.point[0] + (side * station.left[0] * meters) / scale.lng,
          station.point[1] + (side * station.left[1] * meters) / scale.lat,
        ]
        const outer = run.map((station) => offset(station, half + station.reach[side]))
        const inner = run.map((station) => offset(station, half)).reverse()
        const ring = [...outer, ...inner, outer[0]]
        strips.push({ kind: runKind, geometry: { type: 'Polygon', coordinates: [ring] } })
      }
      run = []
      runKind = null
    }
    for (const station of stations) {
      const kind = station.uphill === side ? 'cut' : 'fill'
      if (station.reach[side] < 0.5) {
        // Too narrow to see: end any run, keeping this vertex as its last point.
        if (run.length) run.push(station)
        flush()
        continue
      }
      if (runKind && kind !== runKind) {
        run.push(station)
        flush()
      }
      runKind = kind
      run.push(station)
    }
    flush()
  }
  return strips
}

/**
 * Meshes for what a stand prescription leaves of each tree it takes (`stand/prescribedCells.ts`,
 * `treatedStems`): a stump, a felled tree with its crown, a limbed log. Drawn by the solid tree layer,
 * the lying two with `headings` so each lies the way it was felled. Display only.
 */
type MeshBuilder = { positions: number[]; normals: number[]; bark: number[]; indices: number[] }

function newBuilder(): MeshBuilder {
  return { positions: [], normals: [], bark: [], indices: [] }
}

function finishMesh(builder: MeshBuilder): ForestMesh {
  return {
    attributes: {
      positions: { size: 3, value: new Float32Array(builder.positions) },
      normals: { size: 3, value: new Float32Array(builder.normals) },
      bark: { size: 1, value: new Float32Array(builder.bark) },
    },
    indices: { size: 1, value: new Uint16Array(builder.indices) },
  }
}

/** An elliptic cylinder from `a` to `b` (axis along x or z), radii `ry`/`rz` or `rx`/`ry`, both ends capped. */
function cylinder(
  builder: MeshBuilder,
  axis: 'x' | 'z',
  from: number,
  to: number,
  r1: number,
  r2: number,
  barkValue: number,
  centre: [number, number] = [0, 0],
  sides = 8,
) {
  const point = (t: number, angle: number): [number, number, number] => {
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    return axis === 'z' ? [c * r1 + centre[0], s * r2 + centre[1], t] : [t, c * r1 + centre[0], s * r2 + centre[1]]
  }
  const normal = (angle: number): [number, number, number] =>
    axis === 'z' ? [Math.cos(angle), Math.sin(angle), 0] : [0, Math.cos(angle), Math.sin(angle)]
  const push = (p: number[], n: number[]) => {
    builder.positions.push(p[0], p[1], p[2])
    builder.normals.push(n[0], n[1], n[2])
    builder.bark.push(barkValue)
    return builder.positions.length / 3 - 1
  }
  for (let i = 0; i < sides; i += 1) {
    const a0 = (i / sides) * Math.PI * 2
    const a1 = ((i + 1) / sides) * Math.PI * 2
    const i0 = push(point(from, a0), normal(a0))
    const i1 = push(point(from, a1), normal(a1))
    const j0 = push(point(to, a0), normal(a0))
    const j1 = push(point(to, a1), normal(a1))
    builder.indices.push(i0, i1, j0, j0, i1, j1)
  }
  for (const [t, sign] of [
    [from, -1],
    [to, 1],
  ] as const) {
    const capNormal = axis === 'z' ? [0, 0, sign] : [sign, 0, 0]
    const middle = push(axis === 'z' ? [centre[0], centre[1], t] : [t, centre[0], centre[1]], capNormal)
    for (let i = 0; i < sides; i += 1)
      builder.indices.push(
        middle,
        push(point(t, (i / sides) * Math.PI * 2), capNormal),
        push(point(t, ((i + 1) / sides) * Math.PI * 2), capNormal),
      )
  }
}

/** A stump: a cylinder a unit across and a unit tall, drawn at its stump height and diameter. */
export function stumpMesh(): ForestMesh {
  const builder = newBuilder()
  cylinder(builder, 'z', 0, 1, 0.5, 0.5, 1)
  return finishMesh(builder)
}

/**
 * Lying meshes are a unit long along +x from the stump, and a unit tall per metre of stem diameter:
 * drawn with height = diameter and width scale = length, so their lateral size is a fixed share of
 * the length (a stem about 1/70 of its length across, a crown about a quarter).
 */
const LYING_STEM_RADIUS = 0.007

/** A limbed log, lying. */
export function logMesh(): ForestMesh {
  const builder = newBuilder()
  cylinder(builder, 'x', 0, 1, LYING_STEM_RADIUS, 0.5, 1, [0, 0.5])
  return finishMesh(builder)
}

/** A felled tree with its crown, lying: the stem, and a flattened crown over its upper part. */
export function felledTreeMesh(): ForestMesh {
  const builder = newBuilder()
  cylinder(builder, 'x', 0, 1, LYING_STEM_RADIUS, 0.5, 1, [0, 0.5])
  // The crown: an ellipsoid over the top 60% of the stem, about a quarter of the length across and
  // five stem diameters high where it lies.
  const rings = 6
  const sides = 8
  const centreX = 0.68
  const rx = 0.32
  const ry = 0.12
  const rz = 2.5
  const start = builder.positions.length / 3
  for (let r = 0; r <= rings; r += 1) {
    const phi = (r / rings) * Math.PI
    for (let k = 0; k <= sides; k += 1) {
      const theta = (k / sides) * Math.PI * 2
      const nx = Math.cos(phi)
      const ny = Math.sin(phi) * Math.cos(theta)
      const nz = Math.sin(phi) * Math.sin(theta)
      builder.positions.push(centreX + nx * rx, ny * ry, Math.max(0, 0.5 + nz * rz))
      const length = Math.hypot(nx / rx, ny / ry, nz / rz) || 1
      builder.normals.push(nx / rx / length, ny / ry / length, nz / rz / length)
      builder.bark.push(0)
    }
  }
  for (let r = 0; r < rings; r += 1)
    for (let k = 0; k < sides; k += 1) {
      const a = start + r * (sides + 1) + k
      const b = a + sides + 1
      builder.indices.push(a, b, a + 1, a + 1, b, b + 1)
    }
  return finishMesh(builder)
}

/**
 * A snag: a wildlife tree topped and left standing dead. A unit across at the base and a unit tall,
 * drawn at its snag height and diameter, tapering, with a few broken branch stubs. All wood.
 */
export function snagMesh(): ForestMesh {
  const builder = newBuilder()
  cylinder(builder, 'z', 0, 0.55, 0.5, 0.5, 1)
  cylinder(builder, 'z', 0.55, 1, 0.36, 0.36, 1)
  // Branch stubs: short and thin, pointing a few ways up the stem.
  for (const [angle, z] of [
    [0.4, 0.62],
    [2.5, 0.74],
    [4.4, 0.85],
  ] as const) {
    const sub = newBuilder()
    cylinder(sub, 'x', 0, 1.6, 0.12, 0.012, 1, [0, z])
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const offset = builder.positions.length / 3
    for (let i = 0; i < sub.positions.length; i += 3) {
      const [x, y, zz] = [sub.positions[i], sub.positions[i + 1], sub.positions[i + 2]]
      builder.positions.push(x * cos - y * sin, x * sin + y * cos, zz)
      const [nx, ny, nz] = [sub.normals[i], sub.normals[i + 1], sub.normals[i + 2]]
      builder.normals.push(nx * cos - ny * sin, nx * sin + ny * cos, nz)
    }
    builder.bark.push(...sub.bark)
    builder.indices.push(...sub.indices.map((index) => index + offset))
  }
  return finishMesh(builder)
}
