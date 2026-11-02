import { expect, test, type Page } from '@playwright/test'
import { writeArrayBuffer } from 'geotiff'
import { readFileSync } from 'node:fs'
const overlapFeatures = JSON.parse(
  readFileSync(new URL('../fixtures/mmgis-overlap.geojson', import.meta.url), 'utf8'),
).features
import { collapsePanel, expectFits, mapTap, openMission, press, readMission } from './mmgis-helpers'

// Keyboard expansion is a portable accessibility path; Chromium's existing
// responsive suite separately exercises native touch drags and pinches.
async function panel(page: Page, name: string) {
  if ((page.viewportSize()?.width ?? 1440) < 768) {
    const handle = page.getByRole('separator', { name: 'Drag to resize sheet', exact: true })
    await handle.press('End')
    await expect(handle).toHaveAttribute('aria-valuenow', '2')
  }
  await press(
    page,
    page.getByRole('navigation', { name: 'Workbench tools' }).getByRole('button', { name, exact: true }),
  )
}
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })

test.beforeEach(async ({ page }) => {
  await page.addInitScript((overlapFeatures) => {
    const layer = (id: string, label: string, geometry: string, features: unknown[]) => ({
      id,
      label,
      geometry,
      group: 'Parity fixture',
      data: { type: 'FeatureCollection', features },
      visible: true,
      editable: true,
      opacity: 0.9,
      showInLegend: true,
      style: { type: 'simple', color: '#d49138' },
      filter: null,
      timeProperty: id === 'points' ? 'date' : '',
    })
    const fixture = {
      schema: 'pgmaps-mission-v1',
      id: 'parity',
      name: 'Parity fixture',
      description: 'Controlled interaction evidence',
      camera: { center: [0, 0], zoom: 13, bearing: 0, pitch: 0 },
      view: 'map',
      terrain: false,
      time: { enabled: false, start: '2026-06-01', end: '2026-06-03' },
      tiles: [],
      bookmarks: [],
      layers: [
        layer('lines', 'Multipart line', 'line', [
          {
            type: 'Feature',
            id: 'line',
            properties: { name: 'Multipart route' },
            geometry: {
              type: 'MultiLineString',
              coordinates: [
                [
                  [-0.01, -0.01],
                  [0, -0.01],
                  [0.01, -0.01],
                ],
                [
                  [-0.01, -0.015],
                  [0, -0.015],
                  [0.01, -0.015],
                ],
              ],
            },
          },
        ]),
        layer('points', 'Overlapping points', 'point', overlapFeatures),
      ],
    }
    if (!localStorage.getItem('pgmaps:mmgis:mission:v1'))
      localStorage.setItem('pgmaps:mmgis:mission:v1', JSON.stringify(fixture))
  }, overlapFeatures)
})

test('inspects overlaps and nested values, hides/restores a feature and preserves its identity on reload', async ({
  page,
}) => {
  const errors = await openMission(page)
  await expect.poll(async () => (await readMission(page)).map.renderedFeatures).toBeGreaterThan(0)
  await mapTap(page, 0.5, 0.5)
  await expect(page.getByRole('group', { name: 'Intersecting features' })).toBeVisible()
  await expect(page.getByText(/Feature 1 of 2/)).toBeVisible()
  const first = (await readMission(page)).selected!.id
  await press(page, button(page, 'Next feature'))
  expect((await readMission(page)).selected!.id).not.toBe(first)
  await page.getByLabel('Filter feature properties').fill('zero')
  await expect(
    page
      .locator('.mm-property-row')
      .filter({ has: page.locator('dt', { hasText: 'zero' }) })
      .locator('dd'),
  ).toHaveText('0')
  await page.getByLabel('Filter feature properties').fill('flag')
  await expect(
    page
      .locator('.mm-property-row')
      .filter({ has: page.locator('dt', { hasText: 'flag' }) })
      .locator('dd'),
  ).toHaveText('false')
  await press(page, button(page, 'Hide feature'))
  await expect.poll(async () => (await readMission(page)).visibleFeatures).toBe(2)
  await expect(page.getByText('Selected feature', { exact: true })).toBeHidden()
  await page.reload()
  await expect.poll(async () => (await readMission(page)).visibleFeatures).toBe(2)
  await panel(page, 'Layers')
  await press(page, button(page, 'Show hidden features (1)'))
  await expect.poll(async () => (await readMission(page)).visibleFeatures).toBe(3)
  await expectFits(page)
  expect(errors).toEqual([])
})

test('inserts and removes vertices in another geometry part and keeps undo reversible', async ({ page }) => {
  const errors = await openMission(page)
  await panel(page, 'Search')
  await page.getByRole('textbox', { name: 'Search mission features' }).fill('Multipart route')
  await press(page, page.getByRole('button', { name: /Multipart route/ }))
  await page.getByLabel('Edit geometry · drag vertex handles').check()
  await panel(page, 'Search')
  const geometry = () => readMission(page).then((s) => s.selectedFeature!.geometry)
  const original = await geometry()
  await page.getByRole('combobox', { name: 'Selected vertex', exact: true }).selectOption('3')
  await press(page, button(page, 'Insert midpoint after vertex'))
  await expect.poll(async () => JSON.stringify(await geometry())).not.toBe(JSON.stringify(original))
  const inserted = await geometry()
  expect(inserted.type === 'MultiLineString' && inserted.coordinates.map((l) => l.length)).toEqual([3, 4])
  await page.getByRole('combobox', { name: 'Selected vertex', exact: true }).selectOption('4')
  await press(page, button(page, 'Remove selected vertex'))
  await expect.poll(geometry).toEqual(original)
  await collapsePanel(page)
  await press(page, button(page, 'Undo mission edit'))
  await expect.poll(geometry).toEqual(inserted)
  await expectFits(page)
  expect(errors).toEqual([])
})

test('restores site layer visibility and time window settings', async ({ page }) => {
  const errors = await openMission(page)
  await collapsePanel(page)
  await press(page, button(page, 'Toggle time control'))
  await page.getByLabel('Time window end').fill('2026-06-01')
  await expect.poll(async () => (await readMission(page)).visibleFeatures).toBe(2)
  await panel(page, 'Mission')
  await page.getByLabel('Site name', { exact: true }).fill('Saved state')
  await press(page, button(page, 'Save current view'))
  await collapsePanel(page)
  await page.getByLabel('Time window end').fill('2026-06-03')
  await panel(page, 'Layers')
  await page.getByLabel('Parity fixture', { exact: true }).uncheck()
  await expect.poll(async () => (await readMission(page)).visibleFeatures).toBe(0)
  await panel(page, 'Mission')
  await press(page, button(page, 'Saved state'))
  await expect.poll(async () => (await readMission(page)).visibleFeatures).toBe(2)
  await collapsePanel(page)
  await expect(page.getByLabel('Time window end')).toHaveValue('2026-06-01')
  await expectFits(page)
  expect(errors).toEqual([])
})

test('runs directional visibility from the imported DEM without remote elevation requests', async ({ page }) => {
  let remoteRequests = 0
  await page.route('**/elevation-tiles-prod/**', (route) => {
    remoteRequests++
    return route.abort()
  })
  const errors = await openMission(page)
  await panel(page, 'Rasters')
  const raster = Buffer.from(
    writeArrayBuffer(Array(64).fill(0), {
      width: 8,
      height: 8,
      GeographicTypeGeoKey: 4326,
      GTRasterTypeGeoKey: 1,
      ModelPixelScale: [0.005, 0.005, 0],
      ModelTiepoint: [0, 0, 0, -0.02, 0.02, 0],
      BitsPerSample: [8],
      SampleFormat: [1],
      StripByteCounts: [64],
    }),
  )
  await page.getByLabel('Vertical reference / datum').fill('Controlled datum, metres')
  await page
    .getByLabel('Import terrain GeoTIFF', { exact: true })
    .setInputFiles({ name: 'flat-zero.tif', mimeType: 'image/tiff', buffer: raster })
  await expect.poll(async () => (await readMission(page)).localRaster?.name).toBe('flat-zero.tif')
  await panel(page, 'Terrain')
  await page.getByLabel('Radius (m)', { exact: true }).fill('500')
  await page.getByLabel('Horizontal field of view (°)').fill('90')
  await page.getByLabel('Target height above terrain (m)').fill('2')
  await page.getByLabel('Show visibility analysis').check()
  await expect(page.getByText('Current analysis', { exact: true })).toBeVisible({ timeout: 30000 })
  const visibility = (await readMission(page)).visibility
  expect(visibility.groundMeters).toBe(0)
  expect(visibility.source).toBe('flat-zero.tif')
  expect(visibility.settings.fieldOfView).toEqual({ bearing: 0, width: 90 })
  expect(visibility.settings.targetOffsetMeters).toBe(2)
  expect(visibility.counts!.unknown).toBe(0)
  expect(visibility.counts!.visibleA).toBe(visibility.counts!.total)
  expect(remoteRequests).toBe(0)
  await collapsePanel(page)
  await expect
    .poll(async () => (await readMission(page)).map.sources.some((s) => s.includes('mmgis-viewshed')))
    .toBe(true)
  await expectFits(page)
  expect(errors).toEqual([])
})

test('snaps a new point to an existing vertex and closes a polygon by its first vertex', async ({ page }) => {
  const errors = await openMission(page)
  await panel(page, 'Draw')
  await page.getByLabel('Snap to visible vertices within 12 pixels').check()
  await press(page, button(page, 'Point'))
  await collapsePanel(page)
  // Offset the actual native click/tap by a few pixels so matching 0/0 proves snapping.
  await mapTap(page, 0.503, 0.503)
  await expect
    .poll(async () => (await readMission(page)).selectedFeature?.geometry)
    .toEqual({ type: 'Point', coordinates: [0, 0] })
  await panel(page, 'Draw')
  await press(page, button(page, 'Polygon'))
  await collapsePanel(page)
  await mapTap(page, 0.25, 0.3)
  await mapTap(page, 0.65, 0.3)
  await mapTap(page, 0.45, 0.6)
  await expect.poll(async () => (await readMission(page)).draftVertices).toBe(3)
  await mapTap(page, 0.25, 0.3)
  await expect.poll(async () => (await readMission(page)).selectedFeature?.geometry.type).toBe('Polygon')
  const geometry = (await readMission(page)).selectedFeature!.geometry
  if (geometry.type !== 'Polygon') throw Error('Expected closed polygon')
  expect(geometry.coordinates[0]).toHaveLength(4)
  expect(geometry.coordinates[0][0]).toEqual(geometry.coordinates[0].at(-1))
  expect((await readMission(page)).draftVertices).toBe(0)
  await collapsePanel(page)
  await expectFits(page)
  expect(errors).toEqual([])
})
