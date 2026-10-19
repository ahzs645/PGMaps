import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import proj4 from 'proj4'
import { describe, expect, it } from 'vitest'
import { METRIC_CRS } from './sourceGrids'
import type { TreeCrop } from './treeIsolation'
import { TreeProfilePanel } from './TreeProfilePanel'
import { canPinProfile, prepareTreeProfile, profileHorizontal, profileScale, treeProfilesSVG } from './treeProfiles'

const metricCentre = [511819.5, 5971123.5]
const centre = proj4(METRIC_CRS, 'EPSG:4326', metricCentre) as [number, number]
const crop: TreeCrop = {
  id: 'crown-test',
  centre,
  source_sha256: 'source-test',
  ground_m: 700,
  loaded_nodes: 2,
  available_nodes: 3,
  loaded_points: 120,
  budget_limited: true,
  withheld_filtered: true,
  points: [
    [-3, 4, 10],
    [3, -4, 20],
  ].map(([x, y, height], index) => {
    const [lon, lat] = proj4(METRIC_CRS, 'EPSG:4326', [metricCentre[0] + x, metricCentre[1] + y])
    return { lon, lat, height, z: 700 + height, node: '0-0-0-0', index, classification: 1 }
  }),
}
describe('observed tree side profiles', () => {
  it('uses the source metric frame and per-return terrain heights', () => {
    const p = prepareTreeProfile(crop)
    expect(p.points[0].east).toBeCloseTo(-3, 3)
    expect(p.points[0].north).toBeCloseTo(4, 3)
    expect(p.points.map((point) => point.height)).toEqual([10, 20])
    expect(p.maximum).toBe(20)
    expect(p.radius).toBeCloseTo(5, 3)
    expect(profileHorizontal(-3, 4, 0)).toBe(-3)
    expect(profileHorizontal(-3, 4, 90)).toBeCloseTo(4)
    expect(profileHorizontal(-3, 4, 180)).toBeCloseTo(3)
  })
  it('retains crop exclusions and never creates lower stems or fills missing returns', () => {
    const p = prepareTreeProfile({
      ...crop,
      points: [...crop.points, ...[1, 81, NaN].map((height) => ({ ...crop.points[0], height }))],
    })
    expect(p.points).toHaveLength(2)
    const svg = treeProfilesSVG([p], 0)
    expect(svg.match(/h0\.01/g)).toHaveLength(2)
    expect(svg).toContain('0–2 m excluded by crop')
    expect(svg).toContain('Partial crop')
    expect(svg).toContain('source-test')
    expect(svg).not.toContain('NaN')
    expect(svg).not.toContain('Infinity')
  })
  it('shares one undistorted metric scale, with fixed bounds through rotation', () => {
    const short = prepareTreeProfile(crop)
    const tall = { ...short, maximum: 45, radius: 7 }
    const scale = profileScale([short, tall])
    expect(scale.height).toBe(45)
    expect(scale.halfWidth).toBe(8)
    expect(scale.pixelsPerMetre).toBe(280 / 45)
    for (const angle of [0, 45, 90, 135, 180]) {
      const svg = treeProfilesSVG([short, tall], angle)
      expect(svg).toContain('width="520"')
      expect(svg).toContain('viewBox="0 0 520 510"')
      expect(svg).toContain('equal_metric_axes')
      expect(svg).not.toContain('NaN')
    }
  })
  it('exports inert XML with point lineage, colour meaning and no external resources', () => {
    const p = prepareTreeProfile({ ...crop, id: '<script>alert("x")</script>' })
    const svg = treeProfilesSVG([p], 90, true)
    expect(svg).not.toContain('<script>')
    expect(svg).toContain('&lt;script&gt;')
    expect(svg).toContain('Height 0–40+ m')
    expect(svg).toContain('source_sha256')
    expect(svg).toContain('withheld_filtered')
    expect(svg).not.toContain('href=')
  })
  it('bounds pinned data and rejects mixed source datasets', () => {
    const p = prepareTreeProfile(crop)
    expect(canPinProfile([], p)).toBe(true)
    expect(canPinProfile([p], { ...p, crop: { ...crop, source_sha256: 'other' } })).toBe(false)
    const four = [1, 2, 3, 4].map((n) => ({ ...p, crop: { ...crop, id: `crown-${n}` } }))
    expect(canPinProfile(four, p)).toBe(false)
    expect(canPinProfile(four, four[0])).toBe(true)
    const large = { ...p, crop: { ...crop, points: Array(150001).fill(crop.points[0]) } }
    expect(canPinProfile([], large)).toBe(false)
  })
  it('keeps empty or wholly excluded crops finite', () => {
    const p = prepareTreeProfile({ ...crop, points: [] })
    expect(p.points).toEqual([])
    expect(treeProfilesSVG([p], 0)).toContain('No eligible returns')
    expect(treeProfilesSVG([p], 0)).not.toMatch(/NaN|Infinity/)
  })
  it('renders the real profile, rotation, comparison and export controls through the shared panel', () => {
    const html = renderToStaticMarkup(
      createElement(TreeProfilePanel, {
        crop,
        sourceHash: crop.source_sha256,
        selectedId: crop.id,
        loading: false,
        onLoad: () => {},
      }),
    )
    for (const label of [
      'Tree side profiles',
      'Tree profile rotation',
      'Pin for comparison',
      'Download profiles SVG',
      'Fullscreen Tree side profiles',
      'Partial crop',
      'Height above terrain (m)',
    ])
      expect(html).toContain(label)
    const unavailable = renderToStaticMarkup(
      createElement(TreeProfilePanel, { crop, sourceHash: 'different', loading: false, onLoad: () => {} }),
    )
    expect(unavailable).not.toContain('Tree candidate side profiles · shared metre scale')
    expect(unavailable).toContain('Load selected tree profile')
  })
})
