import { expect, test, type Locator } from '@playwright/test'
import { localRasterResolution } from '../../src/pages/dev-forestry/localRaster'
import type { LocalRaster } from '../../src/pages/dev-forestry/types'
import { positionAt } from '../../src/pages/dev-forestry-roads/engine'
import { createDemoProject } from '../../src/pages/dev-forestry-roads/terrain'

test.use({ serviceWorkers: 'block', viewport: { width: 1512, height: 982 } })
test.setTimeout(120_000)

type CanvasMeasurements = {
  bitmap: [number, number]
  svg: [number, number]
  canvasBounds: [number, number]
  svgBounds: [number, number]
  chartSlot: [number, number]
  viewportSlot: [number, number]
  expected: [number, number]
  ratio: number
  willReadFrequently: boolean
}

/** ChartViewport and SizedChart both measure asynchronously with ResizeObserver. */
async function settledCanvasMeasurements(canvas: Locator): Promise<CanvasMeasurements> {
  let settled: CanvasMeasurements | undefined
  await expect
    .poll(
      async () => {
        const pair = await canvas.evaluate(async (element: HTMLCanvasElement) => {
          const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
          const measure = (): CanvasMeasurements => {
            const svg = element.closest('svg')!
            const chartSlot = svg.parentElement!.getBoundingClientRect()
            const viewportSlot = svg.parentElement!.parentElement!.getBoundingClientRect()
            const canvasBounds = element.getBoundingClientRect()
            const svgBounds = svg.getBoundingClientRect()
            return {
              bitmap: [element.width, element.height],
              svg: [Number(svg.getAttribute('width')), Number(svg.getAttribute('height'))],
              canvasBounds: [canvasBounds.width, canvasBounds.height],
              svgBounds: [svgBounds.width, svgBounds.height],
              chartSlot: [chartSlot.width, chartSlot.height],
              viewportSlot: [viewportSlot.width, viewportSlot.height],
              expected: [Math.max(0, Math.floor(chartSlot.width)), Math.max(1, Math.floor(viewportSlot.height))],
              ratio: Math.min(window.devicePixelRatio || 1, 2),
              willReadFrequently: Boolean(element.getContext('2d')!.getContextAttributes().willReadFrequently),
            }
          }
          // Let both measurement/observer passes run; a mesh-count attribute alone does not
          // establish that the chart has adopted the host slot's final dimensions.
          await frame()
          const first = measure()
          await frame()
          return { first, second: measure() }
        })
        const m = pair.second
        const matchesSlot =
          m.willReadFrequently &&
          m.expected[0] > 0 &&
          m.svg.every((size, axis) => size === m.expected[axis]) &&
          m.svgBounds.every((size, axis) => size === m.expected[axis]) &&
          m.canvasBounds.every((size, axis) => size === m.expected[axis]) &&
          m.bitmap.every((size, axis) => size === Math.round(m.expected[axis] * m.ratio))
        if (!matchesSlot || JSON.stringify(pair.first) !== JSON.stringify(pair.second)) return false
        settled = m
        return true
      },
      { message: 'The ground canvas and SVG must adopt a stable measured chart slot before pixel comparisons.' },
    )
    .toBe(true)
  return settled!
}

test('source gaps remain visible across station selection, charts and the terrain preview', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, contextId: string, options?: unknown) {
      // Exact pixel comparisons must use one raster backend throughout. Chromium can
      // switch an ordinary 2D context from GPU to CPU after repeated getImageData calls,
      // changing edge antialiasing even when the app emits identical projected faces.
      const settings =
        contextId === '2d' && this.getAttribute('data-testid') === 'road-ground-canvas'
          ? { ...(options as CanvasRenderingContext2DSettings | undefined), willReadFrequently: true }
          : options
      return Reflect.apply(original, this, [contextId, settings]) as RenderingContext | null
    } as HTMLCanvasElement['getContext']
  })
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  const project = createDemoProject()
  const raster: LocalRaster = {
    id: 'terrain-gap-fixture',
    name: 'Synthetic terrain with a known gap',
    kind: 'terrain',
    epsg: 4326,
    origin: [-122.731, 53.907],
    pixelSize: [0.0002, -0.0002],
    width: 211,
    height: 116,
    values: Array.from({ length: 211 * 116 }, (_, i) => 700 + (i % 211) * 0.01),
    acquired: '',
    verticalReference: 'Synthetic metres',
    sha256: 'a'.repeat(64),
  }
  const coordinate = positionAt(project.alignments[0], 200).coordinate
  const col = Math.floor((coordinate[0] - raster.origin[0]) / raster.pixelSize[0]),
    row = Math.floor((coordinate[1] - raster.origin[1]) / raster.pixelSize[1])
  for (let r = row - 1; r <= row + 1; r++)
    for (let c = col - 1; c <= col + 1; c++) raster.values[r * raster.width + c] = null
  // A separate, small enclosed gap can be estimated visually without repairing the analysis source.
  const smallGap = positionAt(project.alignments[0], 600).coordinate
  raster.values[
    Math.floor((smallGap[1] - raster.origin[1]) / raster.pixelSize[1]) * raster.width +
      Math.floor((smallGap[0] - raster.origin[0]) / raster.pixelSize[0])
  ] = null
  project.terrain = {
    kind: 'geotiff',
    name: raster.name,
    epsg: raster.epsg,
    resolutionM: localRasterResolution(raster, raster.origin[1]),
    verticalReference: raster.verticalReference,
    sha256: raster.sha256,
    raster,
  }
  await page.goto('/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await (
    await chooser
  ).setFiles({
    name: 'terrain-gap.road.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  })
  // The autosave notice changes the available chart height; settle it before comparing pixels.
  await expect(page.getByTestId('road-workspace-header')).toContainText('Training session saved')
  await page.getByRole('button', { name: 'Expand legend', exact: true }).click()
  await expect(page.getByTestId('road-plan-view')).toContainText(raster.name)
  const station = page.getByRole('spinbutton', { name: 'Selected station metres', exact: true })
  await station.fill('200')
  await station.press('Tab')
  const warning = page.getByTestId('road-station-terrain-gap')
  await expect(warning).toContainText('No ground elevation at 0+200.0')
  await expect(warning).toContainText('Import a DEM with coverage')
  await expect(page.getByTestId('road-section-chart')).toHaveAttribute('data-station', '200')
  expect(await page.getByTestId('road-section-chart').locator('[data-terrain-gap]').count()).toBeGreaterThan(0)
  expect(await page.getByTestId('road-profile-chart').locator('[data-terrain-gap]').count()).toBeGreaterThan(0)
  await page.getByRole('combobox', { name: 'Road detail view', exact: true }).click()
  await page.getByRole('option', { name: '3D', exact: true }).click()
  await expect(page.getByTestId('road-terrain-preview')).toHaveAttribute('data-station', '200')
  await expect(page.getByTestId('road-ground-canvas')).toHaveAttribute('data-face-count', /^[1-9][0-9]*$/)
  await station.fill('600')
  await station.press('Tab')
  await expect(warning).toContainText('No ground elevation at 0+600.0')
  const preview = page.getByTestId('road-terrain-preview')
  const canvas = page.getByTestId('road-ground-canvas')
  await page.getByRole('button', { name: 'Follow station', exact: true }).click()
  await expect(preview).toHaveAttribute('data-infilled-cells', /^[1-9][0-9]*$/)
  await expect(page.getByTestId('road-terrain-infill-note')).toHaveText('Estimated patches · display only')
  await expect(canvas).toHaveAttribute('data-estimated-face-count', /^[1-9][0-9]*$/)
  // Known vertical design remains visible even where the source ground is unknown.
  await expect(preview.locator('polygon[data-design-over-terrain-gap="true"]')).not.toHaveCount(0)
  const counts = await preview.evaluate((el) => ({
    filled: Number(el.dataset.infilledCells),
    open: Number(el.dataset.openGapCells),
  }))
  const paintedPixels = () =>
    canvas.evaluate((el: HTMLCanvasElement) => {
      const data = el.getContext('2d')!.getImageData(0, 0, el.width, el.height).data
      let count = 0
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count++
      return count
    })
  const recordPaint = async (stage: string) => {
    const measurements = await settledCanvasMeasurements(canvas)
    const pixels = await paintedPixels()
    await info.attach(`terrain-infill-${stage}.json`, {
      body: JSON.stringify({ stage, measurements, paintedPixels: pixels }),
      contentType: 'application/json',
    })
    return { measurements, pixels }
  }
  const filled = await recordPaint('before')
  await page.getByRole('button', { name: 'Fill small gaps in 3D display', exact: true }).click()
  await expect(preview).toHaveAttribute('data-infilled-cells', '0')
  await expect(preview).toHaveAttribute('data-open-gap-cells', String(counts.filled + counts.open))
  await expect(canvas).toHaveAttribute('data-estimated-face-count', '0')
  await expect(preview.locator('polygon[data-design-over-terrain-gap="true"]')).not.toHaveCount(0)
  const unfilled = await recordPaint('off')
  expect(unfilled.measurements.bitmap).toEqual(filled.measurements.bitmap)
  expect(unfilled.measurements.svg).toEqual(filled.measurements.svg)
  expect(unfilled.pixels).toBeLessThan(filled.pixels)
  await expect(warning).toContainText('No ground elevation at 0+600.0')
  await page.getByRole('button', { name: 'Fill small gaps in 3D display', exact: true }).click()
  await expect(preview).toHaveAttribute('data-infilled-cells', String(counts.filled))
  const restored = await recordPaint('restored')
  expect(restored.measurements.bitmap).toEqual(filled.measurements.bitmap)
  expect(restored.measurements.svg).toEqual(filled.measurements.svg)
  expect(restored.pixels).toBe(filled.pixels)
  await station.fill('0')
  await station.press('Tab')
  await expect(warning).toHaveCount(0)
  // Fractional end stations keep their exact shared position and a valid, readable entry.
  await page.getByRole('slider', { name: 'Linked road station', exact: true }).press('End')
  const exact = Number(await page.getByTestId('road-terrain-preview').getAttribute('data-station'))
  expect(exact).toBeGreaterThan(1000)
  await expect(station).toHaveValue(String(Number(exact.toFixed(1))))
  expect(await station.evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(true)
  expect(errors).toEqual([])
})
