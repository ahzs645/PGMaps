import { readFile, writeFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { loadRaster, terrainBounds, terrainFromMetadata } from '../../src/pages/dev-forestry-roads/terrain'
import { analyzeRoad, distance } from '../../src/pages/dev-forestry-roads/engine'
import type { Coordinate, RoadProject } from '../../src/pages/dev-forestry-roads/types'
import { expandRoadSection } from './road-sidebar'

const demPath = process.env.PGMAPS_ROAD_NEW_AREA_DEM
test.skip(!demPath, 'Supply a real GeoTIFF for the opt-in new-area mobile journey.')
test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  serviceWorkers: 'block',
  actionTimeout: 15000,
})
test.setTimeout(300000)

/** Read the actual camera and project coordinates, but never move it outside rendered UI. */
async function inspectMap(page: Page, coordinates: Coordinate[] = []) {
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
        const rect = map.getCanvas().getBoundingClientRect()
        return {
          centre: map.getCenter().toArray(),
          bounds: map.getBounds().toArray(),
          zoom: map.getZoom(),
          moving: map.isMoving(),
          rect: rect.toJSON(),
          clicks: points.map((p) => {
            const xy = map.project(p)
            return { x: rect.x + xy.x, y: rect.y + xy.y }
          }),
        }
      }
    }
    throw Error('Ready map instance unavailable')
  }, coordinates)
}

async function controls(page: Page, tab: string) {
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
  await expect(page.getByTestId('road-workspace')).toHaveAttribute('data-focus-mode', 'true')
  const show = page.getByRole('button', { name: 'Show road controls', exact: true })
  if (await show.isVisible()) await show.tap()
  await page
    .getByRole('tablist', { name: 'Road workflow', exact: true })
    .getByRole('tab', { name: tab, exact: true })
    .tap()
}

async function save(page: Page, path?: string, name?: string): Promise<RoadProject> {
  await page.getByRole('button', { name: 'Save', exact: true }).tap()
  if (name) await page.getByLabel('Project name', { exact: true }).fill(name)
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save project JSON', exact: true }).tap()
  const download = await pending
  if (path) await download.saveAs(path)
  const stream = await download.createReadStream(),
    chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  await page
    .getByRole('dialog', { name: 'Save & export', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .tap()
  return JSON.parse(Buffer.concat(chunks).toString())
}

async function fits(page: Page) {
  expect(
    await page.evaluate(() => {
      const el = document.getElementById('main-content')!
      return { vertical: el.scrollHeight <= el.clientHeight + 1, horizontal: el.scrollWidth <= el.clientWidth + 1 }
    }),
  ).toEqual({ vertical: true, horizontal: true })
}

async function touchDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const session = await page.context().newCDPSession(page)
  try {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ ...from, radiusX: 3, radiusY: 3, force: 1, id: 0 }],
    })
    for (let i = 1; i <= 12; i++) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          {
            x: from.x + ((to.x - from.x) * i) / 12,
            y: from.y + ((to.y - from.y) * i) / 12,
            radiusX: 3,
            radiusY: 3,
            force: 1,
            id: 0,
          },
        ],
      })
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
    }
    // A finger pauses before release, so panning stops rather than becoming a fling.
    await page.waitForTimeout(180)
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } finally {
    await session.detach()
  }
}

async function dragControl(page: Page, index: number, dx: number, dy: number) {
  const marker = page.getByRole('button', { name: `Horizontal point ${index}`, exact: true })
  await expect(marker).toBeVisible()
  expect(
    await marker.evaluate((el) => {
      const r = el.getBoundingClientRect()
      return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
    }),
  ).toBe(true)
  const r = (await marker.boundingBox())!
  const from = { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  await touchDrag(page, from, { x: from.x + dx, y: from.y + dy })
}

async function centreByTouch(page: Page, coordinate: Coordinate) {
  for (let i = 0; i < 6; i++) {
    await expect.poll(async () => (await inspectMap(page)).moving).toBe(false)
    const view = await inspectMap(page, [coordinate])
    const centre = { x: view.rect.x + view.rect.width / 2, y: view.rect.y + view.rect.height / 2 }
    const dx = centre.x - view.clicks[0].x,
      dy = centre.y - view.clicks[0].y
    if (Math.hypot(dx, dy) < 4) return
    const limit = (n: number, max: number) => Math.max(-max, Math.min(max, n))
    await touchDrag(page, centre, {
      x: centre.x + limit(dx, view.rect.width * 0.3),
      y: centre.y + limit(dy, view.rect.height * 0.3),
    })
  }
  const view = await inspectMap(page, [coordinate])
  expect(Math.abs(view.clicks[0].x - view.rect.x - view.rect.width / 2)).toBeLessThan(15)
  expect(Math.abs(view.clicks[0].y - view.rect.y - view.rect.height / 2)).toBeLessThan(15)
}

test('new-area real DEM mobile journey uses visible terrain, road editing, optimization and portable saving', async ({
  page,
  browser,
}, info) => {
  const errors: string[] = [],
    outcomes: Array<Record<string, unknown>> = []
  let completed = false
  try {
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('https://basemaps.cartocdn.com/**', (r) =>
      r.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
    )
    await page.route('https://pgmaps.ahmadjalil.com/data/lidar-analysis/**', (r) => r.abort())
    const bytes = await readFile(demPath!)
    const filename = demPath!.split('/').pop()!
    const fixture = JSON.parse(
      await readFile(
        process.env.PGMAPS_ROAD_NEW_AREA_GUIDE ??
          new URL('../fixtures/forestry-road-new-areas/vernon.json', import.meta.url),
        'utf8',
      ),
    ) as {
      centre?: Coordinate
      fraction?: [number, number]
      guide: Coordinate[]
      sha256?: string
      verticalReference?: string
    }
    const imported = await loadRaster(
      new File([bytes], filename),
      fixture.verticalReference ??
        'AWS Terrain Tiles; EGM96 orthometric metres (product assumption); regional screening',
    )
    if (fixture.sha256) expect(imported.metadata.sha256).toBe(fixture.sha256)
    const bounds = terrainBounds(imported.metadata)!
    await page.goto('/dev/forestry/road-design')
    await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
    const startupError = page.getByTestId('workspace-toast-error')
    if (await startupError.isVisible()) {
      outcomes.push({
        step: 'default terrain unavailable',
        recovery: 'Dismiss the visible notification before opening mobile controls',
        message: await startupError.innerText(),
      })
      await page.screenshot({ path: info.outputPath('00-default-terrain-unavailable.png') })
      await startupError.getByRole('button', { name: 'Dismiss error notification', exact: true }).tap()
    }
    await controls(page, 'Terrain')
    await page
      .getByLabel('Imported DEM vertical datum (metres)', { exact: true })
      .fill(imported.metadata.verticalReference)
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Import GeoTIFF, LAS or LAZ', exact: true }).tap()
    await (await chooser).setFiles(demPath!)
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
    await expect(page.getByRole('complementary', { name: 'Road design controls', exact: true })).toContainText(filename)
    await page.getByRole('button', { name: 'Hide road controls', exact: true }).tap()
    await expect
      .poll(
        async () => {
          const current = await inspectMap(page)
          return (
            current.bounds[1][0] > bounds[0] &&
            current.bounds[0][0] < bounds[2] &&
            current.bounds[1][1] > bounds[1] &&
            current.bounds[0][1] < bounds[3]
          )
        },
        { message: 'New DEM coverage must become discoverable without hidden camera shortcuts' },
      )
      .toBe(true)
    const camera = await inspectMap(page)
    outcomes.push({
      step: 'imported new DEM',
      source: { ...imported.metadata, raster: undefined },
      sourceBounds: bounds,
      camera,
    })
    await writeFile(info.outputPath('mobile-journey.json'), JSON.stringify({ outcomes, errors }, null, 2))
    await page.screenshot({ path: info.outputPath('01-imported-new-area.png') })
    // A new-area import must make its coverage discoverable. No hidden camera shortcut.
    expect(
      camera.bounds[1][0] > bounds[0] &&
        camera.bounds[0][0] < bounds[2] &&
        camera.bounds[1][1] > bounds[1] &&
        camera.bounds[0][1] < bounds[3],
      'Imported DEM must be reachable in the rendered map viewport',
    ).toBe(true)
    await fits(page)
    const importedProject = await save(page, info.outputPath('imported.road.json'), 'Vernon road design')
    expect(importedProject.terrain.sha256).toBe(imported.metadata.sha256)
    expect(importedProject.terrain.raster?.values).toEqual(imported.metadata.raster?.values)
    const guideInfo = {
      ...fixture,
      centre:
        fixture.centre ??
        ([
          bounds[0] + (fixture.fraction?.[0] ?? 0.5) * (bounds[2] - bounds[0]),
          bounds[1] + (fixture.fraction?.[1] ?? 0.5) * (bounds[3] - bounds[1]),
        ] as Coordinate),
    }
    await page.getByRole('button', { name: 'Fit terrain coverage', exact: true }).tap()
    await centreByTouch(page, guideInfo.centre)
    for (let i = 0; i < 3; i++) {
      const beforeZoom = (await inspectMap(page)).zoom
      await page.getByRole('button', { name: 'Zoom in', exact: true }).tap()
      await expect.poll(async () => (await inspectMap(page)).zoom).toBeGreaterThan(beforeZoom + 0.9)
      await expect.poll(async () => (await inspectMap(page)).moving).toBe(false)
    }
    await centreByTouch(page, guideInfo.centre)
    outcomes.push({
      step: 'located guide through touch pan and zoom buttons',
      guideSelection: guideInfo,
      camera: await inspectMap(page),
    })

    await controls(page, 'Design')
    await page.getByRole('button', { name: 'Peg road', exact: true }).tap()
    for (const [index, coordinate] of guideInfo.guide.entries()) {
      // Live pegging feedback can reflow on a phone; read the visible map again before each tap.
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
      )
      const p = (await inspectMap(page, [coordinate])).clicks[0]
      const state = await inspectMap(page)
      expect(p.x).toBeGreaterThan(state.rect.x + 12)
      expect(p.x).toBeLessThan(state.rect.right - 12)
      expect(p.y).toBeGreaterThan(state.rect.y + 65)
      expect(p.y).toBeLessThan(state.rect.bottom - 45)
      await page.touchscreen.tap(p.x, p.y)
      await expect(page.getByTestId('pegging-feedback')).toContainText(`${index + 1} points`)
    }
    await page.getByRole('button', { name: 'Finish road', exact: true }).tap()
    await controls(page, 'Design')
    await page.getByLabel('Road name', { exact: true }).fill('Vernon mobile road guide')
    const originalProject = await save(page, info.outputPath('02-original.road.json'))
    const active = (p: RoadProject) => p.alignments.find((a) => a.id === p.activeAlignmentId)!
    const originalRoad = active(originalProject)
    expect(originalRoad.points).toHaveLength(3)
    originalRoad.points.forEach((point, index) =>
      expect(distance(point.coordinate, guideInfo.guide[index])).toBeLessThan(1),
    )
    expect(originalRoad.points.every((p) => Number.isFinite(imported.source.elevationAt(...p.coordinate)))).toBe(true)
    await fits(page)

    await page.getByRole('button', { name: 'Duplicate active alignment', exact: true }).tap()
    const duplicate = await save(page)
    await page.getByRole('button', { name: 'Select start', exact: true }).tap()
    await dragControl(page, 1, 20, 20)
    const movedStart = await save(page)
    expect(active(movedStart).points[0].coordinate).not.toEqual(active(duplicate).points[0].coordinate)
    await page.getByRole('button', { name: 'Undo road edit', exact: true }).tap()
    expect(await save(page)).toEqual(duplicate)
    await page.getByRole('button', { name: 'Redo road edit', exact: true }).tap()
    expect(await save(page)).toEqual(movedStart)
    await controls(page, 'Design')
    await page.getByRole('button', { name: 'Select end', exact: true }).tap()
    await dragControl(page, 3, -20, 15)
    const movedEnd = await save(page)
    expect(active(movedEnd).points[2].coordinate).not.toEqual(active(movedStart).points[2].coordinate)
    await page.getByRole('button', { name: 'Add control between points 1 and 2', exact: true }).tap()
    const inserted = await save(page)
    expect(active(inserted).points).toHaveLength(4)
    await dragControl(page, 2, 0, -25)
    const edited = await save(page, info.outputPath('03-touch-edited.road.json'))
    expect(active(edited).points[1].coordinate).not.toEqual(active(inserted).points[1].coordinate)
    expect(edited.alignments.find((a) => a.id === originalRoad.id)).toEqual(originalRoad)
    await page.screenshot({ path: info.outputPath('03-touch-edited-road.png') })
    outcomes.push({
      step: 'touch-edited duplicated road',
      controls: active(edited).points.length,
      originalPreserved: true,
      oneUndoPerDrag: true,
    })

    await controls(page, 'Design')
    await page.getByLabel('Active road', { exact: true }).selectOption(originalRoad.id)
    const beforeOptimization = await save(page)
    const review = page.getByTestId('road-optimization-review')
    for (const [objective, halfWidth] of [
      ['balanced', 100],
      ['shortest', 25],
    ] as const) {
      await expandRoadSection(page, 'road-route-tools')
      await page.getByLabel('Corridor optimization objective', { exact: true }).selectOption(objective)
      await page.getByLabel('Corridor half-width metres', { exact: true }).fill(String(halfWidth))
      await page.getByRole('button', { name: 'Optimize sketched corridor', exact: true }).tap()
      const failure = page.getByTestId('workspace-toast-error')
      await expect
        .poll(async () => (await review.isVisible()) || (await failure.isVisible()), { timeout: 120000 })
        .toBe(true)
      if (await review.isVisible()) {
        outcomes.push({ step: 'horizontal search', objective, halfWidth, outcome: 'verified candidate' })
        break
      }
      outcomes.push({ step: 'horizontal search', objective, halfWidth, outcome: await failure.innerText() })
      await failure.getByRole('button', { name: 'Dismiss error notification', exact: true }).tap()
      expect(await save(page)).toEqual(beforeOptimization)
    }
    await expect(review).toBeVisible()
    await page.screenshot({ path: info.outputPath('04-corridor-review.png') })
    await review.getByRole('button', { name: 'Use candidate as new road', exact: true }).tap()
    const horizontal = await save(page, info.outputPath('04-horizontal.road.json'))
    expect(horizontal.alignments.find((a) => a.id === originalRoad.id)).toEqual(originalRoad)
    await page.getByRole('button', { name: 'Optimize profile (K 4)', exact: true }).tap()
    await expect(page.getByLabel('Road name', { exact: true })).toHaveValue(/optimized profile$/, { timeout: 60000 })
    const optimized = await save(page, info.outputPath('05-optimized.road.json'))
    const optimizedRoad = active(optimized)
    const analysis = analyzeRoad(optimizedRoad, terrainFromMetadata(optimized.terrain)!, optimized.settings)
    expect(optimizedRoad.vertical.length).toBeGreaterThanOrEqual(2)
    expect(analysis.coveragePercent).toBeGreaterThan(99.99999)
    expect(analysis.maxGradePercent).toBeLessThanOrEqual(12.000001)
    expect(optimized.settings.minRadius).toBe(25)
    expect(optimized.terrain.raster?.values).toEqual(imported.metadata.raster?.values)
    outcomes.push({
      step: 'optimized profile',
      lengthM: analysis.length,
      coveragePercent: analysis.coveragePercent,
      maxGradePercent: analysis.maxGradePercent,
      cutM3: analysis.cutVolumeM3,
      fillM3: analysis.fillVolumeM3,
      warnings: analysis.warnings,
    })
    await page.getByRole('button', { name: 'Hide road controls', exact: true }).tap()

    const station = page.getByLabel('Selected station metres', { exact: true })
    await station.fill('60')
    await station.press('Tab')
    const tabs = page.getByRole('tablist', { name: 'Visible road pane', exact: true })
    await tabs.getByRole('tab', { name: 'Profile', exact: true }).tap()
    await expect(page.getByTestId('road-profile-chart')).toHaveAttribute('data-station', '60')
    await fits(page)
    await page.screenshot({ path: info.outputPath('05-mobile-profile.png') })
    await tabs.getByRole('tab', { name: 'Detail', exact: true }).tap()
    await expect(page.getByTestId('road-section-chart')).toHaveAttribute('data-station', '60')
    await page.getByRole('combobox', { name: 'Road detail view', exact: true }).tap()
    await page.getByRole('option', { name: '3D', exact: true }).tap()
    await expect(page.getByTestId('road-ground-canvas')).toHaveAttribute('data-face-count', /^[1-9][0-9]*$/)
    await fits(page)
    await page.screenshot({ path: info.outputPath('06-mobile-terrain.png') })
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 667, height: 375 },
    ]) {
      await page.setViewportSize(viewport)
      await fits(page)
      await page.screenshot({ path: info.outputPath(`06-terrain-${viewport.width}x${viewport.height}.png`) })
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Show how the covered estimate is calculated', exact: true }).tap()
    await expect(page.getByRole('dialog').filter({ hasText: 'Covered estimate' })).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).tap()
    await tabs.getByRole('tab', { name: 'Plan', exact: true }).tap()
    await page.screenshot({ path: info.outputPath('07-mobile-complete.png') })

    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            new Promise<string | undefined>((resolve, reject) => {
              const r = indexedDB.open('pgmaps-forestry-roads-v1', 1)
              r.onerror = () => reject(r.error)
              r.onsuccess = () => {
                const db = r.result
                const tx = db.transaction('projects', 'readonly')
                const get = tx.objectStore('projects').get('current')
                get.onsuccess = () => resolve(get.result?.activeAlignmentId)
                tx.oncomplete = () => db.close()
              }
            }),
        ),
      )
      .toBe(optimized.activeAlignmentId)
    await page.reload()
    await controls(page, 'Design')
    await expect(page.getByLabel('Active road', { exact: true })).toHaveValue(optimized.activeAlignmentId)
    expect(await save(page)).toEqual(optimized)

    const fresh = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      serviceWorkers: 'block',
    })
    try {
      const reopened = await fresh.newPage()
      reopened.on('pageerror', (error) => errors.push(error.message))
      await reopened.route('https://**', (r) =>
        r.request().url().startsWith('https://basemaps.cartocdn.com/')
          ? r.fulfill({ json: { version: 8, sources: {}, layers: [] } })
          : r.abort(),
      )
      await reopened.goto(new URL('/dev/forestry/road-design?example=training', page.url()).href)
      await expect(reopened.getByRole('button', { name: 'Open', exact: true })).toBeEnabled()
      const choose = reopened.waitForEvent('filechooser')
      await reopened.getByRole('button', { name: 'Open', exact: true }).tap()
      await (await choose).setFiles(info.outputPath('05-optimized.road.json'))
      await controls(reopened, 'Design')
      await expect(reopened.getByLabel('Active road', { exact: true })).toHaveValue(optimized.activeAlignmentId)
      expect(await save(reopened)).toEqual(optimized)
      await fits(reopened)
    } finally {
      await fresh.close()
    }
    outcomes.push({
      step: 'persistence',
      normalReload: 'exact project restored',
      freshBrowserFileReopen: 'exact project and embedded DEM restored',
      networkScope: 'External terrain requests blocked; valid empty basemap style fixture kept to initialize MapLibre',
    })
    await writeFile(info.outputPath('mobile-journey.json'), JSON.stringify({ outcomes, errors }, null, 2))
    expect(errors).toEqual([])
    completed = true
  } catch (cause) {
    outcomes.push({ step: 'blocked', message: cause instanceof Error ? cause.message : String(cause) })
    throw cause
  } finally {
    await writeFile(info.outputPath('mobile-journey.json'), JSON.stringify({ completed, outcomes, errors }, null, 2))
  }
})
