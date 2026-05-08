import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as turf from '@turf/turf'

const OUTPUT_DIR = 'public/data/walkability'
const OUTPUT_GEOJSON = `${OUTPUT_DIR}/community_walkability.geojson`
const OUTPUT_MANIFEST = `${OUTPUT_DIR}/manifest.json`

const SOURCES = {
  communities: {
    label: 'CityPG community boundaries',
    url: 'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/Community_Information/FeatureServer/1',
    path: 'public/data/citypg/community_boundaries.geojson',
  },
  sidewalks: {
    label: 'CityPG sidewalks',
    url: 'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/Transportation_Infrastructure/FeatureServer/0',
    path: 'public/data/citypg/sidewalks.geojson',
  },
  walkways: {
    label: 'CityPG walkways',
    url: 'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/Transportation_Infrastructure/FeatureServer/1',
    path: 'public/data/citypg/walkways.geojson',
  },
  intersections: {
    label: 'CityPG road intersections',
    url: 'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/Transportation_Infrastructure/MapServer/8',
    path: 'public/data/citypg/road_intersections.geojson',
  },
  transitStops: {
    label: 'CityPG transit bus stops',
    url: 'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/Transit_Features/MapServer/0',
    path: 'public/data/citypg/transit_bus_stops.geojson',
  },
  parkFacilities: {
    label: 'CityPG park facilities',
    url: 'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/Parks/FeatureServer/19',
    path: 'public/data/citypg/parks_facilities.geojson',
  },
  parkPlayingAreas: {
    label: 'CityPG park playing areas',
    url: 'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/Parks/FeatureServer/20',
    path: 'public/data/citypg/parks_playing_areas.geojson',
  },
  pedestrianCrashes: {
    label: 'ICBC pedestrian crash locations',
    url: 'https://public.tableau.com/app/profile/icbc/viz/LowerMainlandCrashes/LMDashboard',
    path: 'public/data/icbc/prince_george_pedestrian_crashes.geojson',
  },
}

const VARIANTS = [
  {
    id: 'balanced',
    label: 'Balanced walkability',
    description: 'Infrastructure, destinations, transit, intersections, and pedestrian-safety burden.',
    weights: {
      sidewalkDensity: 0.24,
      walkwayDensity: 0.14,
      intersectionDensity: 0.18,
      transitStopDensity: 0.16,
      parkAmenityDensity: 0.14,
      pedestrianSafety: 0.14,
    },
  },
  {
    id: 'infrastructure',
    label: 'Pedestrian infrastructure',
    description: 'Sidewalk, walkway, and intersection density.',
    weights: {
      sidewalkDensity: 0.5,
      walkwayDensity: 0.25,
      intersectionDensity: 0.25,
    },
  },
  {
    id: 'access',
    label: 'Access to daily movement',
    description: 'Transit stops, parks and recreation amenities, and intersection density.',
    weights: {
      transitStopDensity: 0.35,
      parkAmenityDensity: 0.35,
      intersectionDensity: 0.3,
    },
  },
  {
    id: 'safetyAdjusted',
    label: 'Safety-adjusted walkability',
    description: 'Balanced score with extra penalty for mapped pedestrian crash concentration.',
    weights: {
      sidewalkDensity: 0.22,
      walkwayDensity: 0.12,
      intersectionDensity: 0.14,
      transitStopDensity: 0.14,
      parkAmenityDensity: 0.12,
      pedestrianSafety: 0.26,
    },
  },
]

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

function asFeatureCollection(data) {
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
    throw new Error('Expected a GeoJSON FeatureCollection')
  }
  return data
}

function featurePoint(feature) {
  if (!feature?.geometry) return null
  if (feature.geometry.type === 'Point') return feature
  return turf.centroid(feature)
}

function featureLengthKm(feature) {
  const propertyLength = Number(feature.properties?.Shape__Length)
  if (Number.isFinite(propertyLength) && propertyLength > 0) return propertyLength / 1000
  return turf.length(feature, { units: 'kilometers' })
}

function containsPoint(polygon, point) {
  try {
    return turf.booleanPointInPolygon(point, polygon)
  } catch {
    return false
  }
}

function normalize(values, value, invert = false) {
  const finiteValues = values.filter((item) => Number.isFinite(item))
  if (!finiteValues.length || !Number.isFinite(value)) return 0
  const min = Math.min(...finiteValues)
  const max = Math.max(...finiteValues)
  if (max === min) return 50
  const scaled = ((value - min) / (max - min)) * 100
  return invert ? 100 - scaled : scaled
}

function scoreVariant(normalizedMetrics, variant) {
  let weighted = 0
  let totalWeight = 0
  for (const [metric, weight] of Object.entries(variant.weights)) {
    weighted += (normalizedMetrics[metric] ?? 0) * weight
    totalWeight += weight
  }
  return totalWeight > 0 ? Math.round((weighted / totalWeight) * 10) / 10 : 0
}

function summarizeFeatures(features, communities, callback) {
  const totals = new Map(communities.map((community) => [community.id, 0]))
  for (const feature of features) {
    const point = featurePoint(feature)
    if (!point) continue
    const community = communities.find((candidate) => containsPoint(candidate.feature, point))
    if (!community) continue
    totals.set(community.id, (totals.get(community.id) ?? 0) + callback(feature))
  }
  return totals
}

async function main() {
  const communitiesGeojson = asFeatureCollection(await readJson(SOURCES.communities.path))
  const sidewalks = asFeatureCollection(await readJson(SOURCES.sidewalks.path))
  const walkways = asFeatureCollection(await readJson(SOURCES.walkways.path))
  const intersections = asFeatureCollection(await readJson(SOURCES.intersections.path))
  const transitStops = asFeatureCollection(await readJson(SOURCES.transitStops.path))
  const parkFacilities = asFeatureCollection(await readJson(SOURCES.parkFacilities.path))
  const parkPlayingAreas = asFeatureCollection(await readJson(SOURCES.parkPlayingAreas.path))
  const pedestrianCrashes = asFeatureCollection(await readJson(SOURCES.pedestrianCrashes.path))

  const communities = communitiesGeojson.features
    .filter((feature) => feature.geometry)
    .map((feature, index) => {
      const id = String(feature.properties?.OBJECTID ?? feature.id ?? index)
      return {
        id,
        name: String(feature.properties?.CommunityName ?? `Community ${id}`),
        areaSqKm: turf.area(feature) / 1_000_000,
        feature,
      }
    })

  const sidewalkKm = summarizeFeatures(sidewalks.features, communities, featureLengthKm)
  const walkwayKm = summarizeFeatures(walkways.features, communities, featureLengthKm)
  const intersectionCount = summarizeFeatures(intersections.features, communities, () => 1)
  const transitStopCount = summarizeFeatures(transitStops.features, communities, () => 1)
  const parkAmenityCount = summarizeFeatures([...parkFacilities.features, ...parkPlayingAreas.features], communities, () => 1)
  const pedestrianCrashCount = summarizeFeatures(pedestrianCrashes.features, communities, (feature) => Number(feature.properties?.crashCount) || 0)

  const rawRows = communities.map((community) => {
    const area = community.areaSqKm > 0 ? community.areaSqKm : 1
    return {
      community,
      metrics: {
        sidewalkKm: sidewalkKm.get(community.id) ?? 0,
        walkwayKm: walkwayKm.get(community.id) ?? 0,
        intersectionCount: intersectionCount.get(community.id) ?? 0,
        transitStopCount: transitStopCount.get(community.id) ?? 0,
        parkAmenityCount: parkAmenityCount.get(community.id) ?? 0,
        pedestrianCrashCount: pedestrianCrashCount.get(community.id) ?? 0,
        sidewalkDensity: (sidewalkKm.get(community.id) ?? 0) / area,
        walkwayDensity: (walkwayKm.get(community.id) ?? 0) / area,
        intersectionDensity: (intersectionCount.get(community.id) ?? 0) / area,
        transitStopDensity: (transitStopCount.get(community.id) ?? 0) / area,
        parkAmenityDensity: (parkAmenityCount.get(community.id) ?? 0) / area,
        pedestrianCrashDensity: (pedestrianCrashCount.get(community.id) ?? 0) / area,
      },
    }
  })

  const metricValues = {
    sidewalkDensity: rawRows.map((row) => row.metrics.sidewalkDensity),
    walkwayDensity: rawRows.map((row) => row.metrics.walkwayDensity),
    intersectionDensity: rawRows.map((row) => row.metrics.intersectionDensity),
    transitStopDensity: rawRows.map((row) => row.metrics.transitStopDensity),
    parkAmenityDensity: rawRows.map((row) => row.metrics.parkAmenityDensity),
    pedestrianCrashDensity: rawRows.map((row) => row.metrics.pedestrianCrashDensity),
  }

  const output = {
    type: 'FeatureCollection',
    features: rawRows.map((row) => {
      const normalizedMetrics = {
        sidewalkDensity: normalize(metricValues.sidewalkDensity, row.metrics.sidewalkDensity),
        walkwayDensity: normalize(metricValues.walkwayDensity, row.metrics.walkwayDensity),
        intersectionDensity: normalize(metricValues.intersectionDensity, row.metrics.intersectionDensity),
        transitStopDensity: normalize(metricValues.transitStopDensity, row.metrics.transitStopDensity),
        parkAmenityDensity: normalize(metricValues.parkAmenityDensity, row.metrics.parkAmenityDensity),
        pedestrianSafety: normalize(metricValues.pedestrianCrashDensity, row.metrics.pedestrianCrashDensity, true),
      }
      const scores = Object.fromEntries(VARIANTS.map((variant) => [variant.id, scoreVariant(normalizedMetrics, variant)]))

      return {
        ...row.community.feature,
        id: row.community.id,
        properties: {
          ...row.community.feature.properties,
          communityId: row.community.id,
          communityName: row.community.name,
          areaSqKm: Math.round(row.community.areaSqKm * 1000) / 1000,
          ...Object.fromEntries(Object.entries(row.metrics).map(([key, value]) => [key, Math.round(value * 1000) / 1000])),
          ...Object.fromEntries(Object.entries(normalizedMetrics).map(([key, value]) => [`${key}Score`, Math.round(value * 10) / 10])),
          ...Object.fromEntries(Object.entries(scores).map(([key, value]) => [`${key}Score`, value])),
        },
      }
    }),
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    geography: 'City of Prince George community boundaries',
    output: `/${OUTPUT_GEOJSON.replace(/^public\//, '')}`,
    sourcePolicy: 'Web-source-only recalculation from CityPG ArcGIS REST layers and ICBC public crash exports. The 2017 pedestrian-network study extraction is used only to choose variant concepts and proximity-oriented metric families.',
    variants: VARIANTS,
    metrics: [
      { id: 'sidewalkDensity', label: 'Sidewalk km per sq km', direction: 'higherIsBetter' },
      { id: 'walkwayDensity', label: 'Walkway km per sq km', direction: 'higherIsBetter' },
      { id: 'intersectionDensity', label: 'Road intersections per sq km', direction: 'higherIsBetter' },
      { id: 'transitStopDensity', label: 'Transit stops per sq km', direction: 'higherIsBetter' },
      { id: 'parkAmenityDensity', label: 'Park facilities and playing areas per sq km', direction: 'higherIsBetter' },
      { id: 'pedestrianSafety', label: 'Inverse pedestrian crash density', direction: 'lowerCrashDensityIsBetter' },
    ],
    sources: Object.entries(SOURCES).map(([id, source]) => ({ id, label: source.label, url: source.url, localPath: source.path })),
    caveats: [
      'Line lengths are assigned to the community containing each feature centroid, so boundary-crossing features are not split.',
      'Scores are min-max normalized within Prince George communities and are relative local indices, not audited engineering ratings.',
      'Crash counts reflect mapped ICBC summary locations and should be interpreted as reported-location concentration, not exposure-adjusted risk.',
    ],
  }

  await mkdir(path.dirname(OUTPUT_GEOJSON), { recursive: true })
  await writeFile(OUTPUT_GEOJSON, `${JSON.stringify(output)}\n`)
  await writeFile(OUTPUT_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Wrote ${output.features.length} community walkability features to ${OUTPUT_GEOJSON}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
