import { expect, test, type Locator, type Page } from '@playwright/test'
import { openWorkbench } from './road-workbench'
import { choose } from './styled-select'
import { forceCanvasTerrainPreview } from './road-terrain-renderer'
import { TERRAIN_RENDER_LIMITS, MAX_TERRAIN_RENDER_SIDE } from '../../src/pages/dev-forestry-roads/terrainRenderQuality'

test.use({
  serviceWorkers: 'block',
  actionTimeout: 15_000,
  viewport: { width: 1512, height: 982 },
})
test.setTimeout(120_000)

async function prepare(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  // Valid empty style: the test owns its terrain and never depends on external map tiles.
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await openWorkbench(page, '/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  const station = page.getByRole('spinbutton', { name: 'Selected station metres', exact: true })
  await station.fill('390')
  await station.press('Tab')
  await choose(page.getByRole('combobox', { name: 'Road detail view', exact: true }), { label: '3D' })
  const preview = page.getByTestId('road-terrain-preview')
  await expect(preview).toHaveAttribute('data-station', '390')
  return { preview, errors }
}

async function gpuMetrics(preview: Locator) {
  return preview.getByTestId('road-terrain-gpu-canvas').evaluate((canvas: HTMLCanvasElement) => {
    const bounds = canvas.getBoundingClientRect()
    return {
      width: canvas.width,
      height: canvas.height,
      displayWidth: bounds.width,
      displayHeight: bounds.height,
      frames: Number(canvas.dataset.renderCount ?? 0),
      triangles: Number(canvas.dataset.triangleCount ?? 0),
      geometryRevision: Number(canvas.dataset.geometryRevision ?? 0),
      moving: canvas.dataset.moving === 'true',
    }
  })
}

async function expectDrawn(preview: Locator) {
  await expect(preview).toHaveAttribute('data-renderer', 'webgl')
  await expect(preview.getByTestId('road-terrain-gpu-canvas')).toBeVisible()
  await expect
    .poll(async () => {
      const size = await gpuMetrics(preview)
      return (
        size.width > 0 &&
        size.height > 0 &&
        size.displayWidth > 0 &&
        size.displayHeight > 0 &&
        size.frames > 0 &&
        size.triangles > 0
      )
    })
    .toBe(true)
}

test('GPU terrain renders on changes and sleeps while the view is still', async ({ page }, testInfo) => {
  const { preview, errors } = await prepare(page)
  await expectDrawn(preview)
  await expect.poll(async () => (await gpuMetrics(preview)).moving).toBe(false)
  const initial = await gpuMetrics(preview)
  await preview.getByRole('button', { name: 'Rotate terrain right', exact: true }).click()
  await expect.poll(async () => (await gpuMetrics(preview)).frames).toBeGreaterThan(initial.frames)
  expect((await gpuMetrics(preview)).geometryRevision).toBe(initial.geometryRevision)
  // One zoom step remains below the finer-patch threshold, so this is a camera-only operation.
  const beforeZoom = (await gpuMetrics(preview)).frames
  await preview.getByRole('button', { name: 'Zoom terrain in', exact: true }).click()
  await expect.poll(async () => Number(await preview.getAttribute('data-zoom'))).toBeGreaterThan(1)
  await expect.poll(async () => (await gpuMetrics(preview)).frames).toBeGreaterThan(beforeZoom)
  expect((await gpuMetrics(preview)).geometryRevision).toBe(initial.geometryRevision)
  const station = page.getByRole('spinbutton', { name: 'Selected station metres', exact: true })
  for (const value of ['400', '390']) {
    const beforeStation = (await gpuMetrics(preview)).frames
    await station.fill(value)
    await station.press('Tab')
    await expect(preview).toHaveAttribute('data-station', value)
    await expect.poll(async () => (await gpuMetrics(preview)).frames).toBeGreaterThan(beforeStation)
    expect((await gpuMetrics(preview)).geometryRevision).toBe(initial.geometryRevision)
  }

  const quality = preview.getByRole('combobox', { name: 'Terrain render quality', exact: true })
  for (const value of ['efficient', 'high', 'auto'] as const) {
    const before = (await gpuMetrics(preview)).frames
    await choose(quality, { value })
    await expect(quality).toHaveAttribute('data-value', value)
    await expect.poll(async () => (await gpuMetrics(preview)).frames).toBeGreaterThan(before)
    await expect(preview).toHaveAttribute('data-station', '390')
    const size = await gpuMetrics(preview)
    expect(size.width * size.height).toBeLessThanOrEqual(TERRAIN_RENDER_LIMITS[value].maxPixels)
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(MAX_TERRAIN_RENDER_SIDE)
  }

  // A bounded observation interval verifies that the viewer has no perpetual animation loop.
  // Retry only while pending layout or asset work is still legitimately asking for a frame.
  await expect(async () => {
    const before = (await gpuMetrics(preview)).frames
    await page.waitForTimeout(500)
    expect((await gpuMetrics(preview)).frames).toBe(before)
  }).toPass({ timeout: 10_000 })
  await preview.screenshot({ path: testInfo.outputPath('gpu-road-view.png'), animations: 'disabled' })
  expect(errors).toEqual([])
})

test('surface, buried-structure and cutaway inspection change the GPU picture without changing station', async ({
  page,
}, testInfo) => {
  const { preview, errors } = await prepare(page)
  await expectDrawn(preview)
  await preview.getByRole('button', { name: 'Around station', exact: true }).click()
  const canvas = preview.getByTestId('road-terrain-gpu-canvas')
  const surface = preview.getByRole('combobox', { name: '3D road surface', exact: true })
  for (const value of ['subgrade', 'finished']) {
    const before = await gpuMetrics(preview)
    await choose(surface, { value })
    await expect(surface).toHaveAttribute('data-value', value)
    await expect.poll(async () => (await gpuMetrics(preview)).frames).toBeGreaterThan(before.frames)
    await expect.poll(async () => (await gpuMetrics(preview)).geometryRevision).toBeGreaterThan(before.geometryRevision)
    await expect(preview).toHaveAttribute('data-station', '390')
  }

  await expect.poll(async () => (await gpuMetrics(preview)).moving).toBe(false)
  const solid = await canvas.screenshot({ path: testInfo.outputPath('gpu-finished-solid.png') })
  const xray = preview.getByRole('button', { name: 'X-ray structures', exact: true })
  const beforeXray = (await gpuMetrics(preview)).frames
  await xray.click()
  await expect(xray).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(async () => (await gpuMetrics(preview)).frames).toBeGreaterThan(beforeXray)
  const xrayImage = await canvas.screenshot({ path: testInfo.outputPath('gpu-finished-xray.png') })
  expect(xrayImage.equals(solid)).toBe(false)
  const beforeSolid = (await gpuMetrics(preview)).frames
  await xray.click()
  await expect(xray).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(async () => (await gpuMetrics(preview)).frames).toBeGreaterThan(beforeSolid)

  const cutaway = preview.getByRole('button', { name: 'Cutaway at selected station', exact: true })
  const beforeCutaway = (await gpuMetrics(preview)).frames
  await cutaway.click()
  await expect(cutaway).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(async () => (await gpuMetrics(preview)).frames).toBeGreaterThan(beforeCutaway)
  await expect(preview.getByText('Cutaway at 0+390.0 · display only', { exact: true })).toBeVisible()
  const cutawayImage = await canvas.screenshot({ path: testInfo.outputPath('gpu-finished-cutaway.png') })
  expect(cutawayImage.equals(solid)).toBe(false)
  await cutaway.click()
  await expect(cutaway).toHaveAttribute('aria-pressed', 'false')
  await expect(preview).toHaveAttribute('data-station', '390')
  expect(errors).toEqual([])
})

test('a terrain-only transect remains selectable over the GPU surface', async ({ page }) => {
  const { preview, errors } = await prepare(page)
  await expectDrawn(preview)
  await page
    .getByRole('tablist', { name: 'Road workflow', exact: true })
    .getByRole('tab', { name: 'Terrain', exact: true })
    .click()
  await page
    .getByTestId('road-streams')
    .getByRole('button', { name: /Synthetic drainage/ })
    .click()
  await page.getByRole('button', { name: 'View terrain profile', exact: true }).click()
  await choose(page.getByRole('combobox', { name: 'Road detail view', exact: true }), { label: '3D' })
  await expect(preview).toHaveAttribute('data-terrain-only', 'true')
  await expectDrawn(preview)
  const station = page.getByRole('spinbutton', { name: 'Selected station metres', exact: true })
  await station.fill('0')
  await station.press('Tab')
  await expect(preview).toHaveAttribute('data-station', '0')

  // The GPU draws the transect; its SVG stroke is the real pointer hit target, not a second visible line.
  const target = preview.locator('line[stroke="transparent"][pointer-events="stroke"]').last()
  await expect(target).toBeVisible()
  await target.click()
  await expect.poll(async () => Number(await preview.getAttribute('data-station'))).toBeGreaterThan(0)
  const selected = Number(await preview.getAttribute('data-station'))
  await expect(page.getByTestId('road-profile-chart')).toHaveAttribute('data-station', String(selected))
  await expect(station).toHaveValue(String(Number(selected.toFixed(1))))
  await expect(preview).toHaveAttribute('data-renderer', 'webgl')
  expect(errors).toEqual([])
})

test('nested fullscreen and resize preserve the 3D station and restore the workspace', async ({ page }) => {
  const { preview, errors } = await prepare(page)
  await expectDrawn(preview)
  const workspace = page.getByTestId('road-workspace')
  const panel = page.getByRole('region', { name: '3D terrain', exact: true })

  await preview.getByRole('button', { name: 'Around station', exact: true }).click()
  await preview.getByRole('button', { name: 'Zoom terrain in', exact: true }).click()
  const zoom = await preview.getAttribute('data-zoom')
  await page.getByRole('button', { name: 'Fullscreen Road workspace', exact: true }).click()
  await expect(workspace).toHaveAttribute('data-fullscreen', 'true')
  await panel.getByRole('button', { name: 'Fullscreen 3D terrain', exact: true }).click()
  await expect(panel).toHaveAttribute('data-fullscreen', 'true')
  await expect.poll(async () => (await gpuMetrics(preview)).displayWidth).toBeGreaterThan(1200)

  await page.setViewportSize({ width: 980, height: 660 })
  await expect.poll(async () => (await gpuMetrics(preview)).displayWidth).toBeLessThan(980)
  await expect.poll(async () => (await gpuMetrics(preview)).displayWidth).toBeGreaterThan(850)
  await expectDrawn(preview)
  await expect(preview).toHaveAttribute('data-station', '390')
  await expect(preview).toHaveAttribute('data-zoom', zoom!)

  // The first Escape belongs to the inner panel, not to the containing workspace.
  await page.keyboard.press('Escape')
  await expect(panel).not.toHaveAttribute('data-fullscreen', 'true')
  await expect(workspace).toHaveAttribute('data-fullscreen', 'true')
  await expectDrawn(preview)
  await page.keyboard.press('Escape')
  await expect(workspace).not.toHaveAttribute('data-fullscreen', 'true')
  await page.setViewportSize({ width: 1512, height: 982 })
  await expectDrawn(preview)
  await expect(preview).toHaveAttribute('data-station', '390')
  await expect(preview).toHaveAttribute('data-zoom', zoom!)

  // Explicit exit has the same restoration contract as Escape.
  await panel.getByRole('button', { name: 'Fullscreen 3D terrain', exact: true }).click()
  await panel.getByRole('button', { name: 'Exit fullscreen 3D terrain', exact: true }).click()
  await expect(panel).not.toHaveAttribute('data-fullscreen', 'true')
  await expectDrawn(preview)
  expect(errors).toEqual([])
})

test('changing the detail view while expanded disposes and recreates the renderer without losing selection', async ({
  page,
}) => {
  const { preview, errors } = await prepare(page)
  await expectDrawn(preview)
  const picker = page.getByRole('combobox', { name: 'Road detail view', exact: true })
  await page.getByRole('button', { name: 'Fullscreen 3D terrain', exact: true }).click()

  for (let round = 0; round < 2; round++) {
    await choose(picker, { label: 'Section' })
    await expect(page.getByRole('region', { name: 'Cross-section', exact: true })).toHaveAttribute(
      'data-fullscreen',
      'true',
    )
    await expect(page.getByTestId('road-terrain-gpu-canvas')).toHaveCount(0)
    await choose(picker, { label: '3D' })
    await expect(page.getByRole('region', { name: '3D terrain', exact: true })).toHaveAttribute(
      'data-fullscreen',
      'true',
    )
    await expectDrawn(preview)
    await expect(preview).toHaveAttribute('data-station', '390')
    await expect(page.getByTestId('road-terrain-gpu-canvas')).toHaveCount(1)
  }
  await page.keyboard.press('Escape')
  await expect(page.getByRole('region', { name: '3D terrain', exact: true })).not.toHaveAttribute(
    'data-fullscreen',
    'true',
  )
  await expect(page.getByRole('spinbutton', { name: 'Selected station metres', exact: true })).toHaveValue('390')
  expect(errors).toEqual([])
})

test('unavailable WebGL in the preview keeps a working canvas fallback', async ({ page }) => {
  await forceCanvasTerrainPreview(page)
  const { preview, errors } = await prepare(page)
  await expect(
    preview.getByRole('status').filter({ hasText: 'This browser cannot create an accelerated 3D view.' }),
  ).toBeVisible()
  await expect(preview).toHaveAttribute('data-renderer', 'canvas')
  await expect(preview.getByTestId('road-ground-canvas')).toBeVisible()
  const before = Number(await preview.getAttribute('data-zoom'))
  await preview.getByRole('button', { name: 'Zoom terrain in', exact: true }).click()
  await expect.poll(async () => Number(await preview.getAttribute('data-zoom'))).toBeGreaterThan(before)
  await preview.getByRole('button', { name: 'Around station', exact: true }).click()
  await expect(preview).toHaveAttribute('data-station', '390')
  expect(errors).toEqual([])
})
