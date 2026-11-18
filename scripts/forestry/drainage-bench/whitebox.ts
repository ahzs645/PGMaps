/**
 * WhiteboxTools in Node through `whitebox-wasm` (the raster codec) and `whitebox-wasm/tools` (all
 * WhiteboxTools tools over WASI). Grids cross as GeoTIFF bytes; nothing touches the disk.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { SurfaceGrid } from '../../../src/pages/dev-forestry-roads/surfaceGrid'

const root = path.dirname(createRequire(import.meta.url).resolve('whitebox-wasm'))
type Codec = typeof import('whitebox-wasm')
type Tools = typeof import('whitebox-wasm/tools')
let ready: Promise<Codec & Pick<Tools, 'runTool'>> | null = null

export function initWhitebox() {
  ready ??= (async () => {
    const codec = await import('whitebox-wasm')
    await codec.default({ module_or_path: await readFile(path.join(root, 'whitebox_wasm_bg.wasm')) })
    const tools = await import('whitebox-wasm/tools')
    await tools.initTools(await readFile(path.join(root, 'whitebox-cli.wasm')))
    return { ...codec, runTool: tools.runTool }
  })()
  return ready
}

export const NODATA = -32767

/** A dense SurfaceGrid (NaN missing) as a GeoTIFF in `epsg`. */
export async function gridToTiff(grid: SurfaceGrid, epsg: number): Promise<Uint8Array> {
  assert(!grid.tiles, 'Whitebox reads dense grids only.')
  const wb = await initWhitebox()
  const builder = new wb.CogBuilder(grid.width, grid.height, 1)
  builder.set_epsg(epsg)
  builder.set_origin(grid.origin[0] - grid.cellM / 2, grid.origin[1] + grid.cellM / 2, grid.cellM)
  builder.set_nodata(NODATA)
  builder.set_compression('deflate')
  const values = new Float64Array(grid.values.length)
  for (let i = 0; i < values.length; i++) values[i] = Number.isFinite(grid.values[i]) ? grid.values[i] : NODATA
  return builder.write_f64(values)
}

/** Band 0 of a GeoTIFF with its frame; the nodata value (and anything below −1e30) becomes NaN. */
export async function tiffToGrid(bytes: Uint8Array): Promise<SurfaceGrid & { epsg: number }> {
  const wb = await initWhitebox()
  const reader = new wb.GeoTiffReader(bytes)
  const [x0, px, , y0, , py] = Array.from(reader.geo_transform() as Float64Array)
  assert(Math.abs(px + py) < 1e-9 * Math.abs(px), 'Square cells with rows running south are expected.')
  const values = reader.read_band_f64(0) as Float64Array,
    nodata = reader.nodata as number | undefined
  for (let i = 0; i < values.length; i++)
    if (values[i] === nodata || !(values[i] > -1e30) || !Number.isFinite(values[i])) values[i] = NaN
  return {
    origin: [x0 + px / 2, y0 + py / 2],
    cellM: px,
    width: reader.width,
    height: reader.height,
    values,
    epsg: reader.epsg as number,
  }
}

/** Run one tool on `input` files placed in /work; returns the output files and the tool's log. */
export async function tool(name: string, args: string[], input: Record<string, Uint8Array>) {
  const wb = await initWhitebox()
  const started = performance.now()
  const result = await wb.runTool(name, { args, input })
  const seconds = (performance.now() - started) / 1000
  if (result.exitCode !== 0) throw Error(`${name} failed (${result.exitCode}): ${result.stdout.slice(-8).join('\n')}`)
  return { files: result.files, log: result.stdout, seconds }
}
