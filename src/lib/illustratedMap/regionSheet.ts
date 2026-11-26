/**
 * Any region's generated geography (`build-geographic-map.py`, BC or a `--region` config) drawn as
 * sheet operations with a saved hatch recipe, so the same SVG and vector PDF writers as every
 * other PGMaps sheet print it. The hatch is painted on coverage ∩ land: the region's dry land
 * clips first (even-odd, so lakes stay clear and islands are painted), then the chosen coverage.
 * The field keeps its own flow; the coastline only clips it. No DOM or network access.
 */
import type { OrganicHatchRecipe } from '@pgmaps/geo-toolkit/patterns'
import { ORGANIC_HATCH_PRESETS } from '@pgmaps/geo-toolkit/patterns'
import type { DrawOp, Point } from '@/lib/mapSheet/drawOps'
import { organicHatchOps } from '@/lib/mapSheet/symbols'

/** The parts of a generated geography file the region sheet reads. */
export interface RegionGeography {
  artboard: { width: number; height: number }
  projection: { name: string }
  /** All dry land in the frame, with lakes as holes. */
  land: { d: string }
  /** Dry land of the region itself (the province, island or park). */
  bcLand: { d: string }
  /** The chosen hatch coverage, before it meets land. */
  coastalCoverage: { d: string }
  roads: { d: string; role?: string }[]
  places: { id: string; name: string; point: [number, number] }[]
  region?: { name: string }
}

export interface RegionSheetOptions {
  recipe?: OrganicHatchRecipe
  /** `coverage` hatches the chosen coverage on the region's land; `region` all of the region's land. */
  coverage?: 'coverage' | 'region'
  /** Places to mark and name, by id; all of them when absent. */
  places?: readonly string[]
  palette?: { water: string; land: string; region: string; road: string; text: string }
  /**
   * Water kept along every shore, drawing units: the coastline drawn in the water's colour over the
   * land and hatch, so channels narrower than a pixel still read. 0 draws the coast as it is.
   */
  channelGap?: number
}

export const REGION_SHEET_PALETTE = {
  water: '#d6dfde',
  land: '#e6e7e8',
  region: '#ffffff',
  road: '#af5045',
  text: '#00392f',
} as const

/** Sub-paths of an SVG path written as `M x,y L x,y … [Z]` (or with spaces); curves are not read. */
export function pathPointLists(d: string): Point[][] {
  const rings: Point[][] = []
  let ring: Point[] = []
  const tokens = d.match(/[MLZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []
  let command = ''
  const numbers: number[] = []
  const flush = () => {
    for (let i = 0; i + 1 < numbers.length; i += 2) ring.push([numbers[i], numbers[i + 1]])
    numbers.length = 0
  }
  for (const token of tokens) {
    if (/^[MLZ]$/i.test(token)) {
      flush()
      command = token.toUpperCase()
      if (command === 'M' && ring.length) {
        rings.push(ring)
        ring = []
      }
      if (command === 'Z' && ring.length) {
        rings.push(ring)
        ring = []
      }
    } else if (command === 'M' || command === 'L') numbers.push(Number(token))
  }
  flush()
  if (ring.length) rings.push(ring)
  return rings
}

/** Rings of a polygon path: its sub-paths of three points or more. */
export const polygonPathRings = (d: string): Point[][] => pathPointLists(d).filter((ring) => ring.length >= 3)

/** The sheet of a region: water, land, the region's land, its hatch, roads and named places. */
export function regionSheetOps(
  geography: RegionGeography,
  {
    recipe = ORGANIC_HATCH_PRESETS['northern-bc-reference'].recipe,
    coverage = 'coverage',
    places,
    palette = REGION_SHEET_PALETTE,
    channelGap = 0,
  }: RegionSheetOptions = {},
): { ops: DrawOp[]; width: number; height: number } {
  const { width, height } = geography.artboard
  const land = polygonPathRings(geography.land.d)
  const regionLand = polygonPathRings(geography.bcLand.d)
  const ops: DrawOp[] = [
    { op: 'rect', x: 0, y: 0, w: width, h: height, fill: palette.water },
    { op: 'path', parts: land, closed: true, fill: palette.land },
    { op: 'path', parts: regionLand, closed: true, fill: palette.region },
    { op: 'clip', parts: regionLand },
  ]
  if (coverage === 'coverage') ops.push({ op: 'clip', parts: polygonPathRings(geography.coastalCoverage.d) })
  const { seed, spacing, bandHeight, strokeWidth, curvature, color, opacity } = recipe
  ops.push(
    ...organicHatchOps(
      { x: 0, y: 0, w: width, h: height },
      { seed, spacing, bandHeight, strokeWidth, curvature, color, ...(opacity < 1 ? { opacity } : {}) },
      recipe.scale,
    ),
  )
  if (coverage === 'coverage') ops.push({ op: 'restore' })
  ops.push({ op: 'restore' })
  if (channelGap > 0) {
    // Inside the frame less the gap, so land running off the sheet gets no water line.
    ops.push({
      op: 'clip',
      parts: [
        [
          [channelGap, channelGap],
          [width - channelGap, channelGap],
          [width - channelGap, height - channelGap],
          [channelGap, height - channelGap],
        ],
      ],
    })
    ops.push({
      op: 'path',
      parts: land,
      closed: true,
      stroke: { color: palette.water, width: channelGap, join: 'round' },
    })
    ops.push({ op: 'restore' })
  }
  for (const road of geography.roads) {
    const parts = pathPointLists(road.d).filter((part) => part.length > 1)
    ops.push({
      op: 'path',
      parts,
      closed: false,
      stroke: { color: palette.road, width: road.role === 'secondary' ? 1.6 : 2.4, cap: 'round', join: 'round' },
    })
  }
  for (const place of geography.places) {
    if (places && !places.includes(place.id)) continue
    const [x, y] = place.point
    ops.push({ op: 'circle', x, y, r: 3.3, fill: palette.text, stroke: { color: '#ffffff', width: 1.5 } })
    ops.push({
      op: 'text',
      x: x + 7,
      y: y - 5,
      text: place.name,
      size: 11,
      style: 'bold',
      color: palette.text,
      halo: { color: '#ffffff', width: 2.5 },
    })
  }
  return { ops, width, height }
}
