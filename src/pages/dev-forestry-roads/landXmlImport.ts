/**
 * LandXML alignments brought in as roads: the horizontal geometry (Line, Curve and Spiral elements of
 * `CoordGeom`) becomes intersection points with radii and spiral lengths, and the `ProfAlign` PVIs
 * with parabolic curves become the road's profile. Every file is checked as it is read:
 *
 * - each element's station length agrees with its geometric length within 7 mm (2π × 1 mm of
 *   radius error);
 * - each element starts within 1 mm of where the previous one ends;
 * - no joint kinks by more than 0.06°, spirals included;
 *
 * and the start station and the ratio of grid length to stationed length are reported. The checks
 * inform; an alignment is never refused on them.
 *
 * Reads LandXML 1.0–1.2 (landxml.org schema): `Units`, `CoordinateSystem`, `Alignment`, `CoordGeom`,
 * `Line`, `Curve`, `Spiral`, `Profile`, `ProfAlign`, `PVI`, `ParaCurve`, `CircCurve`. The XML is read by
 * a small tokenizer here, so minified files read as well as indented ones.
 *
 * Pure: no DOM or network access.
 *
 * Written from functional specifications (Lima VVA §4.1 alignment validation and gap G6; RFLTools
 * §11 RALIGNXML); no code from Lima VVA or RFLTools (GPL-3.0) was used.
 */
import proj4 from 'proj4'
import { projectedCrsDefinition } from '@/lib/geo/projectedCrs'
import { alignmentLength, distance } from './engine'
import type { Alignment, Coordinate, RoadPoint, RoadTemplate, VerticalPoint } from './types'

/** Station length against geometric length: 2π × 1 mm of radius error. */
export const LANDXML_LENGTH_TOLERANCE_M = 0.007
/** Gap allowed between one element's end and the next one's start. */
export const LANDXML_JOINT_TOLERANCE_M = 0.001
/** Change of direction allowed at a joint. */
export const LANDXML_KINK_TOLERANCE_DEG = 0.06
export const MAX_LANDXML_BYTES = 50_000_000

/**
 * Whether the opening of a file is a LandXML document. **Import line** takes LandXML as well as the
 * spatial formats, and the content decides which reader gets it, never the file's name.
 */
export const isLandXml = (head: string) => /<(?:[\w-]+:)?LandXML[\s>]/.test(head)
export const MAX_LANDXML_ELEMENTS = 4000

// ---- A small XML reader --------------------------------------------------------------------------

export interface XmlNode {
  name: string
  attributes: Record<string, string>
  children: XmlNode[]
  text: string
}

const entity = (value: string) =>
  value.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, code: string) => {
    const named: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }
    if (named[code.toLowerCase()]) return named[code.toLowerCase()]
    return String.fromCodePoint(
      code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1)),
    )
  })

/** Elements, attributes and text of an XML document. Namespace prefixes are dropped from names. */
export function readXml(text: string): XmlNode {
  const root: XmlNode = { name: '#document', attributes: {}, children: [], text: '' }
  const stack = [root]
  const local = (name: string) => name.slice(name.indexOf(':') + 1)
  const tag =
    /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<(\/?)([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g
  let last = 0
  for (let match = tag.exec(text); match; match = tag.exec(text)) {
    const top = stack[stack.length - 1]
    top.text += entity(text.slice(last, match.index))
    last = tag.lastIndex
    if (match[1] !== undefined) {
      top.text += match[1]
      continue
    }
    if (!match[3]) continue
    if (match[2] === '/') {
      if (stack.length > 1 && top.name === local(match[3])) stack.pop()
      else throw Error(`The XML closes <${match[3]}> where it did not open it.`)
      continue
    }
    const attributes: Record<string, string> = {}
    for (const pair of match[4].matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
      attributes[local(pair[1])] = entity(pair[2] ?? pair[3] ?? '')
    const node: XmlNode = { name: local(match[3]), attributes, children: [], text: '' }
    top.children.push(node)
    if (!match[5]) stack.push(node)
  }
  if (stack.length > 1) throw Error(`The XML ends inside <${stack[stack.length - 1].name}>.`)
  return root
}

const child = (node: XmlNode, name: string) => node.children.find((c) => c.name === name)
function find(node: XmlNode, name: string): XmlNode[] {
  const out: XmlNode[] = []
  const walk = (n: XmlNode) => {
    for (const c of n.children) {
      if (c.name === name) out.push(c)
      walk(c)
    }
  }
  walk(node)
  return out
}
const numbers = (text: string) =>
  text
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number)

// ---- Geometry -----------------------------------------------------------------------------------

type XY = [number, number]
export type LandXmlElement =
  | { kind: 'line'; start: XY; end: XY; station: number | null; length: number | null }
  | {
      kind: 'curve'
      start: XY
      end: XY
      centre: XY
      radius: number
      rotation: 'cw' | 'ccw'
      station: number | null
      length: number | null
    }
  | {
      kind: 'spiral'
      start: XY
      end: XY
      pi: XY | null
      length: number
      radiusStart: number
      radiusEnd: number
      rotation: 'cw' | 'ccw'
      station: number | null
    }

export interface LandXmlCheck {
  kind: 'length' | 'joint' | 'kink'
  /** 1-based element number the check is at. */
  element: number
  value: number
  limit: number
  passed: boolean
  message: string
}

export interface LandXmlAlignment {
  name: string
  startStation: number
  elements: LandXmlElement[]
  /** Profile stations as in the file; elevations in metres. */
  profile: { station: number; elevation: number; curveLength: number }[]
  checks: LandXmlCheck[]
  /** Sum of the elements' geometric lengths in grid units, m. */
  gridLengthM: number
  /** Last element's end station minus the start station, m; null when the file gives no stations. */
  stationedLengthM: number | null
  warnings: string[]
}

export interface LandXmlFile {
  epsg: number | null
  /** Metres per file unit. */
  unitM: number
  alignments: LandXmlAlignment[]
}

/** Points are "northing easting"; returned as [easting, northing]. */
const point = (node: XmlNode | undefined, scale: number): XY | null => {
  if (!node) return null
  const [n, e] = numbers(node.text)
  return Number.isFinite(n) && Number.isFinite(e) ? [e * scale, n * scale] : null
}
const sub = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]]
const heading = (from: XY, to: XY) => Math.atan2(to[1] - from[1], to[0] - from[0])
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle))
const DEG = 180 / Math.PI

/** Central angle of an arc from its start, centre, end and turning direction, radians (positive). */
function arcAngle(start: XY, centre: XY, end: XY, rotation: 'cw' | 'ccw') {
  const a = heading(centre, start),
    b = heading(centre, end)
  let sweep = rotation === 'ccw' ? b - a : a - b
  while (sweep <= 0) sweep += 2 * Math.PI
  while (sweep > 2 * Math.PI) sweep -= 2 * Math.PI
  return sweep
}
/** Chord of a clothoid from curvature 0 to 1/R over `length` (Simpson's rule). */
function clothoidChord(length: number, radius: number) {
  const steps = 64
  let x = 0,
    y = 0
  for (let i = 0; i <= steps; i++) {
    const u = (length * i) / steps,
      w = i === 0 || i === steps ? 1 : i % 2 ? 4 : 2,
      psi = (u * u) / (2 * radius * length)
    x += w * Math.cos(psi)
    y += w * Math.sin(psi)
  }
  return (Math.hypot(x, y) * length) / steps / 3
}

/** Geometric length of an element, m. */
export function elementLength(element: LandXmlElement): number {
  if (element.kind === 'line') return Math.hypot(...sub(element.end, element.start))
  if (element.kind === 'curve')
    return element.radius * arcAngle(element.start, element.centre, element.end, element.rotation)
  return element.length
}
/** Direction of travel at an element's start and end, radians from east; null where it cannot be read. */
function headings(element: LandXmlElement): [number | null, number | null] {
  if (element.kind === 'line') {
    const h = heading(element.start, element.end)
    return [h, h]
  }
  if (element.kind === 'curve') {
    const turn = element.rotation === 'ccw' ? Math.PI / 2 : -Math.PI / 2
    return [heading(element.centre, element.start) + turn, heading(element.centre, element.end) + turn]
  }
  return element.pi ? [heading(element.start, element.pi), heading(element.pi, element.end)] : [null, null]
}

/** Reads a LandXML file's alignments. Coordinates stay in the file's grid, converted to metres. */
export function parseLandXml(text: string): LandXmlFile {
  if (text.length > MAX_LANDXML_BYTES) throw Error('The LandXML file is over 50 MB.')
  const doc = readXml(text)
  const landXml = child(doc, 'LandXML')
  if (!landXml) throw Error('This is not a LandXML file: it has no <LandXML> element.')
  const units = child(landXml, 'Units')
  const imperial = units && child(units, 'Imperial')
  const linear = imperial?.attributes.linearUnit ?? (units && child(units, 'Metric')?.attributes.linearUnit) ?? 'meter'
  const unitM = /^USSurveyFoot$/i.test(linear)
    ? 1200 / 3937
    : /^(foot|feet|InternationalFoot)$/i.test(linear)
      ? 0.3048
      : /^(meter|metre|m)$/i.test(linear)
        ? 1
        : NaN
  if (!Number.isFinite(unitM)) throw Error(`The LandXML file's linear unit "${linear}" is not one this import reads.`)
  const crs = child(landXml, 'CoordinateSystem')
  const epsgText = crs?.attributes.epsgCode ?? /EPSG:(\d+)/i.exec(crs?.attributes.name ?? '')?.[1]
  const epsg = epsgText && /^\d+$/.test(epsgText) ? Number(epsgText) : null
  const alignments = find(landXml, 'Alignment').map((node) => readAlignment(node, unitM))
  if (!alignments.length) throw Error('The LandXML file holds no <Alignment>.')
  return { epsg, unitM, alignments }
}

function readAlignment(node: XmlNode, unitM: number): LandXmlAlignment {
  const name = (node.attributes.name ?? 'LandXML alignment').slice(0, 200)
  const startStation = Number(node.attributes.staStart ?? 0) * unitM
  const geometry = child(node, 'CoordGeom')
  const warnings: string[] = []
  const elements: LandXmlElement[] = []
  const attr = (n: XmlNode, key: string) => (n.attributes[key] === undefined ? null : Number(n.attributes[key]) * unitM)
  for (const element of geometry?.children ?? []) {
    if (elements.length >= MAX_LANDXML_ELEMENTS) throw Error(`${name} has more than ${MAX_LANDXML_ELEMENTS} elements.`)
    const start = point(child(element, 'Start'), unitM),
      end = point(child(element, 'End'), unitM)
    const station = attr(element, 'staStart')
    if (!start || !end) {
      warnings.push(`Element ${elements.length + 1} (${element.name}) has no start or end point and is left out.`)
      continue
    }
    const rotation = element.attributes.rot === 'ccw' ? 'ccw' : 'cw'
    if (element.name === 'Line') elements.push({ kind: 'line', start, end, station, length: attr(element, 'length') })
    else if (element.name === 'Curve') {
      const centre = point(child(element, 'Center'), unitM)
      const radius = attr(element, 'radius') ?? (centre ? Math.hypot(...sub(start, centre)) : null)
      if (!centre || !(radius !== null && radius > 0)) {
        warnings.push(`Curve ${elements.length + 1} has no centre or radius and is left out.`)
        continue
      }
      elements.push({ kind: 'curve', start, end, centre, radius, rotation, station, length: attr(element, 'length') })
    } else if (element.name === 'Spiral') {
      const length = attr(element, 'length')
      const radius = (key: string) => {
        const value = element.attributes[key]
        return value === undefined || /^INF/i.test(value) || Number(value) === 0 ? Infinity : Number(value) * unitM
      }
      if (!(length !== null && length > 0)) {
        warnings.push(`Spiral ${elements.length + 1} has no length and is left out.`)
        continue
      }
      if (element.attributes.spiType && element.attributes.spiType !== 'clothoid')
        warnings.push(`Spiral ${elements.length + 1} is a ${element.attributes.spiType}; it is read as a clothoid.`)
      elements.push({
        kind: 'spiral',
        start,
        end,
        pi: point(child(element, 'PI'), unitM),
        length,
        radiusStart: radius('radiusStart'),
        radiusEnd: radius('radiusEnd'),
        rotation,
        station,
      })
    } else warnings.push(`<${element.name}> is not read; only Line, Curve and Spiral are.`)
  }
  const profile = readProfile(node, unitM, warnings)
  const checks = checkElements(elements)
  const gridLengthM = elements.reduce((sum, e) => sum + elementLength(e), 0)
  const lastStation = elements.length ? elements[elements.length - 1].station : null
  const stationedLengthM =
    lastStation !== null ? lastStation + elementLength(elements[elements.length - 1]) - startStation : null
  return { name, startStation, elements, profile, checks, gridLengthM, stationedLengthM, warnings }
}

function readProfile(node: XmlNode, unitM: number, warnings: string[]) {
  const align = find(node, 'ProfAlign')[0]
  if (!align) return []
  const out: { station: number; elevation: number; curveLength: number }[] = []
  for (const item of align.children) {
    const [station, elevation] = numbers(item.text)
    if (!Number.isFinite(station) || !Number.isFinite(elevation)) continue
    if (item.name === 'PVI') out.push({ station: station * unitM, elevation: elevation * unitM, curveLength: 0 })
    else if (item.name === 'ParaCurve' || item.name === 'CircCurve') {
      const length = Number(item.attributes.length ?? 0) * unitM
      if (item.name === 'CircCurve')
        warnings.push(`The circular vertical curve at station ${station} is read as a parabola of the same length.`)
      out.push({
        station: station * unitM,
        elevation: elevation * unitM,
        curveLength: Number.isFinite(length) ? length : 0,
      })
    } else if (item.name === 'UnsymParaCurve') {
      const length = (Number(item.attributes.lengthIn ?? 0) + Number(item.attributes.lengthOut ?? 0)) * unitM
      warnings.push(
        `The unsymmetrical vertical curve at station ${station} is read as a symmetric one of the same length.`,
      )
      out.push({
        station: station * unitM,
        elevation: elevation * unitM,
        curveLength: Number.isFinite(length) ? length : 0,
      })
    }
  }
  return out.sort((a, b) => a.station - b.station)
}

/** The three Lima-style checks of an element list. */
export function checkElements(elements: readonly LandXmlElement[]): LandXmlCheck[] {
  const checks: LandXmlCheck[] = []
  elements.forEach((element, i) => {
    const geometric = elementLength(element)
    // Length: the element's own length attribute, the station to the next element, and for a spiral
    // the chord its length and radius give against the chord between its points.
    const stated =
      element.kind === 'spiral'
        ? null
        : (element.length ??
          (element.station !== null && elements[i + 1]?.station != null
            ? elements[i + 1].station! - element.station
            : null))
    if (stated !== null) {
      const difference = Math.abs(stated - geometric)
      checks.push({
        kind: 'length',
        element: i + 1,
        value: difference,
        limit: LANDXML_LENGTH_TOLERANCE_M,
        passed: difference <= LANDXML_LENGTH_TOLERANCE_M,
        message: `Element ${i + 1}: stated length ${stated.toFixed(3)} m, geometric ${geometric.toFixed(3)} m`,
      })
    }
    if (element.kind === 'spiral') {
      const radius = Math.min(element.radiusStart, element.radiusEnd)
      if (Number.isFinite(radius) && (element.radiusStart === Infinity || element.radiusEnd === Infinity)) {
        const difference = Math.abs(
          clothoidChord(element.length, radius) - Math.hypot(...sub(element.end, element.start)),
        )
        checks.push({
          kind: 'length',
          element: i + 1,
          value: difference,
          limit: LANDXML_LENGTH_TOLERANCE_M,
          passed: difference <= LANDXML_LENGTH_TOLERANCE_M,
          message: `Spiral ${i + 1}: its length and radius give a chord ${difference.toFixed(3)} m from the one between its points`,
        })
      }
    }
    if (i === 0) return
    const previous = elements[i - 1]
    const gap = Math.hypot(...sub(element.start, previous.end))
    checks.push({
      kind: 'joint',
      element: i + 1,
      value: gap,
      limit: LANDXML_JOINT_TOLERANCE_M,
      passed: gap <= LANDXML_JOINT_TOLERANCE_M,
      message: `Element ${i + 1} starts ${(gap * 1000).toFixed(1)} mm from the end of element ${i}`,
    })
    const out = headings(previous)[1],
      into = headings(element)[0]
    if (out !== null && into !== null) {
      const kink = Math.abs(wrap(into - out)) * DEG
      checks.push({
        kind: 'kink',
        element: i + 1,
        value: kink,
        limit: LANDXML_KINK_TOLERANCE_DEG,
        passed: kink <= LANDXML_KINK_TOLERANCE_DEG,
        message: `Direction changes ${kink.toFixed(3)}° where element ${i + 1} joins element ${i}`,
      })
    }
  })
  return checks
}

// ---- To a road ----------------------------------------------------------------------------------

/** Where the line through `a` along `ha` meets the line through `b` along `hb`; null when parallel. */
function meet(a: XY, ha: number, b: XY, hb: number): XY | null {
  const da: XY = [Math.cos(ha), Math.sin(ha)],
    db: XY = [Math.cos(hb), Math.sin(hb)]
  const cross = da[0] * db[1] - da[1] * db[0]
  if (Math.abs(cross) < 1e-12) return null
  const w = sub(b, a)
  const t = (w[0] * db[1] - w[1] * db[0]) / cross
  return [a[0] + da[0] * t, a[1] + da[1] * t]
}

/**
 * The intersection points of an alignment's elements, in its grid: its ends, and one PI per run of
 * curves and spirals between tangents, with the run's radius and spiral length. A compound curve
 * (two radii in one run) takes the smaller radius; unequal spirals take their mean. Both say so.
 */
export function landXmlIntersectionPoints(alignment: LandXmlAlignment): {
  points: { xy: XY; radiusM: number; spiralM: number }[]
  warnings: string[]
} {
  const elements = alignment.elements
  if (!elements.length) throw Error(`${alignment.name} has no horizontal elements to import.`)
  const warnings: string[] = []
  const known = elements.map(headings)
  // A spiral without its PI takes its directions from its neighbours, which are continuous with it.
  for (let i = 0; i < elements.length; i++) {
    if (known[i][0] === null) known[i][0] = known[i - 1]?.[1] ?? null
    if (known[i][1] === null) known[i][1] = known[i + 1]?.[0] ?? null
  }
  const points: { xy: XY; radiusM: number; spiralM: number }[] = [{ xy: elements[0].start, radiusM: 0, spiralM: 0 }]
  for (let i = 0; i < elements.length; ) {
    if (elements[i].kind === 'line') {
      i++
      continue
    }
    let j = i
    while (j + 1 < elements.length && elements[j + 1].kind !== 'line') j++
    const run = elements.slice(i, j + 1)
    const into = known[i][0],
      out = known[j][1]
    const curves = run.filter((e) => e.kind === 'curve')
    const spirals = run.filter((e) => e.kind === 'spiral')
    const radius = curves.length
      ? Math.min(...curves.map((c) => c.radius))
      : Math.min(...spirals.map((s) => Math.min(s.radiusStart, s.radiusEnd)))
    if (curves.length > 1 || new Set(curves.map((c) => c.rotation)).size > 1)
      warnings.push(
        `Elements ${i + 1}–${j + 1} are a compound or reverse curve; imported as one curve of R ${radius.toFixed(1)} m.`,
      )
    const spiralLengths = spirals.map((s) => s.length)
    const spiralM = spiralLengths.length
      ? spiralLengths.reduce((a, b) => a + b, 0) / Math.max(2, spiralLengths.length)
      : 0
    if (
      spiralLengths.length === 1 ||
      (spiralLengths.length === 2 && Math.abs(spiralLengths[0] - spiralLengths[1]) > 1e-3)
    )
      warnings.push(
        `Elements ${i + 1}–${j + 1} have spirals of ${spiralLengths.map((l) => l.toFixed(1)).join(' and ')} m; the road takes ${spiralM.toFixed(1)} m each side.`,
      )
    const pi = into !== null && out !== null ? meet(run[0].start, into, run[run.length - 1].end, out) : null
    if (!pi || !Number.isFinite(radius)) {
      warnings.push(
        `Elements ${i + 1}–${j + 1}: their tangents do not meet, so the curve is imported as its end points.`,
      )
      points.push({ xy: run[0].start, radiusM: 0, spiralM: 0 }, { xy: run[run.length - 1].end, radiusM: 0, spiralM: 0 })
    } else points.push({ xy: pi, radiusM: radius, spiralM })
    i = j + 1
  }
  points.push({ xy: elements[elements.length - 1].end, radiusM: 0, spiralM: 0 })
  // A PI on top of an end, or two in one place, is one point.
  return { points: points.filter((p, k) => k === 0 || Math.hypot(...sub(p.xy, points[k - 1].xy)) > 0.001), warnings }
}

export interface LandXmlRoad {
  alignment: Alignment
  source: LandXmlAlignment
  /** PG Maps chainage per file station: the road's spherical length over the file's stationed length. */
  stationScale: number
  warnings: string[]
}

/**
 * Roads from a LandXML file. The coordinate system comes from the file's EPSG code; a file without
 * one is refused, never assumed to be in the terrain's CRS. Each road gets `template` and a new id.
 */
export function landXmlRoads(
  text: string,
  options: { newId: () => string; color: (index: number) => string; template: RoadTemplate },
): { roads: LandXmlRoad[]; epsg: number } {
  const file = parseLandXml(text)
  if (file.epsg === null)
    throw Error(
      'The LandXML file names no coordinate system. Export it again with its EPSG code (<CoordinateSystem epsgCode="…">), so its coordinates are not guessed.',
    )
  const definition = projectedCrsDefinition(file.epsg)
  if (!definition)
    throw Error(
      `EPSG:${file.epsg} is not a projected coordinate system this workspace converts. Export the alignment in UTM (NAD83(CSRS), NAD83 or WGS84) or BC Albers.`,
    )
  const projection = proj4(definition, 'EPSG:4326')
  const toLonLat = (xy: XY) => projection.forward([...xy]) as Coordinate
  const roads = file.alignments.map((source, index): LandXmlRoad => {
    const { points, warnings } = landXmlIntersectionPoints(source)
    const id = options.newId()
    const coordinates = points.map((p) => toLonLat(p.xy))
    // Radii and spirals are grid lengths; the road model measures on the sphere. Scale them by the
    // ratio of the two along the PIs (the projection's scale factor here).
    let sphere = 0,
      grid = 0
    for (let k = 1; k < points.length; k++) {
      sphere += distance(coordinates[k - 1], coordinates[k])
      grid += Math.hypot(...sub(points[k].xy, points[k - 1].xy))
    }
    const planScale = grid > 0 ? sphere / grid : 1
    const roadPoints: RoadPoint[] = points.map((p, k) => ({
      id: `${id}-p${k}`,
      coordinate: coordinates[k],
      radiusM: Math.round(p.radiusM * planScale * 1000) / 1000,
      ...(p.spiralM > 0 ? { spiralM: Math.round(p.spiralM * planScale * 1000) / 1000 } : {}),
    }))
    const draft: Alignment = {
      id,
      name: source.name,
      color: options.color(index),
      points: roadPoints,
      vertical: [],
      template: options.template,
      overrides: [],
    }
    // The road's chainage is measured on the sphere; the file's stations on its grid (or ground).
    // Profile stations are scaled by the ratio, so PVIs land at the same place along the road.
    const length = alignmentLength(draft)
    const fileLength = source.stationedLengthM ?? source.gridLengthM
    const stationScale = fileLength > 0 ? length / fileLength : 1
    const vertical: VerticalPoint[] = source.profile
      .map((p, k) => ({
        id: `${id}-v${k}`,
        chainage: Math.round((p.station - source.startStation) * stationScale * 1000) / 1000,
        elevation: p.elevation,
        curveLength: p.curveLength,
      }))
      .filter((p) => p.chainage >= -1e-6 && p.chainage <= length + 0.01)
      .map((p) => ({ ...p, chainage: Math.max(0, Math.min(length, p.chainage)) }))
    if (vertical.length < source.profile.length)
      warnings.push(`${source.profile.length - vertical.length} PVI(s) lie off the alignment and are left out.`)
    return {
      alignment: { ...draft, vertical },
      source,
      stationScale,
      warnings: [...source.warnings, ...warnings],
    }
  })
  return { roads, epsg: file.epsg }
}

/** One paragraph per road for the import notice: the checks, the start station and the scale. */
export function landXmlImportSummary(road: LandXmlRoad): string {
  const failed = road.source.checks.filter((check) => !check.passed)
  const counts = (kind: LandXmlCheck['kind']) => road.source.checks.filter((c) => c.kind === kind)
  const verdict = (kind: LandXmlCheck['kind'], label: string) => {
    const list = counts(kind)
    const bad = list.filter((c) => !c.passed).length
    return list.length ? `${label} ${bad ? `${bad} of ${list.length} outside` : 'all within'}` : `${label} not checked`
  }
  const parts = [
    `${road.alignment.name}: ${road.source.elements.length} elements, ${road.alignment.points.length} points`,
    `starts at station ${road.source.startStation.toFixed(3)} m (the road's own chainage starts at 0)`,
    `${verdict('length', `lengths (${LANDXML_LENGTH_TOLERANCE_M * 1000} mm)`)}, ${verdict('joint', `joints (${LANDXML_JOINT_TOLERANCE_M * 1000} mm)`)}, ${verdict('kink', `directions (${LANDXML_KINK_TOLERANCE_DEG}°)`)}`,
    `road chainage ÷ file stations ${road.stationScale.toFixed(5)}`,
  ]
  return `${parts.join('; ')}.${failed.length ? ` First outside: ${failed[0].message}.` : ''}${road.warnings.length ? ` ${road.warnings.join(' ')}` : ''}`
}
