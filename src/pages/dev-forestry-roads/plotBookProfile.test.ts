import { describe, expect, it } from 'vitest'
import { DEFAULT_DESIGN_STANDARDS, gradeRule } from './designStandards'
import { analyzeRoad, offsetCoordinate } from './engine'
import { plotBookHtml } from './plotBook'
import { SHEET_BANDS_HEIGHT, sheetBandsSvg, sheetProfileLabelsSvg } from './plotBookProfile'
import { createRoadReportSettings, parseRoadReportSettings } from './reportSettings'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE, exportGrid } from './terrain'
import type { Alignment, Coordinate, TerrainMetadata } from './types'

const origin: Coordinate = [-122.8, 53.9]
const alignment: Alignment = {
  id: 'r',
  name: 'Spur',
  color: '#16817a',
  points: [
    { id: 'a', coordinate: origin, radiusM: 0 },
    { id: 'b', coordinate: offsetCoordinate(origin, 90, 500), radiusM: 0 },
  ],
  vertical: [
    { id: 'p0', chainage: 0, elevation: 800, curveLength: 0 },
    { id: 'p1', chainage: 200, elevation: 820, curveLength: 100 },
    { id: 'p2', chainage: 400, elevation: 810, curveLength: 0 },
    { id: 'p3', chainage: 500, elevation: 812, curveLength: 0 },
  ],
  template: { ...DEFAULT_TEMPLATE },
  overrides: [],
}
const terrain: TerrainMetadata = { kind: 'demo', name: 'Flat', resolutionM: 1, verticalReference: 'CGVD2013' }
const metresEast = (lng: number) =>
  ((lng - origin[0]) * Math.PI * 6371008.8 * Math.cos((origin[1] * Math.PI) / 180)) / 180
const analysis = analyzeRoad(
  alignment,
  { elevationAt: (lng) => (metresEast(lng) > 295 && metresEast(lng) < 325 ? Number.NaN : 812) },
  DEFAULT_ROAD_SETTINGS,
)
const limits = { rule: gradeRule({ maxGradePercent: 8 }, DEFAULT_DESIGN_STANDARDS) }
const book = (subviews: { bands?: boolean; profileLabels?: boolean }) => {
  const settings = createRoadReportSettings()
  settings.chapters = [{ ...settings.chapters[0], sheetLengthM: 500 }]
  Object.assign(settings.subviews, subviews)
  return plotBookHtml({
    projectName: 'Demo',
    alignment,
    analysis,
    terrain,
    settings,
    gradeLimits: limits,
    ...exportGrid(terrain, origin),
  })
}

describe('plot book profile additions', () => {
  it('keeps the first and last band values inside the plot, clear of the row titles', () => {
    const svg = sheetBandsSvg({
      analysis,
      alignment,
      start: 0,
      end: 500,
      sx: (c) => 90 + c * 2,
      left: 90,
      width: 1000,
      top: 0,
    })
    const ground = svg.match(/<g data-role="band-ground">.*?<\/g>/)![0]
    const values = [...ground.matchAll(/<text x="([\d.]+)" y="\d+" font-size="10" text-anchor="(\w+)"/g)].map(
      (m) => [Number(m[1]), m[2]] as const,
    )
    // The row title ends 8 px left of the plot; the first value starts inside it, the last ends inside it.
    expect(values[0]).toEqual([82, 'end'])
    values.shift()
    expect(values[0]).toEqual([92, 'start'])
    expect(values.at(-1)).toEqual([1088, 'end'])
    expect(values.slice(1, -1).every(([, anchor]) => anchor === 'middle')).toBe(true)
  })

  it('leaves a sheet unchanged until a subview turns them on', () => {
    const plain = book({})
    expect(book({ bands: false, profileLabels: false })).toBe(plain)
    expect(plain).not.toContain('data-role="profile-bands"')
    expect(plain).not.toContain('data-role="profile-labels"')
    expect(plain).toContain('<rect x="90" y="470" width="1437" height="330"')
  })

  it('prints value bands under a shorter profile, with unknown ground as —', () => {
    const sheet = book({ bands: true })
    expect(sheet).toContain('data-role="profile-bands"')
    for (const role of ['ground', 'design', 'depth', 'grade', 'crossfallLeft', 'crossfallRight', 'curvature'])
      expect(sheet).toContain(`data-role="band-${role}"`)
    const profileHeight = 798 - 410 - 24 - SHEET_BANDS_HEIGHT
    expect(sheet).toContain(`<rect x="90" y="410" width="1437" height="${profileHeight}"`)
    expect(sheet).toContain(`<rect x="90" y="${410 + profileHeight + 24}" width="1437" height="${SHEET_BANDS_HEIGHT}"`)
    const ground = sheet.slice(sheet.indexOf('data-role="band-ground"'), sheet.indexOf('data-role="band-design"'))
    expect(ground).toContain('>812.00<')
    expect(ground).toContain('fill="#9ca3af">—<')
    expect(sheet).toContain('>C 12.00<')
    expect(sheet).not.toContain('NaN')
    // Bands need the profile they sit under.
    const settings = createRoadReportSettings()
    settings.subviews.profile = false
    settings.subviews.bands = true
    expect(
      plotBookHtml({ projectName: 'Demo', alignment, analysis, terrain, settings, ...exportGrid(terrain, origin) }),
    ).not.toContain('data-role="profile-bands"')
  })

  it('labels curve points and over-limit tangents on the profile', () => {
    const sheet = book({ profileLabels: true })
    expect(sheet).toContain('data-role="profile-labels"')
    expect(sheet).toContain('BVC 0+150.0 · 815.00')
    expect(sheet).toContain('HP 0+216.7 · 818.33')
    expect(sheet).toContain('EVC 0+250.0 · 817.50')
    expect(sheet).toContain('LP 0+400.0 · 810.00 · no culvert')
    expect(sheet).toContain('data-no-culvert="true"')
    expect(sheet.match(/data-role="grade-trouble"/g)).toHaveLength(1)
    expect(sheet).toContain('is over the 8% grade limit')
  })

  it('draws the band and label strings on their own', () => {
    const sx = (c: number) => 90 + c * 2
    const bands = sheetBandsSvg({ analysis, alignment, start: 0, end: 500, sx, left: 90, width: 1000, top: 600 })
    expect(bands.match(/data-role="band-/g)).toHaveLength(7)
    const labels = sheetProfileLabelsSvg({
      analysis,
      alignment,
      start: 300,
      end: 500,
      sx,
      sy: (z) => 900 - z,
      top: 0,
    })
    expect(labels).toContain('LP 0+400.0')
    expect(labels).not.toContain('BVC')
    // Without limits only the road's own vertical standards are judged.
    expect(labels).not.toContain('grade-trouble')
  })

  it('reads the subviews from a saved file, and refuses a value that is not true or false', () => {
    const settings = createRoadReportSettings()
    expect(parseRoadReportSettings(settings).subviews).toEqual(settings.subviews)
    const saved = { ...settings, subviews: { ...settings.subviews, bands: true, profileLabels: false } }
    expect(parseRoadReportSettings(saved).subviews).toMatchObject({ bands: true, profileLabels: false })
    expect(() => parseRoadReportSettings({ ...settings, subviews: { ...settings.subviews, bands: 'yes' } })).toThrow(
      'true or false',
    )
  })
})
