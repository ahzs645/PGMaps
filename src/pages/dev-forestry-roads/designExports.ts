/**
 * Engineering exchange outputs: LandXML 1.2 (alignment, profile, ground and cross-sections) and a
 * slope-stake point file. Both take a `toGrid` projection so coordinates come out in the terrain's
 * projected CRS. Pure: no DOM or network access.
 */
import { horizontalGeometry } from './engine'
import { sectionCodePoints } from './sectionGeometry'
import type { ShapeLayer } from './shapefile'
import type { Alignment, Coordinate, RoadAnalysis, RoadStation, TerrainMetadata } from './types'

export type ToGrid = (coordinate: Coordinate) => [number, number]

const xml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)
/** A fixed-point number, or null when the value is missing. Never prints "-0.000". */
const num = (value: number | null | undefined, digits = 3): string | null => {
  if (value == null || !Number.isFinite(value)) return null
  const text = value.toFixed(digits)
  return /^-0(\.0*)?$/.test(text) ? text.slice(1) : text
}
/** A CSV field: missing values stay blank. */
const cell = (value: number | null | undefined, digits = 3) => num(value, digits) ?? ''
/** LandXML points are "northing easting"; null when either coordinate is missing. */
const ne = ([e, north]: [number, number]) => {
  const a = num(north),
    b = num(e)
  return a === null || b === null ? null : `${a} ${b}`
}
/** "x y" pairs of a 2D point list, skipping any pair with a missing value. */
const pointList = (pairs: [number | null | undefined, number | null | undefined][]) =>
  pairs
    .map(([a, b]) => {
      const x = num(a),
        y = num(b)
      return x === null || y === null ? '' : `${x} ${y}`
    })
    .filter(Boolean)
    .join(' ')

/** Chord of a clothoid running from zero curvature to 1/radius over `length` (Simpson's rule). */
function clothoidChord(length: number, radius: number) {
  const steps = 64
  let x = 0,
    y = 0
  for (let i = 0; i <= steps; i++) {
    const u = (length * i) / steps,
      weight = i === 0 || i === steps ? 1 : i % 2 ? 4 : 2,
      heading = (u * u) / (2 * radius * length)
    x += weight * Math.cos(heading)
    y += weight * Math.sin(heading)
  }
  return (Math.hypot(x, y) * length) / steps / 3
}

/**
 * One CoordGeom element in grid units. The road model measures lengths on a sphere while the
 * coordinates are projected, so each element is scaled to the chord between its projected ends:
 * a line's length is that chord, and an arc or clothoid keeps its shape and deflection with its
 * length and radii multiplied by grid chord ÷ model chord, its centre placed from the projected
 * ends. Every element then closes on its own coordinates. Stations stay road chainage.
 */
function gridElement(piece: ReturnType<typeof horizontalGeometry>[number], toGrid: ToGrid) {
  // Measure from the coordinates as written (to the millimetre), so lengths agree with them.
  const written = (c: [number, number]) => c.map((v) => Number(num(v) ?? NaN)) as [number, number]
  const start = written(toGrid(piece.start)),
    end = written(toGrid(piece.end))
  const startText = ne(start),
    endText = ne(end)
  if (startText === null || endText === null) return null
  const dx = end[0] - start[0],
    dy = end[1] - start[1],
    chord = Math.hypot(dx, dy)
  const sta = num(piece.station)
  const staStart = sta === null ? '' : ` staStart="${sta}"`
  if (piece.kind === 'line') {
    return {
      length: chord,
      model: piece.length,
      text: `<Line${staStart} length="${num(chord)}"><Start>${startText}</Start><End>${endText}</End></Line>`,
    }
  }
  if (piece.kind === 'spiral') {
    const radius = Number.isFinite(piece.radiusStart) ? piece.radiusStart : piece.radiusEnd
    const scale = chord / clothoidChord(piece.length, radius)
    const length = num(piece.length * scale)
    const radiusAt = (r: number) => (Number.isFinite(r) ? num(r * scale) : 'INF')
    const radiusStart = radiusAt(piece.radiusStart),
      radiusEnd = radiusAt(piece.radiusEnd)
    if (length === null || radiusStart === null || radiusEnd === null) return null
    return {
      length: piece.length * scale,
      model: piece.length,
      text: `<Spiral spiType="clothoid" rot="${piece.rotation}" length="${length}" radiusStart="${radiusStart}" radiusEnd="${radiusEnd}"${staStart}><Start>${startText}</Start><End>${endText}</End></Spiral>`,
    }
  }
  const delta = piece.length / piece.radius
  const radius = chord / (2 * Math.sin(delta / 2))
  // The centre is to the left of the chord for a counter-clockwise arc, on the chord's normal.
  const toCentre = (piece.rotation === 'ccw' ? 1 : -1) * radius * Math.cos(delta / 2)
  const centre: [number, number] = [
    (start[0] + end[0]) / 2 - (dy / chord) * toCentre,
    (start[1] + end[1]) / 2 + (dx / chord) * toCentre,
  ]
  const centreText = ne(centre),
    radiusText = num(radius),
    length = num(radius * delta)
  if (centreText === null || radiusText === null || length === null) return null
  return {
    length: radius * delta,
    model: piece.length,
    text: `<Curve rot="${piece.rotation}" crvType="arc" radius="${radiusText}" length="${length}"${staStart}><Start>${startText}</Start><Center>${centreText}</Center><End>${endText}</End></Curve>`,
  }
}

/**
 * LandXML 1.2 for the active road. A missing value is never written as a number: a point, PVI,
 * section surface or element whose value is missing is left out.
 */
export function landXml({
  name,
  alignment,
  analysis,
  terrain,
  toGrid,
  epsg,
  sectionIntervalM = 20,
  date = new Date(),
}: {
  name: string
  alignment: Alignment
  analysis: RoadAnalysis
  terrain: TerrainMetadata
  toGrid: ToGrid
  epsg: number
  sectionIntervalM?: number
  date?: Date
}): string {
  const elements = horizontalGeometry(alignment)
    .map((piece) => gridElement(piece, toGrid))
    .filter((element) => element !== null)
  const gridLength = elements.reduce((sum, e) => sum + e.length, 0),
    modelLength = elements.reduce((sum, e) => sum + e.model, 0)
  const geometry = elements.map((e) => e.text).join('\n        ')
  const vertical = [...alignment.vertical]
    .filter((p) => num(p.chainage) !== null && num(p.elevation) !== null)
    .sort((a, b) => a.chainage - b.chainage)
  const profile = vertical
    .map((p, i) =>
      Number.isFinite(p.curveLength) && p.curveLength > 0 && i > 0 && i < vertical.length - 1
        ? `<ParaCurve length="${num(p.curveLength)}">${num(p.chainage)} ${num(p.elevation)}</ParaCurve>`
        : `<PVI>${num(p.chainage)} ${num(p.elevation)}</PVI>`,
    )
    .join('')
  const ground = pointList(analysis.stations.map((s) => [s.chainage, s.groundElevation]))
  const sections = sectionStations(analysis, sectionIntervalM)
    .map((s) => {
      const sta = num(s.chainage)
      if (sta === null) return ''
      const surface = (label: string, key: 'design' | 'ground') => {
        const points = pointList(s.section.map((p) => [p.offset, p[key]]))
        return points ? `<CrossSectSurf name="${label}"><PntList2D>${points}</PntList2D></CrossSectSurf>` : ''
      }
      const surfaces = surface('Design', 'design') + surface('Ground', 'ground')
      return surfaces ? `<CrossSect sta="${sta}">${surfaces}</CrossSect>` : ''
    })
    .filter(Boolean)
    .join('\n        ')
  const profileBody = [
    profile ? `<ProfAlign name="Design formation">${profile}</ProfAlign>` : '',
    ground ? `<ProfSurf name="Ground · ${xml(terrain.name)}"><PntList2D>${ground}</PntList2D></ProfSurf>` : '',
  ]
    .filter(Boolean)
    .join('\n        ')
  const ratio = modelLength > 0 ? num(gridLength / modelLength, 5) : null
  const pad = (v: number) => String(v).padStart(2, '0')
  return `<?xml version="1.0" encoding="UTF-8"?>
<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2" date="${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}" time="${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}">
  <Units><Metric linearUnit="meter" areaUnit="squareMeter" volumeUnit="cubicMeter" angularUnit="decimal degrees" directionUnit="decimal degrees"/></Units>
  <CoordinateSystem epsgCode="${epsg}" name="EPSG:${epsg}" verticalDatum="${xml(terrain.verticalReference)}"/>
  <Project name="${xml(name)}" desc="Preliminary planning geometry; not a construction design"/>
  <Application name="PG Maps forest road design" manufacturer="PG Maps" version="1"/>
  <!-- Element lengths, radii and centres are grid values in EPSG:${epsg}, consistent with the exported coordinates. Stations (staStart, PVI, ProfSurf and CrossSect sta) are chainage along the road model, measured on a sphere${ratio ? `; grid length ÷ chainage over the alignment is ${ratio}` : ''}. -->
  <Alignments name="${xml(name)}">
    <Alignment name="${xml(alignment.name)}" length="${num(gridLength)}" staStart="0">
      <CoordGeom>
        ${geometry}
      </CoordGeom>${
        profileBody
          ? `
      <Profile name="${xml(alignment.name)}">
        ${profileBody}
      </Profile>`
          : ''
      }${
        sections
          ? `
      <CrossSects>
        ${sections}
      </CrossSects>`
          : ''
      }
    </Alignment>
  </Alignments>
</LandXML>
`
}

/** Stations at the reporting interval (nearest calculated station to each multiple), plus the end. */
export function sectionStations(analysis: RoadAnalysis, intervalM: number): RoadStation[] {
  if (!analysis.stations.length || !(intervalM > 0)) return []
  const picked = new Map<number, RoadStation>()
  for (let chainage = 0; chainage <= analysis.length + 1e-6; chainage += intervalM) {
    const s = analysis.stations.reduce((best, x) =>
      Math.abs(x.chainage - chainage) < Math.abs(best.chainage - chainage) ? x : best,
    )
    picked.set(s.index, s)
  }
  const last = analysis.stations[analysis.stations.length - 1]
  picked.set(last.index, last)
  return [...picked.values()].sort((a, b) => a.chainage - b.chainage)
}

/**
 * Slope-stake points per reporting station: centreline, formation edges (hinges), ditch bottoms
 * and catch points where the batter meets the ground, with their cut (+) or fill (−) and the
 * horizontal distance from the centreline. Numbers and fixed codes only, so the file is safe to
 * open in a spreadsheet. A missing level, ground or cut/fill is a blank field; a point with
 * neither design nor ground is left out.
 */
export function stakeoutCsv({
  alignment,
  analysis,
  toGrid,
  epsg,
  intervalM = 20,
}: {
  alignment: Alignment
  analysis: RoadAnalysis
  toGrid: ToGrid
  epsg: number
  intervalM?: number
}): string {
  const rows = ['point,station_m,code,offset_m,easting,northing,elevation_m,ground_m,cut_fill_m,epsg']
  let point = 0
  const R = 6371008.8,
    RAD = Math.PI / 180
  const at = (s: RoadStation, offset: number): Coordinate => {
    // Offset perpendicular to the station bearing: positive to the right, as in the sections.
    const bearing = (s.bearing + 90) * RAD,
      [lng, lat] = s.coordinate
    return [
      lng + (Math.sin(bearing) * offset) / (R * Math.cos(lat * RAD) * RAD),
      lat + (Math.cos(bearing) * offset) / (R * RAD),
    ]
  }
  for (const s of sectionStations(analysis, intervalM)) {
    const template = analysis.engineering?.stations[s.index]?.template ?? alignment.template
    // The section's daylight point is the catch point: one stake per side, named "…-catch".
    for (const p of sectionCodePoints(s, template)) {
      if (!Number.isFinite(p.offset) || (p.ground === null && p.design === null)) continue
      const catchPoint = p.code.endsWith('-daylight')
      // Design level, never ground standing in for it. At the catch the batter meets the ground.
      const level = catchPoint ? (p.ground ?? p.design) : p.design
      const [easting, northing] = toGrid(at(s, p.offset))
      const cutFill = p.ground !== null && p.design !== null ? p.ground - p.design : null
      point++
      rows.push(
        [
          point,
          cell(s.chainage, 2),
          catchPoint ? p.code.replace(/-daylight$/, '-catch') : p.code,
          cell(p.offset),
          cell(easting),
          cell(northing),
          cell(level),
          cell(p.ground),
          cell(cutFill),
          epsg,
        ].join(','),
      )
    }
  }
  return rows.join('\n') + '\n'
}

/** GIS layers for a zipped shapefile: every road centreline, the active road's stations, its culverts. */
export function roadShapefileLayers(
  alignments: Alignment[],
  analyses: Map<string, RoadAnalysis>,
  activeId: string,
): ShapeLayer[] {
  const active = analyses.get(activeId)
  const round = (v: number | null | undefined, d = 2) =>
    v == null || !Number.isFinite(v) ? null : Number(v.toFixed(d))
  return [
    {
      name: 'road_centrelines',
      type: 'polyline',
      fields: [
        { name: 'NAME', type: 'C', length: 80 },
        { name: 'LENGTH_M', type: 'N', length: 12, decimals: 2 },
        { name: 'MAXGRADE', type: 'N', length: 8, decimals: 2 },
        { name: 'CUT_M3', type: 'N', length: 14, decimals: 1 },
        { name: 'FILL_M3', type: 'N', length: 14, decimals: 1 },
        { name: 'COST_CAD', type: 'N', length: 14, decimals: 0 },
        { name: 'COVER_PCT', type: 'N', length: 7, decimals: 2 },
      ],
      features: alignments.flatMap((a) => {
        const r = analyses.get(a.id)
        return r && r.centerline.length > 1
          ? [
              {
                parts: [r.centerline],
                attributes: {
                  NAME: a.name,
                  LENGTH_M: round(r.length),
                  MAXGRADE: round(r.maxGradePercent),
                  CUT_M3: round(r.cutVolumeM3, 1),
                  FILL_M3: round(r.fillVolumeM3, 1),
                  COST_CAD: round(r.estimatedCost, 0),
                  COVER_PCT: round(r.coveragePercent),
                },
              },
            ]
          : []
      }),
    },
    {
      name: 'road_stations',
      type: 'point',
      fields: [
        { name: 'STATION_M', type: 'N', length: 12, decimals: 2 },
        { name: 'GROUND_M', type: 'N', length: 10, decimals: 2 },
        { name: 'DESIGN_M', type: 'N', length: 10, decimals: 2 },
        { name: 'GRADE_PCT', type: 'N', length: 8, decimals: 2 },
        { name: 'CUT_M2', type: 'N', length: 10, decimals: 2 },
        { name: 'FILL_M2', type: 'N', length: 10, decimals: 2 },
        { name: 'FLAGS', type: 'C', length: 200 },
      ],
      features: (active?.stations ?? []).map((s) => ({
        point: s.coordinate,
        attributes: {
          STATION_M: round(s.chainage),
          GROUND_M: round(s.groundElevation),
          DESIGN_M: round(s.designElevation),
          GRADE_PCT: round(s.gradePercent),
          CUT_M2: round(s.cutAreaM2),
          FILL_M2: round(s.fillAreaM2),
          FLAGS: s.flags.join('; '),
        },
      })),
    },
    {
      name: 'road_culverts',
      type: 'polyline',
      fields: [
        { name: 'NAME', type: 'C', length: 80 },
        { name: 'STATION_M', type: 'N', length: 12, decimals: 2 },
        { name: 'DIAM_M', type: 'N', length: 8, decimals: 3 },
        { name: 'COVER_M', type: 'N', length: 8, decimals: 2 },
        { name: 'COST_CAD', type: 'N', length: 14, decimals: 0 },
      ],
      features: (active?.engineering?.culverts ?? []).map((c) => ({
        parts: [[c.start, c.end]],
        attributes: {
          NAME: c.name,
          STATION_M: round(c.chainage),
          DIAM_M: round(
            alignments.find((a) => a.id === activeId)?.engineering?.culverts.find((x) => x.id === c.id)?.diameterM,
            3,
          ),
          COVER_M: round(c.coverM),
          COST_CAD: round(c.installedCost, 0),
        },
      })),
    },
  ]
}
