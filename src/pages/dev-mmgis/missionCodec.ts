import type { FeatureCollection, Geometry } from 'geojson'
import { RAMPS, type LayerStyle } from '@/lib/layerStyle'
import { makeLayer, type Camera, type Mission, type MissionLayer } from './model'

export const STORAGE_KEY = 'pgmaps:mmgis:mission:v1'
export const MAX_PROJECT_BYTES = 32 * 1024 * 1024
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Expected a mission object.')
  return v as Record<string, unknown>
}
const text = (v: unknown, max = 200) => {
  if (typeof v !== 'string' || v.length > max) throw new Error('A mission text field is missing or too long.')
  return v
}
const finite = (v: unknown, min: number, max: number) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
    throw new Error('A mission number is outside its allowed range.')
  return v
}
const list = (v: unknown, max: number): unknown[] => {
  if (!Array.isArray(v) || v.length > max) throw new Error('A mission list is missing or exceeds its limit.')
  return v
}
const color = (v: unknown) => {
  const value = text(v, 9)
  if (!/^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) throw new Error('Use hexadecimal layer colors.')
  return value
}
export function httpUrl(value: unknown): string {
  const url = new URL(text(value, 4096))
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Use an HTTP(S) URL without credentials.')
  return url.href
}
function camera(v: unknown): Camera {
  const c = object(v),
    p = list(c.center, 2)
  if (p.length !== 2) throw new Error('A camera needs longitude and latitude.')
  return {
    center: [finite(p[0], -180, 180), finite(p[1], -90, 90)],
    zoom: finite(c.zoom, 0, 22),
    bearing: finite(c.bearing, -360, 360),
    pitch: finite(c.pitch, 0, 80),
  }
}
function style(v: unknown): LayerStyle | null {
  if (v === null || v === undefined) return null
  const s = object(v)
  if (s.type === 'simple') return { type: 'simple', color: color(s.color) }
  const column = text(s.column)
  if (s.type === 'categories')
    return {
      type: 'categories',
      column,
      categories: list(s.categories, 1000).map((v) => {
        const c = object(v)
        return { value: text(c.value, 4096), color: color(c.color) }
      }),
      otherColor: s.otherColor === null ? null : color(s.otherColor),
    }
  if (s.type !== 'range' && s.type !== 'size') throw new Error('Unsupported layer style.')
  const breaks = list(s.breaks, 100).map((v) => finite(v, -1e100, 1e100))
  if (breaks.some((v, i) => i > 0 && v < breaks[i - 1])) throw new Error('Layer breaks must be ordered.')
  if (!['quantile', 'equal-interval'].includes(String(s.classification)))
    throw new Error('Unsupported layer classification.')
  const base = {
    column,
    breaks,
    classification: s.classification as 'quantile' | 'equal-interval',
    min: finite(s.min, -1e100, 1e100),
    max: finite(s.max, -1e100, 1e100),
  }
  if (s.type === 'size') {
    const sizes = list(s.sizes, 101).map((v) => finite(v, 0, 100))
    if (sizes.length !== breaks.length + 1) throw new Error('Sizes must match the layer breaks.')
    return { ...base, type: 'size', color: color(s.color), sizes }
  }
  const colors = list(s.colors, 101).map(color)
  if (colors.length !== breaks.length + 1 || !Object.prototype.hasOwnProperty.call(RAMPS, String(s.ramp)))
    throw new Error('Colors must match the layer breaks.')
  return { ...base, type: 'range', colors, ramp: s.ramp as keyof typeof RAMPS }
}
/** Bound coordinates before they reach the map, including project JSON imports. */
function geometry(v: unknown, depth = 0): Geometry {
  if (depth > 8) throw new Error('Geometry nesting exceeds the supported limit.')
  const g = object(v)
  if (g.type === 'GeometryCollection')
    return { type: 'GeometryCollection', geometries: list(g.geometries, 10000).map((v) => geometry(v, depth + 1)) }
  const levels: Record<string, number> = {
    Point: 0,
    MultiPoint: 1,
    LineString: 1,
    MultiLineString: 2,
    Polygon: 2,
    MultiPolygon: 3,
  }
  if (!Object.prototype.hasOwnProperty.call(levels, String(g.type))) throw new Error('Unsupported geometry type.')
  const walk = (value: unknown, level: number): unknown => {
    const a = list(value, level ? 200000 : 10)
    if (!level) {
      if (a.length < 2) throw new Error('A coordinate needs longitude and latitude.')
      finite(a[0], -180, 180)
      finite(a[1], -90, 90)
      return a.map((v) => finite(v, -1e100, 1e100))
    }
    return a.map((v) => walk(v, level - 1))
  }
  return { type: g.type, coordinates: walk(g.coordinates, levels[String(g.type)]) } as Geometry
}
export function validateCollection(v: unknown): FeatureCollection {
  const c = object(v)
  if (c.type !== 'FeatureCollection') throw new Error('Expected a GeoJSON FeatureCollection.')
  return {
    type: 'FeatureCollection',
    features: list(c.features, 100000).map((v) => {
      const f = object(v)
      if (f.type !== 'Feature') throw new Error('Invalid GeoJSON feature.')
      return {
        type: 'Feature',
        properties: f.properties == null ? {} : object(f.properties),
        geometry: geometry(f.geometry),
        ...(typeof f.id === 'string' || typeof f.id === 'number' ? { id: f.id } : {}),
      }
    }),
  }
}
export function parseMission(value: unknown): Mission {
  const m = object(value)
  if (m.schema !== 'pgmaps-mission-v1') throw new Error('This file is not a PG Maps mission (pgmaps-mission-v1).')
  const ids = new Set<string>()
  const layers: MissionLayer[] = list(m.layers, 100).map((v) => {
    const l = object(v),
      id = text(l.id),
      data = validateCollection(l.data)
    if (!id || ids.has(id)) throw new Error('Layer IDs must be unique.')
    ids.add(id)
    const base = makeLayer(text(l.label), data, text(l.group))
    if (!['point', 'line', 'fill'].includes(String(l.geometry))) throw new Error('Unsupported layer geometry.')
    const filter = l.filter === null ? null : object(l.filter)
    return {
      ...base,
      id,
      geometry: l.geometry as MissionLayer['geometry'],
      style: style(l.style ?? l.stylePreset),
      opacity: finite(l.opacity, 0, 1),
      visible: l.visible === true,
      showInLegend: l.showInLegend === true,
      editable: l.editable === true,
      timeProperty: text(l.timeProperty ?? ''),
      nameKey: typeof l.nameKey === 'string' ? text(l.nameKey) : undefined,
      description: typeof l.description === 'string' ? text(l.description, 10000) : undefined,
      filter: filter
        ? { column: text(filter.column), values: list(filter.values, 10000).map((v) => text(v, 4096)) }
        : null,
    }
  })
  const time = object(m.time),
    start = text(time.start, 10),
    end = text(time.end, 10)
  if (![start, end].every((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v))) || start > end)
    throw new Error('Choose an ordered mission date range.')
  if (!['map', 'split', 'globe'].includes(String(m.view))) throw new Error('Unsupported mission view.')
  return {
    schema: 'pgmaps-mission-v1',
    id: text(m.id),
    name: text(m.name),
    description: text(m.description, 10000),
    layers,
    camera: camera(m.camera),
    view: m.view as Mission['view'],
    terrain: m.terrain === true,
    time: { enabled: time.enabled === true, start, end },
    tiles: list(m.tiles, 20).map((v) => {
      const t = object(v),
        cog = t.cog ? object(t.cog) : null
      return {
        id: text(t.id),
        name: text(t.name),
        tiles: list(t.tiles, 8).map((v) => {
          const url = text(v, 4096)
          httpUrl(url)
          return url
        }),
        visible: t.visible === true,
        opacity: finite(t.opacity, 0, 1),
        attribution: text(t.attribution, 2000),
        ...(cog
          ? {
              cog: {
                url: httpUrl(cog.url),
                service: httpUrl(cog.service).replace(/\/$/, ''),
                band: finite(cog.band, 1, 1024),
              },
            }
          : {}),
      }
    }),
    bookmarks: list(m.bookmarks, 100).map((v) => {
      const b = object(v)
      return { id: text(b.id), name: text(b.name), camera: camera(b.camera) }
    }),
  }
}
export function readMissionJson(json: string): Mission {
  if (new TextEncoder().encode(json).length > MAX_PROJECT_BYTES) throw new Error('Mission files are limited to 32 MB.')
  return parseMission(JSON.parse(json))
}
/** Complete vector workspace, compressed in the link; no server or hidden upload. */
export async function missionLink(mission: Mission): Promise<string> {
  const json = JSON.stringify(mission)
  if (new TextEncoder().encode(json).length > MAX_PROJECT_BYTES)
    throw new Error('Export this large mission as a file instead.')
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
  const encoded = btoa(Array.from(bytes, (v) => String.fromCharCode(v)).join(''))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  if (encoded.length > 30000)
    throw new Error('This mission is too large for a share link. Export the mission file instead.')
  const url = new URL(location.href)
  url.hash = `mission=${encoded}`
  return url.href
}
export async function readMissionLink(hash: string): Promise<Mission | null> {
  if (!hash.startsWith('#mission=')) return null
  const encoded = hash.slice(9)
  if (encoded.length > 30000) throw new Error('This mission link is too large.')
  const bytes = Uint8Array.from(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')), (v) => v.charCodeAt(0))
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_PROJECT_BYTES) throw new Error('This mission link expands beyond 32 MB.')
      chunks.push(value)
    }
  } finally {
    await reader.cancel()
  }
  return readMissionJson(await new Blob(chunks as BlobPart[]).text())
}
