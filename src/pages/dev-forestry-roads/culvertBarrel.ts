import type { CulvertShape } from './culverts/culvertShape'
import type { CulvertProfilePoint } from './engineeringTypes'
import type { TerrainVertex } from './terrainMesh'

/** Points round one ring of the 3D barrel. A multiple of 4, so a box keeps its corners. */
export const BARREL_RING_SIDES = 16

export interface CulvertBarrel {
  /** A ring at each end of the barrel, inlet first; each ring has `BARREL_RING_SIDES` points. */
  rings: TerrainVertex[][]
  /** Each ring's centre, on the barrel's axis. */
  centres: TerrainVertex[]
  /** Outward normal's vertical share for each side of a ring (1 on the crown, −1 on the invert), for shading. */
  sideUp: number[]
}

/**
 * The barrel of a culvert as rings of 3D points, for the 3D preview. The barrel runs along the
 * culvert's own profile (inverts as calculated), its opening `riseM` high and `spanM` wide. A box is
 * drawn square-cornered, every other shape as an ellipse of span and rise. The vertical offsets are
 * divided by `exaggeration`, because the preview stretches heights by it: the opening stays its true
 * shape on screen while the axis stays at its true elevation. One barrel is drawn however many the
 * culvert has. Returns null when fewer than two profile points have a known invert.
 */
export function culvertBarrel({
  profile,
  riseM,
  spanM,
  shape,
  point,
  exaggeration,
}: {
  profile: CulvertProfilePoint[]
  riseM: number
  spanM: number
  shape: CulvertShape
  /** Coordinate to the preview's local metres. */
  point: (coordinate: CulvertProfilePoint['coordinate']) => [number, number]
  exaggeration: number
}): CulvertBarrel | null {
  const withInvert = profile.filter((p) => p.invertElevation !== null && Number.isFinite(p.invertElevation))
  // The barrel is straight and its invert falls evenly between inlet and outlet, so its two ends
  // define it; the profile's other samples are for cover along it.
  const known = withInvert.length >= 2 ? [withInvert[0], withInvert[withInvert.length - 1]] : withInvert
  if (known.length < 2 || !(riseM > 0) || !(spanM > 0) || !(exaggeration > 0)) return null
  const local = known.map((p) => point(p.coordinate))
  const [ax, ay] = local[0],
    [bx, by] = local[local.length - 1]
  const length = Math.hypot(bx - ax, by - ay)
  if (!(length > 0)) return null
  // Horizontal, square to the barrel's run.
  const ux = -(by - ay) / length,
    uy = (bx - ax) / length
  const offsets = Array.from({ length: BARREL_RING_SIDES }, (_, k) => {
    const angle = (2 * Math.PI * k) / BARREL_RING_SIDES
    const cos = Math.cos(angle),
      sin = Math.sin(angle)
    // A box: push each point of the circle out to the square that holds it.
    const stretch = shape === 'box' ? 1 / Math.max(Math.abs(cos), Math.abs(sin)) : 1
    return { across: (spanM / 2) * cos * stretch, up: (riseM / 2) * sin * stretch, sideUp: sin }
  })
  const centres = known.map((p, i) => ({
    x: local[i][0],
    y: local[i][1],
    z: (p.invertElevation as number) + riseM / 2,
  }))
  const rings = centres.map((centre) =>
    offsets.map(({ across, up }) => ({
      x: centre.x + ux * across,
      y: centre.y + uy * across,
      z: centre.z + up / exaggeration,
    })),
  )
  return { rings, centres, sideUp: offsets.map((o) => o.sideUp) }
}

/** `hex` lit by `light` (0 under the barrel, 1 on its crown): darker below, lighter on top. */
export function shadedColour(hex: string, light: number): string {
  const value = Number.parseInt(hex.replace('#', ''), 16)
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255]
  const t = Math.min(1, Math.max(0, light))
  const mixed = channels.map((c) => {
    const lit = t >= 0.5 ? c + (255 - c) * (t - 0.5) * 0.7 : c * (0.55 + 0.9 * t)
    return Math.round(Math.min(255, Math.max(0, lit)))
  })
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

interface ScreenPoint {
  x: number
  y: number
  depth: number
}

export interface BarrelPolygons {
  /** The tube's faces turned to the camera, far first; `light` is 0 under the barrel to 1 on its crown. */
  sides: { points: string; light: number }[]
  /** The openings that face the camera, as SVG polygon points. */
  ends: string[]
  /** The barrel's axis on screen, end to end, for drawing it as a line when it is too small to read. */
  axis: [ScreenPoint, ScreenPoint]
  /** The widest opening across on screen, px. */
  openingPx: number
}

/** Below this many pixels across, a barrel is drawn as a line along its axis: its faces would vanish. */
export const BARREL_MIN_OPENING_PX = 5

const svgPoints = (points: ScreenPoint[]) => points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')

const signedArea = (points: ScreenPoint[]) => {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length]
    area += a.x * b.y - b.x * a.y
  }
  return area / 2
}

/**
 * A barrel's faces on screen. Only faces turned to the camera are kept: every side is wound the same
 * way round the barrel, so a side faces the camera when its screen winding matches the nearest
 * side's, which always does. An opening faces the camera when its end of the axis is the nearer one.
 */
export function barrelPolygons(barrel: CulvertBarrel, project: (vertex: TerrainVertex) => ScreenPoint): BarrelPolygons {
  const rings = barrel.rings.map((ring) => ring.map(project))
  const centres = barrel.centres.map(project)
  const sides: { points: ScreenPoint[]; area: number; depth: number; light: number }[] = []
  for (let i = 0; i + 1 < rings.length; i++)
    for (let k = 0; k < BARREL_RING_SIDES; k++) {
      const next = (k + 1) % BARREL_RING_SIDES
      const points = [rings[i][k], rings[i][next], rings[i + 1][next], rings[i + 1][k]]
      sides.push({
        points,
        area: signedArea(points),
        depth: points.reduce((sum, p) => sum + p.depth, 0) / 4,
        light: ((barrel.sideUp[k] + barrel.sideUp[next]) / 2 + 1) / 2,
      })
    }
  const last = centres.length - 1
  const openingPx = Math.max(
    ...rings.map((ring) => {
      const xs = ring.map((p) => p.x),
        ys = ring.map((p) => p.y)
      return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
    }),
  )
  const axis: [ScreenPoint, ScreenPoint] = [centres[0], centres[last]]
  if (!sides.length) return { sides: [], ends: [], axis, openingPx }
  const nearest = sides.reduce((best, side) => (side.depth < best.depth ? side : best))
  const front = Math.sign(nearest.area)
  return {
    axis,
    openingPx,
    sides: sides
      .filter((side) => Math.sign(side.area) === front)
      .sort((a, b) => b.depth - a.depth)
      .map((side) => ({ points: svgPoints(side.points), light: side.light })),
    ends: [
      ...(centres[0].depth < centres[1].depth ? [svgPoints(rings[0])] : []),
      ...(centres[last].depth < centres[last - 1].depth ? [svgPoints(rings[last])] : []),
    ],
  }
}
