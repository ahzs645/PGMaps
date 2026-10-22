/**
 * Engineering exchange outputs: LandXML 1.2 (alignment, profile, ground and cross-sections) and a
 * slope-stake point file. Both take a `toGrid` projection so coordinates come out in the terrain's
 * projected CRS. Pure: no DOM or network access.
 */
import { horizontalGeometry } from './engine'
import { sectionCodePoints, sectionSampleAt } from './sectionGeometry'
import type { Alignment, Coordinate, RoadAnalysis, RoadStation, TerrainMetadata } from './types'

export type ToGrid = (coordinate: Coordinate) => [number, number]

const xml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)
const n = (value: number, digits = 3) => (Number.isFinite(value) ? value.toFixed(digits) : '0')
/** LandXML points are "northing easting". */
const ne = (toGrid: ToGrid, c: Coordinate) => {
  const [e, north] = toGrid(c)
  return `${n(north)} ${n(e)}`
}

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
  const geometry = horizontalGeometry(alignment)
    .map((piece) =>
      piece.kind === 'line'
        ? `<Line staStart="${n(piece.station)}" length="${n(piece.length)}"><Start>${ne(toGrid, piece.start)}</Start><End>${ne(toGrid, piece.end)}</End></Line>`
        : `<Curve rot="${piece.rotation}" crvType="arc" radius="${n(piece.radius)}" length="${n(piece.length)}" staStart="${n(piece.station)}"><Start>${ne(toGrid, piece.start)}</Start><Center>${ne(toGrid, piece.center)}</Center><End>${ne(toGrid, piece.end)}</End></Curve>`,
    )
    .join('\n        ')
  const vertical = [...alignment.vertical].sort((a, b) => a.chainage - b.chainage)
  const profile = vertical.length
    ? vertical
        .map((p, i) =>
          p.curveLength > 0 && i > 0 && i < vertical.length - 1
            ? `<ParaCurve length="${n(p.curveLength)}">${n(p.chainage)} ${n(p.elevation)}</ParaCurve>`
            : `<PVI>${n(p.chainage)} ${n(p.elevation)}</PVI>`,
        )
        .join('')
    : ''
  const ground = analysis.stations
    .filter((s) => s.groundElevation !== null)
    .map((s) => `${n(s.chainage)} ${n(s.groundElevation!)}`)
    .join(' ')
  const sections = sectionStations(analysis, sectionIntervalM)
    .map((s) => {
      const surface = (key: 'design' | 'ground') =>
        s.section
          .filter((p) => p[key] !== null)
          .map((p) => `${n(p.offset)} ${n(p[key]!)}`)
          .join(' ')
      const design = surface('design')
      return `<CrossSect sta="${n(s.chainage)}">${design ? `<CrossSectSurf name="Design"><PntList2D>${design}</PntList2D></CrossSectSurf>` : ''}<CrossSectSurf name="Ground"><PntList2D>${surface('ground')}</PntList2D></CrossSectSurf></CrossSect>`
    })
    .join('\n        ')
  const pad = (v: number) => String(v).padStart(2, '0')
  return `<?xml version="1.0" encoding="UTF-8"?>
<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2" date="${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}" time="${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}">
  <Units><Metric linearUnit="meter" areaUnit="squareMeter" volumeUnit="cubicMeter" angularUnit="decimal degrees" directionUnit="decimal degrees"/></Units>
  <CoordinateSystem epsgCode="${epsg}" name="EPSG:${epsg}" verticalDatum="${xml(terrain.verticalReference)}"/>
  <Project name="${xml(name)}" desc="Preliminary planning geometry; not a construction design"/>
  <Application name="PG Maps forest road design" manufacturer="PG Maps" version="1"/>
  <Alignments name="${xml(name)}">
    <Alignment name="${xml(alignment.name)}" length="${n(analysis.length)}" staStart="0">
      <CoordGeom>
        ${geometry}
      </CoordGeom>
      <Profile name="${xml(alignment.name)}">
        ${profile ? `<ProfAlign name="Design formation">${profile}</ProfAlign>` : ''}
        <ProfSurf name="Ground · ${xml(terrain.name)}"><PntList2D>${ground}</PntList2D></ProfSurf>
      </Profile>
      <CrossSects>
        ${sections}
      </CrossSects>
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
 * open in a spreadsheet.
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
    const points = sectionCodePoints(s, template).map((p) => ({ code: p.code, offset: p.offset }))
    if (s.leftDaylightM !== null) points.push({ code: 'left-catch', offset: -Math.abs(s.leftDaylightM) })
    if (s.rightDaylightM !== null) points.push({ code: 'right-catch', offset: Math.abs(s.rightDaylightM) })
    for (const p of points.sort((a, b) => a.offset - b.offset)) {
      const sample = sectionSampleAt(s, p.offset)
      const level = p.code.endsWith('catch') ? sample.ground : (sample.design ?? sample.ground)
      if (level === null) continue
      const [easting, northing] = toGrid(at(s, p.offset))
      const cutFill = sample.ground !== null && sample.design !== null ? sample.ground - sample.design : null
      point++
      rows.push(
        [
          point,
          n(s.chainage, 2),
          p.code,
          n(p.offset, 3),
          n(easting, 3),
          n(northing, 3),
          n(level, 3),
          sample.ground === null ? '' : n(sample.ground, 3),
          cutFill === null ? '' : n(cutFill, 3),
          epsg,
        ].join(','),
      )
    }
  }
  return rows.join('\n') + '\n'
}
