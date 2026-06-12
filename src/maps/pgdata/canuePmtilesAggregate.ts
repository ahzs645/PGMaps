import { useEffect, useState } from 'react'
import { VectorTile } from '@mapbox/vector-tile'
import Pbf from 'pbf'
import { PMTiles } from 'pmtiles'
import type { CanueVariableSelection } from './canueV2'

type BoundaryGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon
type BoundaryFeature = GeoJSON.Feature<BoundaryGeometry>
type BoundaryCollection = GeoJSON.FeatureCollection<BoundaryGeometry>
type TileCoord = { z: number; x: number; y: number }

export interface CanuePmtilesBoundaryResult {
  data: BoundaryCollection
  loading: boolean
  error: string | null
  minValue: number | null
  maxValue: number | null
  validBoundaryCount: number
  matchedFeatureCount: number
  decodedFeatureCount: number
  tileCount: number
  zoom: number | null
  capped: boolean
}

export interface CanuePmtilesBoundaryOptions {
  selection: CanueVariableSelection | null
  boundaries: BoundaryCollection | null
  idField: string
  nameField: string
  enabled: boolean
  maxZoom?: number
  maxTiles?: number
}

interface BoundaryIndexEntry {
  index: number
  id: string
  name: string
  feature: BoundaryFeature
  bbox: [number, number, number, number]
}

const EMPTY_RESULT: CanuePmtilesBoundaryResult = {
  data: { type: 'FeatureCollection', features: [] },
  loading: false,
  error: null,
  minValue: null,
  maxValue: null,
  validBoundaryCount: 0,
  matchedFeatureCount: 0,
  decodedFeatureCount: 0,
  tileCount: 0,
  zoom: null,
  capped: false,
}

function lonLatToTile(lon: number, lat: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat))
  const latRad = clampedLat * Math.PI / 180
  return {
    x: Math.max(0, Math.min(n - 1, Math.floor((lon + 180) / 360 * n))),
    y: Math.max(0, Math.min(n - 1, Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n))),
  }
}

function tileCoverForBbox(bounds: [number, number, number, number], zoom: number): TileCoord[] {
  const [minLon, minLat, maxLon, maxLat] = bounds
  const northwest = lonLatToTile(minLon, maxLat, zoom)
  const southeast = lonLatToTile(maxLon, minLat, zoom)
  const coords: TileCoord[] = []

  for (let x = northwest.x; x <= southeast.x; x += 1) {
    for (let y = northwest.y; y <= southeast.y; y += 1) {
      coords.push({ z: zoom, x, y })
    }
  }

  return coords
}

function buildBoundaryIndex(boundaries: BoundaryCollection, idField: string, nameField: string): BoundaryIndexEntry[] {
  return boundaries.features.filter((feature): feature is BoundaryFeature => Boolean(feature.geometry)).map((feature, index) => ({
    index,
    feature,
    bbox: geometryBbox(feature.geometry),
    id: String(feature.properties?.[idField] ?? feature.id ?? index),
    name: String(feature.properties?.[nameField] ?? feature.properties?.name ?? feature.id ?? index),
  }))
}

function forEachPosition(geometry: GeoJSON.Geometry, visit: (position: GeoJSON.Position) => void) {
  if (geometry.type === 'Point') {
    visit(geometry.coordinates)
  } else if (geometry.type === 'MultiPoint' || geometry.type === 'LineString') {
    geometry.coordinates.forEach(visit)
  } else if (geometry.type === 'MultiLineString' || geometry.type === 'Polygon') {
    geometry.coordinates.flat(1).forEach(visit)
  } else if (geometry.type === 'MultiPolygon') {
    geometry.coordinates.flat(2).forEach(visit)
  } else if (geometry.type === 'GeometryCollection') {
    geometry.geometries.forEach((child) => forEachPosition(child, visit))
  }
}

function geometryBbox(geometry: GeoJSON.Geometry): [number, number, number, number] {
  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity

  forEachPosition(geometry, ([lon, lat]) => {
    minLon = Math.min(minLon, lon)
    minLat = Math.min(minLat, lat)
    maxLon = Math.max(maxLon, lon)
    maxLat = Math.max(maxLat, lat)
  })

  return [minLon, minLat, maxLon, maxLat]
}

function collectionBbox(collection: BoundaryCollection): [number, number, number, number] {
  return collection.features.reduce<[number, number, number, number]>((bounds, feature) => {
    const featureBounds = geometryBbox(feature.geometry)
    return [
      Math.min(bounds[0], featureBounds[0]),
      Math.min(bounds[1], featureBounds[1]),
      Math.max(bounds[2], featureBounds[2]),
      Math.max(bounds[3], featureBounds[3]),
    ]
  }, [Infinity, Infinity, -Infinity, -Infinity])
}

function featureBboxCenter(feature: GeoJSON.Feature): [number, number] {
  if (!feature.geometry) return [NaN, NaN]
  const [minLon, minLat, maxLon, maxLat] = geometryBbox(feature.geometry)
  return [(minLon + maxLon) / 2, (minLat + maxLat) / 2]
}

function pointInRing(point: [number, number], ring: GeoJSON.Position[]): boolean {
  const [x, y] = point
  let inside = false

  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [xi, yi] = ring[index]
    const [xj, yj] = ring[previous]
    const intersects = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || Number.EPSILON) + xi)
    if (intersects) inside = !inside
  }

  return inside
}

function pointInPolygonCoordinates(point: [number, number], polygon: GeoJSON.Position[][]): boolean {
  if (!polygon.length || !pointInRing(point, polygon[0])) return false
  return !polygon.slice(1).some((hole) => pointInRing(point, hole))
}

function pointInBoundary(point: [number, number], geometry: BoundaryGeometry): boolean {
  if (geometry.type === 'Polygon') return pointInPolygonCoordinates(point, geometry.coordinates)
  return geometry.coordinates.some((polygon) => pointInPolygonCoordinates(point, polygon))
}

function findBoundaryForFeature(feature: GeoJSON.Feature, boundaryIndex: BoundaryIndexEntry[]): BoundaryIndexEntry | null {
  const [lon, lat] = featureBboxCenter(feature)
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null

  return boundaryIndex.find((boundary) => {
    const [minLon, minLat, maxLon, maxLat] = boundary.bbox
    if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) return false
    return pointInBoundary([lon, lat], boundary.feature.geometry)
  }) ?? null
}

function chooseZoom(headerMaxZoom: number, requestedMaxZoom: number, boundaryBounds: [number, number, number, number], maxTiles: number) {
  const initialZoom = Math.min(headerMaxZoom, requestedMaxZoom)
  for (let zoom = initialZoom; zoom >= 5; zoom -= 1) {
    const tiles = tileCoverForBbox(boundaryBounds, zoom)
    if (tiles.length <= maxTiles) return { zoom, tiles, capped: zoom !== initialZoom }
  }
  const zoom = 5
  return { zoom, tiles: tileCoverForBbox(boundaryBounds, zoom), capped: true }
}

export function useCanuePmtilesBoundaryData({
  selection,
  boundaries,
  idField,
  nameField,
  enabled,
  maxZoom = 10,
  maxTiles = 320,
}: CanuePmtilesBoundaryOptions): CanuePmtilesBoundaryResult {
  const [result, setResult] = useState<CanuePmtilesBoundaryResult>(EMPTY_RESULT)

  const inactive = !enabled || !selection || !boundaries?.features.length

  useEffect(() => {
    if (!enabled || !selection || !boundaries?.features.length) return

    const controller = new AbortController()
    const activeSelection = selection
    const activeBoundaries = boundaries
    const property = activeSelection.property

    async function load() {
      setResult((current) => ({ ...current, loading: true, error: null }))

      try {
        const boundaryIndex = buildBoundaryIndex(activeBoundaries, idField, nameField)
        if (!boundaryIndex.length) {
          setResult(EMPTY_RESULT)
          return
        }

        const usableBoundaries: BoundaryCollection = {
          type: 'FeatureCollection',
          features: boundaryIndex.map((boundary) => boundary.feature),
        }
        const boundaryBounds = collectionBbox(usableBoundaries)
        const archive = new PMTiles(activeSelection.pmtilesUrl)
        const header = await archive.getHeader()
        const { zoom, tiles, capped } = chooseZoom(header.maxZoom, maxZoom, boundaryBounds, maxTiles)
        const buckets = new Map(boundaryIndex.map((boundary) => [
          boundary.id,
          { boundary, sum: 0, count: 0, min: null as number | null, max: null as number | null },
        ]))
        let decodedFeatureCount = 0
        let matchedFeatureCount = 0

        for (const tile of tiles) {
          if (controller.signal.aborted) return
          const response = await archive.getZxy(tile.z, tile.x, tile.y, controller.signal)
          if (!response?.data) continue
          const vectorTile = new VectorTile(new Pbf(new Uint8Array(response.data)))
          const layer = vectorTile.layers.canue
          if (!layer) continue

          for (let index = 0; index < layer.length; index += 1) {
            const tileFeature = layer.feature(index)
            const value = Number(tileFeature.properties[property])
            if (!Number.isFinite(value)) continue
            decodedFeatureCount += 1
            const geojsonFeature = tileFeature.toGeoJSON(tile.x, tile.y, tile.z)
            const boundary = findBoundaryForFeature(geojsonFeature, boundaryIndex)
            if (!boundary) continue
            const bucket = buckets.get(boundary.id)
            if (!bucket) continue
            matchedFeatureCount += 1
            bucket.sum += value
            bucket.count += 1
            bucket.min = bucket.min == null ? value : Math.min(bucket.min, value)
            bucket.max = bucket.max == null ? value : Math.max(bucket.max, value)
          }
        }

        let minValue: number | null = null
        let maxValue: number | null = null
        let validBoundaryCount = 0
        const features = usableBoundaries.features.map((feature, index) => {
          const boundary = boundaryIndex[index]
          const bucket = boundary ? buckets.get(boundary.id) : null
          const value = bucket && bucket.count > 0 ? bucket.sum / bucket.count : null

          if (value != null) {
            validBoundaryCount += 1
            minValue = minValue == null ? value : Math.min(minValue, value)
            maxValue = maxValue == null ? value : Math.max(maxValue, value)
          }

          return {
            ...feature,
            id: boundary?.id ?? feature.id ?? index,
            properties: {
              ...feature.properties,
              boundaryId: boundary?.id ?? String(feature.id ?? index),
              boundaryName: boundary?.name ?? String(feature.properties?.name ?? feature.id ?? index),
              datasetId: activeSelection.dataset,
              datasetLabel: activeSelection.dataset,
              family: activeSelection.family,
              year: activeSelection.year,
              sourceMode: 'pmtiles-client',
              rowCount: bucket?.count ?? 0,
              [property]: value,
              [`${property}_count`]: bucket?.count ?? 0,
              [`${property}_min`]: bucket?.min ?? null,
              [`${property}_max`]: bucket?.max ?? null,
            },
          }
        })

        setResult({
          data: { type: 'FeatureCollection', features },
          loading: false,
          error: null,
          minValue,
          maxValue,
          validBoundaryCount,
          matchedFeatureCount,
          decodedFeatureCount,
          tileCount: tiles.length,
          zoom,
          capped,
        })
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setResult({
          ...EMPTY_RESULT,
          error: (err as Error).message || 'Unable to aggregate CANUE PMTiles',
        })
      }
    }

    void load()
    return () => controller.abort()
  }, [boundaries, enabled, idField, maxTiles, maxZoom, nameField, selection])

  return inactive ? EMPTY_RESULT : result
}
