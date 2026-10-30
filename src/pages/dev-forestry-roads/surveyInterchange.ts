/** Open geographic interchange and projected survey reduction. No inferred vertical datum. */
export interface TraverseLeg {
  id: string
  bearingDegrees: number
  horizontalDistanceM: number
  gradePercent: number
}
export interface TraverseInput {
  start: [number, number, number]
  target?: [number, number, number]
  adjustment: 'none' | 'bowditch'
  legs: TraverseLeg[]
  sideShots?: Array<{ id: string; station: number; offsetM: number; heightDifferenceM: number }>
}
export interface TraverseResult {
  stations: Array<{ id: string; raw: [number, number, number]; adjusted: [number, number, number]; chainage: number }>
  sideShots: Array<{ id: string; coordinate: [number, number, number] }>
  closure: { delta: [number, number, number]; horizontalM: number; ratio: number | null } | null
  lengthM: number
  adjustment: TraverseInput['adjustment']
}
export interface SurveyBookRecord {
  id: string
  name: string
  epsg: number
  verticalReference: string
  input: TraverseInput
}
export function parseSurveyBooks(raw: unknown): SurveyBookRecord[] {
  if (!Array.isArray(raw) || raw.length > 20) throw Error('A project supports at most 20 survey field books.')
  const ids = new Set<string>()
  for (const r of raw as SurveyBookRecord[]) {
    if (
      !r ||
      typeof r.id !== 'string' ||
      !r.id ||
      r.id.length > 100 ||
      ids.has(r.id) ||
      typeof r.name !== 'string' ||
      r.name.length > 200 ||
      !Number.isInteger(r.epsg) ||
      r.epsg < 1 ||
      r.epsg > 100000 ||
      typeof r.verticalReference !== 'string' ||
      !r.verticalReference.trim() ||
      r.verticalReference.length > 300
    )
      throw Error('Invalid survey field-book record.')
    reduceTraverse(r.input)
    ids.add(r.id)
  }
  return structuredClone(raw) as SurveyBookRecord[]
}
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
export function reduceTraverse(input: TraverseInput): TraverseResult {
  if (
    !input ||
    !['none', 'bowditch'].includes(input.adjustment) ||
    !Array.isArray(input.start) ||
    input.start.length !== 3 ||
    !input.start.every(finite) ||
    (input.target && (!Array.isArray(input.target) || input.target.length !== 3 || !input.target.every(finite))) ||
    !Array.isArray(input.legs) ||
    !input.legs.length ||
    input.legs.length > 2_000
  )
    throw Error('Enter a starting easting, northing and elevation, and 1–2,000 traverse legs.')
  if (input.adjustment === 'bowditch' && !input.target)
    throw Error('Bowditch adjustment needs a known closing coordinate.')
  const stations: TraverseResult['stations'] = [
    { id: 'start', raw: [...input.start], adjusted: [...input.start], chainage: 0 },
  ]
  let lengthM = 0
  const ids = new Set<string>()
  for (const leg of input.legs) {
    if (
      !leg ||
      typeof leg.id !== 'string' ||
      !leg.id.trim() ||
      leg.id.length > 100 ||
      ids.has(leg.id) ||
      ![leg.bearingDegrees, leg.horizontalDistanceM, leg.gradePercent].every(finite) ||
      leg.horizontalDistanceM <= 0 ||
      leg.horizontalDistanceM > 10_000 ||
      leg.bearingDegrees < 0 ||
      leg.bearingDegrees >= 360 ||
      Math.abs(leg.gradePercent) > 100
    )
      throw Error('Each leg needs a unique station ID, bearing 0–<360°, distance 0–10 km and grade ±100%.')
    ids.add(leg.id)
    lengthM += leg.horizontalDistanceM
    if (lengthM > 100_000) throw Error('Traverse exceeds 100 km.')
    const last = stations[stations.length - 1].raw,
      a = (leg.bearingDegrees * Math.PI) / 180
    const raw: [number, number, number] = [
      last[0] + Math.sin(a) * leg.horizontalDistanceM,
      last[1] + Math.cos(a) * leg.horizontalDistanceM,
      last[2] + (leg.gradePercent * leg.horizontalDistanceM) / 100,
    ]
    stations.push({ id: leg.id, raw, adjusted: [...raw], chainage: lengthM })
  }
  const end = stations[stations.length - 1].raw
  const delta: [number, number, number] | null = input.target
    ? [end[0] - input.target[0], end[1] - input.target[1], end[2] - input.target[2]]
    : null
  const horizontalM = delta ? Math.hypot(delta[0], delta[1]) : 0
  if (input.adjustment === 'bowditch' && delta)
    for (const s of stations)
      s.adjusted = s.raw.map((v, k) => v - (delta[k] * s.chainage) / lengthM) as [number, number, number]
  const shots = input.sideShots ?? []
  if (shots.length > 10_000) throw Error('A survey supports at most 10,000 side shots.')
  const sideShots = shots.map((s) => {
    if (
      !s ||
      !Number.isInteger(s.station) ||
      s.station < 0 ||
      s.station >= stations.length ||
      !finite(s.offsetM) ||
      Math.abs(s.offsetM) > 1000 ||
      !finite(s.heightDifferenceM) ||
      Math.abs(s.heightDifferenceM) > 1000 ||
      typeof s.id !== 'string' ||
      s.id.length > 100
    )
      throw Error(
        'Invalid side shot: choose a traverse station, signed offset ±1,000 m and height difference ±1,000 m.',
      )
    const at = stations[s.station].adjusted
    const bearing = (input.legs[Math.min(s.station, input.legs.length - 1)].bearingDegrees * Math.PI) / 180
    return {
      id: s.id,
      coordinate: [
        at[0] + Math.cos(bearing) * s.offsetM,
        at[1] - Math.sin(bearing) * s.offsetM,
        at[2] + s.heightDifferenceM,
      ] as [number, number, number],
    }
  })
  return {
    stations,
    sideShots,
    lengthM,
    adjustment: input.adjustment,
    closure: delta ? { delta, horizontalM, ratio: horizontalM > 0 ? lengthM / horizontalM : null } : null,
  }
}
/** CSV field book: station,bearing_deg,horizontal_m,grade_pct, with an optional header. */
export function parseTraverseLegs(text: string): TraverseLeg[] {
  if (text.length > 1_000_000) throw Error('Survey notes exceed 1 MB.')
  const lines = text
    .trim()
    .split(/\r?\n/)
    .filter((l) => l.trim())
  if (lines[0] && /bearing/i.test(lines[0])) lines.shift()
  return lines.map((line, i) => {
    const fields = line.split(',').map((f) => f.trim())
    if (fields.length !== 4 || fields.slice(1).some((v) => v === ''))
      throw Error(`Survey row ${i + 1} needs station,bearing_deg,horizontal_m,grade_pct.`)
    return {
      id: fields[0],
      bearingDegrees: Number(fields[1]),
      horizontalDistanceM: Number(fields[2]),
      gradePercent: Number(fields[3]),
    }
  })
}
const csv = (value: string | number) =>
  typeof value === 'number' ? String(value) : `"${/^[=+\-@\t\r]/.test(value) ? "'" : ''}${value.split('"').join('""')}"`
export function traverseCsv(result: TraverseResult, epsg: number, verticalReference: string): string {
  return [
    'id,kind,chainage_m,easting_m,northing_m,elevation_m,epsg,vertical_reference,adjustment',
    ...result.stations.map((s) =>
      [s.id, 'traverse', s.chainage, ...s.adjusted, epsg, verticalReference, result.adjustment].map(csv).join(','),
    ),
    ...result.sideShots.map((s) =>
      [s.id, 'side-shot', '', ...s.coordinate, epsg, verticalReference, result.adjustment].map(csv).join(','),
    ),
  ].join('\r\n')
}

type XmlNode = { name: string; text: string; children: XmlNode[] }
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_m, k: string) =>
    k[0] === '#'
      ? String.fromCodePoint(k[1].toLowerCase() === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10))
      : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[k.toLowerCase()] ?? ''),
  )
/** Small bounded XML tokenizer; rejects entities/DTDs and never follows NetworkLink resources. */
function xmlTree(text: string): XmlNode {
  if (text.length > 30_000_000 || /<!DOCTYPE|<!ENTITY/i.test(text))
    throw Error('KML exceeds 30 MB or uses unsupported XML entities.')
  const root: XmlNode = { name: 'root', text: '', children: [] },
    stack = [root]
  let count = 0
  const tokens = text.match(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<[^>]*>|[^<]+/g) ?? []
  for (const token of tokens) {
    if (token.startsWith('<!--') || token.startsWith('<?')) continue
    if (token.startsWith('<![CDATA[')) {
      stack.at(-1)!.text += token.slice(9, -3)
      continue
    }
    if (token.startsWith('</')) {
      const name = token.slice(2, -1).trim().split(':').at(-1)!.toLowerCase()
      if (stack.length <= 1 || stack.at(-1)!.name !== name) throw Error('KML contains mismatched XML elements.')
      stack.pop()
      continue
    }
    if (token.startsWith('<')) {
      const name = token
        .slice(1)
        .match(/^([\w:.-]+)/)?.[1]
        .split(':')
        .at(-1)
        ?.toLowerCase()
      if (!name || ++count > 100_000 || stack.length > 50)
        throw Error('KML XML complexity exceeds the supported limit.')
      const node: XmlNode = { name, text: '', children: [] }
      stack.at(-1)!.children.push(node)
      if (!/\/\s*>$/.test(token)) stack.push(node)
    } else stack.at(-1)!.text += decode(token)
  }
  if (stack.length !== 1) throw Error('KML XML was not closed.')
  return root
}
function descendants(node: XmlNode, name: string): XmlNode[] {
  return node.children.flatMap((c) => [...(c.name === name ? [c] : []), ...descendants(c, name)])
}
function kmlCoordinates(node: XmlNode): number[][] {
  const data = descendants(node, 'coordinates')[0]?.text.trim()
  if (!data) throw Error('A KML geometry has no coordinates.')
  return data.split(/\s+/).map((tuple) => {
    const p = tuple.split(',').map(Number)
    if (
      p.length < 2 ||
      p.length > 3 ||
      !p.every(finite) ||
      Math.abs(p[0]) > 180 ||
      Math.abs(p[1]) >= 85 ||
      (p.length === 3 && Math.abs(p[2]) > 12000)
    )
      throw Error('KML has an invalid geographic coordinate.')
    return p.slice(0, 2) // KML altitude is deliberately not adopted as measured ground or road design.
  })
}
export function parseKml(text: string): GeoJSON.FeatureCollection {
  const tree = xmlTree(text),
    marks = descendants(tree, 'placemark'),
    features: GeoJSON.Feature[] = []
  if (!descendants(tree, 'kml').length) throw Error('The document has no KML root.')
  let vertices = 0
  for (const mark of marks) {
    const name = (
      mark.children.find((c) => c.name === 'name')?.text.trim() || `KML feature ${features.length + 1}`
    ).slice(0, 200)
    const geometries: GeoJSON.Geometry[] = []
    for (const node of descendants(mark, 'linestring')) {
      const coordinates = kmlCoordinates(node)
      vertices += coordinates.length
      if (coordinates.length < 2) throw Error('A KML line needs at least two coordinates.')
      geometries.push({ type: 'LineString', coordinates })
    }
    for (const node of descendants(mark, 'polygon')) {
      const outer = descendants(node, 'outerboundaryis')[0]
      if (!outer) throw Error('A KML polygon needs an outer boundary.')
      const coordinates = [outer, ...descendants(node, 'innerboundaryis')].map(kmlCoordinates)
      for (const ring of coordinates) {
        vertices += ring.length
        if (ring.length < 4 || ring[0].some((v, k) => v !== ring.at(-1)![k]))
          throw Error('KML polygon rings must have four vertices and be closed.')
      }
      geometries.push({ type: 'Polygon', coordinates })
    }
    for (const geometry of geometries)
      features.push({
        type: 'Feature',
        geometry,
        properties: {
          name,
          kind: geometry.type === 'Polygon' ? 'avoid' : 'stream',
          source: 'KML geographic linework; altitude discarded',
        },
      })
    if (features.length > 500 || vertices > 50_000)
      throw Error('KML exceeds 500 features or 50,000 vertices; crop the file.')
  }
  if (!features.length)
    throw Error('No line or polygon features in this KML. Network links and embedded imagery are not imported.')
  return { type: 'FeatureCollection', features }
}
export async function readSpatialFile(file: Blob & { name?: string }): Promise<unknown> {
  if (file.size > 120_000_000) throw Error('Spatial import exceeds 120 MB.')
  if (/\.kmz$/i.test(file.name ?? '')) {
    const { default: JSZip } = await import('jszip'),
      zip = await JSZip.loadAsync(await file.arrayBuffer())
    const entries = Object.values(zip.files).filter((f) => !f.dir && /\.kml$/i.test(f.name))
    const entry = entries.find((f) => f.name.toLowerCase() === 'doc.kml') ?? (entries.length === 1 ? entries[0] : null)
    if (!entry) throw Error('KMZ must contain doc.kml or one unambiguous KML file.')
    const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize
    if (size !== undefined && size > 30_000_000) throw Error('Expanded KMZ KML exceeds 30 MB.')
    return parseKml(await entry.async('string'))
  }
  if (/\.kml$/i.test(file.name ?? '')) return parseKml(await file.text())
  return JSON.parse(await file.text())
}
