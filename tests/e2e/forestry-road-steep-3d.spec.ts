import { expect, test, type Locator, type Page } from '@playwright/test'
import { alignmentLength, offsetCoordinate } from '../../src/pages/dev-forestry-roads/engine'
import { createDemoProject, DEMO_ORIGIN } from '../../src/pages/dev-forestry-roads/terrain'
import { localRasterResolution } from '../../src/pages/dev-forestry/localRaster'
import type { LocalRaster } from '../../src/pages/dev-forestry/types'

test.use({ serviceWorkers: 'block', actionTimeout: 15_000 })
test.setTimeout(120_000)

function steepProject() {
  const project = createDemoProject()
  project.name = 'Steep high-fill 3D regression'
  project.alignments = [project.alignments[0]]
  const alignment = project.alignments[0]
  alignment.points = [
    { id: 'start', coordinate: DEMO_ORIGIN, radiusM: 0 },
    { id: 'end', coordinate: offsetCoordinate(DEMO_ORIGIN, 0, 1000), radiusM: 0 },
  ]
  alignment.overrides = []
  const length = alignmentLength(alignment)
  // Reproduce the screenshot's station, elevation and 32.1% longitudinal grade.
  alignment.vertical = [
    { id: 'v0', chainage: 0, elevation: 842.31, curveLength: 0 },
    { id: 'v1', chainage: length, elevation: 842.31 + length * 0.321, curveLength: 0 },
  ]
  const raster: LocalRaster = {
    id: 'flat-test-ground',
    name: 'Flat test ground at 700 m',
    kind: 'terrain',
    epsg: 4326,
    origin: [-122.731, 53.907],
    pixelSize: [0.0002, -0.0002],
    width: 211,
    height: 116,
    values: Array.from({ length: 211 * 116 }, () => 700),
    acquired: '',
    verticalReference: 'Synthetic metres',
    sha256: 'b'.repeat(64),
  }
  project.terrain = {
    kind: 'geotiff',
    name: raster.name,
    epsg: raster.epsg,
    resolutionM: localRasterResolution(raster, raster.origin[1]),
    verticalReference: raster.verticalReference,
    sha256: raster.sha256,
    raster,
  }
  return project
}

async function prepare(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.goto('/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await page.getByTestId('road-file-input').setInputFiles({
    name: 'steep.road.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(steepProject())),
  })
  await expect(page.getByRole('button', { name: 'Projects', exact: true })).toHaveAttribute(
    'title',
    'Projects · Steep high-fill 3D regression',
  )
  await page.getByRole('spinbutton', { name: 'Selected station metres', exact: true }).fill('390')
  await page.getByRole('spinbutton', { name: 'Selected station metres', exact: true }).press('Tab')
  const tabs = page.getByRole('tablist', { name: 'Visible road pane', exact: true })
  if (await tabs.isVisible()) await tabs.getByRole('tab', { name: 'Detail', exact: true }).click()
  await page.getByRole('combobox', { name: 'Road detail view', exact: true }).click()
  await page.getByRole('option', { name: '3D', exact: true }).click()
  const preview = page.getByTestId('road-terrain-preview')
  await expect(preview).toHaveAttribute('data-station', '390')
  return { preview, errors }
}

async function expectFitted(preview: Locator) {
  const metrics = await preview.locator('svg[role="group"]').evaluate((svg: SVGSVGElement) => {
    const width = svg.width.baseVal.value,
      height = svg.height.baseVal.value
    const points = [...svg.querySelectorAll('polygon')].flatMap((polygon) =>
      [...polygon.points].map((point) => ({ x: point.x, y: point.y })),
    )
    const circles = [...svg.querySelectorAll('circle')].map((circle) => ({
      x: circle.cx.baseVal.value,
      y: circle.cy.baseVal.value,
    }))
    return {
      count: points.length,
      outside: [...points, ...circles].filter(
        (p) => !Number.isFinite(p.x + p.y) || p.x < 0 || p.y < 0 || p.x > width || p.y > height,
      ),
    }
  })
  expect(metrics.count).toBeGreaterThan(0)
  expect(metrics.outside).toEqual([])
}

async function fillPixels(preview: Locator) {
  return preview.getByTestId('road-ground-canvas').evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
    let count = 0
    for (let i = 0; i < data.length; i += 4)
      if (data[i + 2] > data[i + 1] + 5 && data[i + 1] > data[i] + 10 && data[i + 3] > 0) count++
    return count
  })
}

for (const viewport of [
  { width: 1512, height: 982 },
  { width: 390, height: 844 },
]) {
  test(`high and steep formation stays visible with honest partial batters at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    const { preview, errors } = await prepare(page)
    await expect(preview).toHaveAttribute('data-batter-face-count', /^[1-9][0-9]*$/)
    await expect(preview.getByTestId('road-3d-incomplete-section')).toContainText(
      'Increase “Section reach each side (m)” in Review',
    )
    await expect(preview.locator('[data-unfinished-batter="reach"]')).not.toHaveCount(0)
    await expectFitted(preview)
    await expect.poll(() => fillPixels(preview)).toBeGreaterThan(20)
    await preview.getByRole('button', { name: 'Follow station', exact: true }).click()
    await expectFitted(preview)
    await page.screenshot({ path: testInfo.outputPath('steep-high-fill-follow.png') })
    await preview.getByRole('button', { name: 'Rotate terrain right', exact: true }).click()
    await expectFitted(preview)
    await preview.getByRole('combobox', { name: 'Terrain vertical exaggeration', exact: true }).click()
    await page.getByRole('option', { name: '×4', exact: true }).click()
    await expectFitted(preview)
    await preview.getByRole('button', { name: 'Batters', exact: true }).click()
    await expect(preview.locator('[data-unfinished-batter]')).toHaveCount(0)
    expect(await fillPixels(preview)).toBe(0)
    await expect(preview.getByTestId('road-3d-incomplete-section')).toBeVisible()
    await preview.getByRole('button', { name: 'Batters', exact: true }).click()
    await expect(preview.locator('[data-unfinished-batter]')).not.toHaveCount(0)
    expect(errors).toEqual([])
  })
}

test('live PVI changes remain framed and increasing the reach resolves the marked limit', async ({ page }) => {
  await page.setViewportSize({ width: 1512, height: 982 })
  const { preview, errors } = await prepare(page)
  const sidebar = page.getByRole('complementary', { name: 'Road design controls', exact: true })
  const workflow = page.getByRole('tablist', { name: 'Road workflow', exact: true })
  await workflow.getByRole('tab', { name: 'Design', exact: true }).click()
  for (const name of ['PVI 1 level', 'PVI 2 level']) {
    const input = sidebar.getByRole('spinbutton', { name, exact: true })
    await input.fill('740')
    await input.press('Tab')
  }
  await expectFitted(preview)
  await expect(preview.locator('[data-unfinished-batter="reach"]')).not.toHaveCount(0)
  const first = sidebar.getByRole('spinbutton', { name: 'PVI 1 level', exact: true })
  await first.focus()
  await first.press('ArrowUp')
  // No blur is needed for either the geometry or its fit to refresh.
  await expect(first).toHaveValue('740.1')
  await expectFitted(preview)
  await workflow.getByRole('tab', { name: 'Review', exact: true }).click()
  const reach = sidebar.getByRole('spinbutton', { name: 'Section reach each side (m)', exact: true })
  await reach.fill('70')
  await reach.press('Tab')
  await expect(preview.locator('[data-unfinished-batter]')).toHaveCount(0)
  await expect(preview.getByTestId('road-3d-incomplete-section')).toHaveCount(0)
  await expect(sidebar.getByText('100.0%', { exact: true })).toBeVisible()
  await expectFitted(preview)
  expect(await fillPixels(preview)).toBeGreaterThan(20)
  expect(errors).toEqual([])
})
