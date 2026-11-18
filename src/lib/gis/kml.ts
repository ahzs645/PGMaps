/**
 * Writes neutral layers (`layers.ts`) as one KML 2.2 document: a Folder per layer, one shared Style
 * per layer, and a Placemark per feature named from a chosen field, with every field in
 * `ExtendedData` so the attributes survive into QGIS, ArcGIS and PGMaps' own reader. Heights are
 * written only for a layer that has them, with the altitude mode stated, because KML's default
 * (`clampToGround`) ignores them.
 *
 * Numbers are written in plain decimals (KML readers do not all take exponents) at full precision.
 * Text is XML-escaped; a character XML 1.0 cannot hold at all is replaced with U+FFFD and counted in
 * `warnings`. A coordinate that is not a finite longitude/latitude throws `GisCoordinateError`
 * naming the layer and feature, never written as `NaN`. No DOM or network access.
 */
import {
  assertWritableCoordinates,
  closedPolygonRings,
  fieldValue,
  layerHasZ,
  nameFieldOf,
  positionsWithoutHeight,
  unlistedAttributeWarnings,
  ValueProblems,
  type GisFeature,
  type GisLayer,
  type GisLineFeature,
  type GisPointFeature,
  type GisPolygonFeature,
  type GisPosition,
} from './layers'

export const KML_NAMESPACE = 'http://www.opengis.net/kml/2.2'

/**
 * A layer's look. Colours are CSS hex (`#rgb`, `#rrggbb` or `#rrggbbaa`); an opacity, when given,
 * replaces the colour's own alpha. Line width is in pixels, as KML draws it.
 */
export interface KmlLayerStyle {
  lineColor?: string
  lineOpacity?: number
  lineWidth?: number
  fillColor?: string
  fillOpacity?: number
  /** Whether a polygon draws its outline; on unless false. */
  outline?: boolean
  iconColor?: string
  iconOpacity?: number
  iconScale?: number
  /** The icon image: a URL, or a path inside a KMZ (`kmz.ts` `files`). Clients use their own pin without it. */
  iconHref?: string
}

export type KmlAltitudeMode = 'absolute' | 'relativeToGround' | 'clampToGround'

export interface KmlOptions {
  /** The document's name, shown at the top of a KML client's places list. */
  name: string
  description?: string
  /** Each layer's look, by layer `name`. A layer without one gets an empty Style the client fills in. */
  styles?: Readonly<Record<string, KmlLayerStyle>>
  /** The field each layer's placemarks are named from, by layer `name`; else a field called "name". */
  nameField?: Readonly<Record<string, string>>
  /** The field each layer's placemark descriptions come from; else a field called "description". */
  descriptionField?: Readonly<Record<string, string>>
  /** How heights are read, for layers that have them. Defaults to `absolute`: heights above sea level. */
  altitudeMode?: KmlAltitudeMode
}

export interface KmlResult {
  kml: string
  warnings: string[]
}

/** Characters XML 1.0 cannot carry even escaped: C0 controls but tab, newline and return, U+FFFE/U+FFFF and lone surrogates. */
const NOT_XML =
  // eslint-disable-next-line no-control-regex -- these are the characters being found
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g

/** Escapes text for XML, counting each character it had to replace. Adapted from GeoLibre's `xmlSafeText` (MIT). */
class XmlText {
  replaced = 0
  escape(value: string): string {
    return value
      .replace(NOT_XML, () => {
        this.replaced += 1
        return '\uFFFD'
      })
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  }
}

/**
 * A number in plain decimals: JavaScript writes 1e-7 and 1e21 with an exponent, which several KML
 * readers reject. The digits are the shortest that read back to the same double. Adapted from
 * GeoLibre's `decimalText` in `kml-writer.ts` (MIT).
 */
export function decimalText(value: number): string {
  const text = String(value)
  const match = /^(-?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/i.exec(text)
  if (!match) return text
  const [, sign, integer, fraction = '', exponent] = match
  const digits = `${integer}${fraction}`
  const point = integer.length + Number(exponent)
  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`
  if (point >= digits.length) return `${sign}${digits}${'0'.repeat(point - digits.length)}`
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`
}

const opacityHex = (opacity: number) =>
  Math.round(Math.min(1, Math.max(0, opacity)) * 255)
    .toString(16)
    .padStart(2, '0')

/** A CSS hex colour as KML's aabbggrr, or null when it is not one. */
export function kmlColor(color: string, opacity?: number): string | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color.trim())
  if (!match) return null
  const hex = match[1].length === 3 ? [...match[1]].map((digit) => digit + digit).join('') : match[1]
  const alpha =
    opacity != null && Number.isFinite(opacity) ? opacityHex(opacity) : hex.length === 8 ? hex.slice(6, 8) : 'ff'
  return `${alpha}${hex.slice(4, 6)}${hex.slice(2, 4)}${hex.slice(0, 2)}`.toLowerCase()
}

/** An XML id from a layer name: KML's `styleUrl` refers to it as `#id`. */
function styleId(name: string, taken: Set<string>) {
  const cleaned = `style_${name.replace(/[^A-Za-z0-9_.-]+/g, '_')}`
  let id = cleaned
  for (let n = 2; taken.has(id); n++) id = `${cleaned}_${n}`
  taken.add(id)
  return id
}

function styleKml(layer: GisLayer, style: KmlLayerStyle, id: string, text: XmlText, warnings: string[]) {
  const color = (value: string | undefined, opacity: number | undefined, what: string) => {
    if (value == null) return null
    const kml = kmlColor(value, opacity)
    if (!kml) warnings.push(`${layer.name}: ${what} colour "${value}" left out; it is not a hex colour.`)
    return kml
  }
  const parts: string[] = []
  const number = (value: number | undefined) => (value != null && Number.isFinite(value) ? decimalText(value) : null)
  if (layer.geometry === 'point') {
    const iconColor = color(style.iconColor, style.iconOpacity, 'icon')
    const scale = number(style.iconScale)
    const inner = [
      iconColor ? `<color>${iconColor}</color>` : '',
      scale ? `<scale>${scale}</scale>` : '',
      style.iconHref ? `<Icon><href>${text.escape(style.iconHref)}</href></Icon>` : '',
    ].join('')
    if (inner) parts.push(`<IconStyle>${inner}</IconStyle>`)
  } else {
    const lineColor = color(style.lineColor, style.lineOpacity, 'line')
    const width = number(style.lineWidth)
    const inner = [lineColor ? `<color>${lineColor}</color>` : '', width ? `<width>${width}</width>` : ''].join('')
    if (inner) parts.push(`<LineStyle>${inner}</LineStyle>`)
  }
  if (layer.geometry === 'polygon') {
    const fillColor = color(style.fillColor, style.fillOpacity, 'fill')
    const fill = style.fillOpacity === 0 ? '<fill>0</fill>' : fillColor ? '<fill>1</fill>' : ''
    const outline = `<outline>${style.outline === false ? 0 : 1}</outline>`
    parts.push(`<PolyStyle>${fillColor ? `<color>${fillColor}</color>` : ''}${fill}${outline}</PolyStyle>`)
  }
  return `<Style id="${id}">${parts.join('')}</Style>`
}

/**
 * Writes `layers` as a KML document. Throws `GisCoordinateError` for a coordinate that is not a
 * finite longitude/latitude.
 */
export function writeKml(layers: readonly GisLayer[], options: KmlOptions): KmlResult {
  for (const layer of layers) assertWritableCoordinates(layer)
  const warnings: string[] = []
  const text = new XmlText()
  const altitudeMode = options.altitudeMode ?? 'absolute'
  const layerNames = new Set(layers.map((layer) => layer.name))
  for (const [option, map] of [
    ['Style', options.styles],
    ['Name field', options.nameField],
    ['Description field', options.descriptionField],
  ] as const)
    for (const name of Object.keys(map ?? {}))
      if (!layerNames.has(name)) warnings.push(`${option} for "${name}" left out; no layer has that name.`)

  const ids = new Set<string>()
  const styles: string[] = []
  const folders = layers.map((layer) => {
    const id = styleId(layer.name, ids)
    styles.push(styleKml(layer, options.styles?.[layer.name] ?? {}, id, text, warnings))
    warnings.push(...unlistedAttributeWarnings(layer))
    const chosen = (map: Readonly<Record<string, string>> | undefined, what: string) => {
      const name = map?.[layer.name]
      if (name == null) return undefined
      const field = layer.fields.find((f) => f.name === name)
      if (!field) warnings.push(`${layer.name}: ${what} field "${name}" left out; the layer has no field of that name.`)
      return field
    }
    const nameField = chosen(options.nameField, 'name') ?? nameFieldOf(layer)
    const descriptionField =
      chosen(options.descriptionField, 'description') ??
      layer.fields.find((field) => field.name.toLowerCase() === 'description')
    const hasZ = layerHasZ(layer)
    if (hasZ) {
      const missing = positionsWithoutHeight(layer)
      if (missing)
        warnings.push(
          `${layer.name}: ${missing} vert${missing === 1 ? 'ex has' : 'ices have'} no height; KML clients read ${missing === 1 ? 'it' : 'them'} at altitude 0.`,
        )
    }
    const title = layer.title ?? layer.name
    const problems = new ValueProblems()
    let withoutGeometry = 0

    const position = (p: GisPosition) =>
      hasZ && p.length >= 3 && Number.isFinite(p[2])
        ? `${decimalText(p[0])},${decimalText(p[1])},${decimalText(p[2])}`
        : `${decimalText(p[0])},${decimalText(p[1])}`
    const coordinates = (points: readonly GisPosition[]) =>
      `<coordinates>${points.map(position).join(' ')}</coordinates>`
    // Without heights, tessellate drapes lines and polygon edges over the client's terrain instead of cutting through it.
    const mode = hasZ ? `<altitudeMode>${altitudeMode}</altitudeMode>` : ''
    const surface = hasZ ? mode : '<tessellate>1</tessellate>'
    const pointKml = (p: GisPosition) => `<Point>${mode}${coordinates([p])}</Point>`
    const lineKml = (line: readonly GisPosition[]) => `<LineString>${surface}${coordinates(line)}</LineString>`
    const polygonKml = (polygon: readonly (readonly GisPosition[])[]) => {
      const [outer, ...holes] = closedPolygonRings(polygon)
      return `<Polygon>${surface}<outerBoundaryIs><LinearRing>${coordinates(outer ?? [])}</LinearRing></outerBoundaryIs>${holes
        .map((ring) => `<innerBoundaryIs><LinearRing>${coordinates(ring)}</LinearRing></innerBoundaryIs>`)
        .join('')}</Polygon>`
    }
    const geometry = (feature: GisFeature): string | null => {
      const parts: string[] =
        layer.geometry === 'point'
          ? (feature as GisPointFeature).points.map(pointKml)
          : layer.geometry === 'line'
            ? (feature as GisLineFeature).lines.map(lineKml)
            : (feature as GisPolygonFeature).polygons.map(polygonKml)
      if (!parts.length) return null
      return parts.length === 1 ? parts[0] : `<MultiGeometry>${parts.join('')}</MultiGeometry>`
    }
    const placemarks = layer.features.map((feature, index) => {
      const name = nameField ? fieldValue(nameField, feature.attributes[nameField.name]).value : null
      const description = descriptionField
        ? fieldValue(descriptionField, feature.attributes[descriptionField.name]).value
        : null
      const data: string[] = []
      for (const field of layer.fields) {
        const { value, problem } = fieldValue(field, feature.attributes[field.name])
        if (problem) problems.add(field.name, problem)
        // A null is unknown: no Data element, rather than an empty value read back as empty text.
        if (value == null) continue
        const shown = typeof value === 'number' ? decimalText(value) : String(value)
        const displayName = field.title ? `<displayName>${text.escape(field.title)}</displayName>` : ''
        data.push(`<Data name="${text.escape(field.name)}">${displayName}<value>${text.escape(shown)}</value></Data>`)
      }
      const shape = geometry(feature)
      if (!shape) withoutGeometry += 1
      return [
        '      <Placemark>',
        `        <name>${text.escape(name == null || name === '' ? `${title} ${index + 1}` : String(name))}</name>`,
        description != null && description !== ''
          ? `        <description>${text.escape(String(description))}</description>`
          : null,
        `        <styleUrl>#${id}</styleUrl>`,
        data.length ? `        <ExtendedData>${data.join('')}</ExtendedData>` : null,
        shape ? `        ${shape}` : null,
        '      </Placemark>',
      ]
        .filter((line) => line !== null)
        .join('\n')
    })
    warnings.push(...problems.warnings(layer.name))
    if (withoutGeometry)
      warnings.push(
        `${layer.name}: ${withoutGeometry} placemark${withoutGeometry === 1 ? '' : 's'} written without a geometry; the feature had none.`,
      )
    return [
      '    <Folder>',
      `      <name>${text.escape(title)}</name>`,
      layer.description ? `      <description>${text.escape(layer.description)}</description>` : null,
      ...placemarks,
      '    </Folder>',
    ]
      .filter((line) => line !== null)
      .join('\n')
  })
  const kml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<kml xmlns="${KML_NAMESPACE}">`,
    '  <Document>',
    `    <name>${text.escape(options.name)}</name>`,
    options.description ? `    <description>${text.escape(options.description)}</description>` : null,
    ...styles.map((style) => `    ${style}`),
    ...folders,
    '  </Document>',
    '</kml>',
    '',
  ]
    .filter((line) => line !== null)
    .join('\n')
  if (text.replaced)
    warnings.push(
      `${text.replaced} character${text.replaced === 1 ? '' : 's'} XML cannot hold (control characters or broken surrogates) written as U+FFFD.`,
    )
  return { kml, warnings }
}
