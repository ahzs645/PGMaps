/** Direct anonymous reads or an explicitly selected isolated local read gateway. */
import { gatewayRequest, gatewayWrite, getPortalConnectionMode } from './nechakoConnection'
export {
  getPortalConnectionMode,
  setPortalConnectionMode,
  getPortalConnectionStatus,
  connectPortalSession,
  disconnectPortalSession,
  portalDownloadSubmission,
  type SubmissionDownloadMode,
  PORTAL_CONNECTION_EVENT,
  PORTAL_CONNECTION_SETTING,
  type PortalConnectionMode,
  type PortalConnectionStatus,
  type PortalConnectionChangeReason,
} from './nechakoConnection'
export const NECHAKO_PORTAL = 'https://nechakowatershed-portal.ca/'

export type PortalSource = {
  name: string
  type: string
  resource: string
  attributions?: string | null
}
export type WmsLayer = {
  name: string
  title: string
  queryable: boolean
  crs: string[]
  styles: { name: string; title: string }[]
  bounds?: [number, number, number, number]
}
export type WmsCapabilities = {
  layers: WmsLayer[]
  featureInfoFormats: string[]
  mapFormats: string[]
}
export type PortalEnvelope = {
  success?: boolean
  status?: string
  error?: string
  attributes?: unknown
  loggedIn?: boolean
}

export const isWmsSource = (source: PortalSource) => ['capabilities', 'wms'].includes(source.type)

export function checkedPortalAttributes(value: unknown): unknown {
  if (!value || typeof value !== 'object') throw new Error('The portal returned an invalid response.')
  const envelope = value as PortalEnvelope
  // This server sometimes returns success:true and HTTP 200 for application failures.
  if (envelope.success === false || envelope.error || (envelope.status && envelope.status !== 'success')) {
    throw new Error(envelope.error || `Portal status: ${envelope.status || 'failure'}`)
  }
  if (!('attributes' in envelope)) throw new Error('The portal response has no attributes.')
  return envelope.attributes
}

export async function portalRead(path: string, params?: Record<string, string>, signal?: AbortSignal) {
  if (
    !/^rest\/(?:portal|openmap)\/[a-zA-Z][a-zA-Z0-9_]*\.php$/.test(path) &&
    !/^rest\/portal\/admin\/[a-zA-Z][a-zA-Z0-9]*\.php$/.test(path)
  ) {
    throw new Error('Portal reads require a relative native REST endpoint.')
  }
  if (getPortalConnectionMode() === 'gateway') {
    return checkedPortalAttributes(await gatewayRequest('read', { path, params: params ?? {} }, signal))
  }
  const response = await fetch(new URL(path, NECHAKO_PORTAL), {
    credentials: 'omit',
    // URLSearchParams produces a CORS-safelisted form POST. Do not add X-Requested-With.
    ...(params ? { method: 'POST', body: new URLSearchParams(params) } : {}),
    signal: signal ?? AbortSignal.timeout(60000),
  })
  if (!response.ok) throw new Error(`Portal HTTP ${response.status}`)
  return checkedPortalAttributes(await response.json())
}

/** Called only after a user has reviewed and confirmed a source change in the UI. */
export async function portalWrite(path: string, params: Record<string, string>, signal?: AbortSignal) {
  return checkedPortalAttributes(await gatewayWrite(path, params, signal))
}

/** Read a submission's native layer attributes through server-derived descriptors only. */
export async function portalLayerAttributes(submissionId: number, layerId: number, signal?: AbortSignal) {
  if (getPortalConnectionMode() !== 'gateway')
    throw new Error('Source layer attributes require the local gateway connection.')
  if (![submissionId, layerId].every((id) => Number.isSafeInteger(id) && id > 0 && id <= 2147483647))
    throw new Error('Enter the source submission and layer IDs.')
  return checkedPortalAttributes(
    await gatewayRequest('layer-attributes', { submissionId: String(submissionId), layerId: String(layerId) }, signal),
  )
}

export async function loadPortalSources(signal?: AbortSignal): Promise<PortalSource[]> {
  const catalogues = await Promise.all(
    ['notbase', 'default'].map((mode) => portalRead('rest/openmap/getBaseLayers.php', { mode }, signal)),
  )
  const sources = new Map<string, PortalSource>()
  for (const catalogue of catalogues) {
    if (!Array.isArray(catalogue)) throw new Error('Invalid portal layer catalogue.')
    for (const item of catalogue) {
      if (typeof item?.name !== 'string' || typeof item?.resource !== 'string' || typeof item?.type !== 'string') {
        throw new Error('A portal layer entry is missing its name, resource or type.')
      }
      const url = new URL(item.resource)
      if (url.protocol !== 'https:') continue // The original catalogue includes optional HTTP basemaps.
      if (!sources.has(item.resource)) sources.set(item.resource, item as PortalSource)
    }
  }
  return [...sources.values()].sort((a, b) => a.name.localeCompare(b.name))
}

const direct = (element: Element, name: string) =>
  Array.from(element.children).filter((child) => child.localName === name)
const childText = (element: Element, name: string) => direct(element, name)[0]?.textContent?.trim() ?? ''

/** Retain inherited CRS/queryability/styles/bounds and native named groups. */
export function parseWmsCapabilities(xml: string): WmsCapabilities {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Invalid WMS capabilities XML.')
  if (!['WMS_Capabilities', 'WMT_MS_Capabilities'].includes(doc.documentElement.localName)) {
    throw new Error(`WMS did not return capabilities: ${(doc.documentElement.textContent ?? '').trim().slice(0, 300)}`)
  }
  const layers: WmsLayer[] = []
  const visit = (element: Element, parent: Omit<WmsLayer, 'name' | 'title'>) => {
    const crs = [
      ...new Set([
        ...parent.crs,
        ...['SRS', 'CRS']
          .flatMap((name) => direct(element, name).flatMap((child) => (child.textContent ?? '').trim().split(/\s+/)))
          .filter(Boolean),
      ]),
    ]
    const styles = new Map(parent.styles.map((style) => [style.name, style]))
    direct(element, 'Style').forEach((style) => {
      const name = childText(style, 'Name')
      if (name) styles.set(name, { name, title: childText(style, 'Title') || name })
    })
    let bounds = parent.bounds
    const geo = direct(element, 'EX_GeographicBoundingBox')[0]
    const box = direct(element, 'LatLonBoundingBox')[0]
    const values = geo
      ? ['westBoundLongitude', 'southBoundLatitude', 'eastBoundLongitude', 'northBoundLatitude'].map((name) =>
          Number(childText(geo, name)),
        )
      : box
        ? ['minx', 'miny', 'maxx', 'maxy'].map((name) => Number(box.getAttribute(name)))
        : null
    if (values?.every(Number.isFinite) && values[0] < values[2] && values[1] < values[3]) {
      bounds = values as [number, number, number, number]
    }
    const inherited = {
      crs,
      styles: [...styles.values()],
      bounds,
      queryable: element.hasAttribute('queryable')
        ? ['1', 'true'].includes(element.getAttribute('queryable') ?? '')
        : parent.queryable,
    }
    const name = childText(element, 'Name')
    if (name) layers.push({ ...inherited, name, title: childText(element, 'Title') || name })
    direct(element, 'Layer').forEach((child) => visit(child, inherited))
  }
  const capability = direct(doc.documentElement, 'Capability')[0]
  if (!capability) throw new Error('WMS capabilities contain no Capability element.')
  direct(capability, 'Layer').forEach((layer) => visit(layer, { crs: [], styles: [], queryable: false }))
  const request = direct(capability, 'Request')[0]
  const formats = (name: string) =>
    request
      ? direct(request, name)
          .flatMap((element) => direct(element, 'Format').map((format) => format.textContent?.trim() ?? ''))
          .filter(Boolean)
      : []
  return { layers, mapFormats: formats('GetMap'), featureInfoFormats: formats('GetFeatureInfo') }
}

export async function loadWmsCapabilities(source: PortalSource, signal?: AbortSignal) {
  const response = await fetch(wmsUrl(source.resource, { REQUEST: 'GetCapabilities' }), {
    credentials: 'omit',
    signal: signal ?? AbortSignal.timeout(30000),
  })
  if (!response.ok) throw new Error(`WMS HTTP ${response.status}`)
  return parseWmsCapabilities(await response.text())
}

export function wmsUrl(resource: string, params: Record<string, string>): string {
  const url = new URL(resource)
  // Remove case variants to avoid conflicting service/version/request parameters.
  for (const key of [...url.searchParams.keys()]) {
    if (
      ['service', 'version', 'request', ...Object.keys(params).map((name) => name.toLowerCase())].includes(
        key.toLowerCase(),
      )
    )
      url.searchParams.delete(key)
  }
  Object.entries({ SERVICE: 'WMS', VERSION: '1.1.1', ...params }).forEach(([key, value]) =>
    url.searchParams.set(key, value),
  )
  return url.toString()
}

export function wmsTiles(resource: string, layer: string, style = '') {
  return wmsUrl(resource, {
    REQUEST: 'GetMap',
    LAYERS: layer,
    STYLES: style,
    FORMAT: 'image/png',
    TRANSPARENT: 'TRUE',
    SRS: 'EPSG:3857',
    WIDTH: '256',
    HEIGHT: '256',
    BBOX: '{bbox-epsg-3857}',
  }).replace('%7Bbbox-epsg-3857%7D', '{bbox-epsg-3857}')
}

export function wmsLegend(resource: string, layer: string, style = '') {
  return wmsUrl(resource, { REQUEST: 'GetLegendGraphic', LAYER: layer, STYLE: style, FORMAT: 'image/png' })
}

export type SearchTree = { token: string; value?: string; left?: SearchTree; right?: SearchTree }
type Token = { kind: string; value: string }

/** Match the portal's expression tree; reject incomplete expressions before requesting. */
export function parsePortalSearch(input: string): SearchTree {
  let remaining = input.trim()
  const tokens: Token[] = []
  const rules: [string, RegExp][] = [
    ['open', /^\(/],
    ['close', /^\)/],
    ['not', /^!/],
    ['and', /^(?:and(?=$|\)|\[|\s)|&)/i],
    ['or', /^(?:or(?=$|\)|\[|\s)|\|)/i],
    ['comparator', /^(?:<=|>=|[=<>~])/],
    ['tru', /^true/i],
    ['fals', /^false/i],
    ['column', /^\{[^}]*\}/],
    ['number', /^[0-9]+(?:\.[0-9]+)?/],
    ['string', /^"[^"]*"/],
    ['keyword', /^[^\s(){}"!<>=~&|]+/],
  ]
  while (remaining) {
    const rule = rules.find(([, pattern]) => pattern.test(remaining))
    if (!rule) throw new Error(`Unrecognized search syntax near ${remaining.slice(0, 30)}`)
    const match = remaining.match(rule[1])![0]
    tokens.push({
      kind: rule[0],
      value: (['string', 'column'].includes(rule[0]) ? match.slice(1, -1) : match).replace(/'/g, "''"),
    })
    remaining = remaining.slice(match.length).trim()
  }
  let cursor = 0
  const peek = () => tokens[cursor]?.kind
  const take = (): Token => {
    if (!tokens[cursor]) throw new Error('The search expression is incomplete.')
    return tokens[cursor++]
  }
  const literal = (): SearchTree => {
    const token = take()
    if (!['string', 'number', 'keyword', 'tru', 'fals', 'column'].includes(token.kind))
      throw new Error(`Expected a search term, found ${token.value}.`)
    return { token: token.kind, value: token.value }
  }
  const term = (): SearchTree => {
    if (peek() === 'open') {
      take()
      const tree = or()
      if (take().kind !== 'close') throw new Error('Close the search parentheses.')
      return tree
    }
    const left = literal()
    const negate = peek() === 'not'
    if (negate) take()
    if (peek() !== 'comparator') {
      if (negate) throw new Error('Use ! before a comparison operator, for example {Status} != "Draft".')
      if (left.token === 'column') throw new Error('Compare a column to a value.')
      return left
    }
    const operator = take().value
    const right = literal()
    if ((left.token === 'column') === (right.token === 'column'))
      throw new Error('A comparison needs one column and one value.')
    const column = left.token === 'column' ? left : right
    const value = left.token === 'column' ? right : left
    if (column.value === 'date' || column.value === 'time') {
      const date = Date.parse(value.value ?? '')
      if (!Number.isFinite(date)) throw new Error('Compare date/time columns to a valid quoted date.')
      value.value = new Date(date).toISOString().replace(/[TZ]/g, ' ').trim()
    }
    return { token: 'comparator', value: (negate ? '!' : '') + operator, left, right }
  }
  const and = (): SearchTree => {
    let tree = term()
    while (peek() === 'and') {
      take()
      tree = { token: 'AND', left: tree, right: term() }
    }
    return tree
  }
  const or = (): SearchTree => {
    let tree = and()
    while (peek() && peek() !== 'close') {
      if (peek() === 'or') take()
      tree = { token: 'OR', left: tree, right: and() }
    }
    return tree
  }
  if (!tokens.length) throw new Error('Enter a search expression.')
  const tree = or()
  if (cursor !== tokens.length) throw new Error('Unexpected closing parenthesis.')
  return tree
}

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
