import { expect, test, type Page } from '@playwright/test'
import { encode } from 'fast-png'
import type { Geometry } from 'geojson'

test.use({
  serviceWorkers: 'block',
  launchOptions: {
    executablePath: process.env.PGMAPS_PLAYWRIGHT_EXECUTABLE_PATH,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
  },
})
declare global {
  interface Window {
    missionRead: () => Promise<{
      visibleFeatures: number
      name: string
      view: string
      tool: string
      draftVertices: number
      selectedFeature: { geometry: Geometry; properties: Record<string, unknown> } | null
      bookmarks: Array<{ name: string; camera: { center: [number, number]; zoom: number } }>
      selected: { layer: string; id: string } | null
      layers: Array<{
        id: string
        name: string
        features: number
        shown: number
        visible: boolean
        opacity: number
        geometryTypes: string[]
        style: { type: string }
      }>
      map: {
        loaded: boolean
        layerCount: number
        sources: string[]
        terrain: unknown
        camera: { center: [number, number]; zoom: number }
        paintedLayers: Array<{ id: string; type: string; paint: Record<string, unknown>; visible: boolean }>
        dataSources: Array<{ id: string; features: number; geometryTypes: string[] }>
      }
    }>
  }
}
async function open(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.addInitScript(() => {
    Object.defineProperty(document, 'modelContext', {
      value: {
        registerTool: async (tool: { name: string; execute: (args: object, options: object) => Promise<unknown> }) => {
          if (tool.name === 'read_mission_workbench')
            window.missionRead = () => tool.execute({}, {}) as ReturnType<typeof window.missionRead>
        },
      },
    })
  })
  await page.route('https://basemaps.cartocdn.com/**', (r) =>
    r.fulfill({
      json: {
        version: 8,
        sources: {},
        layers: [{ id: 'base', type: 'background', paint: { 'background-color': '#e2e9e5' } }],
        glyphs: 'https://mission-test.invalid/{fontstack}/{range}.pbf',
      },
    }),
  )
  await page.goto('/dev/mmgis')
  await expect.poll(() => page.evaluate(() => window.missionRead?.().then((r) => r.map.loaded))).toBe(true)
  return errors
}
const read = async (page: Page) => {
  await page.waitForFunction(() => typeof window.missionRead === 'function')
  return page.evaluate(() => window.missionRead())
}
const nav = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Workbench tools' }).getByRole('button', { name, exact: true }).click()

test.describe('mission workbench desktop', () => {
  test.use({ viewport: { width: 1440, height: 960 } })
  test('renders real layers and coordinates search, time, table and undo', async ({ page }) => {
    const errors = await open(page)
    expect((await read(page)).map.layerCount).toBeGreaterThan(3)
    await expect.poll(async () => (await read(page)).visibleFeatures).toBe(8)
    await page.getByRole('button', { name: 'Hide Field stations', exact: true }).click()
    await expect.poll(async () => (await read(page)).visibleFeatures).toBe(2)
    await page.getByRole('button', { name: 'Undo mission edit' }).click()
    await expect.poll(async () => (await read(page)).visibleFeatures).toBe(8)
    await nav(page, 'Search')
    await page.getByRole('textbox', { name: 'Search mission features' }).fill('Water')
    await expect(page.getByText('2 matching features')).toBeVisible()
    await page.getByLabel('Filter map and table to these results').check()
    await expect.poll(async () => (await read(page)).visibleFeatures).toBe(2)
    await page.getByRole('button', { name: 'Toggle time control' }).click()
    await page.getByLabel('Time window end').fill('2026-06-02')
    await expect.poll(async () => (await read(page)).visibleFeatures).toBe(1)
    await page.getByRole('button', { name: 'River station', exact: false }).click()
    await expect.poll(async () => (await read(page)).selected !== null).toBe(true)
    await page.getByRole('button', { name: 'Open attribute table', exact: true }).first().click()
    await expect(page.locator('[data-panel="data-table-panel"]')).toContainText('River station')
    expect(errors).toEqual([])
  })
  test('draws, edits, undoes and persists a point; exports and restores the mission', async ({ page }) => {
    const errors = await open(page)
    await nav(page, 'Draw')
    await page.getByLabel('Feature name').fill('New observation')
    await page.getByRole('button', { name: 'Point', exact: true }).click()
    const plan = page.getByTestId('mission-plan')
    await plan.locator('canvas').click({ position: { x: 280, y: 290 } })
    await expect.poll(async () => (await read(page)).layers.length).toBe(4)
    await expect(page.getByRole('heading', { name: 'New observation', exact: true })).toBeVisible()
    await page.getByLabel('Feature properties (JSON)').fill('{"name":"Reviewed observation","samples":0}')
    await page.getByRole('button', { name: 'Save properties' }).click()
    await expect(page.getByRole('heading', { name: 'Reviewed observation', exact: true })).toBeVisible()
    await page.getByLabel('Feature properties (JSON)').fill('{"name":"Reviewed observation","samples":7}')
    await page.getByRole('button', { name: 'Save properties' }).click()
    await page.getByRole('button', { name: 'Undo mission edit' }).click()
    expect(JSON.parse(await page.getByLabel('Feature properties (JSON)').inputValue()).samples).toBe(0)
    await page.getByRole('button', { name: 'Redo mission edit' }).click()
    expect(JSON.parse(await page.getByLabel('Feature properties (JSON)').inputValue()).samples).toBe(7)
    await page.getByRole('button', { name: 'Undo mission edit' }).click()
    await page.getByRole('button', { name: 'Undo mission edit' }).click()
    await expect(page.getByRole('heading', { name: 'New observation', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Redo mission edit' }).click()
    await expect(page.getByRole('heading', { name: 'Reviewed observation', exact: true })).toBeVisible()
    await nav(page, 'Mission')
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export mission', exact: true }).click()
    const exported = await download
    expect(exported.suggestedFilename()).toBe('mission.json')
    await page.getByRole('button', { name: 'Create share link' }).click()
    const link = await page.getByLabel('Mission share link').inputValue()
    expect(link).toContain('#mission=')
    await page.waitForTimeout(700)
    await page.reload()
    await expect.poll(async () => (await read(page)).layers.length).toBe(4)
    await nav(page, 'Mission')
    await page.getByRole('button', { name: 'New mission', exact: true }).click()
    await expect.poll(async () => (await read(page)).layers.length).toBe(0)
    await page.goto(link)
    await expect.poll(async () => (await read(page)).layers.length).toBe(4)
    expect(errors).toEqual([])
  })
  test('imports mixed geometries and switches a synchronized scene without losing data', async ({ page }) => {
    const errors = await open(page)
    await page.getByRole('button', { name: 'Add data', exact: true }).first().click()
    await page.getByLabel('Choose files to upload').setInputFiles({
      name: 'mixed.geojson',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { name: 'Imported point', value: 0 },
              geometry: { type: 'Point', coordinates: [-122.75, 53.92] },
            },
            {
              type: 'Feature',
              properties: { name: 'Imported line' },
              geometry: {
                type: 'LineString',
                coordinates: [
                  [-122.75, 53.92],
                  [-122.74, 53.93],
                ],
              },
            },
          ],
        }),
      ),
    })
    await expect.poll(async () => (await read(page)).visibleFeatures).toBe(10)
    expect((await read(page)).map.dataSources.some((s) => s.features === 1 && s.geometryTypes.includes('Point'))).toBe(
      true,
    )
    expect(
      (await read(page)).map.dataSources.some((s) => s.features === 1 && s.geometryTypes.includes('LineString')),
    ).toBe(true)
    await page.getByRole('button', { name: 'Split', exact: true }).click()
    await expect(page.getByTestId('mission-scene').locator('canvas')).toBeVisible()
    expect((await read(page)).view).toBe('split')
    await page.getByRole('button', { name: 'Globe', exact: true }).click()
    await expect(page.getByTestId('mission-scene')).toBeHidden()
    await expect.poll(async () => (await read(page)).visibleFeatures).toBe(10)
    expect(errors).toEqual([])
  })
  test('samples a real terrain tile into a profile and runs the shared viewshed worker', async ({ page }) => {
    test.setTimeout(90000)
    const bytes = new Uint8Array(256 * 256 * 3)
    for (let i = 0; i < bytes.length; i += 3) {
      bytes[i] = 129
      bytes[i + 1] = 244
    }
    const tile = Buffer.from(encode({ width: 256, height: 256, data: bytes, channels: 3 }))
    await page.route('**/elevation-tiles-prod/terrarium/**', (r) => r.fulfill({ contentType: 'image/png', body: tile }))
    const errors = await open(page)
    await nav(page, 'Draw')
    await page.getByRole('button', { name: 'Measure', exact: true }).click()
    const canvas = page.getByTestId('mission-plan').locator('canvas')
    await canvas.click({ position: { x: 250, y: 250 } })
    await page.waitForTimeout(250)
    await canvas.click({ position: { x: 350, y: 320 } })
    await page.waitForTimeout(250)
    await nav(page, 'Terrain')
    await page.getByRole('button', { name: 'Generate elevation profile' }).click()
    await expect(page.getByRole('img', { name: /Elevation profile: 500.0 to 500.0 metres/ })).toBeVisible()
    await page.getByRole('slider', { name: 'Profile sample', exact: true }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('img', { name: 'Elevation profile location', exact: true })).toBeVisible()
    await expect(page.getByText(/Profile cursor.*500.00 m/)).toBeVisible()
    await page.getByLabel('Show 3D terrain').check()
    await expect.poll(async () => (await read(page)).map.terrain !== null).toBe(true)
    await page.getByLabel('Show visibility analysis').check()
    await expect(page.getByText('Current analysis', { exact: true })).toBeVisible({ timeout: 45000 })
    await expect.poll(async () => (await read(page)).map.sources.some((s) => s.includes('mmgis-viewshed'))).toBe(true)
    expect(errors).toEqual([])
  })
  test('connects a COG and queries original numeric zero from its configured band', async ({ page }) => {
    const tile = Buffer.from(
      encode({ width: 256, height: 256, data: new Uint8Array(256 * 256 * 3).fill(120), channels: 3 }),
    )
    await page.route('https://raster-test.invalid/**', (route) => {
      if (route.request().url().includes('/point/')) return route.fulfill({ json: { values: [0] } })
      if (route.request().url().includes('tilejson'))
        return route.fulfill({ json: { tiles: ['https://raster-test.invalid/tiles/{z}/{x}/{y}.png'] } })
      return route.fulfill({ contentType: 'image/png', body: tile })
    })
    const errors = await open(page)
    await nav(page, 'Rasters')
    await page.getByLabel('Source type').selectOption('cog')
    await page.getByLabel('Layer name', { exact: true }).fill('Numerical COG')
    await page.getByLabel('COG URL', { exact: true }).fill('https://data-test.invalid/dem.tif')
    await page.getByLabel('TiTiler service').fill('https://raster-test.invalid')
    await page.getByRole('button', { name: 'Add raster', exact: true }).click()
    await expect(page.getByText('Numerical COG', { exact: true })).toBeVisible()
    const box = (await page.getByTestId('mission-plan').boundingBox())!
    await page.mouse.move(box.x + 200, box.y + 200)
    await page.getByRole('button', { name: 'Query COG at last map position' }).click()
    await expect(page.getByText(/Numerical COG · band 1 .*: 0/)).toBeVisible()
    await expect.poll(async () => (await read(page)).map.sources.some((s) => s.startsWith('raster-src'))).toBe(true)
    expect(errors).toEqual([])
  })
  test('rejects invalid mission input without replacing the current workspace', async ({ page }) => {
    const errors = await open(page)
    await nav(page, 'Mission')
    await page
      .getByLabel('Import mission JSON')
      .setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"schema":"wrong"}') })
    await expect(page.getByText('This file is not a PG Maps mission (pgmaps-mission-v1).')).toBeVisible()
    expect((await read(page)).visibleFeatures).toBe(8)
    expect(errors).toEqual([])
  })
  test('double-click completes a line once and Escape stops further drawing', async ({ page }) => {
    const errors = await open(page)
    await nav(page, 'Draw')
    await page.getByLabel('Feature name').fill('Double click traverse')
    await page.getByRole('button', { name: 'Line', exact: true }).click()
    const canvas = page.getByTestId('mission-plan').locator('canvas.maplibregl-canvas')
    await canvas.click({ position: { x: 190, y: 170 } })
    await page.mouse.move((await canvas.boundingBox())!.x + 260, (await canvas.boundingBox())!.y + 210)
    await expect(page.getByLabel('Live measurement')).toContainText('from north')
    await canvas.click({ position: { x: 260, y: 220 } })
    await canvas.dblclick({ position: { x: 340, y: 290 } })
    await expect.poll(async () => (await read(page)).layers.length).toBe(4)
    const geometry = (await read(page)).selectedFeature!.geometry
    expect(geometry.type).toBe('LineString')
    expect(geometry.type === 'LineString' && geometry.coordinates.length).toBe(3)
    await nav(page, 'Draw')
    await page.getByRole('button', { name: 'Line', exact: true }).click()
    await canvas.click({ position: { x: 200, y: 180 } })
    await page.keyboard.press('Escape')
    await canvas.click({ position: { x: 240, y: 230 } })
    expect((await read(page)).draftVertices).toBe(1)
    expect((await read(page)).tool).toBe('inspect')
    expect(errors).toEqual([])
  })
  test('closes polygons, edits a vertex with keyboard, deletes and restores geometry', async ({ page }) => {
    const errors = await open(page)
    await nav(page, 'Draw')
    await page.getByRole('button', { name: 'Polygon', exact: true }).click()
    const canvas = page.getByTestId('mission-plan').locator('canvas.maplibregl-canvas')
    await canvas.click({ position: { x: 200, y: 170 } })
    await canvas.click({ position: { x: 320, y: 170 } })
    await canvas.dblclick({ position: { x: 270, y: 290 } })
    await expect.poll(async () => (await read(page)).layers.length).toBe(4)
    const original = (await read(page)).selectedFeature!.geometry
    expect(original.type).toBe('Polygon')
    if (original.type !== 'Polygon') throw new Error('Expected a polygon')
    expect(original.coordinates[0]).toHaveLength(4)
    expect(original.coordinates[0][0]).toEqual(original.coordinates[0][3])
    await page.getByLabel('Edit geometry · drag vertex handles').check()
    await page.getByRole('button', { name: 'Move vertex 1', exact: true }).press('ArrowRight')
    await expect
      .poll(async () => JSON.stringify((await read(page)).selectedFeature!.geometry))
      .not.toBe(JSON.stringify(original))
    await page.getByRole('button', { name: 'Undo mission edit' }).click()
    expect((await read(page)).selectedFeature!.geometry).toEqual(original)
    await page.getByRole('button', { name: 'Delete feature', exact: true }).click()
    await expect.poll(async () => (await read(page)).layers.at(-1)!.features).toBe(0)
    await page.getByRole('button', { name: 'Undo mission edit' }).click()
    expect((await read(page)).layers.at(-1)!.features).toBe(1)
    expect(errors).toEqual([])
  })
  test('style, opacity, category filters and ordering reach the renderer', async ({ page }) => {
    const errors = await open(page)
    await page
      .getByRole('group', { name: 'Field stations legend' })
      .getByRole('button', { name: 'Water', exact: true })
      .click()
    await expect.poll(async () => (await read(page)).visibleFeatures).toBe(6)
    await page.getByRole('button', { name: 'Field stations', exact: true }).click()
    await page.getByRole('group', { name: 'Style type' }).getByRole('button', { name: 'Simple', exact: true }).click()
    expect((await read(page)).layers.at(-1)!.style.type).toBe('simple')
    await page.getByRole('slider', { name: 'Opacity', exact: true }).press('Home')
    await expect.poll(async () => (await read(page)).layers.at(-1)!.opacity).toBe(0)
    await expect
      .poll(async () =>
        (await read(page)).map.paintedLayers.some((l) => l.type === 'circle' && l.paint['circle-opacity'] === 0),
      )
      .toBe(true)
    await page.getByRole('button', { name: 'Back to layers', exact: true }).click()
    const before = (await read(page)).layers.map((l) => l.id)
    await page.getByRole('button', { name: 'Field stations options', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Move toward bottom', exact: true }).click()
    expect((await read(page)).layers.map((l) => l.id)).toEqual([before[0], before[2], before[1]])
    await page.getByLabel('Example mission', { exact: true }).uncheck()
    expect((await read(page)).visibleFeatures).toBe(0)
    expect(errors).toEqual([])
  })
  test('hiding a selected layer removes its inspector and highlights', async ({ page }) => {
    const errors = await open(page)
    await nav(page, 'Search')
    await page.getByRole('textbox', { name: 'Search mission features' }).fill('River station')
    await page.getByRole('button', { name: 'River station', exact: false }).click()
    expect((await read(page)).selected).not.toBeNull()
    await nav(page, 'Layers')
    await page.getByRole('button', { name: 'Hide Field stations', exact: true }).click()
    expect((await read(page)).selected).toBeNull()
    await expect(page.getByRole('heading', { name: 'Selected feature', exact: true })).toHaveCount(0)
    expect(errors).toEqual([])
  })
  test('restores a saved viewpoint and supports temporal stepping and playback', async ({ page }) => {
    const errors = await open(page)
    await nav(page, 'Mission')
    const initial = (await read(page)).map.camera
    await page.getByLabel('Site name', { exact: true }).fill('Camp view')
    await page.getByRole('button', { name: 'Save current view' }).click()
    await page.getByRole('button', { name: 'Zoom in', exact: true }).first().click()
    await expect.poll(async () => (await read(page)).map.camera.zoom).toBeGreaterThan(initial.zoom)
    await page.getByRole('button', { name: 'Camp view', exact: true }).click()
    await expect.poll(async () => Math.abs((await read(page)).map.camera.zoom - initial.zoom)).toBeLessThan(0.01)
    await page.getByRole('button', { name: 'Toggle time control' }).click()
    await page.getByLabel('Time window end').fill('2026-06-01')
    await expect.poll(async () => (await read(page)).visibleFeatures).toBe(3)
    await page.getByRole('button', { name: 'Next frame', exact: true }).click()
    await expect.poll(async () => (await read(page)).visibleFeatures).toBe(4)
    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await expect.poll(async () => (await read(page)).visibleFeatures).toBeGreaterThan(4)
    await page.getByRole('button', { name: 'Pause', exact: true }).click()
    expect(errors).toEqual([])
  })
  test('reports a failed raster connection and keeps vector data available', async ({ page }) => {
    await page.route('https://raster-failure.invalid/**', (r) => r.fulfill({ status: 503, body: 'unavailable' }))
    const errors = await open(page)
    await nav(page, 'Rasters')
    await page.getByLabel('Source type').selectOption('cog')
    await page.getByLabel('COG URL', { exact: true }).fill('https://example.invalid/dem.tif')
    await page.getByLabel('TiTiler service').fill('https://raster-failure.invalid')
    await page.getByRole('button', { name: 'Add raster', exact: true }).click()
    await expect(page.getByText(/Raster service returned 503/)).toBeVisible()
    expect((await read(page)).visibleFeatures).toBe(8)
    expect((await read(page)).map.sources.some((id) => id.startsWith('raster-src'))).toBe(false)
    expect(errors).toEqual([])
  })
})
test.describe('mission workbench mobile', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test('fits the screen and opens usable tools without replacing the map', async ({ page }) => {
    const errors = await open(page)
    const first = (await read(page)).map.sources
    await page.getByRole('button', { name: 'Show panel', exact: true }).click()
    await nav(page, 'Draw')
    await expect(page.getByRole('button', { name: 'Polygon', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect((await read(page)).map.sources).toEqual(first)
    await nav(page, 'Mission')
    const download = page.waitForEvent('download')
    await page
      .locator('[data-map-sidebar-wrapper]')
      .getByRole('button', { name: 'Export layer CSV', exact: true })
      .click()
    expect((await download).suggestedFilename()).toMatch(/\.csv$/)
    expect(errors).toEqual([])
  })
})
