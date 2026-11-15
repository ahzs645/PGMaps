import { describe, expect, it } from 'vitest'

import { sheetSvg } from '@/lib/mapSheet/renderSvg'
import { FIT_SCALES } from '@/lib/mapSheet/scale'

import {
  captureFrame,
  composeReportMap,
  fitCamera,
  frameProjectionFor,
  MAX_REGIONAL_ZOOM,
  metresPerPixel,
  OVERVIEW_SHEET_PIXELS,
  planOverviewSheet,
  planReportMaps,
  REPORT_MAP_ASPECT,
  SHEET_FURNITURE_SHARE,
  REGIONAL_ZOOM_STEP,
  reportMapFeatures,
  viewWedge,
  type ReportMapFeatures,
} from './reportMaps'
import { bearingDegrees, haversineMeters } from './visibility'

const square = (lng: number, lat: number, d: number): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [lng - d, lat - d],
      [lng + d, lat - d],
      [lng + d, lat + d],
      [lng - d, lat + d],
      [lng - d, lat - d],
    ],
  ],
})

const features: ReportMapFeatures = {
  blocks: [
    { name: 'EGG1', geometry: square(-122.8, 54.02, 0.004) },
    { name: 'EGG2', geometry: square(-122.78, 54.03, 0.003) },
  ],
  openings: [{ name: 'Old cut', geometry: square(-122.79, 54.0, 0.003) }],
  inventory: [
    { id: 'u1', code: 'PR', label: '968', geometry: square(-122.79, 54.02, 0.03) },
    { id: 'u2', code: null, label: null, geometry: square(-122.81, 54.03, 0.006) },
  ],
  road: [
    [-122.83, 53.99],
    [-122.82, 53.995],
  ],
  viewpoints: [{ name: 'VP1', lng: -122.825, lat: 53.993, bearingDeg: 45, fovDeg: 40 }],
}

/** MapLibre's own projection: world pixels at `zoom` from the centre, 512 px tiles. */
function maplibreProject(camera: { center: [number, number]; zoom: number }, frame: { width: number; height: number }) {
  const world = 512 * 2 ** camera.zoom
  const x = (lng: number) => ((lng + 180) / 360) * world
  const y = (lat: number) => ((1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2) * world
  return (lng: number, lat: number): [number, number] => [
    frame.width / 2 + x(lng) - x(camera.center[0]),
    frame.height / 2 + y(lat) - y(camera.center[1]),
  ]
}

describe('report map planning', () => {
  it('takes the largest centred window of the canvas at the aspect', () => {
    expect(captureFrame({ width: 800, height: 900 }, 4 / 3)).toEqual({ width: 800, height: 600 })
    expect(captureFrame({ width: 1200, height: 600 }, 4 / 3)).toEqual({ width: 800, height: 600 })
  })

  it('fits the bounds inside the frame with the padding, as fitBounds does', () => {
    const frame = { width: 800, height: 600 }
    const bounds: [number, number, number, number] = [-122.85, 53.98, -122.75, 54.04]
    const camera = fitCamera(bounds, frame, 0.1)
    const project = maplibreProject(camera, frame)
    const [x0, y0] = project(bounds[0], bounds[3])
    const [x1, y1] = project(bounds[2], bounds[1])
    // Every corner inside the padded frame, and one side touching the padding.
    expect(x0).toBeGreaterThanOrEqual(80 - 1e-6)
    expect(y0).toBeGreaterThanOrEqual(60 - 1e-6)
    expect(x1).toBeLessThanOrEqual(720 + 1e-6)
    expect(y1).toBeLessThanOrEqual(540 + 1e-6)
    expect(Math.min(x0 - 80, y0 - 60, 720 - x1, 540 - y1)).toBeLessThan(0.5)
  })

  it('projects each vertex where MapLibre draws it, and the scale bar holds at the centre', () => {
    const frame = { width: 800, height: 600 }
    const camera = { center: [-122.8, 54.02] as [number, number], zoom: 13.4 }
    const projection = frameProjectionFor(camera, frame)
    const reference = maplibreProject(camera, frame)
    for (const [lng, lat] of [
      [-122.8, 54.02],
      [-122.83, 54.0],
      [-122.77, 54.04],
    ] as const) {
      const [x, y] = projection.project(lng, lat)
      const [ex, ey] = reference(lng, lat)
      expect(x).toBeCloseTo(ex, 6)
      expect(y).toBeCloseTo(ey, 6)
    }
    // 100 px east of the centre is 100 × metres-per-pixel of ground.
    const [lng] = projection.unproject(500, 300)
    expect(haversineMeters({ lng: -122.8, lat: 54.02 }, { lng, lat: 54.02 })).toBeCloseTo(
      100 * metresPerPixel(camera),
      0,
    )
  })

  it('draws the wedge along the bearing, out past the farthest block corner in the field', () => {
    const wedge = viewWedge(features.viewpoints[0], features.blocks)!
    expect(wedge.blocks).toContain('EGG1')
    const eye = { lng: -122.825, lat: 53.993 }
    // The tip of the centre line (the ring's middle point) lies on the bearing.
    const tip = wedge.ring[Math.floor(wedge.ring.length / 2)]
    expect(bearingDegrees(eye, { lng: tip[0], lat: tip[1] })).toBeCloseTo(45, 0)
    const farthest = Math.max(
      ...features.blocks
        .filter((block) => wedge.blocks.includes(block.name))
        .flatMap((block) => (block.geometry as GeoJSON.Polygon).coordinates[0])
        .filter(([lng, lat]) => Math.abs(((bearingDegrees(eye, { lng, lat }) - 45 + 540) % 360) - 180) <= 20)
        .map(([lng, lat]) => haversineMeters(eye, { lng, lat })),
    )
    expect(wedge.lengthM).toBeGreaterThan(farthest)
    expect(viewWedge({ ...features.viewpoints[0], bearingDeg: null }, features.blocks)).toBeNull()
  })

  it('plans the overview, a location map per viewpoint and a regional map four zoom levels out', () => {
    const plans = planReportMaps(features, { width: 800, height: 600 })
    expect(plans.map((plan) => [plan.kind, plan.key, plan.basemap])).toEqual([
      ['overview', 'overview', 'satellite'],
      ['location', 'VP1', 'satellite'],
      ['regional', 'regional', 'map'],
    ])
    const [overview, location, regional] = plans
    expect(regional.camera.zoom).toBeCloseTo(Math.min(MAX_REGIONAL_ZOOM, overview.camera.zoom - REGIONAL_ZOOM_STEP))
    expect(regional.projectArea).toHaveLength(4)
    expect(location.wedge).toBeDefined()
    expect(location.caption).toMatch(/facing 45° over a 40° field, toward Blocks EGG1 and EGG2;/)
    expect(overview.caption).toMatch(
      /Proposed blocks EGG1 and EGG2 and the viewpoint, over the visual landscape inventory/,
    )
    // The overview shows every block and viewpoint.
    const projection = frameProjectionFor(overview.camera, { width: 800, height: 600 })
    for (const [lng, lat] of [
      [-122.825, 53.993],
      [-122.804, 54.024],
      [-122.777, 54.033],
    ] as const) {
      const [x, y] = projection.project(lng, lat)
      expect(x).toBeGreaterThan(0)
      expect(x).toBeLessThan(800)
      expect(y).toBeGreaterThan(0)
      expect(y).toBeLessThan(600)
    }
    expect(planReportMaps({ ...features, blocks: [], viewpoints: [] }, { width: 800, height: 600 })).toEqual([])
  })
})

describe('report map figure', () => {
  const frame = { width: 800, height: 600 }

  it('draws the inventory, openings, road, blocks and viewpoints with a legend of what was drawn', () => {
    const [overview] = planReportMaps(features, frame)
    const map = composeReportMap(overview, features, frame, null, 'Imagery © Esri')
    expect(map.legend).toEqual([
      'Partial Retention (PR) VQO',
      'Inventory unit, no VQO established',
      'Existing opening',
      'Road',
      'Proposed block',
      'Viewpoint (saved view)',
    ])
    expect(map.labels).toEqual(expect.arrayContaining(['VP1', 'EGG1', 'EGG2', '968 PR']))
    const texts = map.ops.flatMap((op) => (op.op === 'text' ? [op.text] : []))
    // North arrow, scale bar labels and the attribution.
    expect(texts).toContain('N')
    expect(texts).toContain('0')
    expect(texts.some((text) => / k?m$/.test(text))).toBe(true)
    expect(texts).toContain('Imagery © Esri')
    // Every label stays inside the frame.
    for (const op of map.ops)
      if (op.op === 'text') {
        expect(op.x).toBeGreaterThanOrEqual(0)
        expect(op.x).toBeLessThanOrEqual(frame.width)
        expect(op.y).toBeGreaterThanOrEqual(0)
        expect(op.y).toBeLessThanOrEqual(frame.height)
      }
    // The sheet engine's SVG back end draws it.
    expect(sheetSvg(map.ops, map.width, map.height)).toContain('<svg')
  })

  it('draws a location map with its own viewpoint and wedge, and a regional map with the project area', () => {
    const [, location, regional] = planReportMaps(features, frame)
    expect(composeReportMap(location, features, frame, null, null).legend).toContain('View from the viewpoint')
    const map = composeReportMap(regional, features, frame, null, null)
    expect(map.legend).toContain('Project area (overview map)')
    expect(map.legend).toEqual(['Project area (overview map)', 'Viewpoint (saved view)'])
    expect(map.labels).not.toContain('EGG1')
  })

  it('moves a label that would meet another above or below its block, and leaves out one with no room', () => {
    const crowded: ReportMapFeatures = {
      ...features,
      inventory: [],
      blocks: ['A', 'B', 'C', 'D'].map((letter, i) => ({
        name: `Block name ${letter}`,
        geometry: square(-122.8 + i * 0.00001, 54.02, 0.0002),
      })),
    }
    const [overview] = planReportMaps(crowded, frame)
    const map = composeReportMap(overview, crowded, frame, null, null)
    expect(map.labels.filter((label) => /Block name/.test(label))).toHaveLength(3)
    const ys = map.ops.flatMap((op) => (op.op === 'text' && /Block name/.test(op.text) ? [op.y] : []))
    expect(new Set(ys.map((y) => Math.round(y))).size).toBe(3)
  })
})

describe('overview sheet', () => {
  const twoViewpoints: ReportMapFeatures = {
    ...features,
    viewpoints: [
      ...features.viewpoints,
      { name: 'VP2 Far Ridge', lng: -122.72, lat: 54.06, bearingDeg: 225, fovDeg: 40 },
    ],
  }
  const frame = captureFrame({ width: 1100, height: 900 }, REPORT_MAP_ASPECT.sheet)

  it('is 17:11 at print resolution, so the report prints it on a sheet page of its own', () => {
    expect(Math.abs(frame.width / frame.height - 1224 / 792)).toBeLessThan(0.01)
    expect(OVERVIEW_SHEET_PIXELS.width).toBe(3300)
    expect(Math.abs(OVERVIEW_SHEET_PIXELS.width / OVERVIEW_SHEET_PIXELS.height - 1224 / 792)).toBeLessThan(0.001)
  })

  it('fits every block and every viewpoint at the largest round scale that holds them, true at the centre', () => {
    const sheet = planOverviewSheet(twoViewpoints, frame)!
    expect(sheet.kind).toBe('sheet')
    expect(sheet.basemap).toBe('topo')
    const scale = sheet.sheet!.scale
    expect(FIT_SCALES).toContain(scale)
    // The frame printed 17 in wide shows `scale` × 17 in of ground at its centre latitude.
    expect(metresPerPixel(sheet.camera) * frame.width).toBeCloseTo(scale * 17 * 0.0254, 3)
    const projection = frameProjectionFor(sheet.camera, frame)
    const points: Array<[number, number]> = [
      ...twoViewpoints.viewpoints.map((vp): [number, number] => [vp.lng, vp.lat]),
      ...twoViewpoints.blocks.flatMap(
        (block) => (block.geometry as GeoJSON.Polygon).coordinates[0] as [number, number][],
      ),
    ]
    const furnitureTop = frame.height * (1 - SHEET_FURNITURE_SHARE)
    for (const [lng, lat] of points) {
      const [x, y] = projection.project(lng, lat)
      expect(x).toBeGreaterThan(0)
      expect(x).toBeLessThan(frame.width)
      expect(y).toBeGreaterThan(0)
      expect(y).toBeLessThan(furnitureTop + 1)
    }
    // The next larger round scale would not hold them: the sheet is as close as a round scale allows.
    const closer = FIT_SCALES[FIT_SCALES.indexOf(scale as (typeof FIT_SCALES)[number]) - 1]
    const xs = points.map(([lng, lat]) => projection.project(lng, lat)[0])
    const ys = points.map(([lng, lat]) => projection.project(lng, lat)[1])
    const grow = scale / closer
    expect(
      (Math.max(...xs) - Math.min(...xs)) * grow > frame.width * 0.86 ||
        (Math.max(...ys) - Math.min(...ys)) * grow > frame.height * (1 - 0.07 - SHEET_FURNITURE_SHARE),
    ).toBe(true)
    expect(sheet.caption).toMatch(/^Overview at 1:[\d,]+ \(11 × 17\): proposed blocks EGG1 and EGG2 and viewpoints VP1/)
    expect(planOverviewSheet({ ...features, blocks: [], viewpoints: [] }, frame)).toBeNull()
  })

  it('labels each viewpoint and block, and states its scale with the scale bar, legend and north arrow', () => {
    const sheet = planOverviewSheet(twoViewpoints, frame)!
    const map = composeReportMap(sheet, twoViewpoints, frame, null, '© OpenStreetMap contributors')
    expect(map.labels).toEqual(expect.arrayContaining(['VP1', 'VP2 Far Ridge', 'EGG1', 'EGG2']))
    expect(map.scale).toBe(`1:${sheet.sheet!.scale.toLocaleString('en-US')}`)
    expect(map.legend).toEqual(expect.arrayContaining(['Proposed block', 'Viewpoint (saved view)']))
    const texts = map.ops.flatMap((op) => (op.op === 'text' ? [op] : []))
    expect(texts.map((op) => op.text)).toEqual(
      expect.arrayContaining(['N', 'Legend', `Scale ${map.scale} (11 × 17 in)`, '© OpenStreetMap contributors']),
    )
    // Text is sized in points on the 11 × 17 paper: the legend's rows print at about 12 pt whatever the frame.
    const row = texts.find((op) => op.text === 'Proposed block')!
    expect((row.size * 1224) / frame.width).toBeCloseTo(9.5 * 1.25, 3)
  })
})

describe('report map features', () => {
  it('reads blocks, openings and the inventory once per polygon', () => {
    const result = reportMapFeatures({
      targets: [
        { role: 'block', name: 'B1', geometry: square(0, 0, 1) },
        { role: 'harvested', name: 'H1', geometry: square(1, 1, 1) },
        { role: 'landscape', name: 'L', geometry: square(2, 2, 1) },
      ],
      units: [{ id: '7', polygonNumber: '968', objectiveId: 'retention', geometry: square(0, 0, 2) }],
      evqo: {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', geometry: square(0, 0, 2), properties: { id: '7', code: 'R' } },
          { type: 'Feature', geometry: square(3, 3, 2), properties: { id: '8', code: 'M' } },
          { type: 'Feature', geometry: square(3, 3, 2), properties: { id: '9', code: 'X' } },
        ],
      },
      road: [[0, 0]],
      viewpoints: [{ name: 'VP', lng: Number.NaN, lat: 0, bearingDeg: null, fovDeg: null }],
    })
    expect(result.blocks.map((block) => block.name)).toEqual(['B1'])
    expect(result.openings.map((opening) => opening.name)).toEqual(['H1'])
    expect(result.inventory.map((unit) => [unit.id, unit.code, unit.label])).toEqual([
      ['7', 'R', '968'],
      ['8', 'M', null],
    ])
    expect(result.road).toBeNull()
    expect(result.viewpoints).toEqual([])
  })
})
