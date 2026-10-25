import { readFile, writeFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { analyzeRoad, distance } from '../../src/pages/dev-forestry-roads/engine'
import { loadRaster, terrainFromMetadata } from '../../src/pages/dev-forestry-roads/terrain'
import type { Coordinate, RoadProject } from '../../src/pages/dev-forestry-roads/types'

// This journey deliberately uses only user-facing navigation and camera controls.
const root = process.env.PGMAPS_ROAD_NEW_AREA_DIR
test.skip(process.env.PGMAPS_ROAD_NEW_AREA !== '1' || !root, 'Supply the real DEM directory for this opt-in journey')
test.use({ viewport: { width: 1512, height: 982 }, serviceWorkers: 'block', actionTimeout: 15000 })
test.setTimeout(360000)

async function save(page: Page, path?: string): Promise<RoadProject> {
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save project JSON', exact: true }).click()
  const download = await pending
  if (path) await download.saveAs(path)
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  await page
    .getByRole('dialog', { name: 'Save & export', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .click()
  return JSON.parse(Buffer.concat(chunks).toString())
}

async function routes(page: Page) {
  await page.route('https://**', (route) => route.abort())
  // A valid basemap style isolates external basemap service availability only.
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
}

async function mapRead(page: Page, coordinates: Coordinate[] = []) {
  return page.evaluate((points) => {
    const container = document.querySelector('[data-testid="road-plan-view"] .maplibregl-map')!
    const key = Object.keys(container).find((k) => k.startsWith('__reactFiber$'))!
    type Map = import('maplibre-gl').Map
    type Hook = { memoizedState?: { current?: Map } | Map; next?: Hook }
    type Fiber = { memoizedState?: Hook; return?: Fiber }
    let fiber = (container as unknown as Record<string, Fiber>)[key]
    for (let depth = 0; fiber && depth < 200; depth++, fiber = fiber.return!) {
      for (let h = fiber.memoizedState, n = 0; h && n < 40; h = h.next, n++) {
        const value = h.memoizedState
        const map =
          value && typeof value === 'object' && 'current' in value ? value.current : (value as Map | undefined)
        if (typeof map?.getTerrain !== 'function') continue
        const box = map.getCanvas().getBoundingClientRect()
        return {
          centre: map.getCenter().toArray(),
          zoom: map.getZoom(),
          moving: map.isMoving(),
          bounds: map.getBounds().toArray(),
          clicks: points.map((p) => {
            const xy = map.project(p)
            return {
              x: box.x + xy.x,
              y: box.y + xy.y,
              inside: xy.x >= 0 && xy.y >= 0 && xy.x <= box.width && xy.y <= box.height,
            }
          }),
          canvas: { x: box.x, y: box.y, width: box.width, height: box.height },
        }
      }
    }
    throw Error('Ready map not found')
  }, coordinates)
}

async function drag(page: Page, index: number, dx: number, dy: number) {
  const marker = page.getByRole('button', { name: `Horizontal point ${index}`, exact: true })
  await expect(marker).toBeVisible()
  const box = (await marker.boundingBox())!
  expect(
    await marker.evaluate((el) => {
      const b = el.getBoundingClientRect()
      return el.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2))
    }),
  ).toBe(true)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 })
  await page.mouse.up()
}

test('desktop user loads Kamloops DEM, locates its coverage and designs an editable saved road', async ({
  page,
  context,
}, info) => {
  const errors: string[] = []
  const events: Array<Record<string, unknown>> = []
  page.on('pageerror', (error) => errors.push(error.message))
  const metadata = JSON.parse(
    await readFile(new URL('../fixtures/forestry-road-new-areas/kamloops.json', import.meta.url), 'utf8'),
  )
  const bytes = await readFile(root + '/kamloops.tif')
  const imported = await loadRaster(new File([bytes], 'kamloops.tif'), metadata.verticalReference)
  const guide = metadata.guide as Coordinate[]
  const active = (project: RoadProject) => project.alignments.find((a) => a.id === project.activeAlignmentId)!
  await routes(page)
  await page.goto('/dev/forestry/road-design')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
  await page
    .getByRole('tablist', { name: 'Road workflow', exact: true })
    .getByRole('tab', { name: 'Terrain', exact: true })
    .click()
  await page.getByLabel('Imported DEM vertical datum (metres)', { exact: true }).fill(metadata.verticalReference)
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Import GeoTIFF, LAS or LAZ', exact: true }).click()
  await (await chooser).setFiles(root + '/kamloops.tif')
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
  const importedProject = await save(page, info.outputPath('imported.road.json'))
  expect(importedProject.terrain.sha256).toBe(metadata.sha256)
  expect(importedProject.terrain.raster!.values).toEqual(imported.metadata.raster!.values)
  // This check reproduces the original new-area failure; no camera injection repairs it.
  await expect
    .poll(
      async () => {
        const map = await mapRead(page)
        return (
          map.centre[0] >= metadata.bounds[0] &&
          map.centre[0] <= metadata.bounds[2] &&
          map.centre[1] >= metadata.bounds[1] &&
          map.centre[1] <= metadata.bounds[3]
        )
      },
      { message: 'Importing an unrelated DEM should show its actual coverage' },
    )
    .toBe(true)
  await page.getByRole('button', { name: 'Fit terrain coverage', exact: true }).click()
  for (let i = 0; i < 6; i++) {
    const snapshot = await mapRead(page, guide)
    const span = Math.hypot(snapshot.clicks[2].x - snapshot.clicks[0].x, snapshot.clicks[2].y - snapshot.clicks[0].y)
    if (span >= 190) break
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
    await expect.poll(async () => (await mapRead(page)).zoom).toBeGreaterThan(snapshot.zoom + 0.8)
    await expect.poll(async () => (await mapRead(page)).moving).toBe(false)
  }
  await page
    .getByRole('tablist', { name: 'Road workflow', exact: true })
    .getByRole('tab', { name: 'Design', exact: true })
    .click()
  await page.getByRole('button', { name: 'Peg road', exact: true }).click()
  for (const coordinate of guide) {
    // Drawing feedback changes the chart slot; locate each click in the current rendered map.
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    )
    const click = (await mapRead(page, [coordinate])).clicks[0]
    expect(click.inside).toBe(true)
    await page.mouse.click(click.x, click.y)
  }
  await page.getByRole('button', { name: 'Finish road', exact: true }).click()
  await page.getByLabel('Road name', { exact: true }).fill('Kamloops desktop field trial')
  const sketched = await save(page, info.outputPath('sketched.road.json'))
  expect(active(sketched).points).toHaveLength(3)
  active(sketched).points.forEach((point, i) => expect(distance(point.coordinate, guide[i])).toBeLessThan(3))
  expect(sketched.settings.maxGradePercent).toBe(12)
  expect(sketched.settings.minRadius).toBe(25)
  await page.screenshot({ path: info.outputPath('desktop-sketched.png') })

  await page.getByRole('button', { name: 'Select start', exact: true }).click()
  await drag(page, 1, 5, 0)
  await page.getByRole('button', { name: 'Select end', exact: true }).click()
  await drag(page, 3, -5, 0)
  await page.getByRole('button', { name: 'Add control between points 1 and 2', exact: true }).click()
  await drag(page, 2, 0, -6)
  const edited = await save(page, info.outputPath('edited.road.json'))
  expect(active(edited).points).toHaveLength(4)
  expect(active(edited).points[0].coordinate).not.toEqual(active(sketched).points[0].coordinate)
  expect(active(edited).points[3].coordinate).not.toEqual(active(sketched).points[2].coordinate)
  const original = active(edited)
  await page
    .getByRole('group', { name: 'Road map tool', exact: true })
    .getByRole('button', { name: 'Inspect', exact: true })
    .click()
  await page.setViewportSize({ width: 1280, height: 720 })
  expect(
    await page.evaluate(() => {
      const m = document.getElementById('main-content')!
      return m.scrollHeight <= m.clientHeight + 1 && m.scrollWidth <= m.clientWidth + 1
    }),
  ).toBe(true)
  await page.screenshot({ path: info.outputPath('short-desktop-edited.png') })
  await page.setViewportSize({ width: 1512, height: 982 })

  const review = page.getByTestId('road-optimization-review')
  for (const [objective, halfWidth] of [
    ['balanced', 100],
    ['balanced', 60],
    ['shortest', 100],
  ] as const) {
    await page.getByLabel('Corridor optimization objective', { exact: true }).selectOption(objective)
    await page.getByLabel('Corridor half-width metres', { exact: true }).fill(String(halfWidth))
    await page.getByRole('button', { name: 'Optimize sketched corridor', exact: true }).click()
    const failure = page.getByRole('alert').filter({ hasText: /budget|No verified candidate|Candidate failed/i })
    await expect
      .poll(async () => (await review.isVisible()) || (await failure.count()) > 0, { timeout: 100000 })
      .toBe(true)
    if (await review.isVisible()) {
      events.push({ objective, halfWidthM: halfWidth, outcome: 'candidate established' })
      break
    }
    events.push({ objective, halfWidthM: halfWidth, outcome: await failure.allTextContents() })
    expect(await save(page)).toEqual(edited)
  }
  await writeFile(info.outputPath('horizontal-attempts.json'), JSON.stringify(events, null, 2))
  await expect(review).toBeVisible()
  await page.screenshot({ path: info.outputPath('desktop-corridor-review.png') })
  await review.getByRole('button', { name: 'Use candidate as new road', exact: true }).click()
  const horizontal = await save(page, info.outputPath('horizontal.road.json'))
  expect(horizontal.alignments.find((a) => a.id === original.id)).toEqual(original)
  await page.getByRole('button', { name: 'Optimize profile (K 4)', exact: true }).click()
  await expect(page.getByLabel('Road name', { exact: true })).toHaveValue(/optimized profile$/, { timeout: 60000 })
  const optimized = await save(page, info.outputPath('optimized.road.json'))
  const analysis = analyzeRoad(active(optimized), terrainFromMetadata(optimized.terrain)!, optimized.settings)
  expect(analysis.coveragePercent).toBeCloseTo(100, 5)
  expect(analysis.maxGradePercent).toBeLessThanOrEqual(12.000001)
  expect(
    analysis.stations.every((station) => station.groundElevation !== null && station.designElevation !== null),
  ).toBe(true)
  const station = page.getByLabel('Selected station metres', { exact: true })
  await station.fill('50')
  await station.press('Tab')
  await expect(page.getByTestId('road-profile-chart')).toHaveAttribute('data-station', '50')
  await expect(page.getByTestId('road-section-chart')).toHaveAttribute('data-station', '50')
  await page.getByRole('combobox', { name: 'Road detail view', exact: true }).click()
  await page.getByRole('option', { name: '3D', exact: true }).click()
  await expect(page.getByTestId('road-ground-canvas')).toHaveAttribute('data-face-count', /^[1-9][0-9]*$/)
  await page.screenshot({ path: info.outputPath('desktop-optimized-3d.png') })

  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const geoDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export GeoJSON', exact: true }).click()
  const geoFile = await geoDownload
  await geoFile.saveAs(info.outputPath('roads.geojson'))
  const exported = JSON.parse(await readFile(info.outputPath('roads.geojson'), 'utf8')) as GeoJSON.FeatureCollection
  const exportedRoad = exported.features.find(
    (feature) => feature.properties?.alignment_id === optimized.activeAlignmentId,
  )!
  expect(exportedRoad.properties?.terrain_sha256).toBe(metadata.sha256)
  expect(exportedRoad.properties?.length_m).toBeCloseTo(analysis.length, 6)
  expect(exportedRoad.properties?.coverage_percent).toBeCloseTo(100, 5)
  const csvDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Station CSV', exact: true }).click()
  await (await csvDownload).saveAs(info.outputPath('stations.csv'))
  const csv = await readFile(info.outputPath('stations.csv'), 'utf8')
  expect(csv).toContain('station_m,longitude,latitude,ground_elevation_m,design_elevation_m')
  expect(csv.trim().split('\n').length).toBe(analysis.stations.length + 1)
  await page
    .getByRole('dialog', { name: 'Save & export', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .click()

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<string | undefined>((resolve, reject) => {
            const request = indexedDB.open('pgmaps-forestry-roads-v1', 1)
            request.onerror = () => reject(request.error)
            request.onsuccess = () => {
              const db = request.result
              const tx = db.transaction('projects', 'readonly')
              const read = tx.objectStore('projects').get('current')
              read.onsuccess = () => resolve(read.result?.activeAlignmentId)
              tx.oncomplete = () => db.close()
            }
          }),
      ),
    )
    .toBe(optimized.activeAlignmentId)
  await page.reload()
  await expect(page.getByLabel('Active road', { exact: true })).toHaveValue(optimized.activeAlignmentId)
  expect(await save(page)).toEqual(optimized)

  const fresh = await context.browser()!.newContext({ viewport: { width: 1512, height: 982 }, serviceWorkers: 'block' })
  try {
    const reopened = await fresh.newPage()
    reopened.on('pageerror', (error) => errors.push(error.message))
    await routes(reopened)
    await reopened.goto(new URL('/dev/forestry/road-design', page.url()).href)
    await expect(reopened.getByRole('button', { name: 'Open', exact: true })).toBeEnabled()
    const choose = reopened.waitForEvent('filechooser')
    await reopened.getByRole('button', { name: 'Open', exact: true }).click()
    await (await choose).setFiles(info.outputPath('optimized.road.json'))
    await expect(reopened.getByLabel('Active road', { exact: true })).toHaveValue(optimized.activeAlignmentId)
    expect(await save(reopened)).toEqual(optimized)
    await expect(reopened.getByTestId('road-profile-chart')).toBeVisible()
    await expect(reopened.getByTestId('road-section-chart')).toBeVisible()
    await reopened.screenshot({ path: info.outputPath('desktop-fresh-reopened.png') })
  } finally {
    await fresh.close()
  }
  await writeFile(
    info.outputPath('result.json'),
    JSON.stringify(
      {
        area: 'Kamloops BC',
        source: { ...metadata, raster: undefined },
        attempts: events,
        lengthM: analysis.length,
        coveragePercent: analysis.coveragePercent,
        maxDesignGradePercent: analysis.maxGradePercent,
        cutM3: analysis.cutVolumeM3,
        fillM3: analysis.fillVolumeM3,
        activeControls: active(optimized).points.length,
        verticalControls: active(optimized).vertical.length,
        browserErrors: errors,
        exports: [
          'project JSON',
          'GeoJSON with matched active geometry/source',
          'station CSV with every analyzed station',
        ],
        cameraNavigation:
          'Only rendered Fit terrain and Zoom controls; no programmatic camera changes or seeded project inputs.',
      },
      null,
      2,
    ),
  )
  expect(errors).toEqual([])
})
