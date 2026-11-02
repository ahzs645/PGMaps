const AIR_ROOT = 'https://www.env.gov.bc.ca/epd/bcairquality/'
const CSV_ROOT = `${AIR_ROOT}aqo/csv/`
const WIDGET_ROOT = 'https://envistaweb.env.gov.bc.ca/aqo/csv/'
export const AIR_SOURCE_REPOSITORY = 'https://github.com/bcgov/air-monitoring-visualization'
export const AIR_RESEARCH_GUIDE = 'https://github.com/ahzs645/PGMaps/blob/main/docs/bc-air-monitoring-integration.md'

export const AIR_STREAMS = {
  stations: {
    title: 'Station inventory and latest pollutant readings',
    source: `${CSV_ROOT}bc_air_monitoring_stations.csv`,
    proposedProduct: '/data/bc/air-quality/latest-stations.geojson',
    identity: 'EMS_ID, with SERIAL_CODE retained for source links',
  },
  aqhiMap: {
    title: 'AQHI observations and forecast periods',
    source: `${CSV_ROOT}AQHIWebMap.csv`,
    proposedProduct: '/data/bc/air-quality/aqhi-areas.geojson',
    identity: 'AQHI_AREA',
  },
  aqhiSummary: {
    title: 'AQHI summary',
    source: `${CSV_ROOT}AQHIWeb.csv`,
    proposedProduct: '/data/bc/air-quality/aqhi-summary.json',
    identity: 'AQHI_AREA',
  },
  history: {
    title: 'Station or AQHI-area history',
    source: `${CSV_ROOT}Hourly_Raw_Air_Data/Station/{stationId}.csv`,
    proposedProduct: '/data/bc/air-quality/history/{stationId}.json',
    identity: 'Station ID and original observation timestamp',
  },
  smithers: {
    title: 'Smithers AQHI widget',
    source: `${WIDGET_ROOT}AQHIWeb-Smithers.csv`,
    proposedProduct: '/data/bc/air-quality/widgets/smithers.json',
    identity: 'AQHI_AREA',
  },
  kamloops: {
    title: 'Kamloops AQHI widget',
    source: `${WIDGET_ROOT}AQHIWeb-Kamloops.csv`,
    proposedProduct: '/data/bc/air-quality/widgets/kamloops.json',
    identity: 'AQHI_AREA',
  },
  comoxValley: {
    title: 'Comox Valley AQHI widget',
    source: `${WIDGET_ROOT}AQHIWeb-Comox-Valley.csv`,
    proposedProduct: '/data/bc/air-quality/widgets/comox-valley.json',
    identity: 'AQHI_AREA',
  },
} as const

export type AirStreamId = keyof typeof AIR_STREAMS

export interface AirCatalogEntry {
  id: string
  title: string
  description: string
  sourcePath: string
  sourceQuery?: string
  originalViewAvailable?: boolean
  wrapperPath?: string
  streams: AirStreamId[]
  fields: string[]
  period: string
  recreation: string
}

type PollutantMap = [id: string, title: string, sourceName: string, wrapperName: string, field: string, period: string]

const pollutantMaps: PollutantMap[] = [
  ['pm25', 'PM2.5 · 1 hour', 'pm25', 'PM25', 'PM25', '1 hour'],
  ['pm25-24hr', 'PM2.5 · 24 hours', 'pm25-24hr', 'PM25-24hr', 'PM25_24', '24 hours'],
  ['pm10', 'PM10 · 1 hour', 'pm10', 'PM10', 'PM10', '1 hour'],
  ['pm10-24hr', 'PM10 · 24 hours', 'pm10-24hr', 'PM10-24hr', 'PM10_24', '24 hours'],
  ['o3', 'Ozone · 1 hour', 'o3', 'O3', 'O3', '1 hour'],
  ['o3-8hr', 'Ozone · 8 hours', 'o3-8hr', 'O3-8hr', 'O3_8', '8 hours'],
  ['no2', 'Nitrogen dioxide · 1 hour', 'no2', 'NO2', 'NO2', '1 hour'],
  ['so2', 'Sulphur dioxide · 1 hour', 'so2', 'SO2', 'SO2', '1 hour'],
  ['trs', 'Total reduced sulphur · 1 hour', 'trs', 'TRS', 'TRS', '1 hour'],
]

export const AIR_MAPS: AirCatalogEntry[] = [
  {
    id: 'aqhi',
    title: 'Air Quality Health Index',
    description: 'Observed AQHI, four forecast periods, health messages and links to area histories.',
    sourcePath: 'readings/map_aqhi.html',
    wrapperPath: 'readings/find-stations-map.html',
    streams: ['aqhiMap', 'history'],
    fields: ['VALUE', 'VALUE_CHAR', 'FIRST_FORECAST', 'SECOND_FORECAST', 'THIRD_FORECAST', 'FOURTH_FORECAST'],
    period: 'Observed AQHI and forecast periods',
    recreation:
      'Use an AQHI-area point layer with the published health-risk scale, forecast labels and a linked history panel. Keep AQHI areas separate from physical stations.',
  },
  {
    id: 'stations',
    title: 'All air monitoring stations',
    description: 'Station locations, operating status and the available pollutant measurements at each site.',
    sourcePath: 'readings/map_stations.html',
    wrapperPath: 'readings/find-stations-map-ALL.html',
    streams: ['stations', 'history'],
    fields: ['EMS_ID', 'SERIAL_CODE', 'STATION_NAME', 'STATUS', 'LATITUDE', 'LONGITUDE'],
    period: 'Latest available observation per station',
    recreation:
      'Extend the existing PGMaps station layer with all published pollutant fields and units, observation timestamps, source links and a selected-station history panel.',
  },
  ...pollutantMaps.map(
    ([id, title, sourceName, wrapperName, field, period]): AirCatalogEntry => ({
      id,
      title,
      description: `A station map classified by ${field}, with the averaging period preserved.`,
      sourcePath: `readings/map_${sourceName}.html`,
      wrapperPath: `readings/find-stations-map-${wrapperName}.html`,
      streams: ['stations', 'history'],
      fields: [field],
      period,
      recreation:
        'Configure one shared station renderer for this field and period. Read units from the feed, display missing readings explicitly, and review current objectives before reproducing legacy class breaks.',
    }),
  ),
  {
    id: 'northeast',
    title: 'Northeast monitoring stations',
    description: 'A regional view combining the AQHI summary and physical monitoring stations.',
    sourcePath: 'readings/ne-stations-map.html',
    streams: ['aqhiSummary', 'stations', 'history'],
    fields: ['VALUE', 'EMS_ID', 'LATITUDE', 'LONGITUDE'],
    period: 'Latest AQHI and station observations',
    recreation:
      'Reuse the AQHI and station layers with a northeast camera preset. Preserve both source identities and verify the regional extent against the original map.',
  },
]

export const AIR_DATA_VIEWS: AirCatalogEntry[] = [
  {
    id: 'station-graph',
    title: 'Station history graph',
    description: 'Time series for a physical station, with selectable pollutant measurements.',
    sourcePath: 'data/station.html',
    sourceQuery: '?id=E315110',
    streams: ['history', 'aqhiSummary'],
    fields: ['DATE_LOCAL', 'DATE_PST', 'PM25', 'PM10', 'NO2', 'O3', 'SO2'],
    period: 'Source-provided hourly history',
    recreation:
      'Add a chart panel to station selection. Preserve null gaps, units, averaging windows and source timezones.',
  },
  {
    id: 'aqhi-graph',
    title: 'AQHI history graph',
    description: 'AQHI-area history alongside the latest observations and forecast information.',
    sourcePath: 'data/aqhi.html',
    sourceQuery: '?id=AQHI-SMITHERS',
    streams: ['history', 'aqhiMap'],
    fields: ['DATE_LOCAL', 'DATE_PST', 'AQHI_PLUS', 'AQHI_RP', 'AQHI_GP'],
    period: 'Source-provided AQHI history',
    recreation:
      'Use the history panel with a case-sensitive AQHI-area ID discovered from source links and available columns.',
  },
  {
    id: 'aqhi-table',
    title: 'AQHI summary table',
    description: 'Observed AQHI and forecast values in a province-wide table.',
    sourcePath: 'data/aqhi-table.html',
    streams: ['aqhiSummary'],
    fields: ['AQHI_AREA', 'VALUE', 'DATE_PST'],
    period: 'Observed AQHI and forecast periods',
    recreation: 'Provide a sortable table backed by the same normalized AQHI records as the map.',
  },
  ...(
    [
      ['smithers', 'Smithers', 'smithers'],
      ['kamloops', 'Kamloops', 'kamloops'],
      ['comox-valley', 'Comox Valley', 'comoxValley'],
    ] as const
  ).map(
    ([id, title, stream]): AirCatalogEntry => ({
      id: `widget-${id}`,
      title: `${title} AQHI widget`,
      description: 'A compact observation, forecast and health-message card for this AQHI area.',
      sourcePath: `aqhi-widget/${id}.html`,
      originalViewAvailable: false,
      streams: [stream],
      fields: ['AQHI_AREA', 'VALUE', 'VALUE_CHAR', 'DATE_LOCAL', 'DATE_PST'],
      period: 'Observed AQHI and forecast periods',
      recreation:
        'Use a reusable AQHI summary card. Discover forecast columns and labels rather than relying on fixed CSV column positions.',
    }),
  ),
]

export function airSourcePage(path: string): string {
  return `${AIR_ROOT}${path}`
}

/** A reviewable configuration proposal; these products are not connected feeds. */
export function proposedAirStreamConfig(entry: AirCatalogEntry): string {
  return JSON.stringify(
    {
      id: `bc-air-${entry.id}`,
      status: 'proposed',
      ingestion: 'scheduled-csv-snapshot',
      fields: entry.fields,
      averagingPeriod: entry.period,
      sources: entry.streams.map((id) => ({ id, ...AIR_STREAMS[id] })),
    },
    null,
    2,
  )
}
