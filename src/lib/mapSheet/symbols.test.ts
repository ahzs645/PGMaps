import { describe, expect, it } from 'vitest'
import { hatchLines, markersAlongLine, MAX_LINE_MARKERS, offsetPolyline, type DrawOp, type Point } from './drawOps'
import {
  areaSymbolOps,
  iconOps,
  lineSymbolOps,
  markerFillPositions,
  swatchOps,
  type AreaSymbol,
  type LineSymbol,
} from './symbols'

const square: Point[] = [
  [0, 0],
  [100, 0],
  [100, 100],
  [0, 100],
]
const paths = (ops: DrawOp[]) => ops.flatMap((op) => (op.op === 'path' ? [op] : []))
/** Angle of a two-point line on paper, counter-clockwise from east, folded into 0–180. */
const angleOf = ([[ax, ay], [bx, by]]: Point[]) =>
  ((((Math.atan2(-(by - ay), bx - ax) * 180) / Math.PI) % 180) + 180) % 180
/** Offset of a line's first point along the normal of `angle`. */
const offsetAlong = (line: Point[], angle: number) => {
  const a = (angle * Math.PI) / 180
  return line[0][0] * Math.sin(a) + line[0][1] * Math.cos(a)
}

describe('hatch geometry', () => {
  it('covers a polygon with evenly spaced lines at the asked angle, clipped to it', () => {
    const symbol: AreaSymbol = {
      kind: 'area',
      label: 'Reserve',
      hatches: [{ angleDeg: 45, spacing: 5, stroke: { color: '#38a800', width: 0.5 } }],
      outline: [{ color: '#38a800', width: 1.2 }],
    }
    const ops = areaSymbolOps([square], symbol, 1)
    expect(ops.map((op) => op.op)).toEqual(['clip', 'path', 'restore', 'path'])
    expect(ops[0]).toMatchObject({ op: 'clip', parts: [square] })
    const hatch = paths(ops)[0]
    expect(hatch.stroke).toMatchObject({ color: '#38a800', width: 0.5 })
    // The box's diagonal across the lines is 100√2 points: 28 or 29 lines 5 points apart.
    expect(hatch.parts.length).toBeGreaterThanOrEqual(28)
    expect(hatch.parts.length).toBeLessThanOrEqual(30)
    for (const line of hatch.parts) expect(angleOf(line)).toBeCloseTo(45, 6)
    const offsets = hatch.parts.map((line) => offsetAlong(line, 45)).sort((a, b) => a - b)
    for (let i = 1; i < offsets.length; i++) expect(offsets[i] - offsets[i - 1]).toBeCloseTo(5, 6)
    // The outline comes last, over the hatch.
    expect(paths(ops)[1]).toMatchObject({ closed: true, stroke: { color: '#38a800', width: 1.2 } })
  })

  it('scales spacing and widths with the paper', () => {
    const lines = hatchLines({ x: 0, y: 0, w: 100, h: 100 }, 90, 5 * 0.5)
    const xs = lines.map((line) => line[0][0]).sort((a, b) => a - b)
    expect(xs[1] - xs[0]).toBeCloseTo(2.5)
  })

  it('draws cross, grid, double and striped hatches as separate families', () => {
    const family = (hatches: AreaSymbol['hatches']) =>
      paths(areaSymbolOps([square], { kind: 'area', label: 'x', hatches, outline: [] }, 1))
    const cross = family([
      { angleDeg: 45, spacing: 8, stroke: { color: '#e60000', width: 0.7 } },
      { angleDeg: 135, spacing: 8, stroke: { color: '#a900e6', width: 0.8 } },
    ])
    expect(cross.map((path) => path.stroke!.color)).toEqual(['#e60000', '#a900e6'])
    expect(angleOf(cross[0].parts[0])).toBeCloseTo(45)
    expect(angleOf(cross[1].parts[0])).toBeCloseTo(135)
    const grid = family([
      { angleDeg: 90, spacing: 5, stroke: { color: '#0070ff', width: 0.5 } },
      { angleDeg: 0, spacing: 5, stroke: { color: '#cdaa66', width: 0.5 } },
    ])
    expect(angleOf(grid[0].parts[0])).toBeCloseTo(90)
    expect(angleOf(grid[1].parts[0])).toBeCloseTo(0)
    // Double hatch: the same lines twice, wide and pale under thin and dark.
    const double = family([
      { angleDeg: 45, spacing: 5, stroke: { color: '#97dbf2', width: 1.6 } },
      { angleDeg: 45, spacing: 5, stroke: { color: '#4065eb', width: 0.4 } },
    ])
    expect(double[0].parts).toEqual(double[1].parts)
    expect(double.map((path) => path.stroke!.width)).toEqual([1.6, 0.4])
    // Stripes: the second colour sits half way between the first's lines.
    const stripes = family([
      { angleDeg: 45, spacing: 6, stroke: { color: '#ff7f7f', width: 1.2 } },
      { angleDeg: 45, spacing: 6, stroke: { color: '#9c9c9c', width: 1.2 }, phase: 3 },
    ])
    const first = stripes[0].parts.map((line) => offsetAlong(line, 45))
    const second = stripes[1].parts.map((line) => offsetAlong(line, 45))
    for (const offset of second) {
      const nearest = Math.min(...first.map((value) => Math.abs(value - offset)))
      expect(nearest).toBeCloseTo(3, 6)
    }
  })

  it('places a marker fill on a grid anchored to the page, staggered on odd rows', () => {
    const fill = { icon: 'marsh' as const, size: 8, color: '#005ce6', spacingX: 14, spacingY: 10, stagger: true }
    const positions = markerFillPositions({ x: 0, y: 0, w: 100, h: 50 }, fill, 1)
    const rows = new Map<number, number[]>()
    for (const [x, y] of positions) rows.set(y, [...(rows.get(y) ?? []), x])
    const [even, odd] = [rows.get(0)!, rows.get(10)!]
    expect(even).toContain(0)
    expect(odd).toContain(7)
    expect(even[1] - even[0]).toBeCloseTo(14)
    const ops = areaSymbolOps([square], { kind: 'area', label: 'Wetland', markerFill: fill, outline: [] }, 1)
    expect(ops[0].op).toBe('clip')
    expect(ops.at(-1)!.op).toBe('restore')
    expect(paths(ops).every((path) => path.stroke?.color === '#005ce6')).toBe(true)
  })

  it('keeps an inside casing within the area', () => {
    const ops = areaSymbolOps(
      [square],
      { kind: 'area', label: 'Alpine', fill: '#ffff00', outline: [{ color: '#ffffff', width: 3, inside: true }] },
      1,
    )
    expect(ops.map((op) => op.op)).toEqual(['path', 'clip', 'path', 'restore'])
    expect(paths(ops)[1].stroke!.width).toBe(6)
  })
})

describe('lines and markers', () => {
  const line: Point[] = [
    [0, 0],
    [100, 0],
    [100, 50],
  ]

  it('places markers every spacing along the line, starting half a spacing in, none past the end', () => {
    const markers = markersAlongLine(line, 20)
    expect(markers.map((m) => [m.x, m.y])).toEqual([
      [10, 0],
      [30, 0],
      [50, 0],
      [70, 0],
      [90, 0],
      [100, 10],
      [100, 30],
      [100, 50],
    ])
    // East along the first leg, then down the page (−90° counter-clockwise) on the second.
    expect(markers[0].angle).toBeCloseTo(0)
    expect(markers.at(-1)!.angle).toBeCloseTo(-90)
    expect(markersAlongLine(line, 20, 0)[0]).toMatchObject({ x: 0, y: 0 })
    expect(markersAlongLine(line, 400)).toEqual([])
    expect(markersAlongLine([[0, 0]], 5)).toEqual([])
  })

  it('caps the marker count on a very long line', () => {
    const long: Point[] = [
      [0, 0],
      [1e6, 0],
    ]
    expect(markersAlongLine(long, 1).length).toBeLessThanOrEqual(MAX_LINE_MARKERS + 1)
  })

  it('offsets to the right of travel, as MapLibre does', () => {
    const east: Point[] = [
      [0, 0],
      [10, 0],
    ]
    // Right of travelling east, on paper with y down, is +y.
    expect(offsetPolyline(east, 1.5)).toEqual([
      [0, 1.5],
      [10, 1.5],
    ])
    const corner = offsetPolyline(line, 2)
    expect(corner[1][0]).toBeCloseTo(98)
    expect(corner[1][1]).toBeCloseTo(2)
  })

  it('stacks strokes at their offsets, then puts markers on top', () => {
    const permit: LineSymbol = {
      kind: 'line',
      label: 'Road permit',
      layers: [
        { color: '#e60000', width: 0.8, offset: -1.5 },
        { color: '#e60000', width: 0.8, offset: 1.5 },
      ],
      markers: [{ icon: 'tick', spacing: 9, size: 4, color: '#000000' }],
    }
    const ops = paths(lineSymbolOps([line], permit, 2))
    expect(ops[0].parts[0][0]).toEqual([0, -3])
    expect(ops[1].parts[0][0]).toEqual([0, 3])
    expect(ops[0].stroke!.width).toBeCloseTo(1.6)
    // Ticks every 18 points at twice size: 150 points of line holds 8.
    const ticks = ops.slice(2)
    expect(ticks).toHaveLength(8)
    const [[ax, ay], [bx, by]] = ticks[0].parts[0]
    // A tick crosses the line: perpendicular to travel, 8 points long.
    expect(ax).toBeCloseTo(bx)
    expect(Math.abs(by - ay)).toBeCloseTo(8)
  })

  it('turns an icon with the line and draws its halo first', () => {
    const ops = iconOps('tick', 0, 0, 10, 90, { primary: '#000000' }, { color: '#ffffff', width: 1 })
    expect(paths(ops).map((op) => op.stroke!.color)).toEqual(['#ffffff', '#000000'])
    const [[ax, ay], [bx, by]] = paths(ops)[1].parts[0]
    // Turned a quarter: the tick now lies along x.
    expect(ay).toBeCloseTo(by)
    expect(Math.abs(bx - ax)).toBeCloseTo(10)
    expect(paths(ops)[0].stroke!.width).toBeGreaterThan(paths(ops)[1].stroke!.width)
  })

  it('shows at least one marker in a legend swatch shorter than a spacing', () => {
    const deactivation: LineSymbol = {
      kind: 'line',
      label: 'Deactivation',
      layers: [],
      markers: [{ icon: 'cross', spacing: 24, size: 7, color: '#000000' }],
    }
    const ops = paths(swatchOps(deactivation, { x: 0, y: 0, w: 17.4, h: 8.7 }, 1))
    expect(ops).toHaveLength(2)
    expect(ops[0].parts[0][0][0]).toBeGreaterThan(4)
  })
})
