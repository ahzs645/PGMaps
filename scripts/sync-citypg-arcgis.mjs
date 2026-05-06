import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const DATASETS = [
  {
    name: 'Park trees',
    url: 'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/Parks/FeatureServer/0',
    output: 'public/data/citypg/parks_trees.geojson',
  },
  {
    name: 'Park sport structures',
    url: 'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/Parks/FeatureServer/3',
    output: 'public/data/citypg/parks_sport_structures.geojson',
  },
  {
    name: 'Park site amenities',
    url: 'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/Parks/FeatureServer/4',
    output: 'public/data/citypg/parks_site_amenities.geojson',
  },
  {
    name: 'Park public art',
    url: 'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/Parks/FeatureServer/7',
    output: 'public/data/citypg/parks_public_art.geojson',
  },
  {
    name: 'Park playground equipment',
    url: 'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/Parks/FeatureServer/9',
    output: 'public/data/citypg/parks_playground_equipment.geojson',
  },
  {
    name: 'Park pedestrian structures',
    url: 'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/Parks/FeatureServer/14',
    output: 'public/data/citypg/parks_pedestrian_structures.geojson',
  },
  {
    name: 'Park boardwalks',
    url: 'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/Parks/FeatureServer/17',
    output: 'public/data/citypg/parks_boardwalks.geojson',
  },
  {
    name: 'Park facilities',
    url: 'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/Parks/FeatureServer/19',
    output: 'public/data/citypg/parks_facilities.geojson',
  },
  {
    name: 'Park playing areas',
    url: 'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/Parks/FeatureServer/20',
    output: 'public/data/citypg/parks_playing_areas.geojson',
  },
  {
    name: 'Active transportation cycle network',
    url: 'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/Active_Transportation/FeatureServer/1',
    output: 'public/data/citypg/active_transportation_cycle_network.geojson',
  },
  {
    name: 'Active transportation connectors',
    url: 'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/Active_Transportation/FeatureServer/2',
    output: 'public/data/citypg/active_transportation_connectors.geojson',
  },
  {
    name: 'Sidewalks',
    url: 'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/Transportation_Infrastructure/FeatureServer/0',
    output: 'public/data/citypg/sidewalks.geojson',
  },
  {
    name: 'Walkways',
    url: 'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/Transportation_Infrastructure/FeatureServer/1',
    output: 'public/data/citypg/walkways.geojson',
  },
  {
    name: 'Traffic counts',
    url: 'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/Transportation_Infrastructure/FeatureServer/35',
    output: 'public/data/citypg/traffic_counts.geojson',
  },
  {
    name: 'Ecology sensitivity',
    url: 'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/Ecology/FeatureServer/0',
    output: 'public/data/citypg/ecology_sensitivity.geojson',
  },
  {
    name: 'Ecology high conservation value',
    url: 'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/Ecology/FeatureServer/1',
    output: 'public/data/citypg/ecology_high_conservation_value.geojson',
  },
  {
    name: 'Ecology riparian areas',
    url: 'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/Ecology/FeatureServer/3',
    output: 'public/data/citypg/ecology_riparian_areas.geojson',
  },
  {
    name: 'Community boundaries',
    url: 'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/Community_Information/FeatureServer/1',
    output: 'public/data/citypg/community_boundaries.geojson',
  },
  {
    name: 'Subdivision boundaries',
    url: 'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/Community_Information/FeatureServer/2',
    output: 'public/data/citypg/subdivision_boundaries.geojson',
  },
  {
    name: 'Civic facility buildings',
    url: 'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/Community_Information/FeatureServer/0',
    output: 'public/data/citypg/civic_facility_buildings.geojson',
  },
  {
    name: 'Secondary school catchments',
    url: 'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/Community_Information/MapServer/4',
    output: 'public/data/boundaries/CityPG/secondary_school_catchments.geojson',
  },
  {
    name: 'Elementary school catchments',
    url: 'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/Community_Information/MapServer/5',
    output: 'public/data/boundaries/CityPG/elementary_school_catchments.geojson',
  },
  {
    name: 'Transit bus stops',
    url: 'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/Transit_Features/MapServer/0',
    output: 'public/data/citypg/transit_bus_stops.geojson',
  },
  {
    name: 'Road intersections',
    url: 'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/Transportation_Infrastructure/MapServer/8',
    output: 'public/data/citypg/road_intersections.geojson',
  },
  {
    name: 'Snow removal',
    url: 'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/City_Services/FeatureServer/0',
    output: 'public/data/citypg/snow_removal.geojson',
  },
  {
    name: 'Garbage collection zones',
    url: 'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/City_Services/FeatureServer/1',
    output: 'public/data/citypg/garbage_collection_zones.geojson',
  },
  {
    name: 'Outdoor ice rinks',
    url: 'https://gishub.princegeorge.ca/server/rest/services/Hosted/Outdoor_Ice_Rinks_List/FeatureServer/0',
    output: 'public/data/citypg/outdoor_ice_rinks.geojson',
  },
  {
    name: 'Evacuation zones',
    url: 'https://gishub.princegeorge.ca/server/rest/services/Hosted/Evacuation_Zones/FeatureServer/4',
    output: 'public/data/citypg/evacuation_zones.geojson',
  },
  {
    name: 'Business licences',
    url: 'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/PGData/FeatureServer/0',
    output: 'public/data/citypg/business_licences.geojson',
  },
  {
    name: 'OCP 2025 proposed park improvements',
    url: 'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/Official_Community_Plan_2025/FeatureServer/44',
    output: 'public/data/citypg/ocp_2025_proposed_park_improvements.geojson',
  },
  {
    name: 'OCP 2025 cycle and pedestrian proposed network',
    url: 'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/Official_Community_Plan_2025/FeatureServer/42',
    output: 'public/data/citypg/ocp_2025_cycle_pedestrian_network.geojson',
  },
  {
    name: 'OCP 2025 community facilities',
    url: 'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/Official_Community_Plan_2025/FeatureServer/46',
    output: 'public/data/citypg/ocp_2025_community_facilities.geojson',
  },
  {
    name: 'OCP 2025 flood hazard',
    url: 'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/Official_Community_Plan_2025/FeatureServer/51',
    output: 'public/data/citypg/ocp_2025_flood_hazard.geojson',
  },
  {
    name: 'OCP 2025 wildfire development',
    url: 'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/Official_Community_Plan_2025/FeatureServer/48',
    output: 'public/data/citypg/ocp_2025_wildfire_development.geojson',
  },
  {
    name: 'OCP transit system routes',
    url: 'https://services2.arcgis.com/CnkB6jCzAsyli34z/arcgis/rest/services/OpenData_OCPLanduse/FeatureServer/27',
    output: 'public/data/citypg/ocp_transit_system_routes.geojson',
  },
]

const PAGE_SIZE = 2000

function queryUrl(layerUrl, offset) {
  const params = new URLSearchParams({
    where: '1=1',
    outFields: '*',
    outSR: '4326',
    f: 'geojson',
    resultRecordCount: String(PAGE_SIZE),
    resultOffset: String(offset),
  })
  return `${layerUrl}/query?${params.toString()}`
}

async function fetchJson(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`)
  }
  return response.json()
}

async function fetchLayer(dataset) {
  const features = []
  let offset = 0
  let template = null

  while (true) {
    const geojson = await fetchJson(queryUrl(dataset.url, offset))
    if (geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
      throw new Error(`${dataset.name} did not return a GeoJSON FeatureCollection`)
    }

    if (!template) {
      template = {
        ...geojson,
        features,
      }
    }

    features.push(...geojson.features)
    if (!geojson.exceededTransferLimit || geojson.features.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  return template ?? { type: 'FeatureCollection', features }
}

async function main() {
  for (const dataset of DATASETS) {
    const geojson = await fetchLayer(dataset)
    await mkdir(path.dirname(dataset.output), { recursive: true })
    await writeFile(dataset.output, `${JSON.stringify(geojson)}\n`)
    console.log(`${dataset.name}: wrote ${geojson.features.length} features to ${dataset.output}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
