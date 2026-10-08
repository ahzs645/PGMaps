import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { expect, it } from 'vitest'
import { liveGridBuilder } from './live-grid'
import { snap } from './routing'
import type { Point, TransitData } from './types'

it('marker routing and browser heat sampling agree with the independent builder across the whole city', () => {
  const data: TransitData = JSON.parse(
    gunzipSync(readFileSync('vendor/bcdatamapper/datascrapers/transit/output/prince_george_travel_time.json.gz')).toString(),
  )
  const spec = { bbox: data.meta.bbox, cols: data.grid.cols, rows: data.grid.rows }
  const grid = liveGridBuilder(data)(spec)
  const mismatches: { point: Point; reason: string; actual: unknown; expected: unknown }[] = []
  let checked = 0
  for (let row = 0; row < spec.rows; row++)
    for (let col = 0; col < spec.cols; col++) {
      const point: Point = [
        spec.bbox[0] + ((col + 0.5) * (spec.bbox[2] - spec.bbox[0])) / spec.cols,
        spec.bbox[3] - ((row + 0.5) * (spec.bbox[3] - spec.bbox[1])) / spec.rows,
      ]
      const actual = grid.cells[row * spec.cols + col]
      const expected = data.grid.cells[row * spec.cols + col]
      const marker = snap(data, point)
      let reason = ''
      if (!!actual !== !!expected || (actual && expected && (actual[0] !== expected[0] || Math.abs(actual[1] - expected[1]) > 0.051)))
        reason = 'browser grid differs from Python snapshot builder'
      if (!!actual !== !!marker || (actual && marker && (actual[0] !== marker[0] || Math.abs(actual[1] - marker[1]) > 0.000001)))
        reason = 'marker and heat access differ'
      if (reason && mismatches.length < 20) mismatches.push({ point, reason, actual, expected })
      checked++
    }
  expect(checked).toBeGreaterThan(250000)
  expect(data.meta.markerAccessMeters).toBe(data.meta.gridAccessMeters)
  expect(mismatches).toEqual([])
}, 30000)
