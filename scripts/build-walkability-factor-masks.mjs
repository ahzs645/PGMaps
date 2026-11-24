// Prebuild every walkability factor mask the live heatmap can ask for, with the
// worker's own rasterization (docs/walkability-factor-masks.md).
//
// Writes bcdatamapper's datascrapers/walkability/output/heatmap/factor_masks.json,
// beside the grid it is built on, and the same file into public/data. Reads the
// synced source layers in public/data, so run `npm run data:sync-from-bcdatamapper`
// first. The file records the SHA-256 of every file it read and no time, so a
// rebuild from the same inputs writes the same bytes.
//
// Usage: npm run walkability:build-factor-masks
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  EXISTING_GRID_URL,
  MASKS_PUBLIC_PATH,
  MASKS_SOURCE_PATH,
  PROJECT_ROOT,
  collectRequiredMaskSpecs,
  loadWorkerApi,
  publicFilePath,
  recordingPublicFetch,
  sha256,
} from './lib/walkability-factor-masks.mjs'

const BOUNDARY_URL = '/data/walkability/source/data/public_gis/community_boundary.json'

function bitPack(mask) {
  const packed = new Uint8Array(Math.ceil(mask.length / 8))
  let activeCells = 0
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue
    packed[index >> 3] |= 1 << (index & 7)
    activeCells += 1
  }
  return { packed, activeCells }
}

const maskToBase64 = (mask) => Buffer.from(mask).toString('base64')

function decodeInsideMaskFromExistingGrid(grid) {
  const cellCount = grid.rows * grid.cols
  const inside = new Uint8Array(cellCount)
  const defaultGrid = grid.grids?.[grid.defaultVariant] ?? grid.grids?.full
  if (!Array.isArray(defaultGrid)) throw new Error('Unable to read existing walkability grid RLE')
  let offset = 0
  for (const [value, count] of defaultGrid) {
    if (value !== grid.noData) inside.fill(1, offset, offset + count)
    offset += count
  }
  if (offset !== cellCount) throw new Error(`Existing walkability grid has ${offset} cells; expected ${cellCount}`)
  return inside
}

async function loadInputsForPrebuild(api, reads) {
  const layerKeys = [...new Set(api.FACTORS.map((factor) => factor.layerKey))]
  const layerFeatures = {}
  for (let index = 0; index < layerKeys.length; index += 1) {
    const key = layerKeys[index]
    console.log(`Loading ${index + 1}/${layerKeys.length}: ${key}`)
    layerFeatures[key] = await api.readLayer(key)
  }
  if (layerFeatures.census_blocks_2021) api.assignPopDensityQuintiles(layerFeatures.census_blocks_2021)

  console.log('Reading city boundary metadata from existing grid')
  const gridBytes = await readFile(publicFilePath(EXISTING_GRID_URL))
  reads.set(EXISTING_GRID_URL, sha256(gridBytes))
  const existingGrid = JSON.parse(gridBytes.toString('utf8'))
  const { minX, maxY } = api.readArcgisProjectedBounds(await api.fetchJson(BOUNDARY_URL))
  return {
    layerFeatures,
    rows: existingGrid.rows,
    cols: existingGrid.cols,
    bounds: { minX, maxY },
    inside: decodeInsideMaskFromExistingGrid(existingGrid),
    imageCoordinates: existingGrid.imageCoordinates,
  }
}

async function main() {
  const startedAt = performance.now()
  const { fetch, reads } = recordingPublicFetch()
  const api = await loadWorkerApi({ fetch, log: (message) => console.log(message) })
  console.log('Loading walkability source layers')
  const inputs = await loadInputsForPrebuild(api, reads)
  const specs = collectRequiredMaskSpecs(api)
  const masks = {}

  console.log(`Building ${specs.length} factor masks on ${inputs.rows} x ${inputs.cols} grid`)
  for (let index = 0; index < specs.length; index += 1) {
    const [key, { factor, distanceM }] = specs[index]
    const features = api.activeSourceFeatures(inputs.layerFeatures, factor)
    const mask = features.length
      ? api.factorMask(inputs, factor, features, distanceM)
      : new Uint8Array(inputs.rows * inputs.cols)
    const { packed, activeCells } = bitPack(mask)
    masks[key] = {
      ref: factor.ref,
      description: factor.description,
      layerKey: factor.layerKey,
      mode: factor.mode,
      field: factor.field,
      values: factor.values,
      where: factor.where,
      distanceM,
      activeCells,
      data: maskToBase64(packed),
    }
  }

  const inside = bitPack(inputs.inside)
  const output = {
    version: 1,
    source: 'src/maps/pgdata/walkabilityLiveHeatmap.worker.js',
    builtBy: 'scripts/build-walkability-factor-masks.mjs',
    // Every file the masks were built from, by the URL the worker reads it at.
    // walkabilityFactorMasks.test.mjs fails when one of them changes.
    inputs: Object.fromEntries([...reads.entries()].sort(([left], [right]) => left.localeCompare(right))),
    encoding: 'bitpack-base64',
    cellSizeM: api.CELL_M,
    rows: inputs.rows,
    cols: inputs.cols,
    noData: api.NODATA,
    imageCoordinates: inputs.imageCoordinates,
    maskCount: specs.length,
    insideMask: {
      activeCells: inside.activeCells,
      data: maskToBase64(inside.packed),
    },
    masks,
  }

  const text = `${JSON.stringify(output)}\n`
  for (const target of [MASKS_SOURCE_PATH, MASKS_PUBLIC_PATH]) {
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, text)
    console.log(`Wrote ${path.relative(PROJECT_ROOT, target)}`)
  }
  console.log(
    `${specs.length} masks from ${reads.size} files in ${((performance.now() - startedAt) / 1000).toFixed(1)}s`,
  )
  console.log('Commit the bcdatamapper copy there, then move the submodule pointer.')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
