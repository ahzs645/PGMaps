import fs from 'node:fs/promises'
import path from 'node:path'
import shp from 'shpjs'

import {
  HMS_DENSITY_COLORS,
  SMOKE_FALLBACK_DATA,
  type SmokeFeatureCollection,
  type SmokeLayerDataMap,
  type SmokeLayerKey,
} from '../lib/smokeLayers'

const AQMAP_ORIGIN = 'https://aqmap.ca/aqmap'

const LOCAL_PATHS: Record<SmokeLayerKey, string[]> = {
  modelledSmoke: [
    path.resolve(process.cwd(), 'public', 'airdatamap', 'data', 'smoke', 'modelled.json'),
    path.resolve(process.cwd(), 'public', 'data', 'smoke', 'modelled.json'),
  ],
  visibleSmoke: [
    path.resolve(process.cwd(), 'public', 'airdatamap', 'data', 'smoke', 'visible.json'),
    path.resolve(process.cwd(), 'public', 'data', 'smoke', 'visible.json'),
  ],
}

const REMOTE_PATHS: Record<SmokeLayerKey, string> = {
  modelledSmoke: `${AQMAP_ORIGIN}/data/smoke/modelled/geojson`,
  visibleSmoke: `${AQMAP_ORIGIN}/data/smoke/visible/geojson`,
}

const HMS_SMOKE_BASE_URL = 'https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/Shapefile'
const VISIBLE_SMOKE_CACHE_TTL_MS = 10 * 60 * 1000
let visibleSmokeCache: { expiresAt: number; data: SmokeFeatureCollection } | null = null

const EER_SMOKE_BASE_URL = 'https://eer.cmc.ec.gc.ca/mandats/AutoSim/Fire'
const MODELLED_SMOKE_CACHE_TTL_MS = 10 * 60 * 1000
let modelledSmokeCache: { expiresAt: number; data: SmokeFeatureCollection } | null = null

type EerFeatureCollection = GeoJSON.FeatureCollection & { fileName?: string }

const EER_PM25_COLORS = [
  { min: 5, color: '#DEDEDE' },
  { min: 10, color: '#BBBBBB' },
  { min: 25, color: '#B1E7FF' },
  { min: 35, color: '#5AB0FF' },
  { min: 50, color: '#BDFF7B' },
  { min: 75, color: '#5ADE5A' },
  { min: 100, color: '#FFFF5A' },
  { min: 200, color: '#FFAC5A' },
  { min: 300, color: '#C48F5A' },
  { min: 500, color: '#FFA7FF' },
] as const

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isFeatureCollection(value: unknown): value is SmokeFeatureCollection {
  if (!isPlainObject(value)) return false
  if (value.type !== 'FeatureCollection') return false
  return Array.isArray(value.features)
}

function toFeatureCollection(value: unknown): SmokeFeatureCollection | null {
  if (isFeatureCollection(value)) return value
  return null
}

function normalizeCollection(value: unknown): SmokeFeatureCollection | null {
  if (!isPlainObject(value)) return null
  return toFeatureCollection(value.data)
}

async function loadJsonFromText(text: string): Promise<SmokeFeatureCollection | null> {
  try {
    const parsed = JSON.parse(text)
    return toFeatureCollection(parsed) ?? normalizeCollection(parsed) ?? null
  } catch {
    return null
  }
}

async function readLocalSmokeData(key: SmokeLayerKey): Promise<SmokeFeatureCollection | null> {
  const candidates = LOCAL_PATHS[key]
  for (const localPath of candidates) {
    try {
      const text = await fs.readFile(localPath, 'utf8')
      const parsed = await loadJsonFromText(text)
      if (parsed) return parsed
    } catch {
      // Try next location.
    }
  }

  return null
}

async function fetchRemoteSmokeData(key: SmokeLayerKey): Promise<SmokeFeatureCollection | null> {
  try {
    const response = await fetch(REMOTE_PATHS[key])
    if (!response.ok) return null
    const text = await response.text()
    return loadJsonFromText(text)
  } catch {
    return null
  }
}

function vancouverDateParts(date: Date): { year: string; month: string; day: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Vancouver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const getPart = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return {
    year: getPart('year'),
    month: getPart('month'),
    day: getPart('day'),
  }
}

function hmsSmokeZipUrl(date: Date): string {
  const { year, month, day } = vancouverDateParts(date)
  return `${HMS_SMOKE_BASE_URL}/${year}/${month}/hms_smoke${year}${month}${day}.zip`
}

function normalizeHmsDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const match = value.match(/^(\d{4})(\d{3})\s+(\d{2})(\d{2})$/)
  if (!match) return value

  const [, year, dayOfYear, hour, minute] = match
  const date = new Date(Date.UTC(Number(year), 0, Number(dayOfYear), Number(hour), Number(minute)))
  return Number.isNaN(date.getTime()) ? value : date.toISOString()
}

function normalizeVisibleSmokeCollection(collection: GeoJSON.FeatureCollection): SmokeFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: collection.features
      .filter((feature) => feature.geometry)
      .map((feature) => {
        const properties = isPlainObject(feature.properties) ? feature.properties : {}
        const density = typeof properties.Density === 'string'
          ? properties.Density
          : typeof properties.density === 'string'
            ? properties.density
            : ''
        const start = normalizeHmsDate(properties.Start)
        const end = normalizeHmsDate(properties.End)
        const period = start && end ? `${start}/${end}` : undefined

        return {
          type: 'Feature',
          geometry: feature.geometry,
          properties: {
            ...properties,
            satellite: properties.Satellite,
            start,
            end,
            period,
            density,
            fill: HMS_DENSITY_COLORS[density] ?? HMS_DENSITY_COLORS.Medium,
          },
        }
      }),
  }
}

async function fetchNoaaVisibleSmokeData(): Promise<SmokeFeatureCollection | null> {
  if (visibleSmokeCache && visibleSmokeCache.expiresAt > Date.now()) {
    return visibleSmokeCache.data
  }

  const candidateDates = [
    new Date(),
    new Date(Date.now() - 24 * 60 * 60 * 1000),
  ]

  for (const date of candidateDates) {
    try {
      const response = await fetch(hmsSmokeZipUrl(date))
      if (!response.ok) continue

      const parsed = await shp(await response.arrayBuffer())
      const collection = Array.isArray(parsed) ? parsed[0] : parsed
      if (!collection || collection.type !== 'FeatureCollection' || collection.features.length === 0) continue

      const normalized = normalizeVisibleSmokeCollection(collection)
      visibleSmokeCache = {
        data: normalized,
        expiresAt: Date.now() + VISIBLE_SMOKE_CACHE_TTL_MS,
      }
      return normalized
    } catch {
      // Try the next HMS date candidate, then fall back to static sample data.
    }
  }

  return null
}

function utcStartOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function floorUtcHours(date: Date, hours: number): Date {
  const intervalMs = hours * 60 * 60 * 1000
  return new Date(Math.floor(date.getTime() / intervalMs) * intervalMs)
}

function eerSmokeZipUrl(modelRun: Date, region = 'Canada'): string {
  const runHour = String(modelRun.getUTCHours()).padStart(2, '0')
  const runDirectory = modelRun >= utcStartOfDay(new Date())
    ? 'latest'
    : `${modelRun.getUTCFullYear()}${String(modelRun.getUTCMonth() + 1).padStart(2, '0')}${String(modelRun.getUTCDate()).padStart(2, '0')}.${runHour}00`
  return `${EER_SMOKE_BASE_URL}/${runHour}UTC/Canada/${runDirectory}/shp/shp_${region}.zip`
}

function parseEerForecastTime(value: unknown, fallbackName?: string): Date | null {
  if (typeof value === 'string') {
    const date = new Date(`${value.replace(' ', 'T')}Z`)
    if (!Number.isNaN(date.getTime())) return date
  }

  const match = fallbackName?.match(/(\d{4})(\d{2})(\d{2})-(\d{2})00/)
  if (!match) return null

  const [, year, month, day, hour] = match
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour)))
  return Number.isNaN(date.getTime()) ? null : date
}

function eerPm25Color(value: unknown): string {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return EER_PM25_COLORS[0].color
  return [...EER_PM25_COLORS].reverse().find((band) => numeric >= band.min)?.color ?? EER_PM25_COLORS[0].color
}

function closeRing(coordinates: GeoJSON.Position[]): GeoJSON.Position[] | null {
  if (coordinates.length < 4) return null

  const first = coordinates[0]
  const last = coordinates[coordinates.length - 1]
  if (first[0] === last[0] && first[1] === last[1]) return coordinates
  return [...coordinates, first]
}

function eerGeometryToPolygon(geometry: GeoJSON.Geometry | null): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  if (!geometry) return null

  if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') return geometry

  if (geometry.type === 'LineString') {
    const ring = closeRing(geometry.coordinates)
    return ring ? { type: 'Polygon', coordinates: [ring] } : null
  }

  if (geometry.type === 'MultiLineString') {
    const polygons = geometry.coordinates
      .map((line) => closeRing(line))
      .filter((ring): ring is GeoJSON.Position[] => Boolean(ring))
      .map((ring) => [ring])

    if (polygons.length === 0) return null
    return polygons.length === 1
      ? { type: 'Polygon', coordinates: polygons[0] }
      : { type: 'MultiPolygon', coordinates: polygons }
  }

  return null
}

function selectEerCollection(parsed: EerFeatureCollection | EerFeatureCollection[], selectTime: Date): EerFeatureCollection | null {
  const collections = (Array.isArray(parsed) ? parsed : [parsed])
    .filter((collection) => collection.type === 'FeatureCollection' && collection.features.length > 0)
    .map((collection) => {
      const properties = isPlainObject(collection.features[0]?.properties) ? collection.features[0].properties : {}
      const forecastTime = parseEerForecastTime(properties.DateTime, collection.fileName)
      return { collection, forecastTime }
    })
    .filter((entry): entry is { collection: GeoJSON.FeatureCollection; forecastTime: Date } => Boolean(entry.forecastTime))
    .sort((left, right) => left.forecastTime.getTime() - right.forecastTime.getTime())

  if (collections.length === 0) return null

  const target = selectTime.getTime()
  return (
    collections.find((entry) => entry.forecastTime.getTime() === target)
    ?? collections.find((entry) => entry.forecastTime.getTime() > target)
    ?? collections.at(-1)
  )?.collection ?? null
}

function normalizeEerSmokeCollection(
  collection: EerFeatureCollection,
  modelRun: Date,
  selectTime: Date,
): SmokeFeatureCollection {
  const features: SmokeFeatureCollection['features'] = []

  for (const feature of collection.features) {
    const properties = isPlainObject(feature.properties) ? feature.properties : {}
    const minPm25 = Number(properties.Interval)
    const forecastTime = parseEerForecastTime(properties.DateTime, collection.fileName) ?? selectTime
    const geometry = eerGeometryToPolygon(feature.geometry)
    if (!geometry) continue

    features.push({
      type: 'Feature',
      geometry,
      properties: {
        ...properties,
        region: 'Canada',
        modelTime: modelRun.toISOString(),
        forecastTime: forecastTime.toISOString(),
        minPm25: Number.isFinite(minPm25) ? minPm25 : undefined,
        altitude: properties.Height,
        fill: eerPm25Color(properties.Interval),
      },
    })
  }

  return {
    type: 'FeatureCollection',
    features,
  }
}

async function fetchEcccModelledSmokeData(): Promise<SmokeFeatureCollection | null> {
  if (modelledSmokeCache && modelledSmokeCache.expiresAt > Date.now()) {
    return modelledSmokeCache.data
  }

  const selectTime = floorUtcHours(new Date(), 1)
  const latestModelRun = floorUtcHours(selectTime, 6)
  const candidateModelRuns = [
    latestModelRun,
    new Date(latestModelRun.getTime() - 6 * 60 * 60 * 1000),
  ]

  for (const modelRun of candidateModelRuns) {
    try {
      const response = await fetch(eerSmokeZipUrl(modelRun))
      if (!response.ok) continue

      const parsed = await shp(await response.arrayBuffer()) as EerFeatureCollection | EerFeatureCollection[]
      const collection = selectEerCollection(parsed, selectTime)
      if (!collection) continue

      const normalized = normalizeEerSmokeCollection(collection, modelRun, selectTime)
      if (normalized.features.length === 0) continue

      modelledSmokeCache = {
        data: normalized,
        expiresAt: Date.now() + MODELLED_SMOKE_CACHE_TTL_MS,
      }
      return normalized
    } catch {
      // Try the previous EER run, then fall back to static sample data.
    }
  }

  return null
}

export async function loadSmokeLayerData(key: SmokeLayerKey): Promise<SmokeFeatureCollection> {
  const local = await readLocalSmokeData(key)
  if (local) return local

  const remote = await fetchRemoteSmokeData(key)
  if (remote) return remote

  if (key === 'modelledSmoke') {
    const eer = await fetchEcccModelledSmokeData()
    if (eer) return eer
  }

  if (key === 'visibleSmoke') {
    const noaa = await fetchNoaaVisibleSmokeData()
    if (noaa) return noaa
  }

  return SMOKE_FALLBACK_DATA[key]
}

export async function loadAllSmokeLayerData(): Promise<SmokeLayerDataMap> {
  const modelledSmoke = await loadSmokeLayerData('modelledSmoke')
  const visibleSmoke = await loadSmokeLayerData('visibleSmoke')

  return {
    modelledSmoke,
    visibleSmoke,
  }
}
