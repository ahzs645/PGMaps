import { expect, test } from '@playwright/test'
import { localRasterResolution } from '../../src/pages/dev-forestry/localRaster'
import type { LocalRaster } from '../../src/pages/dev-forestry/types'
import { positionAt } from '../../src/pages/dev-forestry-roads/engine'
import { createDemoProject } from '../../src/pages/dev-forestry-roads/terrain'

test.use({ serviceWorkers: 'block', viewport: { width: 1512, height: 982 } })
test.setTimeout(120_000)

test('source gaps remain visible across station selection, charts and the terrain preview', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
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
  const filledPixels = await paintedPixels()
  const filledDimensions = await canvas.evaluate((el) => [el.getAttribute('width'), el.getAttribute('height')])
  await page.getByRole('button', { name: 'Fill small gaps in 3D display', exact: true }).click()
  await expect(preview).toHaveAttribute('data-infilled-cells', '0')
  await expect(preview).toHaveAttribute('data-open-gap-cells', String(counts.filled + counts.open))
  await expect(canvas).toHaveAttribute('data-estimated-face-count', '0')
  await expect(preview.locator('polygon[data-design-over-terrain-gap="true"]')).not.toHaveCount(0)
  expect(await canvas.evaluate((el) => [el.getAttribute('width'), el.getAttribute('height')])).toEqual(filledDimensions)
  expect(await paintedPixels()).toBeLessThan(filledPixels)
  await expect(warning).toContainText('No ground elevation at 0+600.0')
  await page.getByRole('button', { name: 'Fill small gaps in 3D display', exact: true }).click()
  await expect(preview).toHaveAttribute('data-infilled-cells', String(counts.filled))
  expect(await paintedPixels()).toBe(filledPixels)
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
