import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { encode } from 'fast-png'
import { writeArrayBuffer } from 'geotiff'
import {
  collapsePanel,
  dragInput,
  expandPanel,
  expectFits,
  expectPanelCollapsed,
  mapTap,
  openMission,
  panel,
  press,
  readMission,
} from './mmgis-helpers'

test.use({
  actionTimeout: 15000,
  screenshot: 'only-on-failure',
  serviceWorkers: 'block',
  launchOptions: {
    executablePath: process.env.PGMAPS_PLAYWRIGHT_EXECUTABLE_PATH,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
  },
})

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
async function flatTerrain(page: Page) {
  const data = new Uint8Array(256 * 256 * 3)
  for (let i = 0; i < data.length; i += 3) {
    data[i] = 129
    data[i + 1] = 244
  }
  await page.route('**/elevation-tiles-prod/terrarium/**', (r) =>
    r.fulfill({ contentType: 'image/png', body: Buffer.from(encode({ width: 256, height: 256, channels: 3, data })) }),
  )
}
const localDem = () =>
  Buffer.from(
    writeArrayBuffer(Array(64).fill(0), {
      width: 8,
      height: 8,
      GeographicTypeGeoKey: 4326,
      GTRasterTypeGeoKey: 1,
      ModelPixelScale: [0.2, 0.2, 0],
      ModelTiepoint: [0, 0, 0, -123.5, 54.6, 0],
      BitsPerSample: [8],
      SampleFormat: [1],
      StripByteCounts: [64],
    }),
  )

for (const profile of [
  { name: 'desktop', viewport: { width: 1440, height: 960 }, isMobile: false, hasTouch: false },
  { name: 'touch phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
]) {
  test.describe(`mission workflows on ${profile.name}`, () => {
    test.use({ viewport: profile.viewport, isMobile: profile.isMobile, hasTouch: profile.hasTouch })
    test.setTimeout(90000)

    test('layers, legend, all style modes, group visibility and filtered downloads', async ({ page }) => {
      const errors = await openMission(page)
      await panel(page, 'Layers')
      await press(
        page,
        page.getByRole('group', { name: 'Field stations legend' }).getByRole('button', { name: 'Water', exact: true }),
      )
      await expect.poll(async () => (await readMission(page)).visibleFeatures).toBe(6)
      await press(
        page,
        page.getByRole('group', { name: 'Field stations legend' }).getByRole('button', { name: 'Water', exact: true }),
      )
      await expect.poll(async () => (await readMission(page)).visibleFeatures).toBe(8)
      await press(page, button(page, 'Field stations'))
      for (const [name, type] of [
        ['Color range', 'range'],
        ['Size', 'size'],
        ['Categories', 'categories'],
        ['Simple', 'simple'],
      ]) {
        await press(page, page.getByRole('group', { name: 'Style type' }).getByRole('button', { name, exact: true }))
        await expect.poll(async () => (await readMission(page)).layers.at(-1)!.style.type).toBe(type)
      }
      await press(page, button(page, 'Back to layers'))
      const ids = (await readMission(page)).layers.map((l) => l.id)
      await press(page, button(page, 'Field stations options'))
      await press(page, page.getByRole('menuitem', { name: 'Move toward bottom', exact: true }))
      expect((await readMission(page)).layers.map((l) => l.id)).toEqual([ids[0], ids[2], ids[1]])
      await page.getByLabel('Example mission', { exact: true }).uncheck()
      await expect.poll(async () => (await readMission(page)).visibleFeatures).toBe(0)
      await page.getByLabel('Example mission', { exact: true }).check()
      await panel(page, 'Search')
      await page.getByRole('textbox', { name: 'Search mission features' }).fill('Water')
      await page.getByLabel('Filter map and table to these results').check()
      await expect.poll(async () => (await readMission(page)).visibleFeatures).toBe(2)
      await press(page, page.getByRole('button', { name: /River station/ }))
      await panel(page, 'Mission')
      for (const [name, extension] of [
        ['Export layer CSV', '.csv'],
        ['Export layer GeoJSON', '.geojson'],
        ['Export map image', '.png'],
      ]) {
        const downloaded = page.waitForEvent('download', { timeout: 15000 })
        await press(page, page.locator('[data-map-sidebar-wrapper]').getByRole('button', { name, exact: true }))
        const file = await downloaded
        expect(file.suggestedFilename()).toMatch(new RegExp(`${extension.replace('.', '\\.')}$`))
        const data = await readFile((await file.path())!)
        expect(data.byteLength).toBeGreaterThan(50)
        if (extension === '.csv') expect(data.toString()).toContain('River station')
        if (extension === '.geojson') expect(JSON.parse(data.toString()).features).toHaveLength(2)
      }
      expect(errors).toEqual([])
    })

    test('tap/click drawing, Finish, property edit, actual vertex drag and history', async ({ page }) => {
      const errors = await openMission(page)
      await panel(page, 'Draw')
      await page.getByLabel('Feature name').fill('Touch point')
      await press(page, button(page, 'Point'))
      await mapTap(page)
      await expandPanel(page)
      await expect(page.getByRole('heading', { name: 'Touch point', exact: true })).toBeVisible()
      await page.getByLabel('Feature properties (JSON)').fill('{"name":"Edited point","samples":0}')
      await press(page, button(page, 'Save properties'))
      const original = (await readMission(page)).selectedFeature!.geometry
      await press(page, page.getByLabel('Edit geometry · drag vertex handles'))
      await expect(page.getByLabel('Edit geometry · drag vertex handles')).toBeChecked()
      await expectPanelCollapsed(page)
      const handle = page.getByRole('button', { name: 'Move vertex 1', exact: true })
      if (profile.hasTouch) await handle.tap({ trial: true })
      else await handle.click({ trial: true })
      const box = (await handle.boundingBox())!
      expect(
        await page.evaluate(
          ({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label'),
          { x: box.x + box.width / 2, y: box.y + box.height / 2 },
        ),
      ).toBe('Move vertex 1')
      await dragInput(
        page,
        { x: box.x + box.width / 2, y: box.y + box.height / 2 },
        { x: box.x + box.width / 2 + 40, y: box.y + box.height / 2 + 20 },
      )
      await expect
        .poll(async () => JSON.stringify((await readMission(page)).selectedFeature!.geometry))
        .not.toBe(JSON.stringify(original))
      await press(page, button(page, 'Undo mission edit'))
      expect((await readMission(page)).selectedFeature!.geometry).toEqual(original)
      await press(
        page,
        page.getByRole('group', { name: 'Active map tool' }).getByRole('button', { name: 'Done', exact: true }),
      )
      await panel(page, 'Draw')
      await press(page, button(page, 'Line'))
      await expectPanelCollapsed(page)
      await mapTap(page, 0.25, 0.3)
      await mapTap(page, 0.5, 0.5)
      await mapTap(page, 0.65, 0.6)
      await expect.poll(async () => (await readMission(page)).draftVertices).toBe(3)
      await press(
        page,
        page.getByRole('group', { name: 'Active map tool' }).getByRole('button', { name: 'Undo vertex', exact: true }),
      )
      expect((await readMission(page)).draftVertices).toBe(2)
      await press(
        page,
        page.getByRole('group', { name: 'Active map tool' }).getByRole('button', { name: 'Finish', exact: true }),
      )
      await expect.poll(async () => (await readMission(page)).selectedFeature?.geometry.type).toBe('LineString')
      await panel(page, 'Draw')
      await press(page, button(page, 'Polygon'))
      await expectPanelCollapsed(page)
      await mapTap(page, 0.25, 0.3)
      await mapTap(page, 0.6, 0.3)
      await mapTap(page, 0.45, 0.6)
      await press(
        page,
        page.getByRole('group', { name: 'Active map tool' }).getByRole('button', { name: 'Finish', exact: true }),
      )
      const polygon = (await readMission(page)).selectedFeature!.geometry
      if (polygon.type !== 'Polygon') throw new Error('Expected Polygon')
      expect(polygon.coordinates[0]).toHaveLength(4)
      expect(polygon.coordinates[0][0]).toEqual(polygon.coordinates[0][3])
      await expandPanel(page)
      await press(page, button(page, 'Delete feature'))
      await collapsePanel(page)
      await press(page, button(page, 'Undo mission edit'))
      expect((await readMission(page)).layers.at(-1)!.features).toBe(1)
      await expectFits(page)
      expect(errors).toEqual([])
    })

    test('imports file and URL geometries and opens an interactive attribute table', async ({ page }) => {
      const errors = await openMission(page)
      await press(page, button(page, 'Add data').first())
      await page.getByLabel('Choose files to upload').setInputFiles({
        name: 'stations.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('name,longitude,latitude,value\nUploaded station,-122.75,53.92,0\n'),
      })
      await expect.poll(async () => (await readMission(page)).visibleFeatures).toBe(9)
      await page.route('https://mission-data.invalid/*', (route) =>
        route.fulfill({
          json: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: { name: 'URL polygon' },
                geometry: {
                  type: 'Polygon',
                  coordinates: [
                    [
                      [-122.8, 53.9],
                      [-122.7, 53.9],
                      [-122.75, 53.95],
                      [-122.8, 53.9],
                    ],
                  ],
                },
              },
            ],
          },
        }),
      )
      await press(page, button(page, 'Add data').first())
      await page.getByRole('textbox', { name: 'GeoJSON URL' }).fill('https://mission-data.invalid/field.geojson')
      await press(page, button(page, 'Add URL'))
      await expect.poll(async () => (await readMission(page)).visibleFeatures).toBe(10)
      expect(
        (await readMission(page)).map.dataSources.some((s) => s.geometryTypes.includes('Polygon') && s.features === 1),
      ).toBe(true)
      await panel(page, 'Search')
      await page.getByRole('textbox', { name: 'Search mission features' }).fill('Uploaded station')
      await press(page, page.getByRole('button', { name: /Uploaded station/ }))
      await press(page, button(page, 'Open attribute table').first())
      await expect(page.getByRole('table').filter({ visible: true }).first()).toContainText('Uploaded station')
      await expectFits(page)
      expect(errors).toEqual([])
    })

    test('DEM import and tap inspection, profile sampling/cursor/export and viewshed worker', async ({ page }) => {
      await flatTerrain(page)
      const errors = await openMission(page)
      await panel(page, 'Rasters')
      await page.getByLabel('Vertical reference / datum').fill('Test datum, metres')
      await page
        .getByLabel('Import terrain GeoTIFF', { exact: true })
        .setInputFiles({ name: 'zero-dem.tif', mimeType: 'image/tiff', buffer: localDem() })
      await expect.poll(async () => (await readMission(page)).localRaster?.width).toBe(8)
      await collapsePanel(page)
      await mapTap(page, 0.5, 0.5)
      await panel(page, 'Rasters')
      await expect(page.getByText('0.00 m', { exact: true })).toBeVisible()
      await panel(page, 'Terrain')
      await press(page, button(page, 'Draw a profile path'))
      await expectPanelCollapsed(page)
      await mapTap(page, 0.3, 0.35)
      await mapTap(page, 0.65, 0.6)
      await press(
        page,
        page.getByRole('group', { name: 'Active map tool' }).getByRole('button', { name: 'Finish', exact: true }),
      )
      await panel(page, 'Terrain')
      await press(page, button(page, 'Generate elevation profile'))
      await expect(page.getByRole('img', { name: 'Elevation profile: 0.0 to 0.0 metres', exact: true })).toBeVisible()
      const sample = page.getByRole('slider', { name: 'Profile sample', exact: true })
      await press(page, sample)
      await expect(page.getByText(/Profile cursor.*0.00 m/)).toBeVisible()
      const downloaded = page.waitForEvent('download', { timeout: 15000 })
      await press(page, button(page, 'Export profile CSV'))
      expect((await downloaded).suggestedFilename()).toBe('elevation-profile.csv')
      await page.getByLabel('Show 3D terrain').check()
      await expect.poll(async () => (await readMission(page)).map.terrain !== null).toBe(true)
      await press(page, button(page, 'Place observer on map'))
      await expectPanelCollapsed(page)
      await mapTap(page, 0.5, 0.45)
      await expect
        .poll(async () => (await readMission(page)).map.sources.some((s) => s.includes('mmgis-viewshed')), {
          timeout: 45000,
        })
        .toBe(true)
      await panel(page, 'Terrain')
      await expect(page.getByText('Current analysis', { exact: true })).toBeVisible({ timeout: 45000 })
      await page.getByLabel('Show visibility analysis').uncheck()
      await page.getByLabel('Show 3D terrain').uncheck()
      await expect.poll(async () => (await readMission(page)).map.terrain).toBeNull()
      expect(errors).toEqual([])
    })

    test('COG numeric-zero tap query and failed connection leave the map usable', async ({ page }) => {
      const tile = Buffer.from(
        encode({ width: 256, height: 256, channels: 3, data: new Uint8Array(256 * 256 * 3).fill(100) }),
      )
      await page.route('https://mission-raster.invalid/**', (route) => {
        const url = route.request().url()
        if (url.includes('/point/')) return route.fulfill({ json: { values: [0] } })
        if (url.includes('tilejson'))
          return route.fulfill({ json: { tiles: ['https://mission-raster.invalid/tiles/{z}/{x}/{y}.png'] } })
        return route.fulfill({ contentType: 'image/png', body: tile })
      })
      await page.route('https://mission-failure.invalid/**', (r) => r.fulfill({ status: 503, body: 'Unavailable' }))
      const errors = await openMission(page)
      await panel(page, 'Rasters')
      await page.getByLabel('Source type').selectOption('cog')
      await page.getByLabel('Layer name', { exact: true }).fill('Test COG')
      await page.getByLabel('COG URL', { exact: true }).fill('https://example.invalid/test.tif')
      await page.getByLabel('TiTiler service').fill('https://mission-raster.invalid')
      await press(page, button(page, 'Add raster'))
      await collapsePanel(page)
      await mapTap(page, 0.5, 0.4)
      await panel(page, 'Rasters')
      await press(page, button(page, 'Query COG at last map position'))
      await expect(page.getByText(/Test COG · band 1 .*: 0$/)).toBeVisible()
      await page.getByLabel('COG URL', { exact: true }).fill('https://example.invalid/missing.tif')
      await page.getByLabel('TiTiler service').fill('https://mission-failure.invalid')
      await press(page, button(page, 'Add raster'))
      await expect(page.getByText(/Raster service returned 503/)).toBeVisible()
      expect((await readMission(page)).visibleFeatures).toBe(8)
      expect(errors).toEqual([])
    })

    test('split views, time playback, bookmarks and portable mission round trip', async ({ page }) => {
      const errors = await openMission(page)
      await press(page, button(page, 'Split'))
      const plan = (await page.getByTestId('mission-plan').boundingBox())!
      const scene = (await page.getByTestId('mission-scene').boundingBox())!
      if (profile.isMobile) {
        expect(scene.y).toBeGreaterThan(plan.y)
        expect(scene.y + scene.height).toBeLessThan(profile.viewport.height - 72)
      } else expect(scene.x).toBeGreaterThan(plan.x)
      await press(page, button(page, 'Globe'))
      await expect(page.getByTestId('mission-scene')).toBeHidden()
      await press(page, button(page, '2D'))
      await panel(page, 'Mission')
      await page.getByLabel('Site name', { exact: true }).fill('Saved view')
      await press(page, button(page, 'Save current view'))
      const initial = (await readMission(page)).map.camera.zoom
      await collapsePanel(page)
      await press(page, button(page, 'Zoom in').first())
      await expect.poll(async () => (await readMission(page)).map.camera.zoom).toBeGreaterThan(initial)
      await panel(page, 'Mission')
      await press(page, button(page, 'Saved view'))
      await expect.poll(async () => Math.abs((await readMission(page)).map.camera.zoom - initial)).toBeLessThan(0.01)
      await collapsePanel(page)
      await press(page, button(page, 'Toggle time control'))
      await page.getByLabel('Time window end').fill('2026-06-01')
      await expect.poll(async () => (await readMission(page)).visibleFeatures).toBe(3)
      await press(page, button(page, 'Next frame'))
      await expect.poll(async () => (await readMission(page)).visibleFeatures).toBe(4)
      await press(page, button(page, 'Play'))
      await expect.poll(async () => (await readMission(page)).visibleFeatures).toBeGreaterThan(4)
      await press(page, button(page, 'Pause'))
      await press(page, button(page, 'Toggle time control'))
      await panel(page, 'Mission')
      const exported = page.waitForEvent('download', { timeout: 15000 })
      await press(page, button(page, 'Export mission'))
      const file = await exported
      await press(page, button(page, 'New mission'))
      await expect.poll(async () => (await readMission(page)).layers.length).toBe(0)
      await page.getByLabel('Import mission JSON').setInputFiles((await file.path())!)
      await expect.poll(async () => (await readMission(page)).layers.length).toBe(3)
      expect((await readMission(page)).bookmarks[0].name).toBe('Saved view')
      await press(page, button(page, 'Create share link'))
      const link = await page.getByLabel('Mission share link').inputValue()
      await press(page, button(page, 'New mission'))
      await page.goto(link)
      await expect.poll(async () => (await readMission(page)).visibleFeatures).toBe(8)
      await expectFits(page)
      expect(errors).toEqual([])
    })

    test('pans and zooms with real input, resizes split panes and rotates without losing layers', async ({ page }) => {
      const errors = await openMission(page)
      const canvas = page.getByTestId('mission-plan').locator('canvas.maplibregl-canvas')
      const box = (await canvas.boundingBox())!
      const initial = (await readMission(page)).map.camera
      await dragInput(
        page,
        { x: box.x + box.width * 0.4, y: box.y + box.height * 0.4 },
        { x: box.x + box.width * 0.6, y: box.y + box.height * 0.5 },
      )
      await expect
        .poll(async () => JSON.stringify((await readMission(page)).map.camera.center))
        .not.toBe(JSON.stringify(initial.center))
      const zoom = (await readMission(page)).map.camera.zoom
      if (profile.hasTouch) {
        const session = await page.context().newCDPSession(page)
        const center = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.4 }
        const touches = (offset: number) => [
          { x: center.x - offset, y: center.y, id: 1 },
          { x: center.x + offset, y: center.y, id: 2 },
        ]
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touches(30) })
        for (let i = 1; i <= 12; i++) {
          await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touches(30 + i * 3) })
          await page.waitForTimeout(20)
        }
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await session.detach()
      } else await press(page, button(page, 'Zoom in').first())
      await expect.poll(async () => (await readMission(page)).map.camera.zoom).toBeGreaterThan(zoom + 0.2)
      const sources = (await readMission(page)).map.sources
      await press(page, button(page, 'Split'))
      const separator = page.getByRole('separator', { name: 'Resize plan and 3D scene', exact: true })
      const boundary = (await separator.boundingBox())!
      const plan = (await page.getByTestId('mission-plan').boundingBox())!
      await dragInput(
        page,
        { x: boundary.x + boundary.width / 2, y: boundary.y + boundary.height / 2 },
        {
          x: boundary.x + boundary.width / 2 + (profile.isMobile ? 0 : 40),
          y: boundary.y + boundary.height / 2 + (profile.isMobile ? 40 : 0),
        },
      )
      await expect
        .poll(async () => {
          const next = (await page.getByTestId('mission-plan').boundingBox())!
          return Math.abs(profile.isMobile ? next.height - plan.height : next.width - plan.width)
        })
        .toBeGreaterThan(10)
      await press(page, button(page, '2D'))
      await page.setViewportSize(profile.isMobile ? { width: 844, height: 390 } : { width: 390, height: 844 })
      await expectFits(page)
      expect((await readMission(page)).map.sources).toEqual(sources)
      expect((await readMission(page)).visibleFeatures).toBe(8)
      expect(errors).toEqual([])
    })
  })
}

for (const viewport of [
  { width: 320, height: 740 },
  { width: 667, height: 375 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
]) {
  test.describe(`workbench layout ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, isMobile: viewport.width < 768, hasTouch: viewport.width < 768 })
    test('keeps tools, views and time controls reachable without overflow', async ({ page }) => {
      const errors = await openMission(page)
      await expectFits(page)
      for (const name of ['Layers', 'Search', 'Draw', 'Terrain', 'Rasters', 'Mission']) {
        await panel(page, name)
        await expect(page.locator('[data-map-sidebar-scroll]')).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      }
      await collapsePanel(page)
      await press(page, button(page, 'Toggle time control'))
      await press(page, button(page, 'Next frame'))
      await expectFits(page)
      await page.screenshot({ path: test.info().outputPath(`mmgis-time-${viewport.width}x${viewport.height}.png`) })
      await press(page, button(page, 'Toggle time control'))
      await press(page, button(page, 'Split'))
      const scene = (await page.getByTestId('mission-scene').boundingBox())!
      expect(scene.y + scene.height).toBeLessThanOrEqual(viewport.height)
      expect(scene.x + scene.width).toBeLessThanOrEqual(viewport.width)
      await expectFits(page)
      await page.screenshot({ path: test.info().outputPath(`mmgis-split-${viewport.width}x${viewport.height}.png`) })
      await press(page, button(page, '2D'))
      await page.screenshot({ path: test.info().outputPath(`mmgis-${viewport.width}x${viewport.height}.png`) })
      expect(errors).toEqual([])
    })
  })
}
