import { expect, test, type Locator, type Page } from '@playwright/test'
import type { RoadProject } from '../../src/pages/dev-forestry-roads/types'

test.use({ serviceWorkers: 'block', actionTimeout: 15_000, viewport: { width: 1512, height: 982 } })
test.setTimeout(120_000)

/** Inspect the actual MapLibre instance, as in the forestry viewshed tests.
 * User actions still go through rendered controls and real pointer events. */
async function mapState(page: Page) {
  return page.evaluate(() => {
    const container = document.querySelector('[data-testid="road-plan-view"] .maplibregl-map')
    if (!container) return null
    const key = Object.keys(container).find((name) => name.startsWith('__reactFiber$'))
    if (!key) return null
    type Map = import('maplibre-gl').Map
    type Hook = { memoizedState?: { current?: Map } | Map; next?: Hook }
    type Fiber = { memoizedState?: Hook; return?: Fiber }
    let fiber = (container as unknown as Record<string, Fiber>)[key]
    for (let depth = 0; fiber && depth < 200; depth++, fiber = fiber.return!) {
      for (let hook = fiber.memoizedState, count = 0; hook && count < 40; hook = hook.next, count++) {
        const value = hook.memoizedState
        const map =
          value && typeof value === 'object' && 'current' in value ? value.current : (value as Map | undefined)
        if (typeof map?.getTerrain !== 'function') continue
        const source = (id: string) => {
          const existing = map.getSource(id)
          return existing?.type === 'geojson' ? (existing.serialize().data as GeoJSON.FeatureCollection) : undefined
        }
        const roads = source('road-roads')?.features ?? []
        const rectangle = map.getCanvas().getBoundingClientRect()
        const terrain = map.getSource('road-terrain')?.serialize() as { url?: string } | undefined
        let imageHash = 0
        for (const character of terrain?.url ?? '') imageHash = (imageHash * 31 + character.charCodeAt(0)) | 0
        return {
          loaded: map.loaded(),
          layers: map.getStyle().layers.map((layer) => layer.id),
          renderedRoads: map.getLayer('road-alignments')
            ? map.queryRenderedFeatures({ layers: ['road-alignments'] }).length
            : 0,
          roadCount: new Set(roads.map((feature) => feature.properties?.id)).size,
          roads: roads.map((feature) => ({ id: feature.properties?.id, chainage: feature.properties?.chainage })),
          roadClicks: roads.flatMap((feature) => {
            if (!feature.properties?.selected || feature.geometry.type !== 'LineString') return []
            const position = map.project(feature.geometry.coordinates[1] as [number, number])
            return [
              {
                chainage: Number(feature.properties.chainage),
                x: rectangle.x + position.x,
                y: rectangle.y + position.y,
              },
            ]
          }),
          contourCount: source('road-contours')?.features.length ?? 0,
          contourInterval: source('road-contours')?.features[0]?.properties?.interval_m,
          contoursVisible: map.getLayer('road-contours')
            ? map.getLayoutProperty('road-contours', 'visibility')
            : undefined,
          terrainVisible: map.getLayer('road-terrain')
            ? map.getLayoutProperty('road-terrain', 'visibility')
            : undefined,
          imageHash,
          section: source('road-section')?.features[0]?.geometry,
          draft: source('road-draft'),
        }
      }
    }
    return null
  })
}

async function prepare(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  // A real, valid style; an empty glyphs URL prevents MapLibre from loading.
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.goto('/dev/forestry/road-design?example=training')
  await expect(page.getByRole('heading', { name: 'Forest road design', exact: true })).toBeVisible()
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await expect
    .poll(async () => (await mapState(page))?.layers)
    .toEqual(
      expect.arrayContaining(['road-terrain', 'road-contours', 'road-corridor', 'road-alignments', 'road-section']),
    )
  await expect.poll(async () => (await mapState(page))?.renderedRoads ?? 0).toBeGreaterThan(0)
  await expect(page.getByTestId('road-profile-chart').locator('path[stroke="#a07845"]')).not.toHaveAttribute('d', '')
  return errors
}

function workflow(page: Page, name: string) {
  return page.getByRole('tablist', { name: 'Road workflow', exact: true }).getByRole('tab', { name, exact: true })
}
function detail(page: Page, name: string) {
  return page.getByRole('tablist', { name: 'Road detail view', exact: true }).getByRole('tab', { name, exact: true })
}
async function downloadText(page: Page, button: Locator) {
  const pending = page.waitForEvent('download')
  await button.click()
  const result = await pending
  const stream = await result.createReadStream()
  expect(stream).not.toBeNull()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  return { name: result.suggestedFilename(), text: Buffer.concat(chunks).toString('utf8') }
}
async function saveProject(page: Page) {
  const download = await downloadText(page, page.getByRole('button', { name: 'Save', exact: true }))
  return { ...download, project: JSON.parse(download.text) as RoadProject }
}
async function fillNumber(page: Page, name: string, value: number) {
  const input = page.getByRole('spinbutton', { name, exact: true })
  await input.fill(String(value))
  await input.press('Tab')
}
async function linkedStation(page: Page, station: number) {
  await expect(page.getByTestId('road-active-map-station')).toHaveAttribute('data-chainage', String(station))
  await expect(page.getByTestId('road-profile-chart')).toHaveAttribute('data-station', String(station))
  await expect(page.getByLabel('Selected station metres', { exact: true })).toHaveValue(String(station))
}

test('station, real map layers, profile, section, schedule and terrain remain linked', async ({ page }, testInfo) => {
  const errors = await prepare(page)
  const initial = (await mapState(page))!
  expect(initial.roadCount).toBe(2)
  expect(initial.contourCount).toBeGreaterThan(0)
  expect(initial.contourInterval).toBe(1)
  await fillNumber(page, 'Selected station metres', 200)
  await linkedStation(page, 200)
  await expect(page.getByTestId('road-section-chart')).toHaveAttribute('data-station', '200')
  const sectionAt200 = (await mapState(page))!.section

  const profile = page.getByTestId('road-profile-chart')
  await profile.focus()
  await profile.press('ArrowRight')
  await linkedStation(page, 210)
  await expect(page.getByTestId('road-section-chart')).toHaveAttribute('data-station', '210')
  expect((await mapState(page))!.section).not.toEqual(sectionAt200)

  await detail(page, 'Stations').click()
  await page.getByRole('button', { name: 'Select station 400.0', exact: true }).click()
  await linkedStation(page, 400)
  await expect(page.getByTestId('road-station-table').locator('tr[aria-selected="true"]')).toContainText('0+400.0')

  // Select another position with an actual map click; rendered feature hit testing is exercised.
  const target = (await mapState(page))!.roadClicks.find((point) => point.chainage === 600)!
  await page.mouse.click(target.x, target.y)
  await expect
    .poll(async () => Number(await page.getByLabel('Selected station metres').inputValue()))
    .toBeGreaterThan(550)
  await expect.poll(async () => Number(await page.getByLabel('Selected station metres').inputValue())).toBeLessThan(650)
  const fromMap = await page.getByTestId('road-active-map-station').getAttribute('data-chainage')
  await expect(profile).toHaveAttribute('data-station', fromMap!)

  await page.getByLabel('Terrain display', { exact: true }).selectOption('slope')
  await expect.poll(async () => (await mapState(page))?.imageHash).not.toBe(initial.imageHash)
  await expect(page.getByTestId('road-plan-view').getByText('Slope 0°', { exact: true })).toBeVisible()
  await expect(page.getByTestId('road-plan-view').getByText('60°+', { exact: true })).toBeVisible()
  await page.getByLabel('Contours', { exact: true }).uncheck()
  await expect.poll(async () => (await mapState(page))?.contoursVisible).toBe('none')
  await page.getByLabel('Contours', { exact: true }).check()
  await page.getByLabel('Terrain display', { exact: true }).selectOption('elevation')
  await expect(page.getByTestId('road-plan-view').getByText(/^Elevation -?\d+–-?\d+ m$/)).toBeVisible()
  await page.getByLabel('Terrain display', { exact: true }).selectOption('hillshade')

  await detail(page, 'Section').click()
  await page.screenshot({ path: testInfo.outputPath('desktop-linked-road.png'), fullPage: true })
  await detail(page, 'Mass haul').click()
  await expect(page.getByTestId('road-mass-chart')).toBeVisible()
  await detail(page, '3D').click()
  const terrain = page.getByTestId('road-terrain-preview')
  await expect(terrain.locator('polygon')).not.toHaveCount(0)
  const firstFace = terrain.locator('polygon').first()
  const beforeRotate = await firstFace.getAttribute('points')
  await page.getByRole('button', { name: 'Rotate terrain right', exact: true }).click()
  await expect(firstFace).not.toHaveAttribute('points', beforeRotate!)
  await page.getByRole('button', { name: 'Follow station', exact: true }).click()
  await fillNumber(page, 'Selected station metres', 700)
  await linkedStation(page, 700)
  await expect(terrain).toHaveAttribute('data-station', '700')
  await page.getByRole('button', { name: 'Fullscreen 3D terrain', exact: true }).click()
  await expect(page.getByRole('region', { name: '3D terrain', exact: true })).toHaveAttribute('data-fullscreen', 'true')
  await expect
    .poll(async () => (await terrain.locator('svg[role="group"]').boundingBox())?.width ?? 0)
    .toBeGreaterThan(1_200)
  await expect
    .poll(async () => (await terrain.locator('svg[role="group"]').boundingBox())?.height ?? 0)
    .toBeGreaterThan(600)
  await page.screenshot({ path: testInfo.outputPath('terrain-follow-fullscreen.png') })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Fullscreen 3D terrain', exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

test('pegging uses real map points with live leg grade and an undoable new road', async ({ page }) => {
  const errors = await prepare(page)
  await page.getByRole('button', { name: 'Peg road', exact: true }).click()
  const feedback = page.getByTestId('pegging-feedback')
  await expect(feedback).toContainText('0 points')
  await expect(page.getByRole('button', { name: 'Finish road', exact: true })).toBeDisabled()
  const box = (await page.locator('[data-testid="road-plan-view"] .maplibregl-canvas').boundingBox())!
  await page.mouse.click(box.x + box.width * 0.28, box.y + box.height * 0.65)
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5)
  await expect(feedback).toContainText('1 points')
  await expect(feedback).toContainText(/Leg [\d,.]+ m · ground [\d,.]+ m · grade -?[\d,.]+%/)
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5)
  await expect(page.getByRole('button', { name: 'Finish road', exact: true })).toBeEnabled()
  await expect
    .poll(async () => (await mapState(page))?.draft?.features[0]?.geometry)
    .toMatchObject({ type: 'LineString' })
  await page.mouse.click(box.x + box.width * 0.72, box.y + box.height * 0.36)
  await expect(feedback).toContainText('3 points')
  await page.getByRole('button', { name: 'Finish road', exact: true }).click()
  await expect(feedback).toHaveCount(0)
  await expect(page.getByLabel('Active road').locator('option:checked')).toHaveText('Road 3')
  await expect(page.getByLabel('Selected horizontal point').locator('option')).toHaveCount(4)
  await expect.poll(async () => (await mapState(page))?.roadCount).toBe(3)
  await expect(page.getByTestId('road-profile-chart').locator('path[stroke="#a07845"]')).not.toHaveAttribute('d', '')
  await page.getByRole('button', { name: 'Undo road edit', exact: true }).click()
  await expect(page.getByLabel('Active road').locator('option')).toHaveCount(2)
  await page.getByRole('button', { name: 'Redo road edit', exact: true }).click()
  await expect(page.getByLabel('Active road').locator('option:checked')).toHaveText('Road 3')
  expect(errors).toEqual([])
})

test('profile controls and one-sided turnout widening change calculated sections and persisted design', async ({
  page,
}) => {
  const errors = await prepare(page)
  const original = (await saveProject(page)).project
  const active = original.alignments.find((alignment) => alignment.id === original.activeAlignmentId)!
  const pvi = page.getByRole('slider', { name: 'Vertical control 2 elevation', exact: true })
  const originalLevel = Number(await pvi.getAttribute('aria-valuenow'))
  await pvi.focus()
  await pvi.press('ArrowUp')
  await expect
    .poll(async () => Number(await pvi.getAttribute('aria-valuenow')))
    .toBeCloseTo(Math.round((originalLevel + 0.1) * 100) / 100, 2)
  await expect(page.getByRole('spinbutton', { name: 'PVI 2 level', exact: true })).toHaveValue(
    String(Math.round((originalLevel + 0.1) * 100) / 100),
  )

  await fillNumber(page, 'Selected station metres', 230)
  await workflow(page, 'Section').click()
  const section = page.getByTestId('road-section-chart')
  const leftBefore = Number(await section.getAttribute('data-left-width'))
  const rightBefore = Number(await section.getAttribute('data-right-width'))
  const designBefore = await section.locator('path[stroke="#0d9488"]').getAttribute('d')
  const firstWidth = page.getByRole('spinbutton', { name: 'Extra width (m)', exact: true }).first()
  await firstWidth.fill('8')
  await firstWidth.press('Tab')
  await expect.poll(async () => Number(await section.getAttribute('data-left-width'))).toBeCloseTo(leftBefore + 4, 2)
  await expect.poll(async () => Number(await section.getAttribute('data-right-width'))).toBeCloseTo(rightBefore, 2)
  await expect(section.locator('path[stroke="#0d9488"]')).not.toHaveAttribute('d', designBefore!)
  const changed = (await saveProject(page)).project.alignments.find((alignment) => alignment.id === active.id)!
  expect(changed.points).toEqual(active.points)
  expect(changed.vertical[1].elevation).toBeCloseTo(Math.round((originalLevel + 0.1) * 100) / 100, 2)
  expect(changed.overrides[0]).toMatchObject({ side: 'left', extraWidth: 8 })
  expect(changed.template.rightWidth).toBe(active.template.rightWidth)
  expect(errors).toEqual([])
})

test('alternatives, comparison, undo and GeoJSON/project round trips preserve editable road data', async ({ page }) => {
  const errors = await prepare(page)
  await page.getByRole('button', { name: 'Duplicate active alignment', exact: true }).click()
  await expect(page.getByLabel('Active road').locator('option')).toHaveCount(3)
  await detail(page, 'Compare').click()
  await expect(page.getByRole('region', { name: 'Compare alternatives', exact: true }).locator('tbody tr')).toHaveCount(
    3,
  )
  await expect(page.getByRole('button', { name: 'Hillside access · training copy', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Undo road edit', exact: true }).click()
  await expect(page.getByLabel('Active road').locator('option')).toHaveCount(2)
  await page.getByRole('button', { name: 'Redo road edit', exact: true }).click()
  await expect(page.getByLabel('Active road').locator('option')).toHaveCount(3)

  const saved = await saveProject(page)
  expect(saved.name).toMatch(/\.road\.json$/)
  expect(saved.project.schema).toBe('pgmaps-road-project-v1')
  expect(saved.project.terrain.kind).toBe('demo')
  expect(saved.project.alignments).toHaveLength(3)
  await workflow(page, 'Files').click()
  const geo = await downloadText(page, page.getByRole('button', { name: 'Export GeoJSON', exact: true }))
  expect(geo.name).toMatch(/\.geojson$/)
  const collection = JSON.parse(geo.text) as GeoJSON.FeatureCollection
  expect(collection.type).toBe('FeatureCollection')
  expect(collection.features.some((feature) => feature.geometry.type === 'LineString')).toBe(true)
  expect(collection.features.some((feature) => feature.geometry.type === 'Point')).toBe(true)
  expect(geo.text).not.toContain('NaN')

  await page.getByRole('button', { name: 'Import road lines', exact: true }).click()
  await page
    .getByTestId('road-file-input')
    .setInputFiles({ name: 'roundtrip.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(geo.text) })
  await expect.poll(async () => page.getByLabel('Active road').locator('option').count()).toBeGreaterThan(3)
  await page.getByRole('button', { name: 'Open project', exact: true }).click()
  await page
    .getByTestId('road-file-input')
    .setInputFiles({ name: 'roundtrip.road.json', mimeType: 'application/json', buffer: Buffer.from(saved.text) })
  await expect(page.getByLabel('Active road').locator('option')).toHaveCount(3)
  await expect(page.getByRole('alert')).toHaveCount(0)
  const reopened = (await saveProject(page)).project
  expect(reopened).toEqual(saved.project)
  expect(errors).toEqual([])
})

test('stream terrain profiles show ground-only data and cannot edit the road vertical alignment', async ({ page }) => {
  const errors = await prepare(page)
  const original = (await saveProject(page)).project
  await workflow(page, 'Terrain').click()
  await page.getByRole('button', { name: 'Synthetic drainage · stream', exact: true }).click()
  const profilePanel = page.getByRole('region', { name: 'Terrain profile · elevation & distance', exact: true })
  await expect(profilePanel).toBeVisible()
  const plot = page.getByTestId('road-profile-chart')
  await expect(plot).toHaveAttribute('data-terrain-only', 'true')
  await expect(plot.getByRole('slider')).toHaveCount(0)
  await expect(profilePanel.getByText('Formation', { exact: true })).toHaveCount(0)
  await expect(profilePanel).not.toContainText('Double-click to add')
  await expect(page.getByTestId('road-section-chart')).toHaveAttribute('data-terrain-only', 'true')
  await expect(
    page.getByRole('region', { name: 'Cross-section', exact: true }).getByText('Template', { exact: true }),
  ).toHaveCount(0)
  const rectangle = (await plot.boundingBox())!
  await page.mouse.dblclick(rectangle.x + rectangle.width * 0.55, rectangle.y + rectangle.height * 0.45)
  expect((await saveProject(page)).project.alignments).toEqual(original.alignments)
  await expect(detail(page, 'Mass haul')).toBeDisabled()
  await detail(page, '3D').click()
  const terrain = page.getByTestId('road-terrain-preview')
  await expect(terrain).toHaveAttribute('data-terrain-only', 'true')
  await expect(terrain.locator('line[stroke="#a07845"]')).not.toHaveCount(0)
  await expect(terrain.locator('polygon.cursor-pointer')).toHaveCount(0)
  await page.getByRole('button', { name: 'Return to road', exact: true }).click()
  await expect(plot).toHaveAttribute('data-terrain-only', 'false')
  await expect(plot.getByRole('slider')).not.toHaveCount(0)
  expect(errors).toEqual([])
})

test('phone views fit the viewport and preserve station selection through panel fullscreen', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const errors = await prepare(page)
  await page.getByRole('button', { name: 'Hide road controls', exact: true }).click()
  await expect(page.getByRole('complementary', { name: 'Road design controls', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await fillNumber(page, 'Selected station metres', 200)
  await linkedStation(page, 200)
  await page.getByRole('button', { name: 'Fullscreen Plan · alignment & terrain', exact: true }).click()
  const plan = page.getByRole('region', { name: 'Plan · alignment & terrain', exact: true })
  await expect(plan).toHaveAttribute('data-fullscreen', 'true')
  const box = (await plan.boundingBox())!
  expect(box.width).toBeLessThanOrEqual(390)
  expect(box.height).toBeLessThanOrEqual(844)
  await expect.poll(async () => (await mapState(page))?.renderedRoads ?? 0).toBeGreaterThan(0)
  await page.screenshot({ path: testInfo.outputPath('mobile-plan-fullscreen.png') })
  await page.keyboard.press('Escape')
  await linkedStation(page, 200)
  await page.getByRole('button', { name: 'Fullscreen Road profile · ground & formation', exact: true }).click()
  const profilePanel = page.getByRole('region', { name: 'Road profile · ground & formation', exact: true })
  await expect(profilePanel).toHaveAttribute('data-fullscreen', 'true')
  const chart = page.getByTestId('road-profile-chart')
  await chart.focus()
  await chart.press('ArrowRight')
  await expect(chart).toHaveAttribute('data-station', '210')
  await page.screenshot({ path: testInfo.outputPath('mobile-profile-fullscreen.png') })
  await page.keyboard.press('Escape')
  await linkedStation(page, 210)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(errors).toEqual([])
})

test('failed saved-terrain restoration cannot autosave synthetic fallback over the original project', async ({
  page,
}) => {
  await prepare(page)
  const saved = (await saveProject(page)).project
  saved.name = 'Keep the real terrain project'
  saved.terrain = {
    kind: 'geotiff',
    name: 'Temporarily unavailable recorded LiDAR terrain',
    epsg: 3157,
    resolutionM: 1,
    verticalReference: 'CGVD2013',
    sha256: '0'.repeat(64),
    sourceUrl: 'https://pgmaps.ahmadjalil.com/data/lidar-analysis/bc-093g086/dtm-1m.tif',
  }
  await page.evaluate(
    (project) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('pgmaps-forestry-roads-v1', 1)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const database = open.result
          const transaction = database.transaction('projects', 'readwrite')
          transaction.objectStore('projects').put(project, 'current')
          transaction.oncomplete = () => {
            database.close()
            resolve()
          }
          transaction.onerror = () => reject(transaction.error)
        }
      }),
    saved,
  )
  let terrainRequests = 0
  await page.route('**/dtm-1m.tif*', (route) => {
    terrainRequests++
    return route.fulfill({ status: 503, body: 'Temporarily unavailable' })
  })
  await page.goto('/dev/forestry/road-design')
  await expect(page.getByRole('alert').first()).toContainText('has not been overwritten')
  expect(terrainRequests).toBeGreaterThan(0)
  await page.clock.install()
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  // Advance beyond the 650 ms autosave debounce without a timing-dependent sleep.
  await page.clock.fastForward(1_500)
  const stored = await page.evaluate(
    () =>
      new Promise<RoadProject>((resolve, reject) => {
        const open = indexedDB.open('pgmaps-forestry-roads-v1', 1)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const database = open.result
          const transaction = database.transaction('projects', 'readonly')
          const request = transaction.objectStore('projects').get('current')
          request.onsuccess = () => resolve(request.result as RoadProject)
          transaction.oncomplete = () => database.close()
          request.onerror = () => reject(request.error)
        }
      }),
  )
  expect(stored).toEqual(saved)
})
