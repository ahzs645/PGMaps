/**
 * The project terrain against ICESat-2's ground photons along the road: evidence beside the terrain,
 * never a correction to it. Photons come from SlideRule (`src/lib/forestry/canopy/sliderule.ts`), are put
 * on EGM2008 with the geoid (`geoid.ts`), binned 20 m along each pass and beam, and each bin's median is
 * compared with the terrain at the bin's centre (`groundCheck.ts`).
 *
 * ICESat-2's ground matched the 093G086 airborne LiDAR to −0.05 m (robust spread 0.31 m), and the bench
 * on a licensee's reference block found its regional terrain about 1 m high and its contour surface at
 * datum. A median past `ICESAT2_CHECK.offsetFlagM` says the terrain's vertical datum or source needs a
 * look; it says nothing about any one station. Keep this file free of DOM and network access.
 */
import { groundCheck, groundCheckSummary, type GroundCheckBin } from '@/lib/forestry/canopy/groundCheck'
import { isSnowFree, type GroundPhoton } from '@/lib/forestry/canopy/sliderule'

export const ICESAT2_CHECK = {
  /** Bin length along a beam, metres. */
  binM: 20,
  /** Photons a bin needs before its median counts. */
  minPoints: 3,
  /** A median difference past this is flagged, metres (a stated screen, not a standard). */
  offsetFlagM: 1,
  /** Fewer bins than this is too thin to judge. */
  minBins: 10,
  /** Margin round the road's stations for the photon request, metres. */
  marginM: 150,
  /** Distance for the slope read beside each bin, metres. */
  slopeStepM: 10,
} as const

export interface Icesat2CheckResult {
  /** ISO date the check was made. */
  checkedOn: string
  terrainName: string
  terrainDatum: string
  box: [number, number, number, number]
  photons: number
  /** Snow-free pass dates used. */
  passes: string[]
  /** Pass dates left out as snow season. */
  winterPasses: string[]
  /** Snow-free pass dates SlideRule could not read: their photons are missing, not absent. */
  unreadPasses: string[]
  /** Snow-free passes SlideRule was asked to read, unread ones included. */
  passesAsked: number
  bins: GroundCheckBin[]
  /** Bins with photons that fall off the terrain. */
  binsOffTerrain: number
  summary: ReturnType<typeof groundCheckSummary>
  seconds: number
}

const M_PER_DEG = 111_320

/** Slope in percent from the terrain, by central differences `step` metres apart. */
export function terrainSlopeAt(
  elevationAt: (lon: number, lat: number) => number,
  stepM: number = ICESAT2_CHECK.slopeStepM,
) {
  return (lon: number, lat: number) => {
    const dLat = stepM / M_PER_DEG
    const dLon = stepM / (M_PER_DEG * Math.cos((lat * Math.PI) / 180))
    const dzdx = (elevationAt(lon + dLon, lat) - elevationAt(lon - dLon, lat)) / (2 * stepM)
    const dzdy = (elevationAt(lon, lat + dLat) - elevationAt(lon, lat - dLat)) / (2 * stepM)
    return Math.hypot(dzdx, dzdy) * 100
  }
}

export function icesat2Check(input: {
  photons: readonly GroundPhoton[]
  allDates: readonly string[]
  /** Snow-free pass dates SlideRule reported it could not read. */
  unreadDates?: readonly string[]
  /** Snow-free passes SlideRule was asked to read. */
  passesAsked?: number
  geoidAt: (lon: number, lat: number) => number
  elevationAt: (lon: number, lat: number) => number
  terrainName: string
  terrainDatum: string
  box: [number, number, number, number]
  checkedOn: string
  seconds: number
}): Icesat2CheckResult {
  const points = input.photons.flatMap((p) => {
    const n = input.geoidAt(p.lon, p.lat)
    return Number.isFinite(n)
      ? [{ lon: p.lon, lat: p.lat, h: p.ellipsoidH - n, group: `${p.date} spot ${p.spot}` }]
      : []
  })
  const all = groundCheck(points, () => 0, { binM: ICESAT2_CHECK.binM, minPoints: ICESAT2_CHECK.minPoints })
  const bins = groundCheck(points, input.elevationAt, {
    binM: ICESAT2_CHECK.binM,
    minPoints: ICESAT2_CHECK.minPoints,
    slopeAt: terrainSlopeAt(input.elevationAt),
  })
  const passes = [...new Set(input.photons.map((p) => p.date))].sort()
  return {
    checkedOn: input.checkedOn,
    terrainName: input.terrainName,
    terrainDatum: input.terrainDatum,
    box: input.box,
    photons: points.length,
    passes,
    unreadPasses: [...new Set(input.unreadDates ?? [])].sort(),
    passesAsked: input.passesAsked ?? passes.length,
    winterPasses: input.allDates.filter((d) => !passes.includes(d) && !isSnowFree(d)),
    bins,
    binsOffTerrain: Math.max(0, all.length - bins.length),
    summary: groundCheckSummary(bins),
    seconds: input.seconds,
  }
}

/** ", 3 SlideRule could not read (2025-09-21, …)", or nothing. */
export function unreadNote(result: Pick<Icesat2CheckResult, 'unreadPasses'>): string {
  const n = result.unreadPasses.length
  return n ? `, ${n} SlideRule could not read (${result.unreadPasses.join(', ')})` : ''
}

/** One line for the Review row's "measured" column. */
export function icesat2Measured(result: Icesat2CheckResult): string {
  const s = result.summary.all
  if (!s)
    return `No ICESat-2 ground bins on ${result.terrainName}: ${result.passesAsked} snow-free ${result.passesAsked === 1 ? 'pass' : 'passes'} asked for${unreadNote(result)} (${result.checkedOn})`
  const sign = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)} m`
  return `Terrain − ICESat-2 ground: median ${sign(s.medianM)}, spread ${s.robustSpreadM.toFixed(2)} m over ${s.bins} bins of ${ICESAT2_CHECK.binM} m from ${result.passes.length} snow-free ${result.passes.length === 1 ? 'pass' : 'passes'}${result.unreadPasses.length ? `, ${result.unreadPasses.length} more unread by SlideRule` : ''} (${result.checkedOn}; heights on EGM2008)`
}
