/* global self, postMessage, fetch, setTimeout, console, atob */

const SOURCE_ROOT = '/data/walkability/source'
const GIS_DIR = `${SOURCE_ROOT}/data/public_gis`
const SUPP_DIR = `${SOURCE_ROOT}/data/supplemental`
const PREBUILT_FACTOR_MASKS_URL = '/data/walkability/heatmap/factor_masks.json'
const CELL_M = 30
const NODATA = 0
const PROX = [
  [400, 1],
  [250, 2],
  [100, 2],
]

const LAYERS = {
  parks: { source: 'arcgis', file: `${GIS_DIR}/parks.json` },
  playing_area: { source: 'arcgis', file: `${GIS_DIR}/playing_area.json` },
  playground: { source: 'arcgis', file: `${GIS_DIR}/playground.json` },
  schools: { source: 'arcgis', file: `${GIS_DIR}/schools.json` },
  community_facility_ocp: { source: 'arcgis', file: `${GIS_DIR}/community_facility_ocp.json` },
  future_landuse_ocp: { source: 'arcgis', file: `${GIS_DIR}/future_landuse_ocp.json` },
  intensive_residential_ocp: { source: 'arcgis', file: `${GIS_DIR}/intensive_residential_ocp.json` },
  zoning_class: { source: 'arcgis', file: `${GIS_DIR}/zoning_class.json` },
  traffic_signals: { source: 'arcgis', file: `${GIS_DIR}/traffic_signals.json` },
  transit_routes: { source: 'arcgis', file: `${GIS_DIR}/transit_routes.json` },
  cycle_network: { source: 'arcgis', file: `${GIS_DIR}/cycle_network.json` },
  roads: { source: 'arcgis', file: `${GIS_DIR}/roads.json` },
  census_blocks_2021: { source: 'arcgis', file: `${GIS_DIR}/census_blocks_2021.json` },
  civic_facility_buildings: { source: 'arcgis', file: `${GIS_DIR}/civic_facility_buildings.json` },
  growth_management: { source: 'arcgis', file: `${GIS_DIR}/growth_management.json` },
  poi_supplement: { source: 'geojson', file: `${SOURCE_ROOT}/mobility_reconstruction/missing_poi_supplement.geojson` },
  osm_crossings: { source: 'geojson', file: `${SUPP_DIR}/osm_crossings.geojson` },
  report_crosswalks: { source: 'geojson', file: `${SUPP_DIR}/report_class3_crosswalks_geocoded.geojson` },
  bc_childcare: { source: 'geojson', file: `${SUPP_DIR}/bc_childcare_locations.geojson` },
  intercity_bus: { source: 'geojson', file: `${SUPP_DIR}/intercity_bus_stops.geojson` },
  gtfs_stops: { source: 'geojson', file: `${SUPP_DIR}/bc_transit_pg_stops.geojson` },
  census_da_age: { source: 'geojson', file: `${SUPP_DIR}/census_da_age.geojson` },
}

const f = (ref, description, layerKey, mode, field = '', values = [], scores = [], score = 0, where = '') => ({
  ref,
  description,
  layerKey,
  mode,
  field,
  values,
  scores,
  score,
  where,
})

const FACTORS = [
  f('A2', 'Park - Park Site', 'parks', 'proximity', '', [], PROX, 0, "LifeCycleStatus = 'Active'"),
  f('A3', 'Park - Activity Area', 'playing_area', 'proximity', '', [], PROX, 0, "LifeCycleStatus = 'Active'"),
  f('A4', 'Park - Playground Area', 'playground', 'proximity', '', [], PROX, 0, "LifeCycleStatus = 'Active'"),
  f(
    'B0',
    'Community Centre or Club - OCP',
    'community_facility_ocp',
    'proximity',
    'FacilityClass',
    ['1', 'Community Centre or Club'],
    PROX,
  ),
  f(
    'B1',
    'Community Facility - Future Land Use',
    'future_landuse_ocp',
    'proximity',
    'FutureLanduse',
    ['Community Facility'],
    PROX,
  ),
  f(
    'B2',
    'Religious Space - OCP',
    'community_facility_ocp',
    'proximity',
    'FacilityClass',
    ['6', 'Religious Assembly'],
    PROX,
  ),
  f('B3', 'Schools - Elementary', 'schools', 'proximity', 'SchoolType', ['1', 'Elementary'], PROX),
  f('B3', 'Schools - Secondary', 'schools', 'proximity', 'SchoolType', ['3', 'Secondary'], PROX),
  f('B3', 'Schools - Post Secondary', 'schools', 'proximity', 'SchoolType', ['4', '5', 'Post Secondary'], PROX),
  f('C2', 'Health Centre - OCP', 'community_facility_ocp', 'proximity', 'FacilityClass', ['5', 'Health'], PROX),
  f('C3', 'Land Use - Commercial', 'zoning_class', 'area_association', 'USECODE', ['11', 'Commercial'], [], 5),
  f(
    'C4',
    'Land Use - Recreation Institutional',
    'zoning_class',
    'area_association',
    'USECODE',
    ['13', 'Recreation_Institutional', 'Recreation Institutional'],
    [],
    5,
  ),
  f(
    'C5',
    'Land Use - Business Industrial',
    'zoning_class',
    'area_association',
    'USECODE',
    ['12', 'Business Industrial'],
    [],
    3,
  ),
  f('C6', 'Land Use - Residential', 'zoning_class', 'area_association', 'USECODE', ['10', 'Residential'], [], 2),
  f('D0', 'Commercial - Downtown', 'future_landuse_ocp', 'proximity', 'FutureLanduse', ['Downtown'], PROX),
  f('D1', 'Commercial - Service', 'future_landuse_ocp', 'proximity', 'FutureLanduse', ['Service Commercial'], PROX),
  f('D2', 'Commercial - Corridor', 'future_landuse_ocp', 'proximity', 'FutureLanduse', ['Corridor'], PROX),
  f(
    'D3',
    'Commercial - Recreational',
    'future_landuse_ocp',
    'proximity',
    'FutureLanduse',
    ['Commercial Recreation'],
    PROX,
  ),
  f('D4', 'Commercial - Regional', 'future_landuse_ocp', 'proximity', 'FutureLanduse', ['Regional Commercial'], PROX),
  f('E6', 'Intensive Residential', 'intensive_residential_ocp', 'area_association', '', [], [], 5),
  f('F1', 'Traffic Signals', 'traffic_signals', 'proximity', '', [], PROX, 0, "LifeCycleStatus = 'Active'"),
  f(
    'F9',
    'Transit - Bus Stops (GTFS, all)',
    'gtfs_stops',
    'proximity',
    '',
    [],
    [
      [400, 1],
      [250, 1],
      [100, 1],
    ],
  ),
  f(
    'F9',
    'Transit - Bus Stops (GTFS, high frequency, band >= 4)',
    'gtfs_stops',
    'proximity',
    'frequency_band',
    ['4', '5'],
    [
      [400, 0],
      [250, 1],
      [100, 1],
    ],
  ),
  f('G0', 'Transit Corridors', 'transit_routes', 'proximity', '', [], PROX),
  f('G1', 'Active Corridors', 'cycle_network', 'line_association', '', [], [], 5),
  f(
    'G2',
    'Road Classification - Arterial/Freeway/Highway/Ramp',
    'roads',
    'line_association',
    'RoadClass',
    ['2', '3', '9', 'Arterial', 'Freeway', 'Highway', 'Ramp'],
    [],
    5,
    "LifeCycleStatus = 'Active'",
  ),
  f(
    'G3',
    'Road Classification - Major Collector',
    'roads',
    'line_association',
    'RoadClass',
    ['4', 'Major Collector'],
    [],
    4,
    "LifeCycleStatus = 'Active'",
  ),
  f(
    'G4',
    'Road Classification - Minor Collector',
    'roads',
    'line_association',
    'RoadClass',
    ['5', 'Minor Collector'],
    [],
    3,
    "LifeCycleStatus = 'Active'",
  ),
  f(
    'G5',
    'Road Classification - Local',
    'roads',
    'line_association',
    'RoadClass',
    ['6', 'Local'],
    [],
    1,
    "LifeCycleStatus = 'Active'",
  ),
  f('A1', 'Entertainment - POI Supplement', 'poi_supplement', 'proximity', 'poi_class', ['Entertainment'], PROX),
  f('E0', 'Affordable Housing - Low Income', 'poi_supplement', 'proximity', 'poi_class', ['Low Income Housing'], PROX),
  f('E1', 'Affordable Housing - Apartments', 'poi_supplement', 'proximity', 'poi_class', ['Apartment Building'], PROX),
  f('E2', 'Assisted Housing', 'poi_supplement', 'proximity', 'poi_class', ['Assisted Housing'], PROX),
  f('E3', 'Senior Housing', 'poi_supplement', 'proximity', 'poi_class', ['Senior Housing'], PROX),
  f('C0', 'Daycares (BC Child Care Locations)', 'bc_childcare', 'proximity', '', [], PROX),
  f('F0', 'Crosswalks - OSM Marked Crossings', 'osm_crossings', 'proximity', '', [], PROX),
  f('F0', 'Crosswalks - Report Class 3 List (Geocoded)', 'report_crosswalks', 'proximity', '', [], PROX),
  f('F8', 'Intercity Bus Depot', 'intercity_bus', 'proximity', '', [], PROX),
  f(
    'F2',
    'Population Density - High (Census Block 2021, top quintile)',
    'census_blocks_2021',
    'area_association',
    'PopDensQuintile',
    ['5'],
    [],
    5,
  ),
  f(
    'F3',
    'Population Density - Medium (Census Block 2021, mid quintiles)',
    'census_blocks_2021',
    'area_association',
    'PopDensQuintile',
    ['3', '4'],
    [],
    3,
  ),
  f(
    'F4',
    'Population Density - Low (Census Block 2021, bottom quintiles)',
    'census_blocks_2021',
    'area_association',
    'PopDensQuintile',
    ['1', '2'],
    [],
    1,
  ),
  f(
    'F6',
    'Seniors Density - High (DA 2021, top quintile)',
    'census_da_age',
    'area_association',
    'SeniorQuintile',
    ['5'],
    [],
    5,
  ),
  f(
    'F6',
    'Seniors Density - Medium (DA 2021, mid quintiles)',
    'census_da_age',
    'area_association',
    'SeniorQuintile',
    ['3', '4'],
    [],
    3,
  ),
  f(
    'F6',
    'Seniors Density - Low (DA 2021, bottom quintiles)',
    'census_da_age',
    'area_association',
    'SeniorQuintile',
    ['1', '2'],
    [],
    1,
  ),
  f(
    'F7',
    'Youth Density - High (DA 2021, top quintile)',
    'census_da_age',
    'area_association',
    'YouthQuintile',
    ['5'],
    [],
    5,
  ),
  f(
    'F7',
    'Youth Density - Medium (DA 2021, mid quintiles)',
    'census_da_age',
    'area_association',
    'YouthQuintile',
    ['3', '4'],
    [],
    3,
  ),
  f(
    'F7',
    'Youth Density - Low (DA 2021, bottom quintiles)',
    'census_da_age',
    'area_association',
    'YouthQuintile',
    ['1', '2'],
    [],
    1,
  ),
  f(
    'A0',
    'Community Space - Cultural / Leased',
    'civic_facility_buildings',
    'proximity',
    'SubType_TEXT',
    ['Cultural', 'Leased'],
    PROX,
  ),
  f(
    'A5',
    'Recreation - Aquatic / Arena / Stadium',
    'civic_facility_buildings',
    'proximity',
    'SubType_TEXT',
    ['Aquatic', 'Arena', 'Stadium'],
    PROX,
  ),
  f(
    'C1',
    'Government Services - Administration / Fire / Police',
    'civic_facility_buildings',
    'proximity',
    'SubType_TEXT',
    ['Administration', 'Fire Hall', 'Police'],
    PROX,
  ),
  f('E4', 'Growth Area - Priority / Infill', 'growth_management', 'area_association', 'GrowthPhase', ['1', '2'], [], 5),
  f(
    'E5',
    'Growth Area - Future / Phased',
    'growth_management',
    'area_association',
    'GrowthPhase',
    ['3', '4', '5'],
    [],
    3,
  ),
]

let cachedInputs = null
let inputsPromise = null
let cachedPrebuiltMasks = null
let prebuiltMasksPromise = null
let pendingComputeRequest = null
let processingComputeRequest = false
const maskCache = new Map()
const MAX_MASK_CACHE_ENTRIES = 160

self.onmessage = async (event) => {
  const { type, requestKey, options } = event.data ?? {}
  if (type !== 'compute') return
  pendingComputeRequest = { requestKey, options: options ?? {} }
  if (!processingComputeRequest) setTimeout(processLatestComputeRequest, 0)
}

async function processLatestComputeRequest() {
  if (processingComputeRequest || !pendingComputeRequest) return
  processingComputeRequest = true
  const { requestKey, options } = pendingComputeRequest
  pendingComputeRequest = null
  try {
    const grid = await computeLiveGrid(requestKey, options)
    postMessage({ type: 'result', requestKey, grid })
  } catch (error) {
    postMessage({ type: 'error', requestKey, error: error instanceof Error ? error.message : String(error) })
  } finally {
    processingComputeRequest = false
    if (pendingComputeRequest) setTimeout(processLatestComputeRequest, 0)
  }
}

function progress(requestKey, message) {
  postMessage({ type: 'progress', requestKey, progress: message })
}

async function computeLiveGrid(requestKey, options) {
  const config = {
    drop_gtfs_hf: Boolean(options.dropGtfsHf),
    narrow_civic: Boolean(options.narrowCivic),
    narrow_growth: Boolean(options.narrowGrowth),
    drop_pop_age: Boolean(options.dropPopAge),
    drop_f0: Boolean(options.dropF0),
    drop_c0: Boolean(options.dropC0),
    drop_f8: Boolean(options.dropF8),
    drop_supp_poi: Boolean(options.dropSuppPoi),
  }
  const areaBufferM = options.tightBuffer ? 10 : 20
  const factorWeights = normalizeFactorWeights(options.factorWeights)
  const activeFactors = applyVariant(FACTORS, config)
    .map((factor) => ({ ...factor, multiplier: factorWeights[factor.ref] ?? 1 }))
    .filter((factor) => factor.multiplier > 0)

  const prebuilt = await loadPrebuiltMasks(requestKey)
  if (prebuilt) {
    try {
      return computeLiveGridFromPrebuilt(requestKey, activeFactors, areaBufferM, prebuilt)
    } catch (error) {
      progress(requestKey, 'Prebuilt masks unavailable; rasterizing source layers')
      console.warn('Walkability prebuilt mask fallback:', error)
    }
  }

  const inputs = await loadInputs(requestKey)
  const grid = new Float32Array(inputs.rows * inputs.cols)

  for (let index = 0; index < activeFactors.length; index += 1) {
    const factor = activeFactors[index]
    progress(requestKey, `Scoring ${index + 1}/${activeFactors.length}: ${factor.ref}`)
    const features = activeSourceFeatures(inputs.layerFeatures, factor)
    if (!features.length) continue
    if (factor.mode === 'proximity') {
      for (const [distance, score] of factor.scores) {
        if (!score) continue
        const mask = factorMask(inputs, factor, features, distance)
        addMaskScoreToGrid(grid, mask, score * factor.multiplier)
      }
    } else {
      const mask = factorMask(inputs, factor, features, areaBufferM)
      addMaskScoreToGrid(grid, mask, factor.score * factor.multiplier)
    }
  }

  const bands = new Uint8Array(inputs.rows * inputs.cols)
  const bandCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  for (let index = 0; index < grid.length; index += 1) {
    if (!inputs.inside[index]) {
      bands[index] = NODATA
      continue
    }
    const band = scoreBand(grid[index])
    bands[index] = band
    bandCounts[band] += 1
  }

  return {
    key: `live-${requestKey}`,
    label: 'Live browser recalculation',
    generatedAt: new Date().toISOString(),
    cellSizeM: CELL_M,
    rows: inputs.rows,
    cols: inputs.cols,
    noData: NODATA,
    imageCoordinates: inputs.imageCoordinates,
    bandCounts,
    rle: rleEncode(bands),
  }
}

function computeLiveGridFromPrebuilt(requestKey, activeFactors, areaBufferM, prebuilt) {
  progress(requestKey, 'Combining prebuilt factor masks')
  const cellCount = prebuilt.rows * prebuilt.cols
  const grid = new Float32Array(cellCount)

  for (let index = 0; index < activeFactors.length; index += 1) {
    const factor = activeFactors[index]
    progress(requestKey, `Scoring ${index + 1}/${activeFactors.length}: ${factor.ref}`)
    if (factor.mode === 'proximity') {
      for (const [distance, score] of factor.scores) {
        if (!score) continue
        const mask = prebuilt.masks[componentMaskKey(factor, distance)]
        if (!mask) throw new Error(`Missing prebuilt walkability mask for ${factor.ref} at ${distance}m`)
        addPackedMaskScoreToGrid(grid, mask.bytes, score * factor.multiplier)
      }
    } else {
      const mask = prebuilt.masks[componentMaskKey(factor, areaBufferM)]
      if (!mask) throw new Error(`Missing prebuilt walkability mask for ${factor.ref} at ${areaBufferM}m`)
      addPackedMaskScoreToGrid(grid, mask.bytes, factor.score * factor.multiplier)
    }
  }

  const bands = new Uint8Array(cellCount)
  const bandCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  for (let index = 0; index < grid.length; index += 1) {
    if (!packedMaskHas(prebuilt.insideMask.bytes, index)) {
      bands[index] = NODATA
      continue
    }
    const band = scoreBand(grid[index])
    bands[index] = band
    bandCounts[band] += 1
  }

  return {
    key: `live-${requestKey}`,
    label: 'Live browser recalculation',
    generatedAt: new Date().toISOString(),
    cellSizeM: prebuilt.cellSizeM,
    rows: prebuilt.rows,
    cols: prebuilt.cols,
    noData: prebuilt.noData ?? NODATA,
    imageCoordinates: prebuilt.imageCoordinates,
    bandCounts,
    rle: rleEncode(bands),
  }
}

async function loadPrebuiltMasks(requestKey) {
  if (cachedPrebuiltMasks) return cachedPrebuiltMasks
  if (prebuiltMasksPromise) return prebuiltMasksPromise
  progress(requestKey, 'Loading prebuilt factor masks')
  prebuiltMasksPromise = fetchJson(PREBUILT_FACTOR_MASKS_URL)
    .then((raw) => {
      cachedPrebuiltMasks = normalizePrebuiltMasks(raw)
      return cachedPrebuiltMasks
    })
    .catch((error) => {
      console.warn('Unable to load walkability prebuilt masks:', error)
      return null
    })
    .finally(() => {
      prebuiltMasksPromise = null
    })
  return prebuiltMasksPromise
}

function normalizePrebuiltMasks(raw) {
  if (!raw || raw.encoding !== 'bitpack-base64') throw new Error('Unsupported prebuilt mask encoding')
  if (raw.cellSizeM !== CELL_M) throw new Error(`Unexpected prebuilt mask cell size: ${raw.cellSizeM}`)
  if (!Number.isFinite(raw.rows) || !Number.isFinite(raw.cols)) throw new Error('Invalid prebuilt mask dimensions')
  const cellCount = raw.rows * raw.cols
  const expectedBytes = Math.ceil(cellCount / 8)
  const insideBytes = decodeBase64ToBytes(raw.insideMask?.data ?? '')
  if (insideBytes.length !== expectedBytes) throw new Error('Invalid prebuilt city boundary mask length')
  const masks = {}
  for (const [key, value] of Object.entries(raw.masks ?? {})) {
    const bytes = decodeBase64ToBytes(value?.data ?? '')
    if (bytes.length !== expectedBytes) throw new Error(`Invalid prebuilt factor mask length for ${key}`)
    masks[key] = { ...value, bytes }
  }
  return {
    ...raw,
    insideMask: { ...raw.insideMask, bytes: insideBytes },
    masks,
  }
}

async function loadInputs(requestKey) {
  if (cachedInputs) return cachedInputs
  if (inputsPromise) return inputsPromise
  inputsPromise = loadInputsUncached(requestKey)
    .then((inputs) => {
      cachedInputs = inputs
      return inputs
    })
    .finally(() => {
      inputsPromise = null
    })
  return inputsPromise
}

async function loadInputsUncached(requestKey) {
  progress(requestKey, 'Fetching source layers')
  const layerKeys = [...new Set(FACTORS.map((factor) => factor.layerKey))]
  const layerFeatures = {}
  for (let index = 0; index < layerKeys.length; index += 1) {
    const key = layerKeys[index]
    progress(requestKey, `Loading ${index + 1}/${layerKeys.length}: ${key}`)
    layerFeatures[key] = await readLayer(key)
  }
  if (layerFeatures.census_blocks_2021) assignPopDensityQuintiles(layerFeatures.census_blocks_2021)

  progress(requestKey, 'Building city boundary grid')
  const boundaryRaw = await fetchJson(`${GIS_DIR}/community_boundary.json`)
  const boundaryFeatures = readLayerFromArcgisData(boundaryRaw)
  const { minX, maxX, maxY } = readArcgisProjectedBounds(boundaryRaw)
  const minY = readArcgisProjectedBounds(boundaryRaw).minY
  const cols = Math.ceil((maxX - minX) / CELL_M)
  const rows = Math.ceil((maxY - minY) / CELL_M)
  const topLeft = utm10nToLonlat(minX, maxY)
  const topRight = utm10nToLonlat(minX + cols * CELL_M, maxY)
  const bottomRight = utm10nToLonlat(minX + cols * CELL_M, maxY - rows * CELL_M)
  const bottomLeft = utm10nToLonlat(minX, maxY - rows * CELL_M)
  const bounds = { minX, maxY }
  const inside = new Uint8Array(rows * cols)
  for (const boundary of boundaryFeatures) addGeometryInteriorToMask(inside, rows, cols, bounds, boundary)

  return {
    layerFeatures,
    rows,
    cols,
    bounds,
    inside,
    imageCoordinates: [topLeft, topRight, bottomRight, bottomLeft],
  }
}

async function fetchJson(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Unable to load ${url}: ${response.status}`)
  return response.json()
}

async function readLayer(layerKey) {
  const layer = LAYERS[layerKey]
  const data = await fetchJson(layer.file)
  const rawFeatures = layer.source === 'arcgis' ? data : (data.features ?? [])
  const features = []
  for (const raw of rawFeatures) {
    const feature =
      layer.source === 'arcgis' ? arcgisGeomToProjectedGeometry(raw.geometry) : normalizeProjectedGeometry(raw)
    if (!feature) continue
    feature.properties = layer.source === 'arcgis' ? (raw.attributes ?? {}) : (raw.properties ?? {})
    features.push(feature)
  }
  return features
}

function readLayerFromArcgisData(data) {
  return data
    .map((feature) => {
      const projected = arcgisGeomToProjectedGeometry(feature.geometry)
      if (projected) projected.properties = feature.attributes ?? {}
      return projected
    })
    .filter(Boolean)
}

function readArcgisProjectedBounds(data) {
  const xs = []
  const ys = []
  const visitCoordinate = ([x, y]) => {
    xs.push(Number(x))
    ys.push(Number(y))
  }
  for (const feature of data) {
    const geometry = feature.geometry
    if (!geometry) continue
    if ('x' in geometry && 'y' in geometry) visitCoordinate([geometry.x, geometry.y])
    for (const pathLine of geometry.paths ?? []) pathLine.forEach(visitCoordinate)
    for (const ring of geometry.rings ?? []) ring.forEach(visitCoordinate)
  }
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}

function scoreBand(value) {
  if (value < 27.4) return 1
  if (value < 45.7) return 2
  if (value < 63.9) return 3
  if (value < 82.2) return 4
  return 5
}

function lonlatToUtm10n(lon, lat) {
  const a = 6378137.0
  const flattening = 1 / 298.257223563
  const e2 = flattening * (2 - flattening)
  const k0 = 0.9996
  const lon0 = (-123 * Math.PI) / 180
  const latR = (lat * Math.PI) / 180
  const lonR = (lon * Math.PI) / 180
  const n = a / Math.sqrt(1 - e2 * Math.sin(latR) ** 2)
  const t = Math.tan(latR) ** 2
  const c = (e2 / (1 - e2)) * Math.cos(latR) ** 2
  const a1 = Math.cos(latR) * (lonR - lon0)
  const m =
    a *
    ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * latR -
      ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * latR) +
      ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * latR) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * latR))
  const x =
    k0 *
      n *
      (a1 + ((1 - t + c) * a1 ** 3) / 6 + ((5 - 18 * t + t ** 2 + 72 * c - (58 * e2) / (1 - e2)) * a1 ** 5) / 120) +
    500000
  const y =
    k0 *
    (m +
      n *
        Math.tan(latR) *
        (a1 ** 2 / 2 +
          ((5 - t + 9 * c + 4 * c ** 2) * a1 ** 4) / 24 +
          ((61 - 58 * t + t ** 2 + 600 * c - (330 * e2) / (1 - e2)) * a1 ** 6) / 720))
  return [x, y]
}

function utm10nToLonlat(x, y) {
  const a = 6378137.0
  const flattening = 1 / 298.257223563
  const e2 = flattening * (2 - flattening)
  const k0 = 0.9996
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2))
  x -= 500000
  const m = y / k0
  const mu = m / (a * (1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256))
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu)
  const n1 = a / Math.sqrt(1 - e2 * Math.sin(phi1) ** 2)
  const t1 = Math.tan(phi1) ** 2
  const c1 = (e2 / (1 - e2)) * Math.cos(phi1) ** 2
  const r1 = (a * (1 - e2)) / (1 - e2 * Math.sin(phi1) ** 2) ** 1.5
  const d = x / (n1 * k0)
  const lat =
    phi1 -
    ((n1 * Math.tan(phi1)) / r1) *
      (d ** 2 / 2 -
        ((5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - (9 * e2) / (1 - e2)) * d ** 4) / 24 +
        ((61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - (252 * e2) / (1 - e2) - 3 * c1 ** 2) * d ** 6) / 720)
  const lon =
    (-123 * Math.PI) / 180 +
    (d -
      ((1 + 2 * t1 + c1) * d ** 3) / 6 +
      ((5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + (8 * e2) / (1 - e2) + 24 * t1 ** 2) * d ** 5) / 120) /
      Math.cos(phi1)
  return [(lon * 180) / Math.PI, (lat * 180) / Math.PI]
}

function makeGeometry(type, coordinates, properties = {}) {
  return { type, coordinates, properties, bbox: geometryBbox(type, coordinates) }
}

function geometryBbox(type, coordinates) {
  const xs = []
  const ys = []
  const visit = ([x, y]) => {
    xs.push(Number(x))
    ys.push(Number(y))
  }
  if (type === 'Point') visit(coordinates)
  else if (type === 'LineString') coordinates.forEach(visit)
  else if (type === 'MultiLineString' || type === 'Polygon') coordinates.flat(1).forEach(visit)
  else if (type === 'MultiPolygon') coordinates.flat(2).forEach(visit)
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}

function arcgisGeomToProjectedGeometry(geometry) {
  if (!geometry) return null
  if ('x' in geometry && 'y' in geometry) return makeGeometry('Point', [Number(geometry.x), Number(geometry.y)])
  if (geometry.paths) {
    const lines = geometry.paths
      .map((line) => line.map(([x, y]) => [Number(x), Number(y)]))
      .filter((line) => line.length >= 2)
    if (!lines.length) return null
    return lines.length === 1 ? makeGeometry('LineString', lines[0]) : makeGeometry('MultiLineString', lines)
  }
  if (geometry.rings) {
    const polygons = geometry.rings
      .map((ring) => ring.map(([x, y]) => [Number(x), Number(y)]))
      .filter((ring) => ring.length >= 4)
      .map((ring) => [ring])
    if (!polygons.length) return null
    return polygons.length === 1 ? makeGeometry('Polygon', polygons[0]) : makeGeometry('MultiPolygon', polygons)
  }
  return null
}

function lonLatOrProjectedToUtm([x, y], properties = {}) {
  const propX = properties.x_26910 === '' || properties.x_26910 == null ? NaN : Number(properties.x_26910)
  const propY = properties.y_26910 === '' || properties.y_26910 == null ? NaN : Number(properties.y_26910)
  if (Number.isFinite(propX) && Number.isFinite(propY)) return [propX, propY]
  const nx = Number(x)
  const ny = Number(y)
  if (Math.abs(nx) > 180 || Math.abs(ny) > 90) return [nx, ny]
  return lonlatToUtm10n(nx, ny)
}

function normalizeProjectedGeometry(feature) {
  if (!feature?.geometry) return null
  const geom = feature.geometry
  const properties = feature.properties ?? {}
  const convertPoint = (point) => lonLatOrProjectedToUtm(point, properties)
  if (geom.type === 'Point') return makeGeometry('Point', convertPoint(geom.coordinates), properties)
  if (geom.type === 'LineString') return makeGeometry('LineString', geom.coordinates.map(convertPoint), properties)
  if (geom.type === 'MultiLineString')
    return makeGeometry(
      'MultiLineString',
      geom.coordinates.map((line) => line.map(convertPoint)),
      properties,
    )
  if (geom.type === 'Polygon')
    return makeGeometry(
      'Polygon',
      geom.coordinates.map((ring) => ring.map(convertPoint)),
      properties,
    )
  if (geom.type === 'MultiPolygon')
    return makeGeometry(
      'MultiPolygon',
      geom.coordinates.map((poly) => poly.map((ring) => ring.map(convertPoint))),
      properties,
    )
  return null
}

function norm(value) {
  return value == null ? '' : String(value).trim()
}

function whereMatches(attrs, where) {
  if (!where) return true
  const match = where.match(/([A-Za-z0-9_]+)\s*=\s*'([^']+)'/)
  if (!match) return true
  const actual = norm(attrs[match[1]]).toLowerCase()
  const expected = match[2].toLowerCase()
  return expected === 'active' ? actual === 'active' || actual === 'act' : actual === expected
}

function fieldMatches(attrs, field, values) {
  if (!field || !values.length) return true
  const actual = norm(attrs[field])
  const actualLower = actual.toLowerCase()
  return values.some(
    (value) =>
      actual === value ||
      actualLower === String(value).toLowerCase() ||
      actualLower.includes(String(value).toLowerCase()),
  )
}

function assignPopDensityQuintiles(features) {
  const densities = features.map((feature) => {
    const pop = Number(feature.properties?.DBpop_2021) || 0
    const area = geometryArea(feature)
    const density = area > 0 ? pop / area : 0
    feature.properties._pop_density = density
    return density
  })
  const nonzero = densities.filter((density) => density > 0).sort((a, b) => a - b)
  if (!nonzero.length) {
    features.forEach((feature) => {
      feature.properties.PopDensQuintile = '1'
    })
    return
  }
  const cut = (q) => nonzero[Math.max(0, Math.min(nonzero.length - 1, Math.floor(q * nonzero.length) - 1))]
  const q1 = cut(0.2)
  const q2 = cut(0.4)
  const q3 = cut(0.6)
  const q4 = cut(0.8)
  for (const feature of features) {
    const density = feature.properties._pop_density
    feature.properties.PopDensQuintile =
      density <= 0 || density <= q1 ? '1' : density <= q2 ? '2' : density <= q3 ? '3' : density <= q4 ? '4' : '5'
  }
}

function applyVariant(factors, config) {
  const dropRefs = new Set()
  if (config.drop_pop_age) ['F2', 'F3', 'F4', 'F6', 'F7'].forEach((ref) => dropRefs.add(ref))
  if (config.drop_f0) dropRefs.add('F0')
  if (config.drop_c0) dropRefs.add('C0')
  if (config.drop_f8) dropRefs.add('F8')
  return factors.flatMap((factor) => {
    if (dropRefs.has(factor.ref)) return []
    if (config.drop_gtfs_hf && factor.description === 'Transit - Bus Stops (GTFS, high frequency, band >= 4)') return []
    if (config.drop_supp_poi && factor.layerKey === 'poi_supplement') return []
    if (config.narrow_civic || config.narrow_growth) {
      const narrow = { A0: ['Cultural'], A5: ['Aquatic'], C1: ['Administration'], E4: ['1'], E5: ['3'] }
      if (
        narrow[factor.ref] &&
        ((config.narrow_civic && ['A0', 'A5', 'C1'].includes(factor.ref)) ||
          (config.narrow_growth && ['E4', 'E5'].includes(factor.ref)))
      ) {
        const values = factor.values.filter((value) => narrow[factor.ref].includes(value))
        if (!values.length) return []
        return [{ ...factor, values }]
      }
    }
    return [factor]
  })
}

function normalizeFactorWeights(rawWeights) {
  const weights = {}
  if (!rawWeights || typeof rawWeights !== 'object') return weights
  for (const [ref, value] of Object.entries(rawWeights)) {
    const numericValue = Number(value)
    if (!Number.isFinite(numericValue)) continue
    weights[ref] = Math.max(0, Math.min(2, numericValue))
  }
  return weights
}

function activeSourceFeatures(layerFeatures, factor) {
  return (layerFeatures[factor.layerKey] ?? []).filter(
    (feature) =>
      whereMatches(feature.properties ?? {}, factor.where) &&
      fieldMatches(feature.properties ?? {}, factor.field, factor.values),
  )
}

function factorMask(inputs, factor, features, distanceM) {
  const key = factorMaskKey(inputs, factor, distanceM)
  const cached = maskCache.get(key)
  if (cached) return cached

  const mask = new Uint8Array(inputs.rows * inputs.cols)
  for (const feature of features) {
    addGeometryDistanceToMask(mask, inputs.rows, inputs.cols, inputs.bounds, feature, distanceM)
  }
  setCachedMask(key, mask)
  return mask
}

function setCachedMask(key, mask) {
  if (!maskCache.has(key) && maskCache.size >= MAX_MASK_CACHE_ENTRIES) {
    const oldestKey = maskCache.keys().next().value
    if (oldestKey) maskCache.delete(oldestKey)
  }
  maskCache.set(key, mask)
}

function factorMaskKey(inputs, factor, distanceM) {
  return [
    inputs.rows,
    inputs.cols,
    inputs.bounds.minX,
    inputs.bounds.maxY,
    CELL_M,
    factor.ref,
    factor.description,
    factor.layerKey,
    factor.mode,
    factor.field,
    factor.where,
    JSON.stringify(factor.values),
    distanceM,
  ].join('|')
}

function componentMaskKey(factor, distanceM) {
  return [
    factor.ref,
    factor.description,
    factor.layerKey,
    factor.mode,
    factor.field,
    factor.where,
    JSON.stringify(factor.values),
    distanceM,
  ].join('|')
}

function addGeometryDistanceToMask(mask, rows, cols, bounds, geometry, distanceM) {
  if (geometry.type === 'Point') {
    addPointDistanceToMask(mask, rows, cols, bounds, geometry.coordinates, distanceM)
  } else if (geometry.type === 'LineString') {
    addLineStringDistanceToMask(mask, rows, cols, bounds, geometry.coordinates, distanceM)
  } else if (geometry.type === 'MultiLineString') {
    for (const line of geometry.coordinates) addLineStringDistanceToMask(mask, rows, cols, bounds, line, distanceM)
  } else if (geometry.type === 'Polygon') {
    addPolygonDistanceToMask(mask, rows, cols, bounds, geometry.coordinates, distanceM)
  } else if (geometry.type === 'MultiPolygon') {
    for (const polygon of geometry.coordinates) addPolygonDistanceToMask(mask, rows, cols, bounds, polygon, distanceM)
  }
}

function scanWindowForBbox(rows, cols, bounds, bbox, distanceM) {
  const minCol = Math.max(0, Math.floor((bbox.minX - distanceM - bounds.minX) / CELL_M))
  const maxCol = Math.min(cols - 1, Math.ceil((bbox.maxX + distanceM - bounds.minX) / CELL_M))
  const minRow = Math.max(0, Math.floor((bounds.maxY - (bbox.maxY + distanceM)) / CELL_M))
  const maxRow = Math.min(rows - 1, Math.ceil((bounds.maxY - (bbox.minY - distanceM)) / CELL_M))
  return { minCol, maxCol, minRow, maxRow }
}

function addPointDistanceToMask(mask, rows, cols, bounds, point, distanceM) {
  const [px, py] = point
  const { minCol, maxCol, minRow, maxRow } = scanWindowForBbox(
    rows,
    cols,
    bounds,
    { minX: px, minY: py, maxX: px, maxY: py },
    distanceM,
  )
  if (minCol > maxCol || minRow > maxRow) return
  const distanceSquared = distanceM * distanceM
  for (let row = minRow; row <= maxRow; row += 1) {
    const y = bounds.maxY - (row + 0.5) * CELL_M
    const base = row * cols
    for (let col = minCol; col <= maxCol; col += 1) {
      const x = bounds.minX + (col + 0.5) * CELL_M
      if ((x - px) ** 2 + (y - py) ** 2 <= distanceSquared) mask[base + col] = 1
    }
  }
}

function addLineStringDistanceToMask(mask, rows, cols, bounds, line, distanceM) {
  for (let index = 1; index < line.length; index += 1) {
    addSegmentDistanceToMask(mask, rows, cols, bounds, line[index - 1], line[index], distanceM)
  }
}

function addSegmentDistanceToMask(mask, rows, cols, bounds, start, end, distanceM) {
  const bbox = {
    minX: Math.min(start[0], end[0]),
    minY: Math.min(start[1], end[1]),
    maxX: Math.max(start[0], end[0]),
    maxY: Math.max(start[1], end[1]),
  }
  const { minCol, maxCol, minRow, maxRow } = scanWindowForBbox(rows, cols, bounds, bbox, distanceM)
  if (minCol > maxCol || minRow > maxRow) return
  const distanceSquared = distanceM * distanceM
  for (let row = minRow; row <= maxRow; row += 1) {
    const y = bounds.maxY - (row + 0.5) * CELL_M
    const base = row * cols
    for (let col = minCol; col <= maxCol; col += 1) {
      const x = bounds.minX + (col + 0.5) * CELL_M
      if (pointSegmentDistanceSquared([x, y], start, end) <= distanceSquared) mask[base + col] = 1
    }
  }
}

function addPolygonDistanceToMask(mask, rows, cols, bounds, rings, distanceM) {
  addPolygonInteriorToMask(mask, rows, cols, bounds, rings)
  if (distanceM <= 0) return
  for (const ring of rings) addRingDistanceToMask(mask, rows, cols, bounds, ring, distanceM)
}

function addRingDistanceToMask(mask, rows, cols, bounds, ring, distanceM) {
  for (let index = 0; index < ring.length; index += 1) {
    const start = ring[index]
    const end = ring[(index + 1) % ring.length]
    addSegmentDistanceToMask(mask, rows, cols, bounds, start, end, distanceM)
  }
}

function addPolygonInteriorToMask(mask, rows, cols, bounds, rings) {
  const bbox = geometryBbox('Polygon', rings)
  const { minRow, maxRow } = scanWindowForBbox(rows, cols, bounds, bbox, 0)
  if (minRow > maxRow) return
  for (let row = minRow; row <= maxRow; row += 1) {
    const y = bounds.maxY - (row + 0.5) * CELL_M
    const intersections = []
    for (const ring of rings) {
      for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
        const [x1, y1] = ring[previous]
        const [x2, y2] = ring[index]
        if (y1 > y === y2 > y) continue
        intersections.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1))
      }
    }
    if (intersections.length < 2) continue
    intersections.sort((left, right) => left - right)
    const base = row * cols
    for (let index = 0; index < intersections.length - 1; index += 2) {
      const startX = intersections[index]
      const endX = intersections[index + 1]
      const minCol = Math.max(0, Math.ceil((startX - bounds.minX) / CELL_M - 0.5))
      const maxCol = Math.min(cols - 1, Math.floor((endX - bounds.minX) / CELL_M - 0.5))
      for (let col = minCol; col <= maxCol; col += 1) mask[base + col] = 1
    }
  }
}

function addGeometryInteriorToMask(mask, rows, cols, bounds, geometry) {
  addGeometryDistanceToMask(mask, rows, cols, bounds, geometry, 0)
}

function geometryArea(geometry) {
  if (geometry.type === 'Polygon') return polygonArea(geometry.coordinates)
  if (geometry.type === 'MultiPolygon')
    return geometry.coordinates.reduce((sum, polygon) => sum + polygonArea(polygon), 0)
  return 0
}

function ringArea(ring) {
  let area = 0
  for (let index = 0; index < ring.length; index += 1) {
    const [x1, y1] = ring[index]
    const [x2, y2] = ring[(index + 1) % ring.length]
    area += x1 * y2 - x2 * y1
  }
  return area / 2
}

function polygonArea(rings) {
  if (!rings.length) return 0
  const outer = Math.abs(ringArea(rings[0]))
  const holes = rings.slice(1).reduce((sum, ring) => sum + Math.abs(ringArea(ring)), 0)
  return Math.max(0, outer - holes)
}

function pointSegmentDistanceSquared(point, start, end) {
  const [px, py] = point
  const [x1, y1] = start
  const [x2, y2] = end
  const dx = x2 - x1
  const dy = y2 - y1
  if (dx === 0 && dy === 0) return (px - x1) ** 2 + (py - y1) ** 2
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
  const x = x1 + t * dx
  const y = y1 + t * dy
  return (px - x) ** 2 + (py - y) ** 2
}

function addMaskScoreToGrid(grid, mask, score) {
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index]) grid[index] += score
  }
}

function addPackedMaskScoreToGrid(grid, packedMask, score) {
  for (let byteIndex = 0; byteIndex < packedMask.length; byteIndex += 1) {
    const byte = packedMask[byteIndex]
    if (!byte) continue
    const baseIndex = byteIndex * 8
    for (let bit = 0; bit < 8; bit += 1) {
      const cellIndex = baseIndex + bit
      if (cellIndex >= grid.length) return
      if (byte & (1 << bit)) grid[cellIndex] += score
    }
  }
}

function packedMaskHas(packedMask, index) {
  return Boolean(packedMask[index >> 3] & (1 << (index & 7)))
}

function decodeBase64ToBytes(base64) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function rleEncode(values) {
  const encoded = []
  let last = values[0]
  let count = 1
  for (let index = 1; index < values.length; index += 1) {
    const value = values[index]
    if (value === last) count += 1
    else {
      encoded.push([last, count])
      last = value
      count = 1
    }
  }
  encoded.push([last, count])
  return encoded
}
