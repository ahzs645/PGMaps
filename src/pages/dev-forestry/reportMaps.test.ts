import proj4 from 'proj4'
import { describe, expect, it } from 'vitest'

import { sheetSvg } from '@/lib/mapSheet/renderSvg'
import { FIT_SCALES, metresPerPoint } from '@/lib/mapSheet/scale'

import {
  captureFrame,
  composeReportMap,
  END_MAP_ASPECT,
  END_MAP_LEGEND_ORDER,
  END_MAP_MAX_DEM_TILES,
  END_MAP_PIXELS,
  endMapContourInterval,
  endMapDemZoom,
  endMapLayout,
  endMapLegendKeys,
  fitCamera,
  frameProjectionFor,
  MAX_REGIONAL_ZOOM,
  metresPerPixel,
  OVERVIEW_SHEET_PIXELS,
  overviewSheetAspect,
  planOverviewSheet,
  planReportMaps,
  REPORT_MAP_ASPECT,
  SHEET_FURNITURE_SHARE,
  REGIONAL_ZOOM_STEP,
  reportMapFeatures,
  utmTickInterval,
  utmZoneOf,
  viewWedge,
  type ReportMapFeatures,
} from './reportMaps'
import {
  composeEndMap,
  endMapBasemapFromMap,
  endMapContours,
  endMapViewpointLabel,
  type EndMapBasemap,
} from './reportEndMap'
import { demTileRange } from './terrain'
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

describe('portrait end map', () => {
  const twoViewpoints: ReportMapFeatures = {
    ...features,
    retention: [{ name: 'WTP 1', geometry: square(-122.8, 54.02, 0.001) }],
    viewpoints: [...features.viewpoints, { name: 'Far Ridge', lng: -122.72, lat: 54.06, bearingDeg: 225, fovDeg: 40 }],
  }
  const frame = captureFrame({ width: 1100, height: 900 }, overviewSheetAspect('end-map-portrait'))
  const layout = endMapLayout()
  const inside = (outer: { x: number; y: number; w: number; h: number }, inner: typeof outer) =>
    inner.x >= outer.x - 1e-9 &&
    inner.y >= outer.y - 1e-9 &&
    inner.x + inner.w <= outer.x + outer.w + 1e-9 &&
    inner.y + inner.h <= outer.y + outer.h + 1e-9

  it('is an 11 × 17 portrait page: title block on top, key map at its right, the map below with room for ticks', () => {
    expect(layout.page).toEqual({ x: 0, y: 0, w: 792, h: 1224 })
    expect(END_MAP_PIXELS.height).toBe(3300)
    expect(Math.abs(END_MAP_PIXELS.width / END_MAP_PIXELS.height - 11 / 17)).toBeLessThan(0.001)
    for (const box of [layout.logo, layout.heading, layout.keyMap]) expect(inside(layout.title, box)).toBe(true)
    expect(layout.logo.x).toBe(layout.title.x)
    expect(layout.keyMap.x + layout.keyMap.w).toBeCloseTo(layout.title.x + layout.title.w, 6)
    expect(layout.logo.x + layout.logo.w).toBeLessThan(layout.heading.x)
    expect(layout.heading.x + layout.heading.w).toBeLessThan(layout.keyMap.x)
    // The map sits under the title and above the footer, with a strip for the tick labels on every side.
    expect(layout.map.y).toBeGreaterThan(layout.title.y + layout.title.h + 20)
    expect(layout.map.x).toBeGreaterThan(20)
    expect(layout.map.x + layout.map.w).toBeLessThan(792 - 20)
    expect(layout.map.y + layout.map.h).toBeLessThan(layout.footer.y - 20)
    expect(END_MAP_ASPECT).toBeCloseTo(layout.map.w / layout.map.h, 9)
    expect(Math.abs(frame.width / frame.height - END_MAP_ASPECT)).toBeLessThan(0.01)
  })

  it('fits every block and viewpoint at the largest round scale, true at the centre when the neat line prints', () => {
    const plan = planOverviewSheet(twoViewpoints, frame, 'end-map-portrait')!
    expect(plan.kind).toBe('sheet')
    expect(plan.basemap).toBe('map')
    expect(plan.sheet?.style).toBe('end-map-portrait')
    expect(plan.sheet?.paper).toEqual({ widthIn: 11, heightIn: 17 })
    const scale = plan.sheet!.scale
    expect(FIT_SCALES).toContain(scale)
    const map = layout.map
    // The captured frame, printed the neat line's width, is at the stated scale at the centre latitude.
    expect(metresPerPixel(plan.camera) * frame.width).toBeCloseTo(((scale * map.w) / 72) * 0.0254, 3)
    // The page projection and MapLibre's agree, so what is drawn over the capture lands on it.
    const pixels = frameProjectionFor(plan.camera, frame)
    const page = plan.endMap!.projection
    const points: Array<[number, number]> = [
      ...twoViewpoints.viewpoints.map((vp): [number, number] => [vp.lng, vp.lat]),
      ...twoViewpoints.blocks.flatMap(
        (block) => (block.geometry as GeoJSON.Polygon).coordinates[0] as [number, number][],
      ),
    ]
    for (const [lng, lat] of points) {
      const [x, y] = page.project(lng, lat)
      expect(x).toBeGreaterThan(map.x + map.w * 0.07 - 1e-6)
      expect(x).toBeLessThan(map.x + map.w * 0.93 + 1e-6)
      expect(y).toBeGreaterThan(map.y + map.h * 0.07 - 1e-6)
      expect(y).toBeLessThan(map.y + map.h * 0.93 + 1e-6)
      const [px, py] = pixels.project(lng, lat)
      // One scale both ways: the frame's whole pixels leave its shape a hair off the neat line's.
      const k = map.w / frame.width
      expect(map.x + map.w / 2 + (px - frame.width / 2) * k).toBeCloseTo(x, 3)
      expect(map.y + map.h / 2 + (py - frame.height / 2) * k).toBeCloseTo(y, 3)
    }
    // The next larger round scale would not hold them.
    const closer = FIT_SCALES[FIT_SCALES.indexOf(scale as (typeof FIT_SCALES)[number]) - 1]
    const xs = points.map(([lng, lat]) => page.project(lng, lat)[0])
    const ys = points.map(([lng, lat]) => page.project(lng, lat)[1])
    expect(
      (Math.max(...xs) - Math.min(...xs)) * (scale / closer) > map.w * 0.86 ||
        (Math.max(...ys) - Math.min(...ys)) * (scale / closer) > map.h * 0.86,
    ).toBe(true)
    // The key map is a window of the same frame at the key box's shape, sixteen times smaller in scale.
    const key = plan.endMap!.keyMap
    expect(Math.abs(key.frame.width / key.frame.height - layout.keyMap.w / layout.keyMap.h)).toBeLessThan(0.02)
    expect(key.camera.center).toEqual(plan.camera.center)
    expect(key.scale / scale).toBeCloseTo(16, 6)
    expect(metresPerPixel(key.camera) * key.frame.width).toBeCloseTo(((key.scale * layout.keyMap.w) / 72) * 0.0254, 3)
    expect(plan.caption).toMatch(/^VIA overview map at 1:[\d,]+ \(11 × 17 portrait\): proposed blocks EGG1 and EGG2/)
    expect(planOverviewSheet({ ...features, blocks: [], viewpoints: [] }, frame, 'end-map-portrait')).toBeNull()
    // The landscape sheet stays the default.
    expect(planOverviewSheet(twoViewpoints, captureFrame({ width: 1100, height: 900 }, 17 / 11))!.basemap).toBe('topo')
  })

  it('ticks round UTM eastings and northings where they cross the neat line, in the area’s zone', () => {
    expect(utmZoneOf(-122.8)).toBe(10)
    expect(utmZoneOf(-116.9)).toBe(11)
    expect(utmTickInterval(40000)).toBe(1000)
    expect(utmTickInterval(20000)).toBe(500)
    expect(utmTickInterval(10000)).toBe(250)
    const plan = planOverviewSheet(twoViewpoints, frame, 'end-map-portrait')!
    const { projection, ticks } = plan.endMap!
    expect(ticks.zone).toBe(10)
    const utm = proj4('EPSG:4326', '+proj=utm +zone=10 +datum=NAD83 +units=m +no_defs')
    const { x, y, w, h } = projection.frame
    const spacingPt = ticks.intervalM / metresPerPoint(projection.scale)
    for (const [edge, list, toPage, axis] of [
      ['top', ticks.top, (at: number) => [at, y], 0],
      ['bottom', ticks.bottom, (at: number) => [at, y + h], 0],
      ['left', ticks.left, (at: number) => [x, at], 1],
      ['right', ticks.right, (at: number) => [x + w, at], 1],
    ] as const) {
      expect(list.length, edge).toBeGreaterThan(3)
      for (const tick of list) {
        expect(tick.value % ticks.intervalM).toBe(0)
        expect(tick.label).toBe(String(tick.value))
        const [px, py] = toPage(tick.at)
        const grid = utm.forward(projection.unproject(px, py))
        expect(Math.abs(grid[axis] - tick.value), `${edge} ${tick.value}`).toBeLessThan(0.5)
      }
      // Neighbouring ticks one interval apart on paper (within the Mercator stretch across the sheet).
      for (let i = 1; i < list.length; i++)
        expect(Math.abs(list[i].at - list[i - 1].at) / spacingPt).toBeGreaterThan(0.97)
    }
  })

  it('reads contours at a round interval from terrain tiles it can afford', () => {
    expect(endMapContourInterval(40000)).toEqual({ intervalM: 20, indexEvery: 5 })
    expect(endMapContourInterval(20000)).toEqual({ intervalM: 10, indexEvery: 5 })
    const plan = planOverviewSheet(twoViewpoints, frame, 'end-map-portrait')!
    const end = plan.endMap!
    expect(demTileRange(end.projection.bounds, end.demZoom).tileCount).toBeLessThanOrEqual(END_MAP_MAX_DEM_TILES)
    expect(endMapDemZoom(end.projection)).toBe(end.demZoom)
    // A plane rising 100 m a kilometre north: contours every interval, none where the terrain has no data.
    const rising = { elevationAt: (_lng: number, lat: number) => (lat - 53.9) * 11_100 }
    const traced = endMapContours(end.projection, rising, { intervalM: 20, indexEvery: 5 })!
    expect(traced.result.interval).toBe(20)
    expect(traced.result.levels.length).toBeGreaterThan(5)
    expect(traced.result.levels.every((level) => level.level % 20 === 0)).toBe(true)
    expect(traced.result.levels.filter((level) => level.index).every((level) => level.level % 100 === 0)).toBe(true)
    expect(endMapContours(end.projection, { elevationAt: () => Number.NaN }, end.contours)).toBeNull()
  })

  it('keys only the rows it drew, in the end map’s order', () => {
    expect(endMapLegendKeys(new Set(['parks', 'viewpoint', 'block']))).toEqual(['viewpoint', 'block', 'parks'])
    expect(END_MAP_LEGEND_ORDER[0]).toBe('viewpoint')
    const plan = planOverviewSheet(twoViewpoints, frame, 'end-map-portrait')!
    const [w, s, e, n] = plan.endMap!.projection.bounds
    const basemap: EndMapBasemap = {
      water: [square((w + e) / 2, (s + n) / 2 - 0.02, 0.01)],
      parks: [],
      creeks: [
        [
          [w, s],
          [e, n],
        ],
      ],
      highways: [
        [
          [w, (s + n) / 2],
          [e, (s + n) / 2],
        ],
      ],
      roads: [],
      waterNames: [{ name: 'Long Lake', lng: (w + e) / 2, lat: (s + n) / 2 - 0.02 }],
    }
    const sheet = composeEndMap({
      plan,
      features: twoViewpoints,
      basemap,
      contours: null,
      mapImage: null,
      keyMapImage: null,
      logo: null,
      project: 'CP 12',
      attribution: '© OpenStreetMap contributors',
    })
    expect(sheet.width).toBe(792)
    expect(sheet.height).toBe(1224)
    expect(sheet.legend).toEqual([
      'Viewpoints',
      'Hwy',
      'Proposed block',
      'VQO linework',
      'Main lakes',
      'Creeks',
      'WTRA',
      'Harvested',
    ])
    expect(sheet.scale).toBe(`1:${plan.sheet!.scale.toLocaleString('en-US')}`)
    expect(sheet.labels).toEqual(expect.arrayContaining(['VP 1', 'VP 2 Far Ridge', 'EGG1', 'EGG2', 'PR', 'Long Lake']))
    const texts = sheet.ops.flatMap((op) => (op.op === 'text' ? [op] : []))
    expect(texts.map((op) => op.text)).toEqual(
      expect.arrayContaining(['VIA Overview Map', 'CP 12', sheet.scale, 'Legend', 'Logo (your own)']),
    )
    // Northings stand on their side; eastings read across.
    const { ticks } = plan.endMap!
    expect(texts.find((op) => op.text === ticks.left[0].label)?.angle).toBe(90)
    expect(texts.find((op) => op.text === ticks.top[0].label)?.angle).toBeUndefined()
    expect(texts.some((op) => /UTM zone 10, NAD83/.test(op.text))).toBe(true)
    // Nothing from the basemap, nothing keyed for it.
    const bare = composeEndMap({
      plan,
      features: { ...twoViewpoints, retention: [], openings: [] },
      basemap: null,
      contours: null,
      mapImage: null,
      keyMapImage: null,
      logo: { kind: 'url', url: 'data:image/png;base64,AAAA', format: 'PNG', width: 200, height: 100 },
      project: null,
      attribution: null,
    })
    expect(bare.legend).toEqual(['Viewpoints', 'Proposed block', 'VQO linework'])
    // The user's logo fills the slot at its own proportions; the project line falls back to the blocks.
    const logo = bare.ops.find((op) => op.op === 'image')
    expect(logo && logo.op === 'image' ? [logo.x, logo.w / logo.h] : null).toEqual([layout.logo.x, 2])
    expect(bare.ops.some((op) => op.op === 'text' && op.text === 'EGG1, EGG2')).toBe(true)
    expect(() => sheetSvg(sheet.ops, sheet.width, sheet.height)).not.toThrow()
  })

  it('numbers viewpoints as the report does, keeping a number already in the name', () => {
    expect(endMapViewpointLabel('Lost Ledges', 1)).toBe('VP 2 Lost Ledges')
    expect(endMapViewpointLabel('VP3 Marine Beach', 0)).toBe('VP 3 Marine Beach')
    expect(endMapViewpointLabel('vp 4', 0)).toBe('VP 4')
    expect(endMapViewpointLabel('Lost Ledge (campground) (VP2)', 0)).toBe('VP 2 Lost Ledge (campground)')
  })

  it('reads water, parks, creeks and roads from the basemap tiles once each', () => {
    const lake: GeoJSON.Feature = { type: 'Feature', geometry: square(-122.8, 54.0, 0.01), properties: {} }
    const far: GeoJSON.Feature = { type: 'Feature', geometry: square(-100, 40, 0.01), properties: {} }
    const line = (roadClass: string, x: number): GeoJSON.Feature => ({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [x, 53.99],
          [x, 54.01],
        ],
      },
      properties: { class: roadClass },
    })
    const tiles: Record<string, GeoJSON.Feature[]> = {
      water: [lake, lake, far],
      park: [],
      waterway: [line('stream', -122.81)],
      transportation: [line('trunk', -122.8), line('track', -122.79), line('track', -122.79), line('path', -122.78)],
      water_name: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [-122.8, 54] }, properties: { name: 'Lake' } },
      ],
    }
    const map = {
      getStyle: () => ({
        layers: Object.keys(tiles).map((sourceLayer) => ({
          id: sourceLayer,
          source: 'omt',
          'source-layer': sourceLayer,
        })),
      }),
      querySourceFeatures: (_source: string, { sourceLayer }: { sourceLayer: string }) => tiles[sourceLayer] ?? [],
    }
    const read = endMapBasemapFromMap(map, [-122.9, 53.9, -122.7, 54.1])
    expect(read.water).toHaveLength(1)
    expect(read.creeks).toHaveLength(1)
    expect(read.highways).toHaveLength(1)
    expect(read.roads).toHaveLength(1)
    expect(read.waterNames).toEqual([{ name: 'Lake', lng: -122.8, lat: 54 }])
    // CARTO's and Protomaps' schema: lakes, waterways and names in one `water` layer, `roads` by `kind_detail`.
    const carto: Record<string, GeoJSON.Feature[]> = {
      water: [
        lake,
        { ...line('', -122.81), properties: { kind: 'stream' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [-122.8, 54] }, properties: { name: 'Lake' } },
      ],
      roads: [
        { ...line('', -122.8), properties: { kind: 'major_road', kind_detail: 'primary' } },
        { ...line('', -122.79), properties: { kind: 'path', kind_detail: 'track' } },
        { ...line('', -122.78), properties: { kind: 'path', kind_detail: 'footway' } },
      ],
      landuse: [
        { type: 'Feature', geometry: square(-122.75, 54.0, 0.01), properties: { kind: 'national_park' } },
        { type: 'Feature', geometry: square(-122.75, 54.0, 0.02), properties: { kind: 'residential' } },
      ],
    }
    const fromCarto = endMapBasemapFromMap(
      {
        getStyle: () => ({
          layers: Object.keys(carto).map((sourceLayer) => ({
            id: sourceLayer,
            source: 'c',
            'source-layer': sourceLayer,
          })),
        }),
        querySourceFeatures: (_source: string, { sourceLayer }: { sourceLayer: string }) => carto[sourceLayer] ?? [],
      },
      [-122.9, 53.9, -122.7, 54.1],
    )
    expect(
      [fromCarto.water, fromCarto.creeks, fromCarto.highways, fromCarto.roads, fromCarto.parks].map((l) => l.length),
    ).toEqual([1, 1, 1, 1, 1])
    expect(fromCarto.waterNames.map((w) => w.name)).toEqual(['Lake'])
    expect(
      endMapBasemapFromMap({ getStyle: () => ({ layers: [] }), querySourceFeatures: () => [] }, [0, 0, 1, 1]),
    ).toEqual({
      water: [],
      parks: [],
      creeks: [],
      highways: [],
      roads: [],
      waterNames: [],
    })
  })
})
