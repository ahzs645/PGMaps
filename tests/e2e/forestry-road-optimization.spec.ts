import { expect, test, type Page, type Download } from '@playwright/test'
import type { RoadProject } from '../../src/pages/dev-forestry-roads/types'
import { corridorFrame } from '../../src/pages/dev-forestry-roads/corridorOptimizer'
import { distance, positionAt } from '../../src/pages/dev-forestry-roads/engine'

test.use({ serviceWorkers: 'block', actionTimeout: 15000, viewport: { width: 1512, height: 982 } })
test.setTimeout(150000)
async function jsonDownload(download: Download) {
  const stream = await download.createReadStream()
  expect(stream).not.toBeNull()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
async function saved(page: Page): Promise<RoadProject> {
  const next = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('button', { name: 'Save project JSON', exact: true }).click()
  const project = await jsonDownload(await next)
  await page.getByRole('dialog', { name: 'Save & export', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()
  return project
}
async function openProject(page: Page, project: RoadProject) {
  const pending = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await (await pending).setFiles({ name: 'optimizer-test.road.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
  await expect(page.getByLabel('Active road', { exact: true })).toHaveValue(project.activeAlignmentId)
}
async function prepare(page: Page) {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route('https://basemaps.cartocdn.com/**', r => r.fulfill({ json: { version: 8, sources: {}, layers: [] } }))
  await page.goto('/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  const project = await saved(page), f = corridorFrame([-122.72, 53.89])
  const a = project.alignments[0]
  a.name = 'Optimizer browser guide'
  a.points = [[0, 0], [110, 60], [230, 20]].map((p, i) => ({ id: 'test-peg-' + i, coordinate: f.fromXY([p[0], p[1]]), radiusM: 0 }))
  a.vertical = []; a.overrides = []; delete a.engineering
  project.alignments = [a]; project.activeAlignmentId = a.id
  project.context = []; project.cables = []; project.profiles = []
  project.settings.minRadius = 20; project.settings.maxGradePercent = 12
  await openProject(page, project)
  await page.getByLabel('Corridor half-width metres', { exact: true }).fill('100')
  return { errors, project: await saved(page) }
}
async function optimize(page: Page) {
  await page.getByRole('button', { name: 'Optimize sketched corridor', exact: true }).click()
  const review = page.getByTestId('road-optimization-review')
  await expect(review).toBeVisible({ timeout: 100000 })
  return review
}
async function actualMap(page: Page) {
  return page.evaluate(() => {
    const container = document.querySelector('[data-testid="road-plan-view"] .maplibregl-map')
    if (!container) return null
    const key = Object.keys(container).find(k => k.startsWith('__reactFiber$'))
    if (!key) return null
    type Map = import('maplibre-gl').Map
    type Hook = { memoizedState?: { current?: Map } | Map; next?: Hook }
    type Fiber = { memoizedState?: Hook; return?: Fiber }
    let fiber = (container as unknown as Record<string, Fiber>)[key]
    for (let depth = 0; fiber && depth < 200; depth++, fiber = fiber.return!) {
      for (let h = fiber.memoizedState, n = 0; h && n < 40; h = h.next, n++) {
        const value = h.memoizedState
        const map = value && typeof value === 'object' && 'current' in value ? value.current : value as Map | undefined
        if (typeof map?.getTerrain !== 'function') continue
        const source = map.getSource('road-section')
        const roads = map.getSource('road-roads')
        const selected = roads?.type === 'geojson'
          ? (roads.serialize().data as GeoJSON.FeatureCollection<GeoJSON.LineString>).features.filter(f => f.properties?.selected)
          : []
        return {
          selected: selected.map(f => ({ id: String(f.properties?.id), chainage: Number(f.properties?.chainage), coordinates: f.geometry.coordinates })),
          roads: map.getLayer('road-alignments') ? map.queryRenderedFeatures({ layers: ['road-alignments'] }).length : 0,
          section: source?.type === 'geojson' ? (source.serialize().data as GeoJSON.FeatureCollection).features[0]?.geometry : null,
        }
      }
    }
    return null
  })
}

test('corridor review, adoption, linked station, report, undo and reopen retain real geometry', async ({ page }, info) => {
  const { errors, project } = await prepare(page)
  const review = await optimize(page)
  const reportDownload = page.waitForEvent('download')
  await review.getByRole('button', { name: 'Download optimization report' }).click()
  const report = await jsonDownload(await reportDownload)
  expect(report.schema).toBe('pgmaps-road-corridor-review-v1')
  expect(report.result.complete).toBe(true)
  expect(report.guide).toEqual(project.alignments[0])
  expect(report.result.maxSampledGroundPitchPercent).toBeLessThanOrEqual(12.00001)
  await page.screenshot({ path: info.outputPath('corridor-review.png'), fullPage: true })
  await review.getByRole('button', { name: 'Use candidate as new road' }).click()
  await expect(review).not.toBeVisible()
  const adopted = await saved(page)
  expect(adopted.alignments).toHaveLength(2)
  expect(adopted.alignments[0]).toEqual(project.alignments[0])
  expect(adopted.alignments[1].points).toEqual(report.candidate.points)
  expect(adopted.activeAlignmentId).toBe(report.candidate.id)
  const station = page.getByRole('spinbutton', { name: 'Selected station metres', exact: true })
  await station.fill('60'); await station.press('Tab')
  await expect(page.getByTestId('road-profile-chart')).toHaveAttribute('data-station', '60')
  await expect(page.getByTestId('road-active-map-station')).toHaveAttribute('data-chainage', '60')
  await expect(page.getByTestId('road-section-chart')).toHaveAttribute('data-station', '60')
  await expect.poll(async () => (await actualMap(page))?.roads ?? 0).toBeGreaterThan(0)
  expect((await actualMap(page))?.section).toBeTruthy()
  // The NEW candidate, not merely some road, must be the selected rendered source.
  await expect.poll(async () => [...new Set((await actualMap(page))?.selected.map(f => f.id) ?? [])]).toEqual([adopted.activeAlignmentId])
  const rendered = (await actualMap(page))!.selected.find(f => Math.abs(f.chainage - 60) < 0.001)
  expect(rendered).toBeTruthy()
  const last = rendered!.coordinates[rendered!.coordinates.length - 1]
  const expected = positionAt(adopted.alignments[1], 60).coordinate
  expect(distance([last[0], last[1]], expected)).toBeLessThan(0.002)
  await page.screenshot({ path: info.outputPath('corridor-linked-adopted.png'), fullPage: true })
  await page.getByRole('button', { name: 'Undo road edit' }).click()
  expect((await saved(page)).alignments).toHaveLength(1)
  await page.getByRole('button', { name: 'Redo road edit' }).click()
  expect((await saved(page)).alignments[1].points).toEqual(report.candidate.points)
  await openProject(page, project)
  await openProject(page, adopted)
  expect(await saved(page)).toEqual(adopted)
  expect(errors).toEqual([])
})

test('discard and cancellation never change the saved road', async ({ page }) => {
  const { errors, project } = await prepare(page)
  const review = await optimize(page)
  await review.getByRole('button', { name: 'Discard candidate' }).click()
  expect(await saved(page)).toEqual(project)
  // A tiny feasible route can finish before a person (or Playwright) reaches
  // Cancel. Use a larger, genuinely expensive blocked search, not a fake delay.
  const cancellationProject = structuredClone(project)
  const frame = corridorFrame([-122.72, 53.89])
  cancellationProject.alignments[0].points = [[0, 0], [1000, 500]].map((p, i) => ({ id: 'cancel-peg-' + i, coordinate: frame.fromXY([p[0], p[1]]), radiusM: 0 }))
  cancellationProject.context = [{ id: 'cancel-barrier', name: 'Cancellation test exclusion', kind: 'avoid', geometry: { type: 'Polygon', coordinates: [[frame.fromXY([450, -500]), frame.fromXY([550, -500]), frame.fromXY([550, 1000]), frame.fromXY([450, 1000]), frame.fromXY([450, -500])]] } }]
  await openProject(page, cancellationProject)
  const beforeCancellation = await saved(page)
  await page.getByLabel('Corridor optimization objective', { exact: true }).selectOption('contour')
  await page.getByLabel('Corridor half-width metres', { exact: true }).fill('300')
  await page.getByRole('button', { name: 'Optimize sketched corridor', exact: true }).click()
  const cancel = page.getByRole('button', { name: 'Cancel road optimization', exact: true })
  await expect(cancel).toBeVisible()
  await cancel.click()
  await expect(cancel).not.toBeVisible()
  await expect(page.getByTestId('road-optimization-review')).not.toBeVisible()
  await expect(page.getByText('Optimization cancelled. No road was changed.', { exact: true })).toBeVisible()
  expect(await saved(page)).toEqual(beforeCancellation)
  expect(errors).toEqual([])
})

test('optimization review stays usable on a phone viewport', async ({ page }, info) => {
  const { errors, project } = await prepare(page)
  await page.setViewportSize({ width: 390, height: 844 })
  const review = await optimize(page)
  const box = await review.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(-1)
  expect(box!.x + box!.width).toBeLessThanOrEqual(391)
  await review.getByRole('button', { name: 'Discard candidate' }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('corridor-review-mobile.png'), fullPage: true })
  await review.getByRole('button', { name: 'Discard candidate' }).click()
  expect(await saved(page)).toEqual(project)
  expect(errors).toEqual([])
})
