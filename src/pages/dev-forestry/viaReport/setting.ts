/**
 * Where the blocks are and what the land is like, as a VIA report's summary and landscape paragraphs say it (22, 23):
 * the named places around the blocks and how far and which way the blocks lie from them, the way the blocks' ground
 * faces and how steep it is, and the stands the forest inventory records over the landforms. Every value is read
 * from what the page already holds: the basemap's place labels (`collectPlacesFromMap`), the run's terrain samples
 * and the run's own inventory read (`renderStands`). Words that need a judgement (the topography's character, the
 * stands' history) stay the reviewer's. No DOM or network access.
 */
import type { PlaceKind, PlaceLabel } from '../basemapContext'
import type { PolygonGeometry } from '../visibility'
import { bearingDegrees, haversineMeters, polygonAreaMeters, preparePolygons } from '../visibility'

/** A named place near the blocks: how far the blocks' centre is from it, and in which direction. */
export interface SettingPlace {
  name: string
  kind: PlaceKind
  distanceKm: number
  /** The blocks' direction from the place, a compass word ("north", "southeast"). */
  direction: string
}

export interface ReportSetting {
  /** Named places around the blocks, nearest first within each kind; empty when the basemap named none. */
  places: readonly SettingPlace[]
  /** The blocks' ground: the way it faces (compass word) and its mean slope, from the run's samples. */
  ground: { aspect: string | null; slopePercent: number | null } | null
  /** The landforms' mean slope, percent, area-weighted over the run's landform samples. */
  landformSlopePercent: number | null
  /**
   * The stands the forest inventory records over the landforms' samples: species by share of the recorded
   * composition (common names, largest first), mean projected height, and the share of the samples in a treed stand.
   */
  stand: {
    species: ReadonlyArray<{ name: string; percent: number }>
    heightM: number | null
    coverPercent: number
  } | null
}

const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'] as const

/** A bearing, degrees clockwise from north, as one of the eight compass words. */
export function compassWord(deg: number): (typeof COMPASS)[number] {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]
}

/** How many places of each kind the summary names, nearest first. */
const PLACES_PER_KIND: Readonly<Record<PlaceKind, number>> = { settlement: 2, water: 1, peak: 1, island: 1, other: 0 }
/** Places farther than this from the blocks do not place them (they place the region). */
export const PLACE_REACH_KM = 25

/** The places that place the blocks: the nearest of each kind within `PLACE_REACH_KM`, nearest first. */
export function placesAround(labels: readonly PlaceLabel[], centre: [number, number]): SettingPlace[] {
  const at = { lng: centre[0], lat: centre[1] }
  const measured = labels
    .map((label) => {
      const from = { lng: label.lngLat[0], lat: label.lngLat[1] }
      return {
        name: label.name,
        kind: label.kind,
        distanceKm: haversineMeters(from, at) / 1000,
        direction: compassWord(bearingDegrees(from, at)),
      }
    })
    .filter((place) => place.distanceKm <= PLACE_REACH_KM)
    .sort((a, b) => a.distanceKm - b.distanceKm)
  const taken = new Map<PlaceKind, number>()
  return measured.filter((place) => {
    const count = taken.get(place.kind) ?? 0
    if (count >= PLACES_PER_KIND[place.kind]) return false
    taken.set(place.kind, count + 1)
    return true
  })
}

/** The blocks' centre: the area-weighted mean of their outlines' vertex means. */
export function blocksCentre(blocks: readonly PolygonGeometry[]): [number, number] | null {
  let lng = 0,
    lat = 0,
    weight = 0
  for (const block of blocks) {
    const ring = block.type === 'Polygon' ? block.coordinates[0] : block.coordinates[0]?.[0]
    if (!ring?.length) continue
    const points = ring.length > 1 ? ring.slice(0, -1) : ring
    const area = Math.max(1, polygonAreaMeters(block))
    lng += (area * points.reduce((sum, p) => sum + p[0], 0)) / points.length
    lat += (area * points.reduce((sum, p) => sum + p[1], 0)) / points.length
    weight += area
  }
  return weight ? [lng / weight, lat / weight] : null
}

/** Ground flatter than this overall (percent) faces no way in particular: no aspect is said. */
export const FLAT_GROUND_PERCENT = 5

/**
 * The way a set of terrain samples faces, from the least-squares plane through them: the compass word of its
 * steepest descent, or null when the plane is flatter than `FLAT_GROUND_PERCENT` or the samples are too few.
 * `positions` are lng/lat pairs, `elevations` metres, as the run keeps them.
 */
export function groundAspect(positions: ArrayLike<number>, elevations: ArrayLike<number>): string | null {
  const n = Math.min(Math.floor(positions.length / 2), elevations.length)
  if (n < 3) return null
  const lat0 = positions[1]
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180),
    ky = 110_540
  let sx = 0,
    sy = 0,
    sz = 0,
    count = 0
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(elevations[i])) continue
    sx += positions[i * 2] * kx
    sy += positions[i * 2 + 1] * ky
    sz += elevations[i]
    count++
  }
  if (count < 3) return null
  const mx = sx / count,
    my = sy / count,
    mz = sz / count
  let xx = 0,
    xy = 0,
    yy = 0,
    xz = 0,
    yz = 0
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(elevations[i])) continue
    const x = positions[i * 2] * kx - mx,
      y = positions[i * 2 + 1] * ky - my,
      z = elevations[i] - mz
    xx += x * x
    xy += x * y
    yy += y * y
    xz += x * z
    yz += y * z
  }
  const det = xx * yy - xy * xy
  if (Math.abs(det) < 1e-9) return null
  // z = a x + b y: the plane's gradient (a, b), east and north.
  const a = (xz * yy - yz * xy) / det,
    b = (yz * xx - xz * xy) / det
  if (100 * Math.hypot(a, b) < FLAT_GROUND_PERCENT) return null
  return compassWord((Math.atan2(-a, -b) * 180) / Math.PI)
}

/**
 * Common names for the forest inventory's species codes (VRI `SPECIES_CD_n`), tried as given, then by their first
 * two letters, then by the first: a public code list, not a style.
 */
const SPECIES_NAMES: Readonly<Record<string, string>> = {
  FD: 'Douglas-fir',
  F: 'Douglas-fir',
  HW: 'western hemlock',
  HM: 'mountain hemlock',
  H: 'hemlock',
  CW: 'western redcedar',
  C: 'western redcedar',
  YC: 'yellow-cedar',
  Y: 'yellow-cedar',
  PL: 'lodgepole pine',
  PY: 'ponderosa pine',
  PW: 'western white pine',
  PA: 'whitebark pine',
  P: 'pine',
  SX: 'hybrid spruce',
  SW: 'white spruce',
  SE: 'Engelmann spruce',
  SS: 'Sitka spruce',
  SB: 'black spruce',
  S: 'spruce',
  BA: 'amabilis fir',
  BL: 'subalpine fir',
  BG: 'grand fir',
  B: 'true fir',
  LW: 'western larch',
  L: 'larch',
  DR: 'red alder',
  D: 'red alder',
  AT: 'trembling aspen',
  AC: 'cottonwood',
  EP: 'paper birch',
  E: 'birch',
  MB: 'bigleaf maple',
}

export function speciesName(code: string): string | null {
  const upper = code.trim().toUpperCase()
  return SPECIES_NAMES[upper] ?? SPECIES_NAMES[upper.slice(0, 2)] ?? SPECIES_NAMES[upper.slice(0, 1)] ?? null
}

/** A stand as the run reads it from the inventory (`AnalysisResult.renderStands`). */
export interface SettingStand {
  geometry: PolygonGeometry
  heightMeters: number
  speciesCode?: string | null
  speciesComposition?: ReadonlyArray<{ code: string; percent: number; heightMeters: number | null }>
}

/** A species below this share of the recorded composition is not named. */
export const MINOR_SPECIES_PERCENT = 10

/**
 * What the inventory records over a set of sample points (the run's landform samples): each species' share of the
 * composition across the samples in a stand, the mean projected height, and the share of the samples in a stand.
 * Null when no sample falls in a recorded stand.
 */
export function standCharacter(stands: readonly SettingStand[], positions: ArrayLike<number>): ReportSetting['stand'] {
  if (!stands.length) return null
  const prepared = preparePolygons(stands.map((stand) => stand.geometry))
  const shares = new Map<string, number>()
  let inStand = 0,
    height = 0,
    heightCount = 0
  const n = Math.floor(positions.length / 2)
  for (let i = 0; i < n; i++) {
    const index = prepared.indexAt(positions[i * 2], positions[i * 2 + 1])
    if (index < 0) continue
    const stand = stands[index]
    const composition = stand.speciesComposition?.length
      ? stand.speciesComposition
      : stand.speciesCode
        ? [{ code: stand.speciesCode, percent: 100, heightMeters: null }]
        : []
    const total = composition.reduce((sum, entry) => sum + Math.max(0, entry.percent), 0)
    if (!(total > 0)) continue
    inStand++
    for (const entry of composition) {
      const name = speciesName(entry.code)
      if (!name || !(entry.percent > 0)) continue
      shares.set(name, (shares.get(name) ?? 0) + entry.percent / total)
    }
    if (stand.heightMeters > 0) {
      height += stand.heightMeters
      heightCount++
    }
  }
  if (!inStand) return null
  const species = [...shares]
    .map(([name, share]) => ({ name, percent: Math.round((100 * share) / inStand) }))
    .filter((entry) => entry.percent >= MINOR_SPECIES_PERCENT)
    .sort((a, b) => b.percent - a.percent)
  return {
    species,
    heightM: heightCount ? height / heightCount : null,
    coverPercent: Math.round((100 * inStand) / Math.max(1, n)),
  }
}

/** A target as the run reports it (`TargetVisibility`), reduced to what the setting reads. */
export interface SettingTarget {
  role: string
  positions: ArrayLike<number>
  elevations: ArrayLike<number>
  meanSlopePercent: number | null
  areaMeters: number
}

/** Area-weighted mean slope over targets that report one. */
function meanSlope(targets: readonly SettingTarget[]): number | null {
  let sum = 0,
    weight = 0
  for (const target of targets)
    if (target.meanSlopePercent !== null && Number.isFinite(target.meanSlopePercent) && target.areaMeters > 0) {
      sum += target.meanSlopePercent * target.areaMeters
      weight += target.areaMeters
    }
  return weight ? sum / weight : null
}

function concat(targets: readonly SettingTarget[], key: 'positions' | 'elevations'): number[] {
  const out: number[] = []
  for (const target of targets) for (let i = 0; i < target[key].length; i++) out.push(target[key][i])
  return out
}

/**
 * The report's setting from what the page holds: the proposed blocks' outlines, the run's targets (absent before a
 * run), the run's inventory stands and the basemap's place labels. Each part is null or empty when its source is.
 */
export function reportSetting(input: {
  blocks: readonly PolygonGeometry[]
  targets?: readonly SettingTarget[] | null
  stands?: readonly SettingStand[] | null
  places?: readonly PlaceLabel[] | null
}): ReportSetting {
  const centre = blocksCentre(input.blocks)
  const targets = input.targets ?? []
  const blockTargets = targets.filter((target) => target.role === 'block')
  const landforms = targets.filter((target) => target.role === 'landscape')
  const ground = blockTargets.length
    ? {
        aspect: groundAspect(concat(blockTargets, 'positions'), concat(blockTargets, 'elevations')),
        slopePercent: meanSlope(blockTargets),
      }
    : null
  return {
    places: centre && input.places?.length ? placesAround(input.places, centre) : [],
    ground: ground && (ground.aspect || ground.slopePercent !== null) ? ground : null,
    landformSlopePercent: meanSlope(landforms),
    stand:
      input.stands?.length && landforms.length ? standCharacter(input.stands, concat(landforms, 'positions')) : null,
  }
}
