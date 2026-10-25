import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { analyzeRoad, distance } from '../../src/pages/dev-forestry-roads/engine'
import { corridorFrame } from '../../src/pages/dev-forestry-roads/corridorOptimizer'
import { loadRaster, terrainBounds, terrainFromMetadata } from '../../src/pages/dev-forestry-roads/terrain'
import type { Coordinate, RoadProject } from '../../src/pages/dev-forestry-roads/types'

// Opt-in real-data workflow. See docs/forestry-road-workflow-check.md for the download command.
const demPath = process.env.PGMAPS_ROAD_DEM_PATH
test.skip(!demPath, 'Set PGMAPS_ROAD_DEM_PATH to the documented real elevation tile.')
test.use({ serviceWorkers: 'block', viewport: { width: 1512, height: 982 }, actionTimeout: 15000 })
test.setTimeout(240000)

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

/** Set only the test camera; all road creation/editing uses visible controls and pointer events. */
async function guideClicks(page: Page, guide: Coordinate[]) {
  return page.evaluate((coordinates) => {
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
        map.fitBounds(
          [
            [Math.min(...coordinates.map((p) => p[0])), Math.min(...coordinates.map((p) => p[1]))],
            [Math.max(...coordinates.map((p) => p[0])), Math.max(...coordinates.map((p) => p[1]))],
          ],
          { padding: 70, maxZoom: 17, duration: 0 },
        )
        const rect = map.getCanvas().getBoundingClientRect()
        return coordinates.map((p) => {
          const xy = map.project(p)
          return { x: xy.x + rect.x, y: xy.y + rect.y }
        })
      }
    }
    throw Error('Could not find the ready road map')
  }, guide)
}

for (const [site, u, v] of [
  [1, 0.25, 0.3],
  [2, 0.5, 0.55],
  [3, 0.7, 0.75],
]) {
  test(`real DEM site ${site}: peg, save, optimize plan/profile, reload and reopen offline`, async ({
    page,
    context,
  }, info) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    // Basemap only is isolated; the uploaded DEM and every calculation are real.
    await page.route('https://basemaps.cartocdn.com/**', (route) =>
      route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
    )
    // Exercise recovery by importing our DEM when the optional default sample is unavailable.
    await page.route('https://pgmaps.ahmadjalil.com/data/lidar-analysis/**', (route) => route.abort())
    const bytes = await readFile(demPath!)
    const imported = await loadRaster(
      new File([bytes], 'pg-regional-dem.tif'),
      'AWS Terrain Tiles; EGM96 orthometric metres; regional screening',
    )
    const bounds = terrainBounds(imported.metadata)!
    const centre: Coordinate = [bounds[0] + u * (bounds[2] - bounds[0]), bounds[1] + v * (bounds[3] - bounds[1])]
    const frame = corridorFrame(centre)
    const guide = [
      [-100, 0],
      [0, 35],
      [100, 0],
    ].map((p) => frame.fromXY([p[0], p[1]]))

    await page.goto('/dev/forestry/road-design')
    await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
    await page.getByRole('tab', { name: 'Terrain', exact: true }).click()
    await page
      .getByLabel('Imported DEM vertical datum (metres)', { exact: true })
      .fill(imported.metadata.verticalReference)
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Import GeoTIFF, LAS or LAZ', exact: true }).click()
    await (await chooser).setFiles({ name: 'pg-regional-dem.tif', mimeType: 'image/tiff', buffer: bytes })
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
    await expect(page.getByRole('complementary', { name: 'Road design controls' })).toContainText('pg-regional-dem.tif')
    await page.getByRole('tab', { name: 'Design', exact: true }).click()
    await page.getByRole('button', { name: 'Peg road', exact: true }).click()
    for (const click of await guideClicks(page, guide)) await page.mouse.click(click.x, click.y)
    await page.getByRole('button', { name: 'Finish road', exact: true }).click()
    await page.getByLabel('Road name', { exact: true }).fill(`Real DEM workflow site ${site}`)
    const before = await save(page, info.outputPath('before.road.json'))
    expect(before.terrain.sha256).toBe(imported.metadata.sha256)
    expect(before.terrain.raster?.values).toEqual(imported.metadata.raster!.values)
    const original = before.alignments.find((a) => a.id === before.activeAlignmentId)!
    expect(original.points).toHaveLength(3)
    // Pointer events round to screen pixels; this camera has sub-metre pixel spacing.
    original.points.forEach((p, i) => expect(distance(p.coordinate, guide[i])).toBeLessThan(1))

    const review = page.getByTestId('road-optimization-review')
    const attempts: Array<Record<string, unknown>> = []
    for (const [objective, halfWidth] of [
      ['balanced', 100],
      ['shortest', 25],
    ] as const) {
      await page.getByLabel('Corridor optimization objective', { exact: true }).selectOption(objective)
      await page.getByLabel('Corridor half-width metres', { exact: true }).fill(String(halfWidth))
      await page.getByRole('button', { name: 'Optimize sketched corridor', exact: true }).click()
      const failure = page.getByRole('alert').filter({ hasText: /budget|No verified candidate|Candidate failed/i })
      await expect
        .poll(async () => (await review.isVisible()) || (await failure.count()) > 0, { timeout: 100000 })
        .toBe(true)
      if (await review.isVisible()) {
        attempts.push({ objective, halfWidthM: halfWidth, outcome: 'verified candidate' })
        break
      }
      attempts.push({ objective, halfWidthM: halfWidth, outcome: await failure.allTextContents() })
      // A failed bounded search must preserve the downloaded road and its terrain exactly.
      expect(await save(page)).toEqual(before)
    }
    await info.attach('horizontal-attempts', {
      body: JSON.stringify(attempts, null, 2),
      contentType: 'application/json',
    })
    await expect(review).toBeVisible()
    await review.getByRole('button', { name: 'Use candidate as new road', exact: true }).click()
    const horizontal = await save(page, info.outputPath('horizontal.road.json'))
    expect(horizontal.alignments.find((a) => a.id === original.id)).toEqual(original)
    expect(horizontal.alignments).toHaveLength(before.alignments.length + 1)

    await page.getByRole('button', { name: 'Optimize profile (K 4)', exact: true }).click()
    await expect(page.getByLabel('Road name', { exact: true })).toHaveValue(/optimized profile$/, { timeout: 60000 })
    const optimized = await save(page, info.outputPath('optimized.road.json'))
    expect(optimized.alignments).toHaveLength(before.alignments.length + 2)
    const active = optimized.alignments.find((a) => a.id === optimized.activeAlignmentId)!
    expect(active.vertical.length).toBeGreaterThanOrEqual(2)
    const source = terrainFromMetadata(optimized.terrain)!
    const analysis = analyzeRoad(active, source, optimized.settings)
    expect(analysis.coveragePercent).toBeCloseTo(100, 5)
    expect(analysis.stations.every((s) => s.groundElevation !== null && s.designElevation !== null)).toBe(true)
    expect(
      analysis.stations.every(
        (s) => s.gradePercent === null || Math.abs(s.gradePercent) <= optimized.settings.maxGradePercent + 1e-6,
      ),
    ).toBe(true)
    await page.screenshot({ path: info.outputPath('optimized-workspace.png'), fullPage: true })

    // Normal route must restore the imported terrain and all alternatives from device storage.
    await expect
      .poll(() =>
        page.evaluate(async () => {
          return new Promise<string | undefined>((resolve, reject) => {
            const request = indexedDB.open('pgmaps-forestry-roads-v1', 1)
            request.onerror = () => reject(request.error)
            request.onsuccess = () => {
              const db = request.result
              const transaction = db.transaction('projects', 'readonly')
              const read = transaction.objectStore('projects').get('current')
              read.onsuccess = () => resolve(read.result?.activeAlignmentId)
              transaction.oncomplete = () => db.close()
            }
          })
        }),
      )
      .toBe(active.id)
    await page.goto('/dev/forestry/road-design')
    await expect(page.getByLabel('Active road', { exact: true })).toHaveValue(active.id)
    expect(await save(page)).toEqual(optimized)
    // A fresh browser context has no autosave and no network access. Reopen the actual downloaded project.
    const fresh = await context
      .browser()!
      .newContext({ viewport: { width: 1512, height: 982 }, serviceWorkers: 'block' })
    try {
      const reopened = await fresh.newPage()
      reopened.on('pageerror', (error) => errors.push(error.message))
      const appOrigin = new URL(page.url()).origin
      await reopened.route('https://**', (route) =>
        new URL(route.request().url()).origin === appOrigin ? route.continue() : route.abort(),
      )
      await reopened.goto(new URL('/dev/forestry/road-design?example=training', page.url()).href)
      await expect(reopened.getByRole('button', { name: 'Open', exact: true })).toBeEnabled()
      const open = reopened.waitForEvent('filechooser')
      await reopened.getByRole('button', { name: 'Open', exact: true }).click()
      await (await open).setFiles(info.outputPath('optimized.road.json'))
      await expect(reopened.getByLabel('Active road', { exact: true })).toHaveValue(active.id)
      expect(await save(reopened)).toEqual(optimized)
      await expect(reopened.getByTestId('road-profile-chart')).toBeVisible()
      await expect(reopened.getByTestId('road-section-chart')).toBeVisible()
    } finally {
      await fresh.close()
    }
    await info.attach('metrics', {
      body: JSON.stringify(
        {
          site,
          centre,
          terrain: { ...optimized.terrain, raster: undefined },
          lengthM: analysis.length,
          coveragePercent: analysis.coveragePercent,
          cutM3: analysis.cutVolumeM3,
          fillM3: analysis.fillVolumeM3,
          alternatives: optimized.alignments.length,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    })
    expect(errors).toEqual([])
  })
}
