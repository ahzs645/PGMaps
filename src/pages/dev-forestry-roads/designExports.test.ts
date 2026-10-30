import { describe, expect, it } from 'vitest'
import { analyzeRoad, horizontalGeometry, offsetCoordinate } from './engine'
import { landXml, sectionStations, stakeoutCsv } from './designExports'
import { DEFAULT_ROAD_SETTINGS, exportGrid } from './terrain'
import type { Alignment, Coordinate, TerrainMetadata } from './types'
import { createEngineeringDesign } from './engineeringTypes'

const origin: Coordinate = [-122.8, 53.9]
const corner = offsetCoordinate(origin, 0, 200)
const road: Alignment = {
  id: 'r',
  name: 'Spur <A&B>',
  color: '#16817a',
  points: [
    { id: 'a', coordinate: origin, radiusM: 0 },
    { id: 'b', coordinate: corner, radiusM: 60 },
    { id: 'c', coordinate: offsetCoordinate(corner, 90, 200), radiusM: 0 },
  ],
  vertical: [
    { id: 'v0', chainage: 0, elevation: 799, curveLength: 0 },
    { id: 'v1', chainage: 200, elevation: 801, curveLength: 40 },
    { id: 'v2', chainage: 380, elevation: 799, curveLength: 0 },
  ],
  template: {
    leftWidth: 3,
    rightWidth: 3,
    crossfallPercent: 0,
    cutSlope: 1,
    fillSlope: 1.5,
    ditchWidth: 1,
    ditchDepth: 0.5,
    surfaceDepth: 0,
  },
  overrides: [],
}
const terrain: TerrainMetadata = { kind: 'demo', name: 'Flat', resolutionM: 1, verticalReference: 'CGVD2013' }
const flat = { elevationAt: () => 800 }
const analysis = analyzeRoad(road, flat, DEFAULT_ROAD_SETTINGS)
const grid = exportGrid(terrain, origin)

describe('engineering exports', () => {
  it('keeps missing cross-section and profile intervals as separate LandXML surface runs', () => {
    const samples = structuredClone(analysis)
    const first = samples.stations[0]
    first.section = [
      { offset: -2, ground: 800, preparedGround: 799.8, design: 799 },
      { offset: -1, ground: 800, preparedGround: 799.8, design: 799 },
      { offset: 0, ground: null, preparedGround: null, design: null },
      { offset: 1, ground: 800, preparedGround: 799.8, design: 799 },
      { offset: 2, ground: 800, preparedGround: 799.8, design: 799 },
    ]
    samples.stations[1].groundElevation = null
    const text = landXml({ name: 'Gapped source', alignment: road, analysis: samples, terrain, ...grid })
    const firstSection = text.match(/<CrossSect sta="0.000">(.*?)<\/CrossSect>/s)![1]
    for (const name of ['Ground', 'Prepared ground', 'Design']) {
      const runs = [
        ...firstSection.matchAll(
          new RegExp(`<CrossSectSurf name="${name}(?: part \\d+)?"><PntList2D>(.*?)<\\/PntList2D>`, 'g'),
        ),
      ]
      expect(runs).toHaveLength(2)
      expect(runs[0][1]).toContain('-1.000')
      expect(runs[0][1]).not.toContain(' 1.000')
      expect(runs[1][1]).toMatch(/^1.000 /)
    }
    expect(text).toContain('<ProfSurf name="Ground · Flat · part 2">')
    expect(text).not.toMatch(/NaN|undefined|null/)
  })
  it('exports original and prepared section ground as distinct LandXML surfaces', () => {
    const a = structuredClone(road)
    a.points = [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: offsetCoordinate(origin, 0, 100), radiusM: 0 },
    ]
    a.vertical = [
      { id: 's', chainage: 0, elevation: 802, curveLength: 0 },
      { id: 'e', chainage: 100, elevation: 802, curveLength: 0 },
    ]
    a.template = { ...a.template, ditchWidth: 0, ditchDepth: 0 }
    a.engineering = createEngineeringDesign()
    a.engineering.materials = [
      {
        id: 'strip',
        name: 'Topsoil',
        color: '#806040',
        cutRate: 1,
        reusableFraction: 0,
        compactionFactor: 1,
        purpose: 'stripping',
      },
    ]
    a.engineering.sitePreparation = [
      {
        id: 'prep',
        start: 0,
        end: 101,
        materialId: 'strip',
        depthM: 0.2,
        leftInsideM: 0,
        rightInsideM: 0,
        leftOutsideM: 0.3,
        rightOutsideM: 0.3,
      },
    ]
    const result = analyzeRoad(a, flat, DEFAULT_ROAD_SETTINGS)
    const xml = landXml({ name: 'Prepared road', alignment: a, analysis: result, terrain, ...grid })
    const original = xml.match(/<CrossSectSurf name="Ground"><PntList2D>(.*?)<\/PntList2D>/)![1]
    const prepared = xml.match(/<CrossSectSurf name="Prepared ground"><PntList2D>(.*?)<\/PntList2D>/)![1]
    expect(original).toContain('0.000 800.000')
    expect(prepared).toContain('0.000 799.800')
    expect(original).not.toContain('799.800')
    expect(prepared).not.toMatch(/NaN|undefined|null/)
    const legacy = landXml({ name: 'Legacy road', alignment: road, analysis, terrain, ...grid })
    expect(legacy).not.toContain('name="Prepared ground"')
  })
  it('projects a geographic source to its WGS84 UTM zone', () => {
    expect(grid.epsg).toBe(32610)
    const [e, n] = grid.toGrid(origin)
    expect(e).toBeGreaterThan(400000)
    expect(e).toBeLessThan(700000)
    expect(n).toBeGreaterThan(5900000)
  })

  it('writes LandXML lines, arcs, profile, ground and sections', () => {
    const text = landXml({
      name: 'Demo & test',
      alignment: road,
      analysis,
      terrain,
      ...grid,
      date: new Date(2026, 9, 22),
    })
    expect(text).toContain('<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2" date="2026-10-22"')
    expect(text).toContain('<CoordinateSystem epsgCode="32610"')
    expect(text.match(/<Line /g)).toHaveLength(2)
    // The radius is the grid radius through the projected ends, a little over the 60 m chainage radius.
    expect(text.match(/<Curve rot="cw" crvType="arc" radius="60\.\d{3}"/g)).toHaveLength(1)
    expect(text).toContain('<ParaCurve length="40.000">200.000 801.000</ParaCurve>')
    expect(text.match(/<PVI>/g)).toHaveLength(2)
    expect(text.match(/<CrossSect /g)!.length).toBe(sectionStations(analysis, 20).length)
    // Names are escaped; every opened element closes.
    expect(text).toContain('name="Spur &lt;A&amp;B&gt;"')
    for (const tag of ['LandXML', 'Alignments', 'Alignment', 'CoordGeom', 'Profile', 'CrossSects'])
      expect(text.match(new RegExp(`<${tag}[ >]`, 'g'))?.length).toBe(text.split(`</${tag}>`).length - 1)
  })

  it('lists slope stakes with offsets, levels and cut or fill', () => {
    const csv = stakeoutCsv({ alignment: road, analysis, ...grid, intervalM: 100 })
    const rows = csv.trim().split('\n')
    expect(rows[0]).toBe('point,station_m,code,offset_m,easting,northing,elevation_m,ground_m,cut_fill_m,epsg')
    const first = rows.slice(1).filter((r) => r.split(',')[1] === '0.00')
    expect(first.map((r) => r.split(',')[2])).toEqual(
      expect.arrayContaining([
        'centreline',
        'left-formation-edge',
        'right-formation-edge',
        'left-catch',
        'right-catch',
      ]),
    )
    const centre = first.find((r) => r.split(',')[2] === 'centreline')!.split(',')
    // Formation 799 under flat 800 ground: 1 m of cut at the centreline.
    expect(Number(centre[6])).toBeCloseTo(799, 3)
    expect(Number(centre[8])).toBeCloseTo(1, 3)
    // A catch point sits on the ground; left catches have negative offsets.
    const leftCatch = first.find((r) => r.split(',')[2] === 'left-catch')!.split(',')
    expect(Number(leftCatch[3])).toBeLessThan(0)
    expect(Number(leftCatch[6])).toBeCloseTo(800, 3)
    expect(csv).not.toMatch(/[=+@]/)
  })

  it('writes each catch point once and never prints negative zero', () => {
    const csv = stakeoutCsv({ alignment: road, analysis, ...grid })
    const rows = csv
      .trim()
      .split('\n')
      .slice(1)
      .map((r) => r.split(','))
    expect(rows.some((r) => r[2].endsWith('-daylight'))).toBe(false)
    // One row per code per station. (Where formation meets ground, the edge and catch coincide.)
    const keys = rows.map((r) => `${r[1]} ${r[2]}`)
    expect(new Set(keys).size).toBe(keys.length)
    for (const station of new Set(rows.map((r) => r[1]))) {
      const codes = rows.filter((r) => r[1] === station).map((r) => r[2])
      expect(codes.filter((c) => c === 'left-catch')).toHaveLength(1)
      expect(codes.filter((c) => c === 'right-catch')).toHaveLength(1)
    }
    // Point numbers run 1…n without gaps.
    expect(rows.map((r) => Number(r[0]))).toEqual(rows.map((_, i) => i + 1))
    expect(csv).not.toMatch(/(^|,)-0(\.0+)?(,|$)/m)
    const landxml = landXml({ name: 'N', alignment: road, analysis, terrain, ...grid })
    expect(landxml).not.toMatch(/[\s>"]-0\.0+[\s<"]/)
  })

  it('leaves a missing design level blank instead of falling back to ground', () => {
    // Station 0 loses its design: the centreline keeps its ground but has no level or cut/fill.
    const stations = analysis.stations.map((s, i) =>
      i === 0
        ? {
            ...s,
            designElevation: null,
            section: s.section.map((p) => ({ ...p, design: null })),
            leftDaylightM: null,
            rightDaylightM: null,
          }
        : s,
    )
    const csv = stakeoutCsv({ alignment: road, analysis: { ...analysis, stations }, ...grid, intervalM: 100 })
    const first = csv
      .trim()
      .split('\n')
      .slice(1)
      .map((r) => r.split(','))
      .filter((r) => r[1] === '0.00')
    const centre = first.find((r) => r[2] === 'centreline')!
    expect(centre[6]).toBe('')
    expect(centre[7]).toBe('800.000')
    expect(centre[8]).toBe('')
    expect(first.every((r) => r[6] === '')).toBe(true)
    // Ground missing too: the point has no level of any kind and is left out.
    const bare = stations.map((s, i) =>
      i === 0 ? { ...s, section: s.section.map((p) => ({ ...p, ground: null })) } : s,
    )
    const none = stakeoutCsv({ alignment: road, analysis: { ...analysis, stations: bare }, ...grid, intervalM: 100 })
    expect(none.split('\n').filter((r) => r.split(',')[1] === '0.00')).toHaveLength(0)
  })

  it('leaves missing values out of LandXML rather than writing 0', () => {
    const at = analysis.stations[1].chainage
    const stations = analysis.stations.map((s, i) =>
      i === 1 ? { ...s, groundElevation: Number.NaN, section: s.section.map((p) => ({ ...p, ground: null })) } : s,
    )
    const vertical = road.vertical.map((p) => (p.id === 'v1' ? { ...p, elevation: Number.NaN } : p))
    const text = landXml({
      name: 'Gaps',
      alignment: { ...road, vertical },
      analysis: { ...analysis, stations },
      terrain,
      ...grid,
      sectionIntervalM: at,
    })
    expect(text).not.toContain('NaN')
    // The PVI with no elevation is omitted, not written as 0, and no curve is attached to a neighbour.
    expect(text).toContain('<ProfAlign name="Design formation"><PVI>0.000 799.000</PVI><PVI>380.000 799.000</PVI>')
    const ground = text.match(/<ProfSurf [^>]*><PntList2D>([^<]*)</)![1].split(' ')
    const chainages = ground.filter((_, i) => i % 2 === 0)
    expect(chainages).not.toContain(at.toFixed(3))
    expect(ground.filter((_, i) => i % 2 === 1).every((z) => z === '800.000')).toBe(true)
    // The section at that station keeps its design and drops the empty ground surface.
    const section = text.match(new RegExp(`<CrossSect sta="${at.toFixed(3)}">.*?</CrossSect>`))![0]
    expect(section).toContain('name="Design"')
    expect(section).not.toContain('name="Ground"')
  })

  it('writes line and arc lengths that match the distance between their exported coordinates', () => {
    // A 983 m east–west line at Prince George, then a curve: grid distance is ~0.3 % over chainage.
    const start: Coordinate = [-122.75, 53.92]
    const pi = offsetCoordinate(start, 90, 983)
    const long: Alignment = {
      ...road,
      points: [
        { id: 'a', coordinate: start, radiusM: 0 },
        { id: 'b', coordinate: pi, radiusM: 120 },
        { id: 'c', coordinate: offsetCoordinate(pi, 30, 400), radiusM: 0 },
      ],
      vertical: [],
    }
    const result = analyzeRoad(long, flat, DEFAULT_ROAD_SETTINGS)
    const pieces = horizontalGeometry(long)
    const text = landXml({ name: 'PG', alignment: long, analysis: result, terrain, ...exportGrid(terrain, start) })
    const point = (s: string) => {
      const [north, east] = s.split(' ').map(Number)
      return [east, north] as const
    }
    const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(b[0] - a[0], b[1] - a[1])
    const lines = [...text.matchAll(/<Line staStart="([^"]+)" length="([^"]+)"><Start>([^<]+)<\/Start><End>([^<]+)</g)]
    expect(lines).toHaveLength(2)
    for (const [, , length, a, b] of lines)
      expect(Math.abs(Number(length) - dist(point(a), point(b)))).toBeLessThan(1e-3)
    // The first line's grid length is longer than its chainage length, and stations stay chainage.
    expect(Number(lines[0][2]) / pieces[0].length).toBeGreaterThan(1.002)
    expect(lines[0][1]).toBe('0.000')
    expect(Number(lines[1][1])).toBeCloseTo(pieces[2].station, 3)
    const [, radius, length, staStart, a, c, b] = text.match(
      /<Curve rot="(?:cw|ccw)" crvType="arc" radius="([^"]+)" length="([^"]+)" staStart="([^"]+)"><Start>([^<]+)<\/Start><Center>([^<]+)<\/Center><End>([^<]+)</,
    )!
    const [s, centre, e] = [point(a), point(c), point(b)]
    expect(Math.abs(dist(s, centre) - Number(radius))).toBeLessThan(1e-3)
    expect(Math.abs(dist(e, centre) - Number(radius))).toBeLessThan(1e-3)
    const u = [s[0] - centre[0], s[1] - centre[1]],
      v = [e[0] - centre[0], e[1] - centre[1]]
    const sweep = Math.abs(Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]))
    expect(Math.abs(Number(radius) * sweep - Number(length))).toBeLessThan(1e-3)
    expect(Number(staStart)).toBeCloseTo(pieces[1].station, 3)
    // Consecutive elements share their end and start coordinates.
    expect(lines[0][4]).toBe(a)
    expect(b).toBe(lines[1][3])
    expect(text).toMatch(/grid length ÷ chainage over the alignment is 1\.00\d{3}/)
  })

  it('scales each clothoid so its exported length and radius reach its exported end', () => {
    const pi = offsetCoordinate(origin, 90, 400)
    const spiralRoad: Alignment = {
      ...road,
      points: [
        { id: 'a', coordinate: origin, radiusM: 0 },
        { id: 'b', coordinate: pi, radiusM: 80, spiralM: 40 },
        { id: 'c', coordinate: offsetCoordinate(pi, 0, 400), radiusM: 0 },
      ],
      vertical: [],
    }
    const result = analyzeRoad(spiralRoad, flat, DEFAULT_ROAD_SETTINGS)
    const text = landXml({ name: 'S', alignment: spiralRoad, analysis: result, terrain, ...grid })
    const spirals = [
      ...text.matchAll(
        /<Spiral [^>]*length="([^"]+)" radiusStart="([^"]+)" radiusEnd="([^"]+)"[^>]*><Start>([^<]+)<\/Start><End>([^<]+)</g,
      ),
    ]
    expect(spirals).toHaveLength(2)
    for (const [, length, radiusStart, radiusEnd, a, b] of spirals) {
      const L = Number(length),
        R = Number(radiusStart === 'INF' ? radiusEnd : radiusStart)
      // Chord of a clothoid from zero curvature to 1/R over L, by fine midpoint integration.
      let x = 0,
        y = 0
      for (let i = 0; i < 4000; i++) {
        const u = ((i + 0.5) / 4000) * L
        x += Math.cos((u * u) / (2 * R * L)) * (L / 4000)
        y += Math.sin((u * u) / (2 * R * L)) * (L / 4000)
      }
      const [n0, e0] = a.split(' ').map(Number),
        [n1, e1] = b.split(' ').map(Number)
      expect(Math.abs(Math.hypot(x, y) - Math.hypot(e1 - e0, n1 - n0))).toBeLessThan(1e-3)
      expect(L).toBeGreaterThan(40)
      expect(L).toBeLessThan(40 * 1.004)
    }
  })
})
