import { describe, expect, it } from 'vitest'
import { analyzeRoad, offsetCoordinate } from './engine'
import { planSheetFraming, plotBookHtml, rangedMaterialQuantities, SHEET_FRAME } from './plotBook'
import { reportingRows } from './stationReport'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE, exportGrid } from './terrain'
import { createReportChapter, createRoadReportSettings, parseRoadReportSettings } from './reportSettings'
import { createEngineeringDesign } from './engineeringTypes'
import type { Alignment, Coordinate, RoadStation, TerrainMetadata } from './types'
import type { Culvert } from './engineeringTypes'
import { chartStats, gradeAxis, intervalStats, valueAxis } from './chartsSheet'
import { chartsTitle } from './chartsOptions'

const origin: Coordinate = [-122.8, 53.9]
const alignment: Alignment = {
  id: 'r',
  name: 'Spur <1>',
  color: '#16817a',
  points: [
    { id: 'a', coordinate: origin, radiusM: 0 },
    { id: 'b', coordinate: offsetCoordinate(origin, 60, 600), radiusM: 0 },
  ],
  vertical: [
    { id: 's', chainage: 0, elevation: 799, curveLength: 0 },
    { id: 'e', chainage: 600, elevation: 805, curveLength: 0 },
  ],
  template: { ...DEFAULT_TEMPLATE },
  overrides: [],
}
const terrain: TerrainMetadata = { kind: 'demo', name: 'Slope', resolutionM: 1, verticalReference: 'CGVD2013' }
const analysis = analyzeRoad(alignment, { elevationAt: (lng) => 800 + (lng - origin[0]) * 1000 }, DEFAULT_ROAD_SETTINGS)

describe('plot book', () => {
  it('is not printed from results that leave out an invalid input', () => {
    const stale = {
      ...analysis,
      invalidInput: { message: 'Road section: cut batter (H:V) must be 0.1 to 10.', leftOut: 'input' as const },
    }
    expect(() =>
      plotBookHtml({ projectName: 'Demo', alignment, analysis: stale, terrain, ...exportGrid(terrain, origin) }),
    ).toThrow(
      'Plot book was not exported: an input is invalid, and this file would leave it out without saying so. Road section: cut batter (H:V) must be 0.1 to 10. Correct it and export again.',
    )
  })
  it('lays out plan-and-profile sheets per window and section sheets of twelve', () => {
    const book = plotBookHtml({
      projectName: 'Demo & book',
      alignment,
      analysis,
      terrain,
      ...exportGrid(terrain, origin),
      sheetLengthM: 250,
      sectionIntervalM: 20,
    })
    // 600 m at 250 m per sheet → 3 plan-and-profile sheets; 31 sections → 3 section sheets.
    expect(book.match(/<section class="sheet">/g)).toHaveLength(6)
    expect(book).toContain('Sheet 1 of 6')
    expect(book).toContain('Plan &amp; profile 0+000.0–0+250.0')
    expect(book).toContain('Mass haul (m³)')
    expect(book).toContain('Cross-sections 0+000.0–0+220.0')
    expect(book).toContain('@page{size:A3 landscape')
    expect(book).toContain('Spur &lt;1&gt;')
    expect(book).not.toContain('NaN')
  })

  it('draws the mass balance through road with unknown earthwork and shades that road', () => {
    const local = (lng: number, lat: number) => {
      const east = (lng - origin[0]) * (Math.PI / 180) * 6371008.8 * Math.cos((origin[1] * Math.PI) / 180)
      return Math.hypot(east, (lat - origin[1]) * (Math.PI / 180) * 6371008.8)
    }
    const holed = analyzeRoad(
      alignment,
      { elevationAt: (lng, lat) => (Math.abs(local(lng, lat) - 300) < 5 ? NaN : 800 + (lng - origin[0]) * 1000) },
      DEFAULT_ROAD_SETTINGS,
    )
    expect(holed.coveragePercent).toBeLessThan(100)
    const book = plotBookHtml({
      projectName: 'P',
      alignment,
      analysis: holed,
      terrain,
      ...exportGrid(terrain, origin),
      sheetLengthM: 600,
    })
    expect(book.match(/data-role="unknown-earthwork"/g)).toHaveLength(1)
    expect(book).toContain('shaded: earthwork unknown, balance carried across')
    // One unbroken mass line: a single move-to, with a vertex at every station of the sheet.
    const mass = book.match(/<path d="([^"]+)" fill="none" stroke="#7c3aed"/)![1]
    expect(mass.match(/M/g)).toHaveLength(1)
    expect(mass.match(/L/g)).toHaveLength(holed.stations.length - 1)
    // A complete road has nothing to shade.
    expect(
      plotBookHtml({ projectName: 'P', alignment, analysis, terrain, ...exportGrid(terrain, origin) }),
    ).not.toContain('unknown-earthwork')
  })

  it('says on every plan when contours are unavailable', () => {
    for (const contours of [undefined, { type: 'FeatureCollection' as const, features: [] }]) {
      const book = plotBookHtml({
        projectName: 'P',
        alignment,
        analysis,
        terrain,
        contours,
        ...exportGrid(terrain, origin),
      })
      expect(book.match(/>Contours unavailable</g)).toHaveLength(3)
    }
  })

  it('prints the contour interval on every plan', () => {
    const contours: GeoJSON.FeatureCollection<GeoJSON.MultiLineString> = {
      type: 'FeatureCollection',
      features: [800, 802].map((elevation) => ({
        type: 'Feature',
        properties: { elevation_m: elevation, index: false, interval_m: 2, preview_resolution_m: 4.25 },
        geometry: {
          type: 'MultiLineString',
          coordinates: [[origin, offsetCoordinate(origin, 0, 100 + elevation - 800)]],
        },
      })),
    }
    const book = plotBookHtml({
      projectName: 'P',
      alignment,
      analysis,
      terrain,
      contours,
      ...exportGrid(terrain, origin),
    })
    expect(book.match(/>Contours 2 m \(index 10 m\) · from a 4\.3 m sample grid</g)).toHaveLength(3)
    expect(book).not.toContain('Contours unavailable')
  })

  it('authors ordered ranged chapters, table columns, label text and A4 paper without changing analysis', () => {
    const settings = createRoadReportSettings()
    settings.paper = 'A4'
    settings.chapters = [
      {
        ...createReportChapter('schedule', 'table'),
        title: 'Chosen station fields',
        startM: 100,
        endM: 200,
        columns: ['station', 'grade', 'flags'],
        sectionIntervalM: 50,
      },
      { ...createReportChapter('plan-profile', 'plan'), title: 'Short design', startM: 100, endM: 200 },
      createReportChapter('curves', 'curves'),
    ]
    settings.subviews.mass = false
    settings.subviews.legend = false
    settings.subviews.contours = false
    settings.stationLabel = '{road} @ {station}'
    const before = JSON.stringify(analysis)
    const book = plotBookHtml({
      projectName: 'P <script>',
      alignment,
      analysis,
      terrain,
      settings,
      ...exportGrid(terrain, origin),
    })
    expect(book.match(/<section class="sheet">/g)).toHaveLength(3)
    expect(book.indexOf('Chosen station fields')).toBeLessThan(book.indexOf('Short design'))
    expect(book).toContain('Short design 0+100.0–0+200.0')
    expect(book).toContain('Spur &lt;1&gt; @ 0+100')
    expect(book).toContain('@page{size:A4 landscape')
    expect(book).toContain('Grade (%)')
    expect(book).not.toContain('Interval cut (m³)')
    expect(book).not.toContain('Mass haul (m³)')
    expect(book).toContain('Contours hidden')
    expect(book).not.toContain('<script>')
    expect(JSON.stringify(analysis)).toBe(before)
  })

  it('uses physical print scale to shorten windows and refuses excessive sheet counts before rendering', () => {
    const settings = createRoadReportSettings()
    settings.chapters = [{ ...settings.chapters[0], horizontalScale: 1000 }]
    settings.chapters[0].sheetLengthM = 10000
    const book = plotBookHtml({
      projectName: 'P',
      alignment,
      analysis,
      terrain,
      settings,
      ...exportGrid(terrain, origin),
    })
    expect(book.match(/<section class="sheet">/g)).toHaveLength(2)
    expect(book).toContain('Horizontal 1:1000')
    expect(book).toContain('H 1:1000, V×1')
    settings.chapters[0].horizontalScale = 50
    expect(() =>
      plotBookHtml({
        projectName: 'P',
        alignment,
        analysis: { ...analysis, length: 100000 },
        terrain,
        settings,
        ...exportGrid(terrain, origin),
      }),
    ).toThrow('500 sheets')
  })

  it('includes prepared ground separately from source ground and design in cross-sections', () => {
    const settings = createRoadReportSettings()
    settings.chapters = [createReportChapter('sections', 'prepared')]
    const prepared = {
      ...analysis,
      stations: analysis.stations.map((s) => ({
        ...s,
        section: s.section.map((p) => ({ ...p, preparedGround: p.ground === null ? null : p.ground - 0.2 })),
      })),
    }
    const book = plotBookHtml({
      projectName: 'P',
      alignment,
      analysis: prepared,
      terrain,
      settings,
      ...exportGrid(terrain, origin),
    })
    expect(book).toContain('data-role="prepared-ground"')
    expect(book).not.toContain('NaN')
  })

  it('clips a material takeoff to range boundaries with the same volume basis as the engine', () => {
    const engineering = createEngineeringDesign()
    engineering.materials = [
      { id: 'rock', name: 'Rock', color: '#888888', cutRate: 10, reusableFraction: 0.8, compactionFactor: 0.9 },
    ]
    engineering.strata = [{ id: 'h', start: 0, end: 100, materialId: 'rock', topDepthM: 0, bottomDepthM: null }]
    const cut: Alignment = {
      ...alignment,
      points: [
        { id: 'a', coordinate: origin, radiusM: 0 },
        { id: 'b', coordinate: offsetCoordinate(origin, 0, 100), radiusM: 0 },
      ],
      vertical: [
        { id: 's', chainage: 0, elevation: 798, curveLength: 0 },
        { id: 'e', chainage: 100, elevation: 798, curveLength: 0 },
      ],
      engineering,
    }
    const result = analyzeRoad(cut, { elevationAt: () => 800 }, DEFAULT_ROAD_SETTINGS)
    const full = rangedMaterialQuantities(result, 0, result.length).find((m) => m.materialId === 'rock')!
    const half = rangedMaterialQuantities(result, 25, 75).find((m) => m.materialId === 'rock')!
    expect(full.bankCutM3).toBeCloseTo(result.engineering!.materials.find((m) => m.materialId === 'rock')!.bankCutM3, 7)
    expect(half.bankCutM3).toBeCloseTo(full.bankCutM3 / 2, 5)
    expect(half.excavationCost).toBeCloseTo(half.bankCutM3 * 10, 7)
    expect(half.usableCompactedM3).toBeCloseTo(half.bankCutM3 * 0.8 * 0.9, 7)
    expect(half.unusableBankM3).toBeCloseTo(half.bankCutM3 * 0.2, 7)
  })

  it('prints on tabloid and ANSI D: wider sheets, the same heights, and more road per sheet at a fixed scale', () => {
    const book = (paper: 'A3' | 'tabloid' | 'ansi-d') => {
      const settings = createRoadReportSettings()
      settings.paper = paper
      settings.chapters = [
        { ...createReportChapter('plan-profile', 'fixed'), sheetLengthM: 1000, horizontalScale: 1000 },
        createReportChapter('schedule', 'table'),
      ]
      return plotBookHtml({
        projectName: 'Demo',
        alignment,
        analysis,
        terrain,
        settings,
        ...exportGrid(terrain, origin),
      })
    }
    const a3 = book('A3'),
      tabloid = book('tabloid'),
      d = book('ansi-d')
    expect(a3).toContain('viewBox="0 0 1587 1123"')
    expect(a3).toContain('@page{size:A3 landscape;margin:0}')
    expect(a3).toContain('.sheet{width:420mm;height:297mm;')
    expect(tabloid).toContain('viewBox="0 0 1736 1123"')
    expect(tabloid).toContain('@page{size:17in 11in;margin:0}')
    expect(tabloid).toContain('.sheet{width:431.8mm;height:279.4mm;')
    expect(d).toContain('viewBox="0 0 1736 1123"')
    expect(d).toContain('@page{size:34in 22in;margin:0}')
    expect(d).toContain('.sheet{width:863.6mm;height:558.8mm;')
    // The paper's proportions hold to within a unit of the drawing.
    expect(Math.abs(1736 / 1123 - 17 / 11)).toBeLessThan(1 / 1123)
    // At 1:1000 a printed sheet holds its printable width of road: about 380 m on A3, 395 m on
    // tabloid, 789 m on ANSI D, so the 600 m road takes two sheets, two, and one.
    const plans = (html: string) => html.match(/Plan &amp; profile [^<"]*/g) ?? []
    expect(plans(a3).filter((t) => t.includes('0+380.'))).not.toHaveLength(0)
    expect(plans(tabloid).filter((t) => t.includes('0+394.'))).not.toHaveLength(0)
    expect(d).toContain('Plan &amp; profile 0+000.0–0+600.0')
    for (const html of [tabloid, d]) {
      // Nothing is drawn past the sheet's right edge.
      for (const rect of html.matchAll(/<rect x="([\d.]+)" y="[\d.-]+" width="([\d.]+)"/g))
        expect(Number(rect[1]) + Number(rect[2])).toBeLessThanOrEqual(1736)
      expect(html).toContain('data-chapter="fixed"')
      expect(html).toContain('data-chapter="table"')
      expect(html).not.toContain('NaN')
    }
  })
})

describe('profile, grade and mass-haul chapter', () => {
  it('draws the whole road on one sheet with profile, grade and mass-haul panels', () => {
    const settings = createRoadReportSettings()
    settings.chapters = [createReportChapter('charts', 'charts')]
    const book = plotBookHtml({
      projectName: 'Demo',
      alignment,
      analysis,
      terrain,
      ...exportGrid(terrain, origin),
      settings,
      gradeLimits: {
        rule: {
          favourablePercent: 12,
          adversePercent: 12,
          loadedDirection: null,
          shortPitch: { gradePercent: 18, maxLengthM: 150 },
        },
      },
    })
    expect(book.match(/<section class="sheet">/g)).toHaveLength(1)
    expect(book).toContain('Profile, grade &amp; mass haul 0+000.0')
    for (const role of ['ground', 'design', 'design-grade', 'ground-grade', 'grade-limit', 'mass'])
      expect(book).toContain(`data-role="${role}"`)
    expect(book).toContain('+limit 12.0%')
    expect(book).toContain('short pitch 18.0% ≤ 150 m')
  })

  it('labels every axis, prints the legend and statistics, and leaves out a panel when asked', () => {
    const settings = createRoadReportSettings()
    const rule = { favourablePercent: 12, adversePercent: 12, loadedDirection: null, shortPitch: null }
    settings.chapters = [createReportChapter('charts', 'charts')]
    const full = plotBookHtml({
      projectName: 'Demo',
      alignment,
      analysis,
      terrain,
      ...exportGrid(terrain, origin),
      settings,
      gradeLimits: { rule },
    })
    expect([...full.matchAll(/data-role="y-axis-title">([^<]+)</g)].map((m) => m[1])).toEqual([
      'Elevation (m)',
      'Grade (%)',
      'Mass (m³)',
    ])
    expect(full).toContain('data-role="chart-legend"')
    expect(full).toContain('Average grade (net)')
    settings.chapters = [
      {
        ...createReportChapter('charts', 'charts'),
        charts: {
          panels: ['profile', 'grade'],
          stationTickM: 100,
          gradeRangePercent: null,
          legend: false,
          stats: false,
        },
      },
    ]
    const two = plotBookHtml({
      projectName: 'Demo',
      alignment,
      analysis,
      terrain,
      ...exportGrid(terrain, origin),
      settings: parseRoadReportSettings(JSON.parse(JSON.stringify(settings))),
      gradeLimits: { rule },
    })
    expect(two).not.toContain('data-role="mass"')
    expect(two).not.toContain('data-role="chart-legend"')
    expect(two).not.toContain('data-role="chart-stats"')
    // The lowest panel carries the station labels and the station-axis title.
    expect(two).toContain('Station (m)')
    expect(two).toContain('>0+100<')
  })

  it('works out the sheet statistics from the design line', () => {
    const station = (chainage: number, z: number, grade: number | null, cut = 10, fill = 5) =>
      ({
        chainage,
        designElevation: z,
        gradePercent: grade,
        cutVolumeM3: cut,
        fillVolumeM3: fill,
      }) as unknown as RoadStation
    const stats = chartStats(
      [station(0, 100, 10, 0, 0), station(100, 110, 10), station(200, 105, -5), station(300, 125, 20)],
      { favourablePercent: 12, adversePercent: 12, loadedDirection: null, shortPitch: null },
    )
    expect(stats.lengthM).toBe(300)
    expect(stats.climbM).toBe(30)
    expect(stats.descentM).toBe(5)
    expect(stats.averageGradePercent).toBeCloseTo(25 / 3)
    expect(stats.meanAbsoluteGradePercent).toBeCloseTo(35 / 3)
    expect(stats.steepestClimbPercent).toBe(20)
    expect(stats.steepestDescentPercent).toBe(-5)
    expect(stats.overLimitM).toBe(100)
    expect(stats.cutM3).toBe(30)
    expect(stats.earthworkKnownShare).toBe(1)
  })

  it('holds each grade to its direction’s limit when loaded trucks travel one way', () => {
    const station = (chainage: number, z: number, grade: number) =>
      ({ chainage, designElevation: z, gradePercent: grade, cutVolumeM3: 0, fillVolumeM3: 0 }) as unknown as RoadStation
    // 100 m climbing at 12% up-station, then 100 m descending at 12%.
    const line = [station(0, 100, 12), station(100, 112, 12), station(200, 100, -12)]
    const rule = (loadedDirection: 'start-to-end' | 'end-to-start') => ({
      favourablePercent: 16,
      adversePercent: 9,
      loadedDirection,
      shortPitch: null,
    })
    // Loaded up-station: the climb is adverse (12% > 9%), the descent favourable (12% < 16%).
    expect(chartStats(line, rule('start-to-end')).overLimitM).toBe(100)
    expect(intervalStats(line, 0, 200, 100, rule('start-to-end')).map((i) => i.overLimit)).toEqual([true, true])
    // Loaded down-station: the other way round; the second interval holds the -12% station only.
    expect(chartStats(line, rule('end-to-start')).overLimitM).toBe(100)
    expect(
      intervalStats([station(0, 100, 12), station(100, 112, 12)], 0, 100, 100, rule('end-to-start'))[0].overLimit,
    ).toBe(false)
  })

  it('fits the grade axis to the steepest grade, or holds a fixed range', () => {
    expect(gradeAxis([12, -12, 31.2, -4], null)).toEqual({ low: -15, high: 35 })
    expect(gradeAxis([250], null)).toEqual({ low: -5, high: 100 })
    expect(gradeAxis([31], 20)).toEqual({ low: -20, high: 20 })
  })

  it('gives each axis about one line per 55 units, ending on a tick at both ends', () => {
    const z = valueAxis(897, 1195, 400)
    expect(z.step).toBe(50)
    expect([z.low, z.high]).toEqual([850, 1200])
    expect(z.ticks[0]).toBe(z.low)
    expect(z.ticks.at(-1)).toBe(z.high)
    const g = valueAxis(-20, 40, 190)
    expect(g.step).toBe(10)
    expect(g.ticks).toEqual([-20, -10, 0, 10, 20, 30, 40])
    expect(valueAxis(-20_000, 15_000, 190).ticks).toEqual([-20_000, -10_000, 0, 10_000, 20_000])
    expect(valueAxis(897, 1195, 520).step).toBe(50)
  })

  it('works out each interval of the band from the stations inside it', () => {
    const station = (chainage: number, z: number, ground: number, grade: number) =>
      ({
        chainage,
        designElevation: z,
        groundElevation: ground,
        gradePercent: grade,
        cutVolumeM3: chainage ? 100 : null,
        fillVolumeM3: chainage ? 40 : null,
      }) as unknown as RoadStation
    const stations = [0, 100, 200, 300, 400, 450].map((c, i) =>
      station(c, 900 + (c <= 200 ? c * 0.1 : 20 + (c - 200) * 0.14), 900 + c * 0.12, i < 3 ? 10 : 14),
    )
    const rule = { favourablePercent: 12, adversePercent: 12, loadedDirection: null, shortPitch: null }
    const columns = intervalStats(stations, 0, 450, 200, rule)
    expect(columns.map((c) => [c.from, c.to])).toEqual([
      [0, 200],
      [200, 400],
      [400, 450],
    ])
    expect(columns[0].averageGradePercent).toBeCloseTo(10)
    expect(columns[0].riseM).toBeCloseTo(20)
    expect(columns[0].groundGradePercent).toBeCloseTo(12)
    expect(columns[0].cutM3).toBe(200)
    expect(columns[0].overLimit).toBe(false)
    expect(columns[1].averageGradePercent).toBeCloseTo(14)
    expect(columns[1].overLimit).toBe(true)
  })

  it('prints the interval band under the charts with the stations below it', () => {
    const settings = createRoadReportSettings()
    settings.chapters = [
      {
        ...createReportChapter('charts', 'charts'),
        charts: {
          panels: ['profile', 'grade'],
          stationTickM: 200,
          gradeRangePercent: null,
          legend: true,
          stats: true,
          intervalM: 200,
        },
      },
    ]
    const book = plotBookHtml({
      projectName: 'Demo',
      alignment,
      analysis,
      terrain,
      ...exportGrid(terrain, origin),
      settings: parseRoadReportSettings(JSON.parse(JSON.stringify(settings))),
    })
    expect(book).toContain('data-role="interval-band"')
    expect(book).toContain('Every 200 m')
    expect(book).toContain('Steepest grade')
    expect(book).not.toContain('data-role="mass"')
    expect(book).not.toContain('NaN')
  })

  it('draws the interval statistics on the profile in the chosen style', () => {
    const book = (intervalStyle: 'top' | 'bottom' | 'line', panels: ('profile' | 'grade')[] = ['profile', 'grade']) => {
      const settings = createRoadReportSettings()
      settings.chapters = [
        {
          ...createReportChapter('charts', 'charts'),
          charts: {
            panels,
            stationTickM: 200,
            gradeRangePercent: null,
            legend: true,
            stats: true,
            intervalM: 200,
            intervalStyle,
          },
        },
      ]
      return plotBookHtml({
        projectName: 'Demo',
        alignment,
        analysis,
        terrain,
        ...exportGrid(terrain, origin),
        settings: parseRoadReportSettings(JSON.parse(JSON.stringify(settings))),
        gradeLimits: { rule: { favourablePercent: 12, adversePercent: 12, loadedDirection: null, shortPitch: null } },
      })
    }
    for (const style of ['top', 'bottom', 'line'] as const) {
      const html = book(style)
      expect(html).toContain('data-role="interval-boundary"')
      expect(html).toContain('data-role="interval-label"')
      expect(html).not.toContain('data-role="interval-band"')
      expect(html).toContain('Interval boundary, every 200 m')
      expect(html).not.toContain('NaN')
    }
    expect(book('line')).toContain('data-role="interval-average"')
    expect(book('top')).not.toContain('data-role="interval-average"')
    // With both lines, the ground's average prints beside the design's, each in its line's colour.
    const bothBook = (intervalStyle: 'top' | 'line') => {
      const settings = createRoadReportSettings()
      settings.chapters = [
        {
          ...createReportChapter('charts', 'charts'),
          charts: {
            panels: ['profile', 'grade'],
            stationTickM: 200,
            gradeRangePercent: null,
            legend: true,
            stats: true,
            intervalM: 200,
            intervalStyle,
            intervalLines: 'both',
          },
        },
      ]
      return plotBookHtml({
        projectName: 'Demo',
        alignment,
        analysis,
        terrain,
        ...exportGrid(terrain, origin),
        settings: parseRoadReportSettings(JSON.parse(JSON.stringify(settings))),
      })
    }
    const lineBoth = bothBook('line')
    expect(lineBoth).toContain('data-role="interval-ground-average"')
    expect(lineBoth).toContain('Ground average grade over the interval')
    expect(lineBoth).toMatch(/fill="#8a5a2b">[+−]?\d/)
    expect(lineBoth).toMatch(/fill="#0f766e">[+−]?\d/)
    expect(bothBook('top')).toMatch(/fill="#8a5a2b">ground /)
    expect(book('top')).not.toContain('>ground ')
    // Without a profile to draw on, the statistics fall back to the table.
    expect(book('line', ['grade'])).toContain('data-role="interval-band"')
  })

  it('names a charts sheet after the panels it shows', () => {
    expect(chartsTitle(['profile', 'grade', 'mass'])).toBe(createReportChapter('charts', 'c').title)
    expect(chartsTitle(['profile', 'grade'])).toBe('Profile & grade')
    expect(chartsTitle(['mass'])).toBe('Mass haul')
  })

  it('refuses chart options with no panel', () => {
    const settings = {
      ...createRoadReportSettings(),
      chapters: [
        {
          ...createReportChapter('charts', 'c'),
          charts: { panels: [], stationTickM: null, gradeRangePercent: null, legend: true, stats: true },
        },
      ],
    }
    expect(() => parseRoadReportSettings(settings)).toThrow('at least one')
  })

  it('keeps a whole-road default that survives parsing', () => {
    const chapter = createReportChapter('charts', 'c')
    expect(chapter.sheetLengthM).toBe(10000)
    const settings = { ...createRoadReportSettings(), chapters: [chapter] }
    expect(() => parseRoadReportSettings(JSON.parse(JSON.stringify(settings)))).not.toThrow()
  })
})

describe('title block', () => {
  it('sits in the sheet border corner with the border’s line weight', () => {
    const book = plotBookHtml({ projectName: 'Demo', alignment, analysis, terrain, ...exportGrid(terrain, origin) })
    const W = Number(/viewBox="0 0 (\d+) (\d+)"/.exec(book)![1]),
      H = Number(/viewBox="0 0 (\d+) (\d+)"/.exec(book)![2])
    const block =
      /data-role="title-block"><rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"[^>]*stroke-width="([\d.]+)"/.exec(
        book,
      )!
    const [x, y, w, h, stroke] = block.slice(1).map(Number)
    expect(x + w).toBe(W - SHEET_FRAME.x)
    expect(y + h).toBe(H - SHEET_FRAME.y)
    expect(stroke).toBe(SHEET_FRAME.stroke)
  })
})

describe('drainage on the plot book', () => {
  const grid = exportGrid(terrain, origin)
  const culvert = (patch: Partial<Culvert>): Culvert => ({
    id: 'c1',
    name: 'CD-1',
    kind: 'cross-drain',
    chainage: 117,
    skewDegrees: 0,
    lengthM: 14,
    diameterM: 0.6,
    inletInvertM: 798.6,
    outletInvertM: 798.4,
    minCoverM: 0.3,
    unitCost: 120,
    fixedCost: 0,
    ...patch,
  })
  const withCulverts = (culverts: Culvert[]): Alignment => ({
    ...alignment,
    engineering: { ...createEngineeringDesign(), culverts },
  })
  const sectionsOnly = (intervalM = 20) => {
    const settings = createRoadReportSettings()
    settings.chapters = [{ ...createReportChapter('sections', 's'), sectionIntervalM: intervalM }]
    return settings
  }
  const bookFor = (road: Alignment, settings = sectionsOnly()) =>
    plotBookHtml({
      projectName: 'P',
      alignment: road,
      analysis: analyzeRoad(road, { elevationAt: (lng) => 800 + (lng - origin[0]) * 1000 }, DEFAULT_ROAD_SETTINGS),
      terrain,
      ...grid,
      settings,
      today: new Date('2026-11-01'),
    })

  it('adds a labelled section at a culvert between the section interval', () => {
    const plain = bookFor(withCulverts([]))
    const book = bookFor(withCulverts([culvert({})]))
    expect(plain).not.toContain('data-role="culvert-section"')
    // The 31 interval sections plus the culvert's, at its own station, between 0+100 and 0+120.
    const labels = [...book.matchAll(/text-anchor="middle">(0\+\d{3}\.\d)<\/text>/g)].map((m) => m[1])
    expect(labels).toHaveLength(32)
    expect(labels.slice(5, 8)).toEqual(['0+100.0', '0+117.0', '0+120.0'])
    expect(book).toContain('data-role="culvert-section">Culvert CD-1 · 600 mm pipe</text>')
    expect(book.match(/data-role="culvert-barrel"/g)).toHaveLength(1)
    expect(book).toContain('Sections @ 20 m and culverts')
    expect(plain).toContain('Sections @ 20 m, 1:1 axes')
  })

  it('labels a culvert that falls on an interval section without adding one', () => {
    const book = bookFor(
      withCulverts([culvert({ chainage: 120, shape: 'box', spanM: 1.2, diameterM: 0.9, barrels: 2 })]),
    )
    expect([...book.matchAll(/text-anchor="middle">(0\+\d{3}\.\d)<\/text>/g)]).toHaveLength(31)
    expect(book).toContain('Culvert CD-1 · 2 × box 1,200 × 900 mm')
    // A name that already says culvert is not prefixed again.
    expect(bookFor(withCulverts([culvert({ name: 'Culvert 1' })]))).toContain('>Culvert 1 · 600 mm pipe</text>')
  })

  it('leaves out a culvert outside the chapter range', () => {
    const settings = sectionsOnly()
    settings.chapters[0] = { ...settings.chapters[0], startM: 200, endM: 400 }
    expect(bookFor(withCulverts([culvert({})]), settings)).not.toContain('data-role="culvert-section"')
  })
})

describe('station schedule volumes', () => {
  const grid = exportGrid(terrain, origin)
  const schedule = (intervalM: number) => {
    const settings = createRoadReportSettings()
    settings.chapters = [
      {
        ...createReportChapter('schedule', 's'),
        sectionIntervalM: intervalM,
        columns: ['station', 'cutVolume', 'fillVolume'],
      },
    ]
    return plotBookHtml({ projectName: 'P', alignment, analysis, terrain, ...grid, settings })
  }
  const printed = (book: string) => [...book.matchAll(/<tspan x="[\d.]+" dy="0">([^<]*)<\/tspan>/g)].map((m) => m[1])

  it('totals each row over the whole interval, as the station table does', () => {
    const cells = printed(schedule(100))
    const rows = reportingRows(analysis, analysis.stations, 100)
    const fmt2 = (v: number | null) =>
      v === null ? '—' : v.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    // Header (3 cells), then station, cut, fill per row.
    expect(cells.slice(3)).toEqual(
      rows.flatMap((r) => [
        expect.stringContaining(String(Math.round(r.station.chainage / 100))),
        fmt2(r.cutVolume),
        fmt2(r.fillVolume),
      ]),
    )
    // A 100 m row holds every calculation interval since the previous row, not just its own.
    const at200 = rows.find((r) => Math.abs(r.station.chainage - 200) < 1e-6)!
    const own = analysis.stations.find((s) => Math.abs(s.chainage - 200) < 1e-6)!
    const summed = analysis.stations
      .filter((s) => s.chainage > 100 + 1e-6 && s.chainage <= 200 + 1e-6)
      .reduce((sum, s) => sum + (s.cutVolumeM3 ?? 0), 0)
    expect(at200.cutVolume).toBeCloseTo(summed, 6)
    expect(summed).toBeGreaterThan((own.cutVolumeM3 ?? 0) * 2)
    expect(cells).toContain('Cut since previous row (m³)')
  })
})

describe('plan sheet framing', () => {
  const grid = exportGrid(terrain, origin)
  const book = (planSheets?: unknown) => {
    const settings = createRoadReportSettings()
    settings.chapters = [
      { ...createReportChapter('plan-profile', 'p'), ...(planSheets === undefined ? {} : { planSheets }) } as never,
    ]
    return plotBookHtml({
      projectName: 'P',
      alignment,
      analysis,
      terrain,
      ...grid,
      settings: parseRoadReportSettings(settings),
      today: new Date('2026-11-01'),
    })
  }
  const sheets = (html: string) => html.split('<section class="sheet">').slice(1)

  it('draws every sheet as before when no framing is set, or one set to zero', () => {
    const automatic = book()
    expect(book([])).toBe(automatic)
    expect(book([{ atM: 300, rightM: 0, upM: 0, turnDeg: 0 }])).toBe(automatic)
  })

  it('moves and turns only the plan of the sheet holding the station, and says so', () => {
    const automatic = sheets(book())
    const framed = sheets(book([{ atM: 300, rightM: 20, turnDeg: 15 }]))
    expect(framed).toHaveLength(3)
    expect(framed[0]).toBe(automatic[0])
    expect(framed[2]).toBe(automatic[2])
    expect(framed[1]).not.toBe(automatic[1])
    expect(framed[1]).toContain('framing set by hand: turned 15.0° left, moved 20.0 m right')
    // The profile and mass haul are drawn as before.
    const profile = (sheet: string) => sheet.slice(sheet.indexOf('<clipPath id="profile-'))
    expect(profile(framed[1]).replace(/<g font-family[\s\S]*$/, '')).toBe(
      profile(automatic[1]).replace(/<g font-family[\s\S]*$/, ''),
    )
  })

  it('finds the sheet whose window holds the station, the end of the last one included', () => {
    const chapter = { planSheets: [{ atM: 250 }, { atM: 600 }] }
    expect(planSheetFraming(chapter, 0, 250, false)).toBeUndefined()
    expect(planSheetFraming(chapter, 250, 500, false)).toEqual({ atM: 250 })
    expect(planSheetFraming(chapter, 500, 600, true)).toEqual({ atM: 600 })
  })

  it('reads only valid framings and writes none when the list is empty', () => {
    const settings = createRoadReportSettings()
    const chapter = (planSheets: unknown) =>
      parseRoadReportSettings({ ...settings, chapters: [{ ...settings.chapters[0], planSheets }] }).chapters[0]
    expect('planSheets' in chapter([])).toBe(false)
    expect(chapter([{ atM: 10, rightM: 0, upM: -4 }]).planSheets).toEqual([{ atM: 10, upM: -4 }])
    expect(() => chapter([{ atM: 10, turnDeg: 200 }])).toThrow('Plan turn must be -180–180.')
    expect(() => chapter([{ rightM: 5 }])).toThrow('Plan sheet station')
  })
})
