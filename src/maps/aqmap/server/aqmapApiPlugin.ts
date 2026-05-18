import fs from 'node:fs/promises'
import path from 'node:path'
import type { ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

import {
  applyNetworkFilter,
  loadRecentMonitorRows,
  sanitizeRecentRows,
  serializeAqmapData,
  type AqmapDataFormat,
  type AqmapMonitorRow,
} from './aqmapDataAdapter'
import { loadAqmapPlotRows, serializePlotData } from './aqmapPlotAdapter'
import { renderIconFromPath } from './aqmapIconAdapter'
import { loadSmokeLayerData } from './aqmapSmokeAdapter'
import type { SmokeLayerKey } from '../lib/smokeLayers'

const AQMAP_ORIGIN = 'https://aqmap.ca/aqmap'

const DATA_TYPES = new Set<AqmapDataFormat>(['json', 'csv', 'tsv', 'geojson'])

type SerializedRoute = {
  rows: AqmapMonitorRow[]
  type: AqmapDataFormat
}

function isSupportedDataType(value: string | undefined): value is AqmapDataFormat {
  return !!value && DATA_TYPES.has(value as AqmapDataFormat)
}

function normalizeAssetType(type: string): AqmapDataFormat {
  if (isSupportedDataType(type)) return type
  return 'json'
}

function sendJsonError(res: ServerResponse, status: number, message: string) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ error: message }))
}

function sendResponse(res: ServerResponse, status: number, body: string | Buffer, contentType: string) {
  res.statusCode = status
  res.setHeader('Content-Type', contentType)
  res.end(body)
}

async function resolveLocalAsset(filePath: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(filePath)
  } catch {
    return null
  }
}

function getContentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.css') return 'text/css; charset=utf-8'
  if (extension === '.js') return 'text/javascript; charset=utf-8'
  if (extension === '.json') return 'application/json; charset=utf-8'
  if (extension === '.svg') return 'image/svg+xml'
  if (extension === '.png') return 'image/png'
  if (extension === '.gif') return 'image/gif'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.html') return 'text/html; charset=utf-8'
  if (extension === '.csv') return 'text/csv; charset=utf-8'
  if (extension === '.tsv') return 'text/tab-separated-values; charset=utf-8'
  return 'application/octet-stream'
}

function mapSmokeLayer(type: string | undefined): SmokeLayerKey | null {
  if (!type) return null
  const normalized = type.toLowerCase()
  if (normalized === 'modelled') return 'modelledSmoke'
  if (normalized === 'visible') return 'visibleSmoke'
  return null
}

async function proxyAsset(res: ServerResponse, remotePath: string): Promise<boolean> {
  try {
    const response = await fetch(`${AQMAP_ORIGIN}${remotePath}`)
    if (!response.ok) return false

    const contentType = response.headers.get('content-type') ?? getContentType(remotePath)
    const buffer = Buffer.from(await response.arrayBuffer())
    sendResponse(res, response.status, buffer, contentType)
    return true
  } catch {
    return false
  }
}

async function serveMapRoute(res: ServerResponse) {
  const mapHtmlPath = path.resolve(process.cwd(), 'public', 'airdatamap', 'index.html')
  try {
    const source = await fs.readFile(mapHtmlPath, 'utf8')
    const adjusted = source
      .replace(/src="\.\/assets\//g, 'src="/airdatamap/assets/')
      .replace(/href="\.\/assets\//g, 'href="/airdatamap/assets/')
    sendResponse(res, 200, adjusted, 'text/html; charset=utf-8')
    return
  } catch {
    const fallback = `<!doctype html><html><body><h1>AQMap</h1><p>map unavailable</p></body></html>`
    sendResponse(res, 200, fallback, 'text/html; charset=utf-8')
  }
}

async function serveRouteAsset(res: ServerResponse, prefix: 'css' | 'js' | 'icons', pathname: string) {
  const relative = pathname.slice(prefix.length + 1)

  if (!relative) {
    sendResponse(
      res,
      200,
      `/* AQMap legacy ${prefix} endpoint */\n`,
      prefix === 'css' ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8',
    )
    return
  }

  const candidatePaths = [
    path.resolve(process.cwd(), 'public', prefix, relative),
    path.resolve(process.cwd(), 'public', 'airdatamap', prefix, relative),
    path.resolve(process.cwd(), 'public', 'airdatamap', 'assets', relative),
  ]

  for (const candidate of candidatePaths) {
    const localData = await resolveLocalAsset(candidate)
    if (localData) {
      sendResponse(res, 200, localData, getContentType(candidate))
      return
    }
  }

  const proxied = await proxyAsset(res, `/${prefix}/${relative}`)
  if (!proxied) {
    sendResponse(res, 404, `${prefix} file not found`, 'text/plain; charset=utf-8')
  }
}

async function handleIconRoute(res: ServerResponse, pathname: string) {
  const rendered = renderIconFromPath(pathname)
  if (rendered) {
    sendResponse(res, 200, rendered.content, rendered.contentType)
    return
  }

  await serveRouteAsset(res, 'icons', pathname)
}

async function handleSmokeRoute(res: ServerResponse, requestPath: string) {
  const normalized = requestPath.replace(/^\/data\/smoke\/?/, '')
  const [rawType, rawFormat] = normalized.split('/').filter(Boolean)

  const layer = mapSmokeLayer(rawType)
  if (!layer) {
    sendJsonError(res, 404, 'Unknown smoke layer')
    return
  }

  const format = rawFormat?.toLowerCase()
  if (format && !['geojson', 'json'].includes(format)) {
    sendJsonError(res, 400, 'Unsupported smoke response format')
    return
  }

  const data = await loadSmokeLayerData(layer)
  const body = JSON.stringify(data)
  const contentType = format === 'json' ? 'application/json; charset=utf-8' : 'application/geo+json; charset=utf-8'
  sendResponse(res, 200, body, contentType)
}

function parseDataRouteParts(parts: string[]) {
  if (!parts.length) return { type: 'json' as AqmapDataFormat }

  const maybeType = parts[parts.length - 1]
  const explicitType = isSupportedDataType(maybeType) ? maybeType : null
  const network = explicitType
    ? parts.length > 1 ? parts[parts.length - 2] : undefined
    : parts[0]

  return {
    network,
    type: explicitType ?? 'json',
  }
}

async function createDataPayload(parts: string[], isMeta = false): Promise<SerializedRoute | null> {
  const rows = await loadRecentMonitorRows()
  const { network, type } = parseDataRouteParts(parts)
  const filteredRows = applyNetworkFilter(rows, network)
  const prepared = sanitizeRecentRows(filteredRows, isMeta ? 'meta' : undefined)

  return { rows: prepared, type }
}

async function handleRecentRoute(res: ServerResponse, requestPath: string) {
  const normalized = requestPath.replace(/^\/data\/recent\/?/, '')
  const parts = normalized.split('/').filter(Boolean)
  const payload = await createDataPayload(parts)
  if (!payload) {
    sendJsonError(res, 400, 'Unable to load monitor data')
    return
  }

  const body = serializeAqmapData(payload.rows, payload.type)
  const contentType = payload.type === 'json'
    ? 'application/json; charset=utf-8'
    : payload.type === 'geojson'
      ? 'application/geo+json; charset=utf-8'
      : payload.type === 'tsv'
        ? 'text/tab-separated-values; charset=utf-8'
        : 'text/csv; charset=utf-8'
  sendResponse(res, 200, body, contentType)
}

async function handleMetaRoute(res: ServerResponse, requestPath: string) {
  const normalized = requestPath.replace(/^\/data\/meta\/?/, '')
  const parts = normalized.split('/').filter(Boolean)
  const payload = await createDataPayload(parts, true)
  if (!payload) {
    sendJsonError(res, 400, 'Unable to load monitor metadata')
    return
  }

  const body = serializeAqmapData(payload.rows, payload.type)
  const contentType = payload.type === 'json'
    ? 'application/json; charset=utf-8'
    : payload.type === 'geojson'
      ? 'application/geo+json; charset=utf-8'
      : payload.type === 'tsv'
        ? 'text/tab-separated-values; charset=utf-8'
        : 'text/csv; charset=utf-8'
  sendResponse(res, 200, body, contentType)
}

async function handlePlotRoute(res: ServerResponse, requestPath: string) {
  const normalized = requestPath.replace(/^\/data\/plotting\/?/, '')
  const [network, siteId, explicitType] = normalized.split('/').filter(Boolean)

  if (!network || !siteId) {
    sendJsonError(res, 400, 'network and site_id are required')
    return
  }

  const type = isSupportedDataType(explicitType) ? explicitType : 'json'
  const points = await loadAqmapPlotRows(network, siteId)
  if (!points || !points.length) {
    sendJsonError(res, 404, 'No plotting data available')
    return
  }

  const body = serializePlotData(points, normalizeAssetType(type))
  const contentType = type === 'json'
    ? 'application/json; charset=utf-8'
    : type === 'tsv'
      ? 'text/tab-separated-values; charset=utf-8'
      : 'text/csv; charset=utf-8'

  sendResponse(res, 200, body, contentType)
}

export function aqmapApiPlugin(): Plugin {
  return {
    name: 'aqmap-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== 'GET') {
          next()
          return
        }

        const pathname = (req.url ?? '').split('?')[0] ?? '/'

        if (pathname === '/map') {
          await serveMapRoute(res)
          return
        }

        if (pathname === '/css' || pathname.startsWith('/css/')) {
          await serveRouteAsset(res, 'css', pathname)
          return
        }

        if (pathname === '/js' || pathname.startsWith('/js/')) {
          await serveRouteAsset(res, 'js', pathname)
          return
        }

        if (pathname === '/icons' || pathname.startsWith('/icons/')) {
          await handleIconRoute(res, pathname)
          return
        }

        if (pathname === '/data/smoke' || pathname === '/data/smoke/' || pathname.startsWith('/data/smoke/')) {
          await handleSmokeRoute(res, pathname)
          return
        }

        if (pathname === '/data/recent' || pathname.startsWith('/data/recent/')) {
          await handleRecentRoute(res, pathname)
          return
        }

        if (pathname === '/data/meta' || pathname.startsWith('/data/meta/')) {
          await handleMetaRoute(res, pathname)
          return
        }

        if (pathname === '/data/plotting' || pathname.startsWith('/data/plotting/')) {
          await handlePlotRoute(res, pathname)
          return
        }

        next()
      })
    },
  }
}
