import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const SOURCE_ROOT = '/Users/ahmadjalil/Downloads/Walkability'
const OUTPUT_ROOT = 'public/data/walkability'
const SUPPLEMENTAL_OUTPUT = `${OUTPUT_ROOT}/supplemental`
const ASSET_OUTPUT = `${OUTPUT_ROOT}/assets`
const HEATMAP_OUTPUT = `${OUTPUT_ROOT}/heatmap`

const DIRECT_GEOJSON = [
  {
    id: 'osm_crossings',
    label: 'OSM pedestrian crossings',
    source: `${SOURCE_ROOT}/data/supplemental/osm_crossings.geojson`,
    output: `${SUPPLEMENTAL_OUTPUT}/osm_crossings.geojson`,
  },
  {
    id: 'osm_daycares',
    label: 'OSM daycare points',
    source: `${SOURCE_ROOT}/data/supplemental/osm_daycares.geojson`,
    output: `${SUPPLEMENTAL_OUTPUT}/osm_daycares.geojson`,
  },
  {
    id: 'bc_childcare_locations',
    label: 'BC childcare locations',
    source: `${SOURCE_ROOT}/data/supplemental/bc_childcare_locations.geojson`,
    output: `${SUPPLEMENTAL_OUTPUT}/bc_childcare_locations.geojson`,
  },
  {
    id: 'intercity_bus_stops',
    label: 'Intercity bus stops',
    source: `${SOURCE_ROOT}/data/supplemental/intercity_bus_stops.geojson`,
    output: `${SUPPLEMENTAL_OUTPUT}/intercity_bus_stops.geojson`,
  },
  {
    id: 'report_class3_crosswalks',
    label: 'Geocoded report class-3 crosswalks',
    source: `${SOURCE_ROOT}/data/supplemental/report_class3_crosswalks_geocoded.geojson`,
    output: `${SUPPLEMENTAL_OUTPUT}/report_class3_crosswalks_geocoded.geojson`,
  },
  {
    id: 'missing_poi_supplement',
    label: 'Missing POI supplement',
    source: `${SOURCE_ROOT}/mobility_reconstruction/missing_poi_supplement.geojson`,
    output: `${SUPPLEMENTAL_OUTPUT}/missing_poi_supplement.geojson`,
  },
]

const SOURCE_TABLES = [
  {
    id: 'public_mobility_index_asset_scores',
    label: 'Public mobility index asset scores',
    source: `${SOURCE_ROOT}/mobility_reconstruction/public_mobility_index_asset_scores.csv`,
    output: `${ASSET_OUTPUT}/public_mobility_index_asset_scores.csv`,
  },
  {
    id: 'asset_priority_ranked',
    label: 'Asset priority ranking',
    source: `${SOURCE_ROOT}/mobility_reconstruction/prioritization/asset_priority_ranked.csv`,
    output: `${ASSET_OUTPUT}/asset_priority_ranked.csv`,
  },
  {
    id: 'asset_priority_with_costs',
    label: 'Asset priority with costs',
    source: `${SOURCE_ROOT}/mobility_reconstruction/prioritization/asset_priority_with_costs.csv`,
    output: `${ASSET_OUTPUT}/asset_priority_with_costs.csv`,
  },
]

const HEATMAP_SOURCE_SUMMARY = `${SOURCE_ROOT}/mobility_reconstruction/maps/mi_heatmap_summary.json`
const HEATMAP_IMAGE_COORDINATES = [
  [-122.89932562458775, 54.04175139057946],
  [-122.60292192319302, 54.04113801308205],
  [-122.60508870065334, 53.81221841975791],
  [-122.89987500130398, 53.81282670047815],
]
const MI_BAND_LABELS = {
  1: 'Component 1-27',
  2: 'Component 28-45',
  3: 'Component 46-63',
  4: 'Component 64-82',
  5: 'Component 83-170',
}

function splitCsvLine(line) {
  const values = []
  let current = ''
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"' && line[index + 1] === '"') {
      current += '"'
      index += 1
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === ',' && !quoted) {
      values.push(current)
      current = ''
    } else {
      current += char
    }
  }

  values.push(current)
  return values
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean)
  const headers = splitCsvLine(lines[0] ?? '')
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line)
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))
  })
}

function parseMaybeNumber(value) {
  if (value == null || value === '') return value
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : value
}

async function readGeoJson(filePath) {
  const data = JSON.parse(await readFile(filePath, 'utf8'))
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
    throw new Error(`${filePath} is not a GeoJSON FeatureCollection`)
  }
  return data
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function featureTypeForSource(sourceLayer) {
  if (sourceLayer === 'sidewalks' || sourceLayer === 'walkways') return 'RPath'
  if (sourceLayer === 'trails') return 'PTrail'
  return ''
}

function keyFor(sourceLayer, assetId) {
  return `${featureTypeForSource(sourceLayer)}:${String(assetId ?? '').trim()}`
}

function selectAssetProperties(scoreRow, priorityRow, costRow) {
  const selected = {
    FeatureType: scoreRow.FeatureType,
    AssetID: scoreRow.AssetID,
    source_layer: scoreRow.source_layer,
    public_length_m: scoreRow.public_length_m,
    SurfaceMaterial: scoreRow.SurfaceMaterial,
    MI_Value_Public_Rebuild: scoreRow.MI_Value_Public_Rebuild,
    MI_Score_Public_Rebuild: scoreRow.MI_Score_Public_Rebuild,
    MI_Score_Public_Normalized: scoreRow.MI_Score_Public_Normalized,
    ConditionScore: scoreRow.ConditionScore,
    AssetLength: scoreRow.AssetLength,
    DistressExtentRatio: scoreRow.DistressExtentRatio,
    WeightedDistressExtentRatio: scoreRow.WeightedDistressExtentRatio,
    Risk_Product_Public_MI_x_Condition: scoreRow.Risk_Product_Public_MI_x_Condition,
    Priority_Rank: priorityRow?.Priority_Rank,
    Priority_Category: priorityRow?.Priority_Category,
    Impact: priorityRow?.Impact,
    Contribution_Discrete: priorityRow?.Contribution_Discrete,
    Benefit_Discrete: priorityRow?.Benefit_Discrete,
    Benefit_With_Incidents: priorityRow?.Benefit_With_Incidents,
    PedestrianIncidents_50m_2020_2024: priorityRow?.PedestrianIncidents_50m_2020_2024,
    RepairCost_Low: costRow?.RepairCost_Low,
    RepairCost_Mid: costRow?.RepairCost_Mid,
    RepairCost_High: costRow?.RepairCost_High,
    Benefit_per_Cost_Mid: costRow?.Benefit_per_Cost_Mid,
    SurfaceFamily: costRow?.SurfaceFamily,
  }

  return Object.fromEntries(Object.entries(selected).map(([key, value]) => [key, parseMaybeNumber(value)]))
}

async function buildJoinedAssets() {
  const scoreRows = parseCsv(await readFile(`${SOURCE_ROOT}/mobility_reconstruction/public_mobility_index_asset_scores.csv`, 'utf8'))
  const priorityRows = parseCsv(await readFile(`${SOURCE_ROOT}/mobility_reconstruction/prioritization/asset_priority_ranked.csv`, 'utf8'))
  const costRows = parseCsv(await readFile(`${SOURCE_ROOT}/mobility_reconstruction/prioritization/asset_priority_with_costs.csv`, 'utf8'))
  const priorityByKey = new Map(priorityRows.map((row) => [`${row.FeatureType}:${row.AssetID}`, row]))
  const costByKey = new Map(costRows.map((row) => [`${row.FeatureType}:${row.AssetID}`, row]))
  const scoreByKey = new Map(scoreRows.map((row) => [`${row.FeatureType}:${row.AssetID}`, row]))
  const sourceLayers = [
    ['sidewalks', 'public/data/citypg/sidewalks.geojson'],
    ['walkways', 'public/data/citypg/walkways.geojson'],
  ]

  const features = []
  const matchedKeys = new Set()

  for (const [sourceLayer, filePath] of sourceLayers) {
    const geojson = await readGeoJson(filePath)
    for (const feature of geojson.features) {
      const key = keyFor(sourceLayer, feature.properties?.AssetID)
      const scoreRow = scoreByKey.get(key)
      if (!scoreRow) continue
      matchedKeys.add(key)
      features.push({
        ...feature,
        properties: {
          ...feature.properties,
          walkabilityAsset: selectAssetProperties(scoreRow, priorityByKey.get(key), costByKey.get(key)),
        },
      })
    }
  }

  const output = {
    type: 'FeatureCollection',
    features,
  }
  await mkdir(ASSET_OUTPUT, { recursive: true })
  await writeFile(`${ASSET_OUTPUT}/asset_priority_joined.geojson`, `${JSON.stringify(output)}\n`)

  return {
    scoreRows: scoreRows.length,
    priorityRows: priorityRows.length,
    costRows: costRows.length,
    joinedFeatures: features.length,
    unmatchedScoreRows: scoreRows.length - matchedKeys.size,
    note: 'Joined only RPath rows whose AssetID exists in local CityPG sidewalks/walkways WGS84 layers. PTrail rows remain available in CSV tables because no matching WGS84 trail layer is currently present in this repo import path.',
  }
}

async function buildAssetHeatmap() {
  const joinedAssets = await readGeoJson(`${ASSET_OUTPUT}/asset_priority_joined.geojson`)
  const bandCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  const features = []

  for (const feature of joinedAssets.features) {
    const asset = feature.properties?.walkabilityAsset ?? {}
    const miBand = Number(asset.MI_Score_Public_Rebuild)
    if (!Number.isFinite(miBand) || miBand < 1 || miBand > 5) continue

    bandCounts[miBand] += 1
    features.push({
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        id: `${asset.FeatureType}:${asset.AssetID}`,
        featureType: asset.FeatureType,
        assetId: asset.AssetID,
        sourceLayer: asset.source_layer,
        surfaceMaterial: asset.SurfaceMaterial,
        miValue: asset.MI_Value_Public_Rebuild,
        miBand,
        miBandLabel: MI_BAND_LABELS[miBand],
        normalizedBand: asset.MI_Score_Public_Normalized,
        conditionScore: asset.ConditionScore,
        priorityRank: asset.Priority_Rank,
        priorityCategory: asset.Priority_Category,
        publicLengthM: asset.public_length_m,
      },
    })
  }

  const output = {
    type: 'FeatureCollection',
    features,
  }
  await writeFile(`${HEATMAP_OUTPUT}/asset_mi_bins.geojson`, `${JSON.stringify(output)}\n`)

  return {
    path: '/data/walkability/heatmap/asset_mi_bins.geojson',
    featureCount: features.length,
    bandCounts,
    bandLabels: MI_BAND_LABELS,
    caveat: 'Generated by Node from imported mobility-index CSV attributes joined onto repo-local WGS84 CityPG sidewalk/walkway geometry; it does not use the Python-rendered raster PNG as a source.',
  }
}

async function main() {
  await mkdir(SUPPLEMENTAL_OUTPUT, { recursive: true })
  await mkdir(ASSET_OUTPUT, { recursive: true })
  await mkdir(HEATMAP_OUTPUT, { recursive: true })

  const copiedGeojson = []
  for (const file of DIRECT_GEOJSON) {
    await copyFile(file.source, file.output)
    const data = await readGeoJson(file.output)
    copiedGeojson.push({
      id: file.id,
      label: file.label,
      path: `/${file.output.replace(/^public\//, '')}`,
      sourcePath: file.source,
      featureCount: data.features.length,
    })
  }

  const copiedTables = []
  for (const file of SOURCE_TABLES) {
    await copyFile(file.source, file.output)
    const rowCount = parseCsv(await readFile(file.output, 'utf8')).length
    copiedTables.push({
      id: file.id,
      label: file.label,
      path: `/${file.output.replace(/^public\//, '')}`,
      sourcePath: file.source,
      rowCount,
    })
  }

  const joinedAssets = await buildJoinedAssets()
  const assetHeatmap = await buildAssetHeatmap()
  const heatmapSourceSummary = JSON.parse(await readFile(HEATMAP_SOURCE_SUMMARY, 'utf8'))
  const heatmapVariants = []

  for (const variant of heatmapSourceSummary.variants ?? []) {
    const source = `${SOURCE_ROOT}/mobility_reconstruction/maps/mi_heatmap_overlay_${variant.key}.png`
    const output = `${HEATMAP_OUTPUT}/mi_heatmap_overlay_${variant.key}.png`
    await copyFile(source, output)
    heatmapVariants.push({
      ...variant,
      path: `/${output.replace(/^public\//, '')}`,
    })
  }

  const existingHeatmapManifest = await readJsonIfExists(`${HEATMAP_OUTPUT}/manifest.json`)
  const heatmapManifest = {
    ...existingHeatmapManifest,
    generatedAt: new Date().toISOString(),
    sourceRoot: SOURCE_ROOT,
    defaultLayer: existingHeatmapManifest?.citywideGrid ? 'citywideGrid' : 'assetBinned',
    assetBinned: assetHeatmap,
    cellSizeM: heatmapSourceSummary.cell_size_m,
    defaultVariant: existingHeatmapManifest?.citywideGrid?.defaultVariant ?? 'asset_binned',
    coordinates: HEATMAP_IMAGE_COORDINATES,
    variants: heatmapVariants,
    sourceSummaryPath: HEATMAP_SOURCE_SUMMARY,
    caveats: [
      'The default layer is a Node-generated binned asset layer built from imported mobility-index tables and repo-local geometry, not a census/community aggregation.',
      'The PNG raster overlays are retained as reconstruction reference variants and are not used for the default calculation layer.',
      'Coordinates are the GeoTIFF EPSG:26910 raster bounds transformed to WGS84 for MapLibre image overlay rendering.',
    ],
  }

  await writeFile(`${HEATMAP_OUTPUT}/manifest.json`, `${JSON.stringify(heatmapManifest, null, 2)}\n`)

  const manifest = {
    generatedAt: new Date().toISOString(),
    sourceRoot: SOURCE_ROOT,
    copiedGeojson,
    copiedTables,
    joinedAssets: {
      path: '/data/walkability/assets/asset_priority_joined.geojson',
      ...joinedAssets,
    },
    heatmap: {
      path: '/data/walkability/heatmap/manifest.json',
      assetBinnedPath: assetHeatmap.path,
      assetBinnedFeatures: assetHeatmap.featureCount,
      variants: heatmapVariants.length,
      defaultVariant: heatmapManifest.defaultVariant,
    },
    caveats: [
      'Supplemental point layers were copied from the local Walkability reconstruction folder and are not part of the strict web-only score unless a supplemented variant explicitly says so.',
      'Original reconstruction GeoJSON asset layers use EPSG:26910, so this import joins CSV attributes to existing repo WGS84 CityPG geometry instead of copying those line GeoJSONs directly.',
    ],
  }

  await writeFile(`${SUPPLEMENTAL_OUTPUT}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Imported ${copiedGeojson.length} supplemental GeoJSON layers and joined ${joinedAssets.joinedFeatures} assets`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
