import { expect, test, type Page } from '@playwright/test'
import type { DrainageEvidence } from '../../src/pages/dev-forestry-roads/drainageEvidence'
import type { RoadProject } from '../../src/pages/dev-forestry-roads/types'

test.use({ serviceWorkers: 'block', hasTouch: true, isMobile: true, actionTimeout: 15_000 })
test.setTimeout(180_000)

async function prepare(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.goto('/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  return errors
}
async function showDrainage(page: Page) {
  const tabs = page.getByRole('tablist', { name: 'Visible road pane', exact: true })
  if (await tabs.isVisible()) await tabs.getByRole('tab', { name: 'Detail', exact: true }).tap()
  await page.getByRole('combobox', { name: 'Road detail view', exact: true }).tap()
  await page.getByRole('option', { name: 'Drainage', exact: true }).tap()
  await expect(page.getByTestId('road-drainage')).toBeVisible()
}
/** Read the actual MapLibre source and projected active-road coordinates; do not inject app state. */
async function mapState(page: Page) {
  return page.evaluate(() => {
    const container = document.querySelector('[data-testid="road-plan-view"] .maplibregl-map')
    const key = container && Object.keys(container).find((key) => key.startsWith('__reactFiber$'))
    if (!container || !key) return null
    type Map = import('maplibre-gl').Map
    type Hook = { memoizedState?: { current?: Map } | Map; next?: Hook }
    type Fiber = { memoizedState?: Hook; return?: Fiber }
    let fiber = (container as unknown as Record<string, Fiber>)[key]
    for (let depth = 0; fiber && depth < 200; depth++, fiber = fiber.return!)
      for (let hook = fiber.memoizedState, count = 0; hook && count < 40; hook = hook.next, count++) {
        const value = hook.memoizedState
        const map =
          value && typeof value === 'object' && 'current' in value ? value.current : (value as Map | undefined)
        if (typeof map?.getTerrain !== 'function') continue
        const source = map.getSource('road-drainage')
        const data = source?.type === 'geojson' ? (source.serialize().data as GeoJSON.FeatureCollection) : null
        const roads = map.getSource('road-roads')
        const linework = roads?.type === 'geojson' ? (roads.serialize().data as GeoJSON.FeatureCollection) : null
        const active =
          linework?.features.filter((f) => f.properties?.selected && f.geometry.type === 'LineString') ?? []
        const line = active[Math.floor(active.length * 0.5)]
        const coordinate = line?.geometry.type === 'LineString' ? line.geometry.coordinates[0] : null
        const pixel = coordinate ? map.project(coordinate as [number, number]) : null
        const canvas = map.getCanvas()
        const tap =
          pixel &&
          pixel.x >= 8 &&
          pixel.x <= canvas.clientWidth - 8 &&
          pixel.y >= 8 &&
          pixel.y <= canvas.clientHeight - 8
            ? { x: pixel.x, y: pixel.y }
            : { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }
        return {
          features: data?.features ?? [],
          polygonLayer: !!map.getLayer('road-drainage-catchment-fill'),
          renderedCatchments: map.getLayer('road-drainage-catchment-fill')
            ? map
                .queryRenderedFeatures({ layers: ['road-drainage-catchment-fill'] })
                .filter((f) => f.properties?.role === 'catchment').length
            : 0,
          tap,
        }
      }
    return null
  })
}
async function download(page: Page, button: string) {
  const pending = page.waitForEvent('download', { timeout: 60_000 })
  await page.getByRole('button', { name: button, exact: true }).tap()
  const file = await pending,
    stream = (await file.createReadStream())!,
    chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return { file, bytes: Buffer.concat(chunks) }
}
async function fits(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const root = document.documentElement,
          panel = document.querySelector('[data-testid="road-drainage"]')!
        const bounds = panel.getBoundingClientRect(),
          issues: string[] = []
        if (root.scrollWidth > root.clientWidth + 1) issues.push('page horizontal overflow')
        if (root.scrollHeight > root.clientHeight + 1) issues.push('page vertical overflow')
        for (const node of panel.querySelectorAll(
          'input,[role="combobox"],section[aria-label="Catchment and watershed tools"],section[aria-label="Catchment and watershed tools"] button',
        )) {
          const b = node.getBoundingClientRect()
          if (b.width && b.height && (b.left < bounds.left - 1 || b.right > bounds.right + 1))
            issues.push(`${node.tagName} extends outside drainage panel`)
        }
        return issues
      }),
    )
    .toEqual([])
}
for (const viewport of [
  { width: 390, height: 844 },
  { width: 320, height: 568 },
  { width: 844, height: 320 },
]) {
  test(`touch catchment picking, evidence export and fresh project reopening at ${viewport.width}×${viewport.height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport)
    const errors = await prepare(page)
    await showDrainage(page)
    const panel = page.getByTestId('road-drainage')
    const buffer = panel.getByLabel('Upslope buffer (m)', { exact: true })
    await buffer.fill('50')
    await buffer.press('Tab')
    await fits(page)
    await panel.getByRole('button', { name: 'Select pour point on plan', exact: true }).tap()
    await expect(page.getByTestId('road-connected-layout')).toHaveAttribute('data-focused-pane', 'plan')
    const state = await mapState(page)
    expect(state?.tap).toBeTruthy()
    await page.locator('[data-testid="road-plan-view"] canvas.maplibregl-canvas').tap({ position: state!.tap! })
    await expect(panel).toBeVisible()
    await expect(panel.getByLabel('Pour-point longitude', { exact: true })).toBeVisible()
    await panel.getByRole('checkbox', { name: 'Delineate watershed polygons', exact: true }).check()
    await panel.getByLabel('Minimum watershed (ha)', { exact: true }).fill('.1')
    await panel.getByLabel('Minimum watershed (ha)', { exact: true }).press('Tab')
    await panel.getByRole('button', { name: 'Run drainage check', exact: true }).tap()
    await expect(panel.getByRole('region', { name: 'Selected catchment', exact: true })).toBeVisible({
      timeout: 60_000,
    })
    await expect
      .poll(async () => {
        const state = await mapState(page)
        return state?.features.some(
          (f) => f.properties?.role === 'catchment' && ['Polygon', 'MultiPolygon'].includes(f.geometry.type),
        )
      })
      .toBe(true)
    expect((await mapState(page))?.polygonLayer).toBe(true)
    await page
      .getByRole('tablist', { name: 'Visible road pane', exact: true })
      .getByRole('tab', { name: 'Plan', exact: true })
      .tap()
    await expect.poll(async () => (await mapState(page))?.renderedCatchments ?? 0).toBeGreaterThan(0)
    await page.screenshot({ path: info.outputPath('catchment-map-mobile.png') })
    await page
      .getByRole('tablist', { name: 'Visible road pane', exact: true })
      .getByRole('tab', { name: 'Detail', exact: true })
      .tap()
    const exported = await download(page, 'Export drainage evidence')
    const evidence = JSON.parse(exported.bytes.toString()) as DrainageEvidence
    expect(evidence.settings.bufferM).toBe(50)
    expect(evidence.pourPoint?.coordinate).toHaveLength(2)
    expect(evidence.features.features.some((f) => f.properties?.role === 'catchment')).toBe(true)
    expect(JSON.stringify(evidence)).not.toMatch(/"accumulation"|"directions"|"values"/)
    await exported.file.saveAs(info.outputPath('drainage-evidence.json'))
    await fits(page)
    await page.screenshot({ path: info.outputPath('catchment-mobile.png') })

    await page.getByRole('button', { name: 'Save', exact: true }).tap()
    const saved = await download(page, 'Save project JSON')
    const project = JSON.parse(saved.bytes.toString()) as RoadProject
    expect(project.drainage?.records).toHaveLength(1)
    expect(project.drainage?.pourPoint).toEqual(evidence.pourPoint)
    await page
      .getByRole('dialog', { name: 'Save & export', exact: true })
      .getByRole('button', { name: 'Close', exact: true })
      .tap()
    // A fresh page load loses the in-memory flow grids. Import the actual downloaded project through the UI.
    await page.goto('/dev/forestry/road-design?example=training')
    await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
    await page.getByRole('button', { name: 'Save', exact: true }).tap()
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Open project', exact: true }).tap()
    await (
      await chooser
    ).setFiles({ name: 'mobile-drainage.road.json', mimeType: 'application/json', buffer: saved.bytes })
    await showDrainage(page)
    await expect(panel.getByRole('region', { name: 'Saved drainage evidence', exact: true })).toBeVisible()
    await expect(panel.getByLabel('Upslope buffer (m)', { exact: true })).toHaveValue('50')
    await expect(panel.getByRole('button', { name: 'Export drainage evidence', exact: true })).toBeEnabled()
    await expect
      .poll(async () => (await mapState(page))?.features.some((f) => f.properties?.role === 'catchment'))
      .toBe(true)
    const rainfall = panel.getByLabel('Rainfall (mm/h)', { exact: true })
    await rainfall.fill('70')
    await rainfall.press('Tab')
    await expect(panel.getByText('Saved drainage evidence is out of date.', { exact: false })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Export drainage evidence', exact: true })).toBeDisabled()
    await expect.poll(async () => (await mapState(page))?.features.length).toBe(0)
    await panel.getByRole('button', { name: 'Run drainage check', exact: true }).tap()
    await expect(panel.getByRole('region', { name: 'Selected catchment', exact: true })).toBeVisible({
      timeout: 60_000,
    })
    await expect(panel.getByRole('button', { name: 'Export drainage evidence', exact: true })).toBeEnabled()
    await fits(page)
    expect(errors).toEqual([])
  })
}
