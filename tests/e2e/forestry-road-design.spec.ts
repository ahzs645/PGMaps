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
          formation: source('road-formation'),
          structures: source('road-structures'),
          cables: source('road-cable'),
          overlay: source('road-overlay'),
          overlayLoaded: !!map.getSource('road-overlay') && map.isSourceLoaded('road-overlay'),
          overlayClicks: (source('road-overlay')?.features ?? []).flatMap((feature) => {
            if (feature.geometry.type !== 'LineString') return []
            const first = feature.geometry.coordinates[0],
              last = feature.geometry.coordinates.at(-1)!
            const position = map.project([first[0] * 0.2 + last[0] * 0.8, first[1] * 0.2 + last[1] * 0.8])
            const x = rectangle.x + position.x,
              y = rectangle.y + position.y
            const layers = ['road-exploration-line', 'road-exploration-point'].filter((id) => map.getLayer(id))
            const hit = layers.length ? map.queryRenderedFeatures(position, { layers })[0] : undefined
            return [
              {
                properties: feature.properties,
                x,
                y,
                rendered: !!feature.properties?.spokeId && hit?.properties?.spokeId === feature.properties.spokeId,
                receivesPointer: document.elementFromPoint(x, y) === map.getCanvas(),
              },
            ]
          }),
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
/** The detail view is picked from a combobox in the detail panel's title row. */
function detailPicker(page: Page) {
  return page.getByRole('combobox', { name: 'Road detail view', exact: true })
}
async function showDetail(page: Page, name: string) {
  await detailPicker(page).click()
  await page.getByRole('option', { name, exact: true }).click()
  await expect(detailPicker(page)).toHaveText(name)
}
function engineeringInput(page: Page, name: string) {
  return page.getByRole('tablist', { name: 'Engineering inputs', exact: true }).getByRole('tab', { name, exact: true })
}
function engineeringResult(page: Page, name: string) {
  return page.getByRole('tablist', { name: 'Engineering results', exact: true }).getByRole('tab', { name, exact: true })
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
  const sectionCsv = await downloadText(page, page.getByRole('button', { name: 'Section CSV', exact: true }))
  expect(sectionCsv.text).toContain('signed_offset_m')
  expect(sectionCsv.text).toContain('location_code')
  expect(sectionCsv.text).toContain('centreline')

  const profile = page.getByTestId('road-profile-chart')
  await profile.focus()
  await profile.press('ArrowRight')
  await linkedStation(page, 210)
  await expect(page.getByTestId('road-section-chart')).toHaveAttribute('data-station', '210')
  expect((await mapState(page))!.section).not.toEqual(sectionAt200)

  await showDetail(page, 'Stations')
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

  await showDetail(page, 'Section')
  await page.screenshot({ path: testInfo.outputPath('desktop-linked-road.png'), fullPage: true })
  await showDetail(page, 'Mass haul')
  await expect(page.getByTestId('road-mass-chart')).toBeVisible()
  await showDetail(page, '3D')
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
  const beforeDrawing = (await saveProject(page)).project
  await page.getByRole('combobox', { name: 'Road view layout', exact: true }).click()
  await page.getByRole('option', { name: 'Plan · profile · section · pegging', exact: true }).click()
  await page.getByRole('button', { name: 'Peg road', exact: true }).click()
  const feedback = page.getByTestId('pegging-feedback')
  await expect(feedback).toContainText('0 points')
  await expect(page.getByRole('button', { name: 'Finish road', exact: true })).toBeDisabled()
  const box = (await page.locator('[data-testid="road-plan-view"] .maplibregl-canvas').boundingBox())!
  await page.mouse.click(box.x + box.width * 0.28, box.y + box.height * 0.65)
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5)
  await expect(feedback).toContainText('1 points')
  await expect(feedback).toContainText(/Leg [\d,.]+ m · ground [\d,.]+ m · grade -?[\d,.]+%/)
  await expect(page.getByTestId('road-pegging-editor').locator('tbody tr')).toHaveCount(2)
  const movingLength = Number(await page.getByTestId('road-profile-chart').getAttribute('data-range-end'))
  await page.mouse.move(box.x + box.width * 0.58, box.y + box.height * 0.43)
  await expect
    .poll(async () => Number(await page.getByTestId('road-profile-chart').getAttribute('data-range-end')))
    .not.toBe(movingLength)
  const endpoint = await page.getByTestId('road-profile-chart').getAttribute('data-station')
  await expect(page.getByTestId('road-section-chart')).toHaveAttribute('data-station', endpoint!)
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5)
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5)
  await expect(page.getByRole('button', { name: 'Finish road', exact: true })).toBeEnabled()
  await expect
    .poll(async () => (await mapState(page))?.draft?.features[0]?.geometry)
    .toMatchObject({ type: 'LineString' })
  await page.mouse.click(box.x + box.width * 0.72, box.y + box.height * 0.36)
  await expect(feedback).toContainText('3 points')
  expect((await saveProject(page)).project).toEqual(beforeDrawing)
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
  await showDetail(page, 'Compare')
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
  await detailPicker(page).click()
  await expect(page.getByRole('option', { name: 'Mass haul', exact: true })).toHaveAttribute('data-disabled', '')
  await page.keyboard.press('Escape')
  await showDetail(page, 'Stations')
  await expect(page.getByTestId('road-station-table')).toContainText('Gnd grade')
  await expect(page.getByTestId('road-station-table')).not.toContainText('Formation')
  await expect(page.getByTestId('road-station-table')).not.toContainText('Cut A')
  const terrainCsv = await downloadText(page, page.getByRole('button', { name: 'Profile CSV', exact: true }))
  expect(terrainCsv.text).toContain('ground_grade_percent')
  expect(terrainCsv.text).not.toContain('cut_volume')
  await showDetail(page, '3D')
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

test('named templates, live previews, material horizons and libraries reach the connected geometry and exports', async ({
  page,
}, testInfo) => {
  const errors = await prepare(page)
  await fillNumber(page, 'Selected station metres', 250)
  const initialFormation = (await mapState(page))!.formation
  await workflow(page, 'Engineering').click()
  await page.getByRole('combobox', { name: 'Template starting point', exact: true }).selectOption('double')
  await page.getByRole('button', { name: 'Add named template', exact: true }).click()
  await page.getByLabel('Template name', { exact: true }).fill('Two-lane test section')
  await fillNumber(page, 'Template left width (m)', 5)
  const beforePreview = (await saveProject(page)).project
  await page.getByRole('button', { name: 'Preview at station', exact: true }).click()
  await expect(page.getByText(/Template preview: Two-lane test section/)).toBeVisible()
  await expect(page.getByTestId('road-profile-chart').getByRole('slider')).toHaveCount(0)
  await page.getByTestId('road-profile-chart').dblclick({ position: { x: 160, y: 60 } })
  await expect.poll(async () => (await mapState(page))?.formation).not.toEqual(initialFormation)
  await page.getByRole('button', { name: 'Close preview', exact: true }).click()
  expect((await saveProject(page)).project).toEqual(beforePreview)
  expect((await mapState(page))!.formation).toEqual(initialFormation)
  await fillNumber(page, 'Selected station metres', 250)

  await page.getByRole('button', { name: 'Four condition previews', exact: true }).click()
  await expect(page.getByRole('dialog').getByTestId('road-section-chart')).toHaveCount(4)
  await page.getByRole('dialog').getByText('Ground rises to the left · 25%', { exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('template-four-conditions.png'), fullPage: true })
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Save template', exact: true }).click()
  await page.getByRole('button', { name: 'Assign selected template', exact: true }).click()
  await page.getByRole('combobox', { name: 'Assignment 1 side', exact: true }).selectOption('left')
  await fillNumber(page, 'Assignment 1 start (m)', 200)
  await fillNumber(page, 'Assignment 1 end (m)', 400)
  await fillNumber(page, 'Assignment 1 transition (m)', 10)
  await expect.poll(async () => (await mapState(page))?.formation).not.toEqual(initialFormation)
  await page.getByRole('button', { name: /Grade, curve, template & material bands/ }).click()
  await expect(page.getByTestId('road-engineering-bands')).toContainText('Two-lane test section')
  await linkedStation(page, 250)

  // Editing an already assigned library template is a nonpersistent candidate until Save.
  const assigned = (await saveProject(page)).project
  const assignedFormation = (await mapState(page))!.formation
  await fillNumber(page, 'Template left width (m)', 7)
  await expect(page.getByRole('button', { name: 'Save template', exact: true })).toBeEnabled()
  expect((await mapState(page))!.formation).toEqual(assignedFormation)
  expect((await saveProject(page)).project).toEqual(assigned)
  await page.getByRole('button', { name: 'Preview at station', exact: true }).click()
  await expect.poll(async () => (await mapState(page))?.formation).not.toEqual(assignedFormation)
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click()
  await expect(page.getByText(/Template preview:/)).toHaveCount(0)
  expect((await mapState(page))!.formation).toEqual(assignedFormation)
  await expect(page.getByRole('spinbutton', { name: 'Template left width (m)', exact: true })).toHaveValue('5')

  await engineeringInput(page, 'Ground').click()
  await page.getByRole('button', { name: 'Add ground material', exact: true }).click()
  await page.getByLabel('Ground material name', { exact: true }).fill('Measured till')
  await fillNumber(page, 'Measured till excavation ($/bank m³)', 18)
  await fillNumber(page, 'Measured till reusable fraction', 0.7)
  await page.getByRole('button', { name: 'Add material horizon', exact: true }).click()
  await fillNumber(page, 'Horizon 1 bottom depth (m)', 4)
  await expect(page.getByTestId('road-engineering-bands')).toContainText('Measured till')
  await expect(page.getByTestId('road-section-chart').locator('polygon[fill="#a16207"]')).not.toHaveCount(0)
  await page.getByRole('button', { name: 'Show quantities & cost breakdown', exact: true }).click()
  await engineeringResult(page, 'Materials').click()
  await expect(page.getByTestId('road-engineering-summary')).toContainText('Measured till')
  const quantities = await downloadText(
    page,
    page.getByTestId('road-engineering-summary').getByRole('button', { name: 'CSV', exact: true }),
  )
  expect(quantities.text).toContain('Measured till')
  expect(quantities.text).toContain('bank_m3')
  expect(quantities.text).toContain('compacted_m3')

  await engineeringInput(page, 'Templates').click()
  const library = await downloadText(page, page.getByRole('button', { name: 'Export library', exact: true }))
  expect(JSON.parse(library.text)).toMatchObject({ schema: 'pgmaps-road-library-v1' })
  await page
    .getByTestId('road-library-input')
    .setInputFiles({ name: library.name, mimeType: 'application/json', buffer: Buffer.from(library.text) })
  await expect(page.getByRole('combobox', { name: 'Library template', exact: true }).locator('option')).toHaveCount(2)
  const saved = await saveProject(page)
  const active = saved.project.alignments.find((a) => a.id === saved.project.activeAlignmentId)!
  expect(active.engineering?.templates).toHaveLength(2)
  expect(active.engineering?.materials).toHaveLength(2)
  expect(active.engineering?.assignments).toHaveLength(1)
  expect(active.engineering?.strata).toHaveLength(1)
  await page
    .getByTestId('road-file-input')
    .setInputFiles({ name: saved.name, mimeType: 'application/json', buffer: Buffer.from(saved.text) })
  expect((await saveProject(page)).project.alignments).toEqual(saved.project.alignments)
  expect(errors).toEqual([])
})

test('culvert edits, material-aware haul and engineering ledgers preserve map and profile station mapping', async ({
  page,
}, testInfo) => {
  const errors = await prepare(page)
  await fillNumber(page, 'Selected station metres', 200)
  await workflow(page, 'Engineering').click()
  await engineeringInput(page, 'Drainage').click()
  await page.getByRole('button', { name: 'Add culvert at station', exact: true }).click()
  await page.getByLabel('Culvert 1 name', { exact: true }).fill('Cross-drain A')
  await fillNumber(page, 'Culvert 1 horizontal barrel span (m)', 60)
  await fillNumber(page, 'Culvert 1 installed $/m', 200)
  await page.getByLabel('Enter provisional inverts', { exact: true }).check()
  const inlet = Number(
    await page.getByRole('spinbutton', { name: 'Culvert 1 left inlet invert (m)', exact: true }).inputValue(),
  )
  await fillNumber(page, 'Culvert 1 left inlet invert (m)', inlet - 3)
  await fillNumber(page, 'Culvert 1 right outlet invert (m)', inlet - 3.6)
  const originalBarrel = (await mapState(page))!.structures?.features[0].geometry
  await fillNumber(page, 'Culvert 1 skew (°)', 20)
  await expect.poll(async () => (await mapState(page))?.structures?.features[0].geometry).not.toEqual(originalBarrel)
  await expect(page.getByRole('button', { name: 'Inspect structure Cross-drain A', exact: true })).toBeVisible()
  await fillNumber(page, 'Selected station metres', 400)
  await page.getByRole('button', { name: /Inspect structure Cross-drain A at/ }).click()
  await linkedStation(page, 200)
  await expect(page.getByTestId('road-section-chart')).toHaveAttribute('data-station', '200')

  await engineeringInput(page, 'Haul').click()
  await page.getByLabel('Calculate material haul allocations', { exact: true }).check()
  await fillNumber(page, 'Mobilization ($)', 1000)
  await fillNumber(page, 'Contingency (%)', 10)
  await page.getByRole('button', { name: '+ Borrow', exact: true }).click()
  await page.getByRole('button', { name: '+ Waste', exact: true }).click()
  await fillNumber(page, 'Site 1 access distance (m)', 150)
  await fillNumber(page, 'Site 2 access distance (m)', 250)
  await page.getByRole('button', { name: 'Show quantities & cost breakdown', exact: true }).click()
  await expect(page.getByTestId('road-cost-breakdown')).toContainText('Mobilization')
  await expect(page.getByTestId('road-cost-breakdown')).toContainText('1,000')
  await engineeringResult(page, 'Haul').click()
  await expect(page.getByTestId('road-haul-transfers').locator('tbody tr')).not.toHaveCount(0)
  await expect(page.getByTestId('road-engineering-summary')).toContainText('bank m³·km')
  const transfer = page.getByTestId('road-haul-transfers').locator('tbody tr').first().getByRole('button').first()
  await transfer.click()
  const selected = await page.getByLabel('Selected station metres', { exact: true }).inputValue()
  await linkedStation(page, Number(selected))
  await engineeringResult(page, 'Structures').click()
  await page.getByRole('button', { name: 'Cross-drain A', exact: true }).click()
  await linkedStation(page, 200)
  await expect(page.getByTestId('culvert-profile')).toBeVisible()
  await expect(page.getByTestId('culvert-profile').locator('path')).not.toHaveCount(0)
  const csv = await downloadText(
    page,
    page.getByTestId('road-engineering-summary').getByRole('button', { name: 'CSV', exact: true }),
  )
  expect(csv.text).toContain('Cross-drain A')
  expect(csv.text).toContain('mobilization')
  const saved = await saveProject(page)
  const active = saved.project.alignments.find((a) => a.id === saved.project.activeAlignmentId)!
  expect(active.engineering?.culverts[0]).toMatchObject({
    name: 'Cross-drain A',
    chainage: 200,
    lengthM: 60,
    skewDegrees: 20,
  })
  expect(active.engineering?.sites).toHaveLength(2)
  expect(active.engineering?.haul.enabled).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('culvert-linked-quantities.png'), fullPage: true })
  // Separate barrels at one chainage retain their own identity in every connected view.
  await engineeringInput(page, 'Drainage').click()
  await page.getByRole('button', { name: 'Add culvert at station', exact: true }).click()
  await page.getByLabel('Culvert 2 name', { exact: true }).fill('Cross-drain B')
  await page.getByLabel('Enter provisional inverts', { exact: true }).last().check()
  await page.getByRole('button', { name: 'Inspect structure Cross-drain B', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Inspect structure Cross-drain B', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByTestId('culvert-profile')).toContainText('Cross-drain B')
  await page.getByRole('button', { name: 'Cross-drain A', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Inspect structure Cross-drain A', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByTestId('culvert-profile')).toContainText('Cross-drain A')
  await showDetail(page, '3D')
  await expect(page.getByTestId('road-terrain-preview').getByRole('button', { name: /Cross-drain A/ })).toBeVisible()
  const secondStructure = (await saveProject(page)).project.alignments.find(
    (a) => a.id === saved.project.activeAlignmentId,
  )!.engineering!.culverts[1]
  await page.getByRole('combobox', { name: '3D structure', exact: true }).selectOption(secondStructure.id)
  await expect(page.getByRole('button', { name: 'Inspect structure Cross-drain B', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(errors).toEqual([])
})

test('numeric pegging and radial D-lines preserve physical map positions, invalidate previews and round-trip offsets', async ({
  page,
}, testInfo) => {
  const errors = await prepare(page)
  await showDetail(page, 'Pegs')
  const original = (await saveProject(page)).project
  const oldGeometry = (await mapState(page))!.formation
  await fillNumber(page, 'Peg 2 distance', 160)
  await expect.poll(async () => (await mapState(page))?.formation).not.toEqual(oldGeometry)
  const edited = (await saveProject(page)).project
  const active = edited.alignments.find((a) => a.id === edited.activeAlignmentId)!
  expect(active.points[1].coordinate).not.toEqual(
    original.alignments.find((a) => a.id === original.activeAlignmentId)!.points[1].coordinate,
  )
  const editedFormation = (await mapState(page))!.formation
  const previousProfileLength = Number(await page.getByTestId('road-profile-chart').getAttribute('data-range-end'))
  await page.getByRole('button', { name: 'Preview next peg', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Add peg', exact: true })).toBeEnabled()
  await expect.poll(async () => (await mapState(page))?.overlay?.features.length).toBe(2)
  await expect(page.getByTestId('road-pegging-editor')).toContainText('Preview')
  await expect.poll(async () => (await mapState(page))?.formation).not.toEqual(editedFormation)
  await expect
    .poll(async () => Number(await page.getByTestId('road-profile-chart').getAttribute('data-range-end')))
    .toBeGreaterThan(previousProfileLength)
  expect((await saveProject(page)).project).toEqual(edited)
  await fillNumber(page, 'Peg bearing (°)', 45)
  await expect(page.getByRole('button', { name: 'Add peg', exact: true })).toBeDisabled()
  await expect.poll(async () => (await mapState(page))?.overlay?.features.length).toBe(0)
  await expect.poll(async () => (await mapState(page))?.formation).toEqual(editedFormation)

  await fillNumber(page, 'Selected station metres', 300)
  await showDetail(page, 'Landing')
  await fillNumber(page, 'Tailhold radius (m)', 200)
  await fillNumber(page, 'Bearing step (°)', 45)
  await page.getByRole('button', { name: 'Run radial screen', exact: true }).click()
  await expect(page.getByTestId('radial-spoke-table').locator('tbody tr')).toHaveCount(8)
  await page.getByRole('button', { name: 'Select landing spoke 90.0 degrees', exact: true }).click()
  await expect(page.getByTestId('radial-spoke-table').locator('tr[aria-selected="true"]')).toContainText('90.0°')
  const overlay = (await mapState(page))!
  expect(overlay.overlay?.features.filter((f) => f.geometry.type === 'LineString')).toHaveLength(8)
  let target = overlay.overlayClicks.find((p) => p.properties?.bearing_deg === 180)
  // GeoJSON serialize().data changes before its worker tile and hit index.
  // Wait for this exact spoke to be rendered under an unobscured canvas point.
  await expect
    .poll(async () => {
      const state = await mapState(page)
      target = state?.overlayClicks.find((p) => p.properties?.bearing_deg === 180)
      return !!state?.overlayLoaded && !!target?.rendered && !!target?.receivesPointer
    })
    .toBe(true)
  await page.mouse.move(target!.x, target!.y)
  await linkedStation(page, 300)
  await page.mouse.click(target!.x, target!.y)
  await expect(page.getByTestId('radial-spoke-table').locator('tr[aria-selected="true"]')).toContainText('180.0°')
  const radialChart = page.getByTestId('radial-selected-profile').getByTestId('road-cable-chart')
  await radialChart.focus()
  await radialChart.press('Home')
  await expect(radialChart).toHaveAttribute('data-distance', '0')
  await expect
    .poll(
      async () =>
        (await mapState(page))?.overlay?.features.find(
          (f) => f.geometry.type === 'Point' && f.properties?.distance_m !== undefined,
        )?.properties?.distance_m,
    )
    .toBe(0)
  await page.screenshot({ path: testInfo.outputPath('landing-radial-linked.png'), fullPage: true })
  await fillNumber(page, 'Selected station metres', 400)
  await expect(page.getByTestId('radial-spoke-table')).toHaveCount(0)
  await expect.poll(async () => (await mapState(page))?.overlay?.features.length).toBe(0)
  await page.getByRole('button', { name: 'Run radial screen', exact: true }).click()
  await page.getByRole('button', { name: 'Use selected D-line', exact: true }).click()
  await expect(detailPicker(page)).toHaveText('D-line')
  await workflow(page, 'Review').click()
  const initialCables = (await mapState(page))!.cables
  const startInset = page.getByRole('spinbutton', { name: 'Start inset (m)', exact: true }).last()
  await startInset.fill('10')
  await startInset.press('Tab')
  const endInset = page.getByRole('spinbutton', { name: 'End inset (m)', exact: true }).last()
  await endInset.fill('15')
  await endInset.press('Tab')
  await page.getByRole('combobox', { name: 'Yarder position', exact: true }).last().selectOption('end')
  await expect.poll(async () => (await mapState(page))?.cables).not.toEqual(initialCables)
  const cableChart = page.getByTestId('road-cable-chart')
  await cableChart.focus()
  await cableChart.press('End')
  const chartDistance = Number(await cableChart.getAttribute('data-distance'))
  const mapDistance = Number(await page.getByTestId('road-active-cable-position').getAttribute('data-distance'))
  expect(chartDistance).toBeCloseTo(175, 1)
  expect(mapDistance).toBeCloseTo(chartDistance, 1)
  await page.getByTestId('road-cable-summary').locator('summary').click()
  await expect(page.getByTestId('road-cable-summary')).toContainText('Straight chord')
  const cableCsv = await downloadText(page, page.getByRole('button', { name: 'D-line CSV', exact: true }))
  expect(cableCsv.text).toContain('sampled_geometric_cable_length_m')
  expect(cableCsv.text).toContain('start_offset_m')
  const cableReport = await downloadText(page, page.getByRole('button', { name: 'D-line report', exact: true }))
  expect(cableReport.text).toContain('<svg')
  const saved = await saveProject(page)
  expect(saved.project.cables.at(-1)).toMatchObject({ startOffsetM: 10, endOffsetM: 15, yarderAt: 'end' })
  await page
    .getByTestId('road-file-input')
    .setInputFiles({ name: saved.name, mimeType: 'application/json', buffer: Buffer.from(saved.text) })
  expect((await saveProject(page)).project.cables).toEqual(saved.project.cables)
  expect(errors).toEqual([])
})
