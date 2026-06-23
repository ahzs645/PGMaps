import { gzip } from 'node:zlib'
import { promisify } from 'node:util'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { bboxClip } from '@turf/turf'

const gzipAsync = promisify(gzip)

const MAX_MERCATOR_LAT = 85.05112878

export function roundCoordinates(coords, decimals) {
  if (typeof coords[0] === 'number') {
    return [Number(coords[0].toFixed(decimals)), Number(coords[1].toFixed(decimals))]
  }
  return coords.map((entry) => roundCoordinates(entry, decimals))
}

function visitPositions(coords, callback) {
  if (typeof coords[0] === 'number') {
    callback(coords)
    return
  }
  for (const entry of coords) visitPositions(entry, callback)
}

export function featureBounds(feature) {
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity

  visitPositions(feature.geometry.coordinates, ([lng, lat]) => {
    west = Math.min(west, lng)
    south = Math.min(south, lat)
    east = Math.max(east, lng)
    north = Math.max(north, lat)
  })

  return { west, south, east, north }
}

function lonToTileX(lng, z) {
  return Math.floor(((lng + 180) / 360) * 2 ** z)
}

function latToTileY(lat, z) {
  const rad = (Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat)) * Math.PI) / 180
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z)
}

function clampTile(value, z) {
  return Math.max(0, Math.min(2 ** z - 1, value))
}

export function tileRangeForBounds(bounds, z) {
  return {
    minX: clampTile(lonToTileX(bounds.west, z), z),
    maxX: clampTile(lonToTileX(bounds.east, z), z),
    minY: clampTile(latToTileY(bounds.north, z), z),
    maxY: clampTile(latToTileY(bounds.south, z), z),
  }
}

function tileKey(z, x, y) {
  return `${z}/${x}/${y}`
}

function tileXToLon(x, z) {
  return (x / 2 ** z) * 360 - 180
}

function tileYToLat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z
  return (180 / Math.PI) * Math.atan(Math.sinh(n))
}

export function tileBounds(z, x, y) {
  return {
    west: tileXToLon(x, z),
    south: tileYToLat(y + 1, z),
    east: tileXToLon(x + 1, z),
    north: tileYToLat(y, z),
  }
}

export function webMercatorTileBounds(z, x, y) {
  const earthRadius = 6378137
  const world = 2 * Math.PI * earthRadius
  const origin = -world / 2
  const tileWorld = world / 2 ** z
  return {
    west: origin + x * tileWorld,
    south: -origin - (y + 1) * tileWorld,
    east: origin + (x + 1) * tileWorld,
    north: -origin - y * tileWorld,
  }
}

function boundsContain(container, bounds) {
  return (
    bounds.west >= container.west &&
    bounds.east <= container.east &&
    bounds.south >= container.south &&
    bounds.north <= container.north
  )
}

function clipFeatureToTile(feature, bounds) {
  try {
    return bboxClip(feature, [bounds.west, bounds.south, bounds.east, bounds.north])
  } catch (error) {
    console.warn(`Could not clip feature to tile: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

function isPosition(position) {
  return Array.isArray(position) && position.length >= 2 && Number.isFinite(position[0]) && Number.isFinite(position[1])
}

function samePosition(a, b) {
  return a[0] === b[0] && a[1] === b[1]
}

function normalizeRing(ring) {
  if (!Array.isArray(ring)) return null
  const positions = ring.filter(isPosition)
  if (positions.length < 3) return null
  const first = positions[0]
  const last = positions[positions.length - 1]
  const closed = samePosition(first, last) ? positions : [...positions, first]
  return closed.length >= 4 ? closed : null
}

function normalizePolygonCoordinates(coordinates) {
  if (!Array.isArray(coordinates)) return null
  const rings = coordinates.map(normalizeRing).filter(Boolean)
  return rings.length > 0 ? rings : null
}

function normalizeTileFeature(feature, coordDecimals) {
  if (!feature?.geometry) return null
  if (feature.geometry.type === 'Polygon') {
    const coordinates = normalizePolygonCoordinates(feature.geometry.coordinates)
    if (!coordinates) return null
    return {
      ...feature,
      geometry: { ...feature.geometry, coordinates: roundCoordinates(coordinates, coordDecimals) },
    }
  }
  if (feature.geometry.type === 'MultiPolygon') {
    const coordinates = feature.geometry.coordinates
      .map(normalizePolygonCoordinates)
      .filter(Boolean)
    if (coordinates.length === 0) return null
    return {
      ...feature,
      geometry: { ...feature.geometry, coordinates: roundCoordinates(coordinates, coordDecimals) },
    }
  }
  return null
}

export async function writeGeoJsonTileSet(collection, outputDir, options) {
  const {
    coordDecimals = 6,
    gzipLevel = 9,
    maxZoom,
    minZoom,
    note = 'Tiles are gzip GeoJSON clipped to Web Mercator tile bounds.',
  } = options
  await rm(outputDir, { recursive: true, force: true })

  const tiles = new Map()
  const tileBoundsByKey = new Map()
  const featureEntries = collection.features
    .filter((feature) => feature?.geometry?.coordinates)
    .map((feature) => ({ feature, bounds: featureBounds(feature) }))

  for (let z = minZoom; z <= maxZoom; z += 1) {
    for (const { feature, bounds } of featureEntries) {
      const range = tileRangeForBounds(bounds, z)
      for (let x = range.minX; x <= range.maxX; x += 1) {
        for (let y = range.minY; y <= range.maxY; y += 1) {
          const key = tileKey(z, x, y)
          let boundsForTile = tileBoundsByKey.get(key)
          if (!boundsForTile) {
            boundsForTile = tileBounds(z, x, y)
            tileBoundsByKey.set(key, boundsForTile)
          }

          const tileFeature = boundsContain(boundsForTile, bounds)
            ? feature
            : clipFeatureToTile(feature, boundsForTile)
          const normalizedFeature = normalizeTileFeature(tileFeature, coordDecimals)
          if (!normalizedFeature) continue

          const tile = tiles.get(key)
          if (tile) tile.push(normalizedFeature)
          else tiles.set(key, [normalizedFeature])
        }
      }
    }
  }

  let rawBytes = 0
  let gzipBytes = 0
  for (const [key, features] of tiles) {
    const tilePath = path.join(outputDir, `${key}.geojson.gz`)
    const body = JSON.stringify({
      type: 'FeatureCollection',
      features,
    })
    const compressed = await gzipAsync(body, { level: gzipLevel })
    rawBytes += body.length
    gzipBytes += compressed.length
    await mkdir(path.dirname(tilePath), { recursive: true })
    await writeFile(tilePath, compressed)
  }

  await writeFile(
    path.join(outputDir, 'manifest.json'),
    JSON.stringify({
      source: collection.properties?.source,
      generatedAt: collection.properties?.generatedAt,
      minZoom,
      maxZoom,
      tileCount: tiles.size,
      note,
    }, null, 2),
  )

  return { tileCount: tiles.size, rawBytes, gzipBytes }
}
