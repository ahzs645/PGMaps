import type { FeatureCollection, Point } from 'geojson'

import { fetchJson } from '@/lib/fetchJson'
import type { ProjectMapExplorerWorkspaceDef } from '@/lib/projectPackages'

import type {
  ResearchRecord,
  ResearchRecordsLocation,
  ResearchRecordsOverview,
  ResearchRecordsTimelineBucket,
} from './researchRecordsTypes'

type ExplorerData = ProjectMapExplorerWorkspaceDef['data']
type ExplorerRecords = [
  ResearchRecordsOverview,
  ResearchRecord[],
  ResearchRecordsLocation[],
  ResearchRecordsTimelineBucket[],
]
type PinProperties = {
  title: string
  url?: string
  region: string
  tags: string[]
  month?: string
}

export function normalizeGeoJsonPoints(
  collection: FeatureCollection<Point, PinProperties>,
  categories: ExplorerData['categories'],
): ExplorerRecords {
  if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
    throw new Error('This map source must contain a GeoJSON FeatureCollection.')
  }

  const records: ResearchRecord[] = []
  const locations: ResearchRecordsLocation[] = []
  const seen = new Set<string>()
  const categoryIds = new Set(categories.map(({ id }) => id))
  let yearRange: ResearchRecordsOverview['yearRange'] = null

  for (const feature of collection.features) {
    const id = feature?.id
    const properties = feature?.properties
    const position = feature?.geometry?.coordinates
    if (
      feature?.type !== 'Feature' ||
      feature.geometry?.type !== 'Point' ||
      typeof id !== 'string' ||
      !id.trim() ||
      seen.has(id) ||
      typeof properties?.title !== 'string' ||
      !properties.title.trim() ||
      !Array.isArray(position) ||
      position.length < 2 ||
      !Number.isFinite(position[0]) ||
      Math.abs(position[0]) > 180 ||
      !Number.isFinite(position[1]) ||
      Math.abs(position[1]) > 90
    ) {
      throw new Error('This map source contains an invalid or duplicate story pin.')
    }
    seen.add(id)

    const region = categoryIds.has(properties.region) ? properties.region : 'other'
    const tags = Array.isArray(properties.tags) ? properties.tags.filter((tag) => typeof tag === 'string') : []
    const month =
      typeof properties.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(properties.month)
        ? properties.month
        : undefined
    const year = month ? Number(month.slice(0, 4)) : null
    const decade = year === null ? null : Math.floor(year / 10) * 10
    if (year !== null) {
      yearRange = yearRange
        ? { min: Math.min(yearRange.min, year), max: Math.max(yearRange.max, year) }
        : { min: year, max: year }
    }

    records.push({
      id,
      title: properties.title,
      resourceType: region,
      resourceTypeMain: region,
      publicationYear: year,
      decade,
      author: null,
      tags: [
        ...tags.flatMap((tag) => (tag.includes('-') ? [tag, tag.replace(/-/g, ' ')] : [tag])),
        ...(month ? [month] : []),
      ],
      locationIds: [id],
    })
    locations.push({
      id,
      name: properties.title,
      source:
        typeof properties.url === 'string' &&
        URL.canParse(properties.url) &&
        new URL(properties.url).protocol === 'https:'
          ? { url: properties.url, tags, month }
          : undefined,
      coordinates: { lon: position[0], lat: position[1] },
      coordinateSource: null,
      totalPublications: 1,
      byDecade: decade === null ? {} : { [decade]: 1 },
      resourceTypes: { [region]: 1 },
    })
  }

  const count = records.length
  return [
    {
      submissionsTotal: count,
      linkedRowsTotal: count,
      linkedUniquePairs: count,
      submissionsWithLocations: count,
      submissionsWithoutLocations: 0,
      locationsTotal: count,
      locationsWithCoordinates: count,
      yearRange,
    },
    records,
    locations,
    [],
  ]
}

export async function loadGeoJsonPoints(
  data: Extract<ExplorerData, { adapter: 'geojson-points-v1' }>,
  signal: AbortSignal,
) {
  const collection = await fetchJson<FeatureCollection<Point, PinProperties>>(data.url, signal)
  return normalizeGeoJsonPoints(collection, data.categories)
}
