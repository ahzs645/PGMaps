import { describe, expect, it } from 'vitest'
import { FIT_SCALES, MAX_SHEET_SCALE, zoomForScale } from '@/lib/mapSheet/scale'
import {
  asShownRegistrable,
  captureCamera,
  captureDpi,
  capturePixelRatio,
  DEFAULT_MAP_PDF,
  fittedMapScale,
  framedMapBox,
  framedPageSketch,
  framedScale,
  isAsShown,
  MAP_PDF_MAX_PIXEL_RATIO,
  MAP_PDF_SCALE_PRESETS,
  MAP_PDF_TARGET_DPI,
  mapPdfFrameProjection,
  mapPdfPageFormat,
  mapPdfPageMm,
  mapPdfPlan,
  MIN_MAP_PDF_SCALE,
  parseMapPdfSettings,
  type MapPdfBox,
  type MapPdfPlan,
  type MapPdfTargets,
} from './mapPdfFrame'

/** Great-circle distance, metres, on the mean Earth radius: an independent check of the frame's ground. */
function haversine([lng1, lat1]: [number, number], [lng2, lat2]: [number, number]) {
  const rad = Math.PI / 180
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2
  return 2 * 6371008.8 * Math.asin(Math.sqrt(a))
}

// A block near Prince George, about 900 m east-west and 550 m north-south.
const BLOCK: MapPdfBox = [-122.76, 53.91, -122.7465, 53.915]
const ring = (box: MapPdfBox): [number, number][] => [
  [box[0], box[1]],
  [box[2], box[1]],
  [box[2], box[3]],
  [box[0], box[3]],
  [box[0], box[1]],
]
const targets: MapPdfTargets = {
  viewCenter: [-122.75, 53.912],
  viewSize: { width: 1200, height: 700 },
  road: {
    name: 'Spur 7',
    line: [
      [-122.75, 53.9],
      [-122.74, 53.92],
    ],
  },
  roads: [
    [
      [-122.75, 53.9],
      [-122.74, 53.92],
    ],
    [
      [-122.8, 53.88],
      [-122.79, 53.885],
    ],
  ],
  blocks: [
    { value: 'context:b1', label: 'Block 12', ring: ring(BLOCK) },
    { value: 'reference:r1', label: 'Old block (reference)', ring: ring([-122.7, 53.95, -122.69, 53.96]) },
  ],
}
const framed = (plan: MapPdfPlan) => {
  if (plan.mode !== 'framed') throw Error('expected a framed plan')
  return plan
}

describe('Map PDF settings', () => {
  it('default to the plan as shown on A4, the request the Map PDF always made', () => {
    expect(DEFAULT_MAP_PDF).toMatchObject({ paper: 'a4', orientation: 'auto', frame: 'view', scale: 'fit' })
    expect(isAsShown(DEFAULT_MAP_PDF)).toBe(true)
    expect(mapPdfPlan(DEFAULT_MAP_PDF, targets)).toEqual({ mode: 'as-shown', paper: 'a4', orientation: 'auto' })
    // jsPDF's own A4, so the default page is made with the same format argument as before.
    expect(mapPdfPageFormat('a4')).toBe('a4')
    expect(mapPdfPageMm('a4', 'landscape')).toEqual({ width: 297, height: 210 })
  })

  it('read back from storage defensively', () => {
    expect(parseMapPdfSettings(null)).toEqual(DEFAULT_MAP_PDF)
    expect(parseMapPdfSettings('a3')).toEqual(DEFAULT_MAP_PDF)
    expect(
      parseMapPdfSettings({ paper: 'b5', orientation: 'diagonal', frame: 'world', scale: 12, marginPercent: 90 }),
    ).toEqual(DEFAULT_MAP_PDF)
    expect(
      parseMapPdfSettings({
        paper: 'tabloid',
        orientation: 'portrait',
        frame: 'block',
        block: 'context:b1',
        scale: 12345.6,
        marginPercent: 5,
      }),
    ).toEqual({
      paper: 'tabloid',
      orientation: 'portrait',
      frame: 'block',
      block: 'context:b1',
      scale: 12346,
      marginPercent: 5,
    })
    expect(parseMapPdfSettings({ scale: MIN_MAP_PDF_SCALE - 1 }).scale).toBe('fit')
    expect(parseMapPdfSettings({ scale: MAX_SHEET_SCALE + 1 }).scale).toBe('fit')
  })

  it('offer the block sheets’ scales by name', () => {
    expect(MAP_PDF_SCALE_PRESETS).toEqual([5000, 10000, 20000, 50000])
  })
})

describe('what the Map PDF frames', () => {
  it('frames the road on screen, every road or a block, and names it', () => {
    const road = framed(mapPdfPlan({ ...DEFAULT_MAP_PDF, frame: 'road' }, targets))
    expect(road).toMatchObject({ label: 'Spur 7', bounds: [-122.75, 53.9, -122.74, 53.92], orientation: 'portrait' })
    const roads = framed(mapPdfPlan({ ...DEFAULT_MAP_PDF, frame: 'roads' }, targets))
    expect(roads.bounds).toEqual([-122.8, 53.88, -122.74, 53.92])
    const block = framed(mapPdfPlan({ ...DEFAULT_MAP_PDF, frame: 'block', block: 'reference:r1' }, targets))
    expect(block.label).toBe('Old block (reference)')
    // A block this project does not have falls back to the first, as the block sheet does.
    expect(framed(mapPdfPlan({ ...DEFAULT_MAP_PDF, frame: 'block', block: 'context:gone' }, targets)).label).toBe(
      'Block 12',
    )
    // The view at a typed scale keeps the plan's centre; the view fitted is the plan as shown.
    expect(framed(mapPdfPlan({ ...DEFAULT_MAP_PDF, scale: 10000 }, targets))).toMatchObject({
      center: [-122.75, 53.912],
      scale: 10000,
      orientation: 'landscape',
    })
  })

  it('says what is missing rather than printing nothing', () => {
    const empty: MapPdfTargets = { blocks: [] }
    expect(() => mapPdfPlan({ ...DEFAULT_MAP_PDF, frame: 'road' }, empty)).toThrow(/no road on screen/)
    expect(() => mapPdfPlan({ ...DEFAULT_MAP_PDF, frame: 'roads' }, empty)).toThrow(/no road to frame/)
    expect(() => mapPdfPlan({ ...DEFAULT_MAP_PDF, frame: 'block' }, empty)).toThrow(/no block areas/)
    expect(() => mapPdfPlan({ ...DEFAULT_MAP_PDF, scale: 5000 }, empty)).toThrow(/still loading/)
  })
})

describe('the frame on paper', () => {
  const box = framedMapBox(mapPdfPageMm('a4', 'landscape'), 40)

  it('shows the typed scale’s ground at the centre latitude', () => {
    const center: [number, number] = [-122.75, 53.912]
    const projection = mapPdfFrameProjection(center, 20000, box)
    // 1:20,000: a paper millimetre is 20 m on the ground.
    const widthM = (projection.mercatorBox[2] - projection.mercatorBox[0]) * Math.cos((center[1] * Math.PI) / 180)
    expect(widthM).toBeCloseTo(box.w * 20, 6)
    const heightM = (projection.mercatorBox[3] - projection.mercatorBox[1]) * Math.cos((center[1] * Math.PI) / 180)
    expect(heightM).toBeCloseTo(box.h * 20, 6)
    // Measured on the ground, the frame's middle line is within 0.5 % of it (the sphere is not the ellipsoid).
    const west = projection.unproject(0, projection.frame.h / 2)
    const east = projection.unproject(projection.frame.w, projection.frame.h / 2)
    expect(haversine(west, east) / (box.w * 20)).toBeCloseTo(1, 2)
    // The frame is centred on what it frames.
    expect(projection.project(center[0], center[1])[0]).toBeCloseTo(projection.frame.w / 2, 6)
  })

  it('fits what it frames with the margin clear on every side, at the finest listed scale', () => {
    const center = framed(mapPdfPlan({ ...DEFAULT_MAP_PDF, frame: 'block' }, targets)).center
    /** Whether the block keeps `margin` percent of the map clear on every side at `scale`. */
    const holds = (scale: number, margin: number) => {
      const projection = mapPdfFrameProjection(center, scale, box)
      const [x0, y0] = projection.project(BLOCK[0], BLOCK[3])
      const [x1, y1] = projection.project(BLOCK[2], BLOCK[1])
      const insetX = (projection.frame.w * margin) / 100,
        insetY = (projection.frame.h * margin) / 100
      return (
        x0 >= insetX - 1e-6 &&
        y0 >= insetY - 1e-6 &&
        x1 <= projection.frame.w - insetX + 1e-6 &&
        y1 <= projection.frame.h - insetY + 1e-6
      )
    }
    for (const margin of [0, 10, 20, 40]) {
      const scale = fittedMapScale(BLOCK, box, margin)!
      expect(holds(scale, margin)).toBe(true)
      // The next finer listed scale would not hold it.
      const finer = FIT_SCALES[FIT_SCALES.indexOf(scale as (typeof FIT_SCALES)[number]) - 1]
      if (finer) expect(holds(finer, margin)).toBe(false)
    }
    expect(fittedMapScale(BLOCK, box, 10)).toBe(5000)
    // Too large for the coarsest scale: refused with a reason.
    const province: MapPdfBox = [-139, 48, -114, 60]
    expect(fittedMapScale(province, box, 10)).toBeNull()
    expect(() =>
      framedScale({ ...framed(mapPdfPlan({ ...DEFAULT_MAP_PDF, frame: 'block' }, targets)), bounds: province }, box),
    ).toThrow(/does not fit on this paper at 1:250,000/)
  })

  it('places the plan so the page’s crop is exactly the frame', () => {
    const center: [number, number] = [-122.75, 53.912]
    const plan = { width: 1200, height: 700 }
    const camera = captureCamera(center, 20000, box, plan)
    // The crop has the map box's shape, centred, and fills the plan on its tighter side.
    expect(camera.crop.w / camera.crop.h).toBeCloseTo(box.w / box.h, 9)
    expect(camera.crop.x + camera.crop.w / 2).toBeCloseTo(plan.width / 2, 9)
    expect(camera.crop.y + camera.crop.h / 2).toBeCloseTo(plan.height / 2, 9)
    expect(Math.min(plan.width - camera.crop.w, plan.height - camera.crop.h)).toBeCloseTo(0, 6)
    // MapLibre's 512-pixel tiles: the crop's ground width at the camera's zoom is the frame's.
    const metresPerCss = (2 * Math.PI * 6378137 * Math.cos((center[1] * Math.PI) / 180)) / (512 * 2 ** camera.zoom)
    expect(camera.crop.w * metresPerCss).toBeCloseTo(box.w * 20, 3)
    expect(camera.cssPerMm).toBeCloseTo(camera.crop.w / box.w, 9)
    // At one CSS pixel a 1/96 in of paper, the zoom is the sheets' own `zoomForScale`.
    const exact = captureCamera(center, 20000, box, { width: (box.w * 96) / 25.4, height: (box.h * 96) / 25.4 })
    expect(exact.zoom).toBeCloseTo(zoomForScale(20000, center[1]), 9)
    expect(() => captureCamera(center, 20000, box, { width: 0, height: 700 })).toThrow(/Show the plan panel/)
  })

  it('raises the pixel ratio toward the target resolution, within the cap, never below the plan’s own', () => {
    // 2 CSS px per paper mm is about 51 dpi at ratio 1.
    expect(captureDpi(2, 1)).toBeCloseTo(50.8, 6)
    expect(capturePixelRatio(2, 1)).toBe(MAP_PDF_MAX_PIXEL_RATIO)
    expect(capturePixelRatio(4, 1)).toBeCloseTo(MAP_PDF_TARGET_DPI / (4 * 25.4), 9)
    expect(capturePixelRatio(10, 2)).toBe(2)
  })

  it('registers the plan as shown only when it is a flat Web Mercator picture', () => {
    expect(asShownRegistrable({ bearing: 0, pitch: 0, terrain: false })).toBe(true)
    expect(asShownRegistrable({ bearing: 0, pitch: 0, terrain: false, projection: 'mercator' })).toBe(true)
    expect(asShownRegistrable({ bearing: 3, pitch: 0, terrain: false })).toBe(false)
    expect(asShownRegistrable({ bearing: 0, pitch: 20, terrain: false })).toBe(false)
    expect(asShownRegistrable({ bearing: 0, pitch: 0, terrain: true })).toBe(false)
    expect(asShownRegistrable({ bearing: 0, pitch: 0, terrain: false, projection: 'globe' })).toBe(false)
  })

  it('sketches the page at the scale the PDF prints', () => {
    const plan = framed(mapPdfPlan({ ...DEFAULT_MAP_PDF, frame: 'block' }, targets))
    const sketch = framedPageSketch({
      plan,
      title: 'Spur <7> & co',
      lines: targets.roads ?? [],
      rings: targets.blocks.map((block) => block.ring),
      topMm: 40,
    })
    expect(sketch.scale).toBe(framedScale(plan, framedMapBox(mapPdfPageMm('a4', plan.orientation), 40)))
    expect(sketch.svg).toContain('Spur &lt;7&gt; &amp; co')
    expect(sketch.svg).toContain('Scale 1:5,000 on A4, true at latitude 53.91 N')
    expect(sketch.caption).toMatch(/^Block 12 at 1:5,000 on A4 landscape/)
  })
})
