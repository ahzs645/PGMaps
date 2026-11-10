/**
 * Local validation on a real road, skipped unless ROAD_FIND_SAMPLE_DIR names a folder holding:
 *
 * - `dtm.hdr`: one line, `rows cols x0 y0 cellM`, with (x0, y0) the top-left corner;
 * - `dtm.bin`: rows × cols little-endian float32 elevations, rows running south, NaN for no data;
 * - `original.csv`: the mapped line, a header row then `x,y` rows in the DTM's metres;
 * - `corrected.csv`: a reference line for the same road, same format.
 *
 * No such data is committed: third-party samples stay on the machine that runs this. The figures
 * printed are agreement with the reference line, which is itself an estimate, not a survey.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cumulativeLength, nearestOnLine, resampleLine, spreadOf, type XY } from './roadGrid'
import { findRoadOnTerrain } from './roadRelocation'
import { measureRoadSlices } from './roadSlices'
import type { SurfaceGrid } from './surfaceGrid'

const dir = process.env.ROAD_FIND_SAMPLE_DIR

function readSample(folder: string) {
  const [rows, cols, x0, y0, cellM] = readFileSync(join(folder, 'dtm.hdr'), 'utf8').trim().split(/\s+/).map(Number)
  const bytes = readFileSync(join(folder, 'dtm.bin'))
  const floats = new Float32Array(bytes.buffer, bytes.byteOffset, rows * cols)
  const dtm: SurfaceGrid = {
    origin: [x0 + cellM / 2, y0 - cellM / 2],
    cellM,
    width: cols,
    height: rows,
    values: Float64Array.from(floats, (v) => (Number.isFinite(v) ? v : NaN)),
  }
  const line = (name: string) =>
    readFileSync(join(folder, name), 'utf8')
      .trim()
      .split(/\r?\n/)
      .slice(1)
      .map((row) => row.split(',').map(Number) as XY)
  return { dtm, original: line('original.csv'), corrected: line('corrected.csv') }
}

const offsets = (from: XY[], to: XY[]) => {
  const cum = cumulativeLength(to)
  return spreadOf(resampleLine(from, 5).map((p) => nearestOnLine(to, cum, p).distance))
}

describe.skipIf(!dir)('road finding on a local sample road', () => {
  it('moves the mapped line onto the reference road', () => {
    const { dtm, original, corrected } = readSample(dir!)
    const report: string[] = []
    for (const [name, shift] of [
      ['as mapped', [0, 0]],
      ['+15 m east', [15, 0]],
      ['+25 m east', [25, 0]],
    ] as const) {
      const line = original.map(([x, y]) => [x + shift[0], y + shift[1]] as XY)
      const result = findRoadOnTerrain({ line, ground: dtm, terrainCellM: dtm.cellM })
      const before = offsets(corrected, line)!,
        after = offsets(corrected, result.candidate)!
      report.push(
        `${name}: ${result.status}, found ${(result.foundShare * 100).toFixed(0)}%, ` +
          `mapped→reference P50/P90/max ${before.p50.toFixed(2)}/${before.p90.toFixed(2)}/${before.max.toFixed(2)} m, ` +
          `candidate→reference ${after.p50.toFixed(2)}/${after.p90.toFixed(2)}/${after.max.toFixed(2)} m, ` +
          `bench width ${result.slices?.widthM?.p50.toFixed(1) ?? '—'} m, both shoulders ${((result.slices?.bothShoulderShare ?? 0) * 100).toFixed(0)}%, ` +
          `likeness ${result.likenessAlong?.mean.toFixed(2)}`,
      )
      expect(after.p50).toBeLessThan(before.p50)
    }
    const onReference = measureRoadSlices(dtm, corrected)
    report.push(
      `slices on the reference line: width P10/P50/P90 ${onReference.widthM?.p10.toFixed(1)}/${onReference.widthM?.p50.toFixed(1)}/${onReference.widthM?.p90.toFixed(1)} m, ` +
        `bench ${(onReference.benchShare * 100).toFixed(0)}%, both shoulders ${(onReference.bothShoulderShare * 100).toFixed(0)}%`,
    )
    const moved = findRoadOnTerrain({
      line: original.map(([x, y]) => [x - 150, y] as XY),
      ground: dtm,
      terrainCellM: dtm.cellM,
    })
    report.push(
      `line moved 150 m west (no road): ${moved.status}, found ${(moved.foundShare * 100).toFixed(0)}%, likeness ${moved.likenessAlong?.mean.toFixed(2)}`,
    )
    process.stdout.write(`\n${report.join('\n')}\n`)
  }, 120_000)
})
