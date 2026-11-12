import { DOMParser } from '@xmldom/xmldom'
import { bool, int, list, object, oneOf, text } from '../lib/jsonGuards'

export type BrandSurface = 'workspace' | 'help' | 'exports'
export type BrandFace = {
  family: string
  weight: number
  style: string
  fallback: string
  renderingFamily?: string
  officialFamily?: string | null
  note?: string
}
export type BrandLogo = { svg: string; viewBox: [number, number, number, number] }
export type BrandProfile = {
  schema: 'brandkit/consumer-profile/1'
  id: string
  name: string
  version: string
  sourceUrl?: string
  colours: Record<'ink' | 'paper' | 'primary' | 'muted' | 'light' | 'reverse' | 'line' | 'rule', string>
  typography: Record<'body' | 'heading' | 'label', BrandFace>
  logos: Record<'primary' | 'black' | 'reverse', BrandLogo>
  provenance: { source: string; status: string }
  identity?: Record<string, unknown> & {
    minimumLogoWidthMm?: number
    logo?: Record<string, unknown> & { clearSpaceRatio?: number }
    clearSpace?: string
  }
  affiliation?: Record<string, unknown> | null
}
export type BrandFont = { family: string; weight: number; style: string; dataUrl: string; file: string }
export type BrandRecord = { key: string; profile: BrandProfile; fonts: BrandFont[]; notices: string[] }
export type BrandSettings = {
  selected: string | null
  workspace: boolean
  help: boolean
  exports: boolean
  typography: boolean
  pdfFonts: boolean
}
export const defaultBrandSettings: BrandSettings = {
  selected: null,
  workspace: true,
  help: true,
  exports: true,
  typography: true,
  pdfFonts: false,
}
export type ExportBrand = { brand: BrandRecord; typography: boolean; pdfFonts: boolean }
export const MAX_BRAND_BYTES = 8 * 1024 * 1024

/** A passive geometry subset shared by browser images, offline HTML and the PDF renderer. */
export function parseLogo(input: unknown): BrandLogo {
  const value = object(input, 'logo')
  const svg = text(value.svg, 'logo SVG', 1_000_000)
  if (/<!|<\?|&(?:#|[a-z])/i.test(svg.replace(/&(amp|lt|gt|quot|apos);/g, '')))
    throw Error('Logo SVG cannot contain declarations or custom entities.')
  const box = list(value.viewBox, 'logo viewBox', 4, 4)
  if (
    box.some((n) => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 1e7) ||
    (box[2] as number) <= 0 ||
    (box[3] as number) <= 0
  )
    throw Error('Logo viewBox is invalid.')
  const errors: string[] = []
  const doc = new DOMParser({ onError: (_level, message) => errors.push(message) }).parseFromString(
    svg,
    'image/svg+xml',
  )
  if (errors.length || doc.documentElement?.tagName !== 'svg') throw Error('Logo SVG is not valid XML.')
  const allowed = new Set([
    'svg',
    'g',
    'path',
    'circle',
    'ellipse',
    'polygon',
    'polyline',
    'rect',
    'line',
    'title',
    'desc',
  ])
  const attributes = new Set([
    'xmlns',
    'viewBox',
    'width',
    'height',
    'x',
    'y',
    'x1',
    'y1',
    'x2',
    'y2',
    'cx',
    'cy',
    'r',
    'rx',
    'ry',
    'd',
    'points',
    'fill',
    'stroke',
    'stroke-width',
    'fill-rule',
    'clip-rule',
    'stroke-linecap',
    'stroke-linejoin',
    'stroke-miterlimit',
    'opacity',
    'fill-opacity',
    'stroke-opacity',
    'transform',
    'role',
  ])
  let nodes = 0
  function walk(node: Element, depth: number) {
    if (
      ++nodes > 20000 ||
      depth > 40 ||
      !allowed.has(node.tagName) ||
      node.namespaceURI !== 'http://www.w3.org/2000/svg'
    )
      throw Error('Logo SVG contains unsupported content.')
    for (const attr of Array.from(node.attributes)) {
      const name = attr.name,
        v = attr.value
      if (!attributes.has(name) && !/^(?:data|aria)-[a-z-]+$/.test(name))
        throw Error(`Unsupported SVG attribute: ${name}.`)
      if (/url\s*\(|[<>]/i.test(v)) throw Error('Logo SVG cannot load external content.')
      if (['fill', 'stroke'].includes(name) && !/^(?:#[\da-f]{3}(?:[\da-f]{3})?|none)$/i.test(v))
        throw Error('Logo paints must be fixed colours.')
      if (name === 'd' && !/^[\s\d.,+eE\-MmLlHhVvCcSsQqTtAaZz]+$/.test(v)) throw Error('Invalid SVG path.')
      if (name === 'transform' && !/^(?:(?:matrix|translate|scale|rotate|skewX|skewY)\([\s\d.,+eE-]+\)\s*)+$/.test(v))
        throw Error('Invalid SVG transform.')
    }
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1) walk(child as unknown as Element, depth + 1)
      else if (child.nodeType !== 3 && child.nodeType !== 8) throw Error('Unsupported SVG node.')
    }
  }
  walk(doc.documentElement as unknown as Element, 0)
  const actual = doc.documentElement
    .getAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)
  if (!actual || actual.length !== 4 || actual.some((n, i) => n !== box[i]))
    throw Error('Logo viewBox does not match its geometry.')
  return { svg, viewBox: box as BrandLogo['viewBox'] }
}

export function parseBrandProfile(input: unknown): BrandProfile {
  const p = object(input, 'Brandkit profile')
  oneOf(p.schema, 'brand schema', ['brandkit/consumer-profile/1'])
  const palette = object(p.colours, 'brand colours')
  const colours = {} as BrandProfile['colours']
  for (const role of ['ink', 'paper', 'primary', 'muted', 'light', 'reverse', 'line', 'rule'] as const) {
    const value = text(palette[role], role, 7)
    if (!/^#[a-f\d]{6}$/i.test(value)) throw Error(`${role} must be a six-digit hex colour.`)
    colours[role] = value
  }
  const type = object(p.typography, 'brand typography')
  const typography = {} as BrandProfile['typography']
  for (const role of ['body', 'heading', 'label'] as const) {
    const face = object(type[role], role)
    typography[role] = {
      family: text(face.family, 'font family', 120),
      weight: int(face.weight, 'font weight', 100, 900),
      style: oneOf(face.style, 'font style', ['normal', 'italic', 'oblique']),
      fallback: text(face.fallback, 'font fallback', 400),
      ...(typeof face.renderingFamily === 'string'
        ? { renderingFamily: text(face.renderingFamily, 'rendering font', 120) }
        : {}),
      ...(typeof face.officialFamily === 'string'
        ? { officialFamily: text(face.officialFamily, 'official font', 120) }
        : {}),
      ...(typeof face.note === 'string' ? { note: face.note.slice(0, 2000) } : {}),
    }
  }
  const logos = object(p.logos, 'brand logos')
  const provenance = object(p.provenance, 'brand provenance')
  const result: BrandProfile = {
    schema: 'brandkit/consumer-profile/1',
    id: text(p.id, 'brand id', 160),
    name: text(p.name, 'brand name', 200),
    version: text(p.version, 'brand version', 100),
    colours,
    typography,
    logos: { primary: parseLogo(logos.primary), black: parseLogo(logos.black), reverse: parseLogo(logos.reverse) },
    provenance: {
      source: typeof provenance.source === 'string' ? provenance.source.slice(0, 10000) : '',
      status: typeof provenance.status === 'string' ? provenance.status.slice(0, 4000) : '',
    },
  }
  if (typeof p.sourceUrl === 'string') result.sourceUrl = p.sourceUrl.slice(0, 2000)
  if (p.affiliation === null) result.affiliation = null
  else if (p.affiliation !== undefined) result.affiliation = object(p.affiliation, 'affiliation')
  if (p.identity !== undefined) {
    const identity = object(p.identity, 'identity'),
      logo = identity.logo ? object(identity.logo, 'logo policy') : {}
    const positive = (v: unknown, max: number) => {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max)
        throw Error('Invalid logo layout restriction.')
      return v
    }
    result.identity = {
      ...identity,
      minimumLogoWidthMm:
        identity.minimumLogoWidthMm === undefined ? undefined : positive(identity.minimumLogoWidthMm, 200),
      logo: {
        ...logo,
        clearSpaceRatio: logo.clearSpaceRatio === undefined ? undefined : positive(logo.clearSpaceRatio, 1),
      },
      clearSpace: typeof identity.clearSpace === 'string' ? identity.clearSpace.slice(0, 2000) : undefined,
    }
  }
  return result
}

export function parseBrandRecord(input: unknown): BrandRecord {
  const r = object(input, 'saved brand')
  if (JSON.stringify(input).length > MAX_BRAND_BYTES) throw Error('Brand exceeds the 8 MB storage limit.')
  return {
    key: text(r.key, 'brand key', 200),
    profile: parseBrandProfile(r.profile),
    fonts: list(r.fonts, 'brand fonts', 24).map((value) => {
      const f = object(value, 'font'),
        dataUrl = text(f.dataUrl, 'font data', 4_000_000)
      if (!/^data:font\/(?:ttf|otf|woff2?);base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl))
        throw Error('Font must be embedded data.')
      return {
        family: text(f.family, 'font family', 120),
        weight: int(f.weight, 'font weight', 100, 900),
        style: oneOf(f.style, 'font style', ['normal', 'italic', 'oblique']),
        dataUrl,
        file: text(f.file, 'font filename', 300),
      }
    }),
    notices: list(r.notices, 'font notices', 30).map((n) => text(n, 'notice', 100000)),
  }
}

export function parseBrandSettings(input: unknown): BrandSettings {
  const s = object(input, 'brand choices'),
    result = { ...defaultBrandSettings }
  result.selected = s.selected === null ? null : text(s.selected, 'selected brand', 200)
  for (const key of ['workspace', 'help', 'exports', 'typography', 'pdfFonts'] as const) result[key] = bool(s[key], key)
  return result
}

export const logoDataUrl = (logo: BrandLogo) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(logo.svg)
export function pdfFontProblem(brand: BrandRecord): string | null {
  for (const role of ['body', 'heading'] as const) {
    const face = brand.profile.typography[role]
    const font = brand.fonts.find((f) => f.family === face.family && f.weight === face.weight && f.style === face.style)
    if (!font)
      return `The profile does not include the ${face.family} ${face.weight} font file. PDF can use standard fonts.`
    if (!font.dataUrl.startsWith('data:font/ttf;'))
      return 'This kit uses OpenType or web fonts. They work on screen and in HTML; PDF can use standard fonts.'
    if (atob(font.dataUrl.split(',')[1].slice(0, 8)).slice(0, 4) !== '\0\x01\0\0')
      return 'The font does not contain TrueType outlines. PDF can use standard fonts.'
  }
  return null
}
