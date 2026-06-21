import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..')
const WORKER_PATH = path.join(PROJECT_ROOT, 'src/maps/pgdata/walkabilityLiveHeatmap.worker.js')
const EXISTING_GRID_PATH = path.join(PROJECT_ROOT, 'public/data/walkability/heatmap/citywide_mi_grid.json')
const OUTPUT_PATH = path.join(PROJECT_ROOT, 'public/data/walkability/heatmap/factor_masks.json')
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public')
const CONFIG_KEYS = [
  'drop_gtfs_hf',
  'narrow_civic',
  'narrow_growth',
  'drop_pop_age',
  'drop_f0',
  'drop_c0',
  'drop_f8',
  'drop_supp_poi',
]

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

function maskToBase64(mask) {
  return Buffer.from(mask).toString('base64')
}

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

function localPublicPath(url) {
  const pathname = new URL(url, 'http://localhost').pathname
  const filePath = path.resolve(PUBLIC_DIR, pathname.replace(/^\/+/, ''))
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) throw new Error(`Refusing to read outside public/: ${url}`)
  return filePath
}

async function localFetch(url) {
  const filePath = localPublicPath(url)
  try {
    const body = await readFile(filePath, 'utf8')
    return {
      ok: true,
      status: 200,
      async json() {
        return JSON.parse(body)
      },
    }
  } catch (error) {
    return {
      ok: false,
      status: error?.code === 'ENOENT' ? 404 : 500,
      async json() {
        throw error
      },
    }
  }
}

async function loadWorkerApi() {
  const workerSource = await readFile(WORKER_PATH, 'utf8')
  let lastProgress = ''
  const context = {
    console,
    fetch: localFetch,
    postMessage(message) {
      if (message?.type !== 'progress' || message.progress === lastProgress) return
      lastProgress = message.progress
      console.log(message.progress)
    },
    self: {},
    setTimeout,
    clearTimeout,
    atob(base64) {
      return Buffer.from(base64, 'base64').toString('binary')
    },
  }
  vm.createContext(context)
  vm.runInContext(
    `${workerSource}
globalThis.__walkabilityMaskApi = {
  FACTORS,
  CELL_M,
  NODATA,
  applyVariant,
  activeSourceFeatures,
  assignPopDensityQuintiles,
  componentMaskKey,
  fetchJson,
  factorMask,
  loadInputs,
  readArcgisProjectedBounds,
  readLayer,
}`,
    context,
    { filename: WORKER_PATH },
  )
  return { api: context.__walkabilityMaskApi }
}

async function loadInputsForPrebuild(api) {
  console.log('Fetching source layers')
  const layerKeys = [...new Set(api.FACTORS.map((factor) => factor.layerKey))]
  const layerFeatures = {}
  for (let index = 0; index < layerKeys.length; index += 1) {
    const key = layerKeys[index]
    console.log(`Loading ${index + 1}/${layerKeys.length}: ${key}`)
    layerFeatures[key] = await api.readLayer(key)
  }
  if (layerFeatures.census_blocks_2021) api.assignPopDensityQuintiles(layerFeatures.census_blocks_2021)

  console.log('Reading city boundary metadata from existing grid')
  const existingGrid = JSON.parse(await readFile(EXISTING_GRID_PATH, 'utf8'))
  const boundaryRaw = await api.fetchJson('/data/walkability/source/data/public_gis/community_boundary.json')
  const { minX, maxY } = api.readArcgisProjectedBounds(boundaryRaw)
  return {
    layerFeatures,
    rows: existingGrid.rows,
    cols: existingGrid.cols,
    bounds: { minX, maxY },
    inside: decodeInsideMaskFromExistingGrid(existingGrid),
    imageCoordinates: existingGrid.imageCoordinates,
  }
}

function configForMask(mask) {
  return Object.fromEntries(CONFIG_KEYS.map((key, index) => [key, Boolean(mask & (1 << index))]))
}

function collectRequiredMaskSpecs(api) {
  const specsByKey = new Map()
  for (let mask = 0; mask < 1 << CONFIG_KEYS.length; mask += 1) {
    const config = configForMask(mask)
    const factors = api.applyVariant(api.FACTORS, config)
    for (const factor of factors) {
      if (factor.mode === 'proximity') {
        for (const [distance, score] of factor.scores) {
          if (!score) continue
          specsByKey.set(api.componentMaskKey(factor, distance), { factor, distanceM: distance })
        }
      } else {
        specsByKey.set(api.componentMaskKey(factor, 20), { factor, distanceM: 20 })
        specsByKey.set(api.componentMaskKey(factor, 10), { factor, distanceM: 10 })
      }
    }
  }
  return [...specsByKey.entries()].sort(([left], [right]) => left.localeCompare(right))
}

async function main() {
  const startedAt = performance.now()
  const { api } = await loadWorkerApi()
  console.log('Loading walkability source layers')
  const inputs = await loadInputsForPrebuild(api)
  const specs = collectRequiredMaskSpecs(api)
  const masks = {}

  console.log(`Building ${specs.length} factor masks on ${inputs.rows} x ${inputs.cols} grid`)
  for (let index = 0; index < specs.length; index += 1) {
    const [key, { factor, distanceM }] = specs[index]
    const maskStartedAt = performance.now()
    console.log(`Building ${index + 1}/${specs.length}: ${factor.ref} ${factor.description} (${distanceM}m)`)
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
    console.log(`Built ${index + 1}/${specs.length} in ${((performance.now() - maskStartedAt) / 1000).toFixed(1)}s`)
  }

  const inside = bitPack(inputs.inside)
  const output = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'src/maps/pgdata/walkabilityLiveHeatmap.worker.js',
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

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true })
  await writeFile(OUTPUT_PATH, `${JSON.stringify(output)}\n`)
  const seconds = ((performance.now() - startedAt) / 1000).toFixed(1)
  console.log(`Wrote ${path.relative(PROJECT_ROOT, OUTPUT_PATH)} in ${seconds}s`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
