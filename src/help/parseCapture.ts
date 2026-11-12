import { bool, distinct, int, list, object, oneOf, strictObject, type JsonObject } from '../lib/jsonGuards'
import type { Capture } from './ribbonCapture'

// Keep the portable TourKit format's limits and cross-reference checks without a schema runtime.
const limits = {
  maxBytes: 67_108_864,
  maxEvents: 200_000,
  maxSteps: 2000,
  maxAssets: 2000,
  maxDepth: 160,
  maxNodes: 1_000_000,
}
// The preserved replay sanitizer also uses this byte budget for expanded assets.
export { limits as captureLimits }
const assetData =
  /^data:(image\/(?:png|jpeg|webp|gif)|font\/(?:woff|woff2|ttf|otf)|application\/(?:font-woff|font-sfnt)|text\/css);base64,[A-Za-z0-9+/]+={0,2}$/i

function string(value: unknown, label: string, max: number, min = 0): string {
  if (typeof value !== 'string' || value.length < min || value.length > max)
    throw Error(`${label} must contain ${min}–${max} characters.`)
  return value
}

function id(value: unknown, label: string): string {
  const result = string(value, label, 160, 1)
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(result)) throw Error(`${label} is not a valid identifier.`)
  return result
}

function number(value: unknown, label: string, min = 0, max = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw Error(`${label} must be a finite number between ${min} and ${max}.`)
  return value
}

function date(value: unknown, label: string) {
  const result = string(value, label, 100, 1)
  if (
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?Z$/.test(result) ||
    !Number.isFinite(Date.parse(result)) ||
    new Date(result).toISOString().slice(0, 10) !== result.slice(0, 10)
  )
    throw Error(`${label} must be a UTC date and time.`)
}

function optional(source: JsonObject, key: string, check: (value: unknown, label: string) => unknown) {
  if (source[key] !== undefined) check(source[key], key)
}

/** Bound arbitrary rrweb event payloads before walking their typed envelope. Iterative for deep JSON. */
function checkJson(value: unknown, budget: typeof limits) {
  const stack = [{ value, depth: 0 }]
  const encoder = new TextEncoder()
  let nodes = 0
  let bytes = 0
  while (stack.length) {
    const item = stack.pop()!
    if (++nodes > budget.maxNodes) throw Error('Capture contains too many JSON values.')
    if (item.depth > budget.maxDepth) throw Error('Capture JSON nesting is too deep.')
    const current = item.value
    if (typeof current === 'string') bytes += encoder.encode(current).length + 2
    else if (current === null || typeof current === 'boolean') bytes += 5
    else if (typeof current === 'number' && Number.isFinite(current)) bytes += 24
    else if (current && typeof current === 'object') {
      if (!Array.isArray(current) && ![Object.prototype, null].includes(Object.getPrototypeOf(current)))
        throw Error('Capture must contain plain JSON objects.')
      for (const [key, child] of Object.entries(current)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key))
          throw Error('Capture contains an unsafe JSON property.')
        bytes += encoder.encode(key).length + 4
        stack.push({ value: child, depth: item.depth + 1 })
        if (stack.length + nodes > budget.maxNodes) throw Error('Capture contains too many JSON values.')
      }
    } else throw Error('Capture must contain JSON values only.')
    if (bytes > budget.maxBytes) throw Error('Capture exceeds the size limit.')
  }
}

function screenshot(value: unknown) {
  const image = strictObject(value, 'screenshot', [
    'dataUrl',
    'width',
    'height',
    'alt',
    'caption',
    'sourceDataUrl',
    'sourceWidth',
    'sourceHeight',
    'provenance',
  ])
  function png(data: unknown, width: unknown, height: unknown) {
    const url = string(data, 'screenshot dataUrl', 8_000_000)
    int(width, 'screenshot width', 1, 4096)
    int(height, 'screenshot height', 1, 4096)
    if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(url)) throw Error('Screenshot must be an embedded PNG.')
    const bytes = Uint8Array.from(atob(url.slice(22, 66)), (char) => char.charCodeAt(0))
    const header = new DataView(bytes.buffer)
    if (
      bytes.length < 24 ||
      header.getUint32(0) !== 0x89504e47 ||
      header.getUint32(4) !== 0x0d0a1a0a ||
      header.getUint32(12) !== 0x49484452 ||
      header.getUint32(16) !== width ||
      header.getUint32(20) !== height
    )
      throw Error('Screenshot PNG dimensions do not match.')
  }
  png(image.dataUrl, image.width, image.height)
  string(image.alt, 'screenshot alt', 500, 1)
  optional(image, 'caption', (v, l) => string(v, l, 500))
  if (['sourceDataUrl', 'sourceWidth', 'sourceHeight'].some((key) => image[key] !== undefined))
    png(image.sourceDataUrl, image.sourceWidth, image.sourceHeight)
  if (image.provenance !== undefined) {
    const p = strictObject(image.provenance, 'screenshot provenance', [
      'engine',
      'capturedAt',
      'stepFingerprint',
      'reviewedAt',
    ])
    oneOf(p.engine, 'screenshot engine', ['dom', 'native', 'import'])
    date(p.capturedAt, 'screenshot capturedAt')
    optional(p, 'stepFingerprint', (v, l) => string(v, l, 160, 1))
    optional(p, 'reviewedAt', date)
  }
  // The player must never receive the original unredacted screenshot.
  const published = { ...image }
  delete published.sourceDataUrl
  delete published.sourceWidth
  delete published.sourceHeight
  return published
}

export function parseCapture(input: unknown, overrides: Partial<typeof limits> = {}): Capture {
  const budget = { ...limits, ...overrides }
  for (const [key, value] of Object.entries(budget))
    if (!Number.isSafeInteger(value) || value <= 0) throw Error(`Invalid capture limit: ${key}.`)
  let value = input
  if (typeof input === 'string') {
    if (new TextEncoder().encode(input).length > budget.maxBytes) throw Error('Capture exceeds the size limit.')
    try {
      value = JSON.parse(input)
    } catch {
      throw Error('Capture is not valid JSON.')
    }
  }
  checkJson(value, budget)
  const capture = strictObject(value, 'capture', [
    'format',
    'version',
    'id',
    'title',
    'createdAt',
    'updatedAt',
    'engine',
    'viewport',
    'privacy',
    'pages',
    'events',
    'steps',
    'assets',
    'warnings',
  ])
  oneOf(capture.format, 'capture format', ['tourkit-browser-capture'])
  oneOf(capture.version, 'capture version', [1])
  id(capture.id, 'capture id')
  string(capture.title, 'capture title', 300, 1)
  date(capture.createdAt, 'createdAt')
  date(capture.updatedAt, 'updatedAt')
  const engine = strictObject(capture.engine, 'engine', ['name', 'version'])
  oneOf(engine.name, 'engine name', ['rrweb'])
  string(engine.version, 'engine version', 100, 1)
  const viewport = strictObject(capture.viewport, 'viewport', ['width', 'height', 'devicePixelRatio'])
  int(viewport.width, 'viewport width', 1, 16384)
  int(viewport.height, 'viewport height', 1, 16384)
  optional(viewport, 'devicePixelRatio', (v, l) => number(v, l, 0.1, 10))
  const privacy = strictObject(capture.privacy, 'privacy', ['mode', 'notes'])
  oneOf(privacy.mode, 'privacy mode', ['masked', 'reviewed', 'unreviewed'])
  optional(privacy, 'notes', (v, l) => string(v, l, 10000))

  const pages = (capture.pages === undefined ? [] : list(capture.pages, 'pages', 2000)).map((entry) => {
    const page = strictObject(entry, 'page', ['id', 'origin', 'path'])
    id(page.id, 'page id')
    const origin = string(page.origin, 'page origin', 2048)
    const path = string(page.path, 'page path', 4096)
    const url = new URL(origin + path)
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.origin !== origin ||
      url.pathname !== path ||
      !path.startsWith('/') ||
      path.startsWith('//')
    )
      throw Error(`Invalid source page: ${page.id}.`)
    return page
  })
  const pageIds = new Set(pages.map((page) => page.id))
  distinct(
    pages.map((page) => page.id),
    'Duplicate page id.',
  )
  const events = list(capture.events, 'events', budget.maxEvents, 1).map((entry) => {
    const event = strictObject(entry, 'event', ['type', 'timestamp', 'data'])
    int(event.type, 'event type', 0, 6)
    number(event.timestamp, 'event timestamp')
    return event
  })
  let previous = -Infinity
  let fullSnapshot = false
  for (const event of events) {
    if ((event.timestamp as number) < previous) throw Error('Capture events must be ordered by timestamp.')
    previous = event.timestamp as number
    if (event.type === 2) {
      if (!object(event.data, 'full snapshot').node) throw Error('Full snapshot event is missing its document node.')
      fullSnapshot = true
    }
    if (event.type === 5 && event.data && typeof event.data === 'object' && !Array.isArray(event.data)) {
      const data = object(event.data, 'event data')
      if (data.tag === 'tourkit-document' && !pageIds.has(object(data.payload, 'document marker').documentId))
        throw Error('Document marker references an unknown source page.')
    }
  }
  if (!fullSnapshot) throw Error('Capture needs at least one full DOM snapshot.')
  const duration = (events[events.length - 1].timestamp as number) - (events[0].timestamp as number)
  const steps = list(capture.steps, 'steps', budget.maxSteps).map((entry) => {
    const step = {
      ...strictObject(entry, 'step', [
        'id',
        'title',
        'instruction',
        'atMs',
        'afterMs',
        'action',
        'target',
        'sourceDocumentId',
        'screenshot',
        'screenshotAtMs',
        'value',
        'disabled',
      ]),
    }
    id(step.id, 'step id')
    string(step.title, 'step title', 300, 1)
    string(step.instruction, 'step instruction', 20000)
    oneOf(step.action, 'step action', ['click', 'input', 'change', 'scroll', 'navigate', 'continue'])
    number(step.atMs, 'step atMs', 0, duration + 1)
    for (const key of ['afterMs', 'screenshotAtMs']) optional(step, key, (v, l) => number(v, l, 0, duration + 1))
    if (step.afterMs !== undefined && (step.afterMs as number) < (step.atMs as number))
      throw Error(`Result precedes its action: ${step.id}.`)
    optional(step, 'value', (v, l) => string(v, l, 20000))
    optional(step, 'disabled', bool)
    optional(step, 'sourceDocumentId', id)
    let target: JsonObject | undefined
    if (step.target !== undefined) {
      target = strictObject(step.target, 'target', ['nodeId', 'documentId', 'selector', 'label'])
      int(target.nodeId, 'target nodeId', 0, Number.MAX_SAFE_INTEGER)
      optional(target, 'documentId', id)
      optional(target, 'selector', (v, l) => string(v, l, 2000))
      optional(target, 'label', (v, l) => string(v, l, 500))
    }
    for (const documentId of [step.sourceDocumentId, target?.documentId])
      if (documentId !== undefined && !pageIds.has(documentId))
        throw Error(`Unknown source document in step: ${step.id}.`)
    if (step.screenshot !== undefined) step.screenshot = screenshot(step.screenshot)
    return step
  })
  const stepIds = new Set(steps.map((step) => step.id))
  distinct(
    steps.map((step) => step.id),
    'Duplicate step id.',
  )
  const assets = (capture.assets === undefined ? [] : list(capture.assets, 'assets', budget.maxAssets)).map((entry) => {
    const asset = strictObject(entry, 'asset', ['id', 'url', 'mime', 'dataUrl'])
    id(asset.id, 'asset id')
    string(asset.url, 'asset url', 8192, 1)
    string(asset.mime, 'asset mime', 100)
    const data = string(asset.dataUrl, 'asset dataUrl', 16_000_000)
    if (!assetData.test(data) || data.slice(5, data.indexOf(';')) !== asset.mime)
      throw Error(`Asset MIME type does not match its data URL: ${asset.id}.`)
    return asset
  })
  distinct(
    assets.map((asset) => asset.id),
    'Duplicate asset id.',
  )
  distinct(
    assets.map((asset) => asset.url),
    'Duplicate asset URL.',
  )
  for (const entry of list(capture.warnings, 'warnings', 10000)) {
    const warning = strictObject(entry, 'warning', ['code', 'message', 'stepId'])
    id(warning.code, 'warning code')
    string(warning.message, 'warning message', 4000, 1)
    optional(warning, 'stepId', id)
    if (warning.stepId !== undefined && !stepIds.has(warning.stepId))
      throw Error(`Warning references an unknown step: ${warning.stepId}.`)
  }
  return { ...capture, steps } as unknown as Capture
}
