export type AqmapIconGroup = 'agency' | 'purpleair' | 'aqegg' | 'lcm'

export interface AqmapIconRenderOptions {
  group: string
  rawValue: string | number | null | undefined
  size?: number
  forLegend?: boolean
}

interface ParsedIconRequest {
  group: AqmapIconGroup
  valueText: string
  size: number
}

const DEFAULT_ICON_SIZE = 26

function normalizeGroup(group: string): AqmapIconGroup {
  const normalized = group.trim().toLowerCase()
  if (normalized === 'fem' || normalized === 'agency') return 'agency'
  if (normalized === 'purpleair' || normalized === 'pa' || normalized === 'lcm') return 'purpleair'
  if (normalized === 'aqegg' || normalized === 'egg') return 'aqegg'
  return 'lcm'
}

function parseIconValue(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  const value = typeof raw === 'number' ? raw : Number.parseFloat(String(raw))
  return Number.isFinite(value) ? value : null
}

function makeIconText(raw: string | number | null | undefined): string {
  const value = parseIconValue(raw)
  if (value === null) return '-'
  const rounded = Math.round(value)
  if (rounded < 0) return '-'
  if (rounded > 999) return '+'
  return String(rounded)
}

function parseGeneratedIconText(valueText: string): string {
  if (valueText === '+' || valueText === '-' || valueText === '') return valueText
  const value = Number.parseInt(valueText, 10)
  if (!Number.isFinite(value)) return '-'
  if (value < 0) return '-'
  if (value > 999) return '+'
  return String(value)
}

function fillColor(raw: string | number | null | undefined): string {
  const value = parseIconValue(raw)
  if (value === null) return '#94a3b8'
  if (value < 30) return '#3bb54a'
  if (value < 60) return '#f7d13d'
  if (value < 100) return '#f59e0b'
  return '#c81e1e'
}

function contrastText(fill: string): string {
  const normalized = fill.startsWith('#') ? fill.slice(1) : fill
  const red = Number.parseInt(normalized.slice(0, 2), 16)
  const green = Number.parseInt(normalized.slice(2, 4), 16)
  const blue = Number.parseInt(normalized.slice(4, 6), 16)
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255
  return luminance > 0.58 ? '#010101' : '#ffffff'
}

function shapeElement(group: AqmapIconGroup): string {
  if (group === 'agency') {
    return '<polygon points="130,18 242,130 130,242 18,130" fill="{fill}" stroke="{stroke}" stroke-width="13" />'
  }
  if (group === 'aqegg') {
    return '<rect x="41.35" y="41.35" width="177.3" height="177.3" fill="{fill}" stroke="{stroke}" stroke-width="13" />'
  }
  return '<circle cx="130" cy="130" r="100" fill="{fill}" stroke="{stroke}" stroke-width="13" />'
}

function fontSizeFor(text: string, forLegend: boolean): number {
  if (forLegend) return 120
  if (text.length <= 1) return 121
  if (text.length === 2) return 103
  return 90
}

function baselineFor(text: string): string {
  return text === '+' ? 'middle' : 'central'
}

export function normalizeIconGroup(group: string): AqmapIconGroup {
  return normalizeGroup(group)
}

export function buildIconText(group: string, rawValue: string | number | null | undefined, forLegend = false): string {
  void group
  const text = makeIconText(rawValue)
  return forLegend ? '' : text
}

export function buildIconUrl(
  group: string,
  rawValue: string | number | null | undefined,
  size = DEFAULT_ICON_SIZE,
): string {
  const iconGroup = normalizeIconGroup(group)
  const iconSize = Number.isFinite(size) && size > 0 ? Math.round(size) : DEFAULT_ICON_SIZE
  const suffix = iconSize === DEFAULT_ICON_SIZE ? '' : `_size${iconSize}`
  return `/icons/${iconGroup}_icon_${buildIconText(iconGroup, rawValue)}${suffix}.svg`
}

export function buildIconSvg(options: AqmapIconRenderOptions): string {
  const group = normalizeIconGroup(options.group)
  const valueText = makeIconText(options.rawValue)
  const markerSize = options.size ?? DEFAULT_ICON_SIZE
  const forLegend = options.forLegend ?? false
  const value = forLegend ? '' : valueText

  const fill = fillColor(options.rawValue)
  const stroke = contrastText(fill)
  const fontSize = fontSizeFor(valueText, forLegend)
  const baseline = baselineFor(valueText)

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${markerSize}" height="${markerSize}" viewBox="0 0 260 260">`,
    shapeElement(group)
      .replace('{fill}', fill)
      .replace('{stroke}', stroke),
    `<text x="130" y="130" text-anchor="middle" dominant-baseline="${baseline}" alignment-baseline="${baseline}" font-size="${fontSize}" fill="${stroke}" font-family="Inter, sans-serif">${value}</text>`,
    '</svg>',
  ].join('')
}

export function parseIconRequest(pathname: string): ParsedIconRequest | null {
  const normalized = decodeURIComponent(pathname)
    .replace(/^\//, '')
    .replace(/^icons\//, '')

  const match = normalized.match(/^([a-z0-9_]+)_icon_([^/]+?)(?:_size(\d+))?\.svg$/i)
  if (!match?.[1] || !match[2]) return null

  const group = normalizeGroup(match[1])
  const parsedSize = Number.parseInt(match[3] || '', 10)

  return {
    group,
    valueText: parseGeneratedIconText(match[2]),
    size: Number.isFinite(parsedSize) && parsedSize > 0 ? parsedSize : DEFAULT_ICON_SIZE,
  }
}

export function renderIconFromPath(pathname: string): { content: Buffer; contentType: string } | null {
  const parsed = parseIconRequest(pathname)
  if (!parsed) return null

  const content = buildIconSvg({
    group: parsed.group,
    rawValue: parsed.valueText,
    size: parsed.size,
  })

  return {
    content: Buffer.from(content),
    contentType: 'image/svg+xml',
  }
}
