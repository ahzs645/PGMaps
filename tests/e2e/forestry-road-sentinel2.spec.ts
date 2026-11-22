import { expect, test, type Page, type Route } from '@playwright/test'
import { writeArrayBuffer } from 'geotiff'
import { DEMO_BOUNDS } from '../../src/pages/dev-forestry-roads/terrain'
import { sceneWindow } from '../../src/lib/sentinel2/window'
import { choose } from './styled-select'

test.use({ serviceWorkers: 'block', actionTimeout: 20_000, viewport: { width: 1512, height: 982 } })
test.setTimeout(120_000)

const COGS = 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/test'
const EARLIER = 'S2B_10UEE_20190814_0_L2A',
  LATER = 'S2C_10UEE_20250820_0_L2A'

// The training example's terrain is the demo grid; the stubbed COGs cover its read window in UTM 10N
// at 40 m, so every request the page makes lands inside them.
const window = sceneWindow(
  [DEMO_BOUNDS[0] - 0.1, DEMO_BOUNDS[1] - 0.1, DEMO_BOUNDS[2] + 0.1, DEMO_BOUNDS[3] + 0.1],
  32610,
)
const PIXEL = 40
const width = Math.ceil((window.bbox[2] - window.bbox[0]) / PIXEL),
  height = Math.ceil((window.bbox[3] - window.bbox[1]) / PIXEL)

/** A one-strip GeoTIFF on the window, each pixel's bands from `pixel(column, row)`. */
function tiff(pixel: (column: number, row: number) => number[]) {
  const values: number[] = []
  for (let row = 0; row < height; row++)
    for (let column = 0; column < width; column++) values.push(...pixel(column, row))
  return Buffer.from(
    writeArrayBuffer(values, {
      width,
      height,
      ModelPixelScale: [PIXEL, PIXEL, 0],
      ModelTiepoint: [0, 0, 0, window.bbox[0], window.bbox[3], 0],
      ProjectedCSTypeGeoKey: 32610,
      GTModelTypeGeoKey: 1,
      GTRasterTypeGeoKey: 1,
    }) as ArrayBuffer,
  )
}

// The later scene has a cleared square in the middle of the window: red up, near infrared down.
const cleared = (column: number, row: number) =>
  Math.abs(column - width / 2) < width / 6 && Math.abs(row - height / 2) < height / 6
const files: Record<string, Buffer> = {
  [`${EARLIER}/TCI.tif`]: tiff(() => [40, 90, 40]),
  [`${LATER}/TCI.tif`]: tiff((c, r) => (cleared(c, r) ? [150, 130, 100] : [40, 90, 40])),
  [`${EARLIER}/B04.tif`]: tiff(() => [30]),
  [`${LATER}/B04.tif`]: tiff((c, r) => [cleared(c, r) ? 120 : 30]),
  [`${EARLIER}/B08.tif`]: tiff(() => [200]),
  [`${LATER}/B08.tif`]: tiff((c, r) => [cleared(c, r) ? 80 : 200]),
  [`${EARLIER}/SCL.tif`]: tiff(() => [4]),
  [`${LATER}/SCL.tif`]: tiff(() => [4]),
  // SWIR rises where the ground is cleared, so NBR and NDMI fall there.
  [`${EARLIER}/B11.tif`]: tiff(() => [100]),
  [`${LATER}/B11.tif`]: tiff((c, r) => [cleared(c, r) ? 150 : 100]),
  [`${EARLIER}/B12.tif`]: tiff(() => [80]),
  [`${LATER}/B12.tif`]: tiff((c, r) => [cleared(c, r) ? 120 : 80]),
}

const item = (id: string, datetime: string, cloud: number) => ({
  type: 'Feature',
  id,
  bbox: [-123.000291, 53.149869, -121.31968, 54.148095],
  properties: { datetime, 'eo:cloud_cover': cloud, 'proj:epsg': 32610, 'earthsearch:boa_offset_applied': true },
  assets: Object.fromEntries(
    [
      ['visual', 'TCI'],
      ['red', 'B04'],
      ['nir', 'B08'],
      ['scl', 'SCL'],
      ['swir16', 'B11'],
      ['swir22', 'B12'],
    ].map(([key, band]) => [
      key,
      { href: `${COGS}/${id}/${band}.tif`, 'raster:bands': [{ scale: 0.0001, offset: -0.1 }] },
    ]),
  ),
})

/** Serve the stubbed COGs by byte range, as S3 does: geotiff.js refuses a whole-file answer. */
function serveCog(route: Route) {
  const name = new URL(route.request().url()).pathname.split('/').slice(-2).join('/')
  const body = files[name]
  if (!body) return route.fulfill({ status: 404, body: '' })
  const cors = { 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes' }
  const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range ?? '')
  if (!range) return route.fulfill({ status: 200, headers: cors, body })
  const start = Number(range[1]),
    end = Math.min(body.length - 1, range[2] ? Number(range[2]) : body.length - 1)
  return route.fulfill({
    status: 206,
    headers: { ...cors, 'Content-Range': `bytes ${start}-${end}/${body.length}`, 'Content-Type': 'image/tiff' },
    body: body.subarray(start, end + 1),
  })
}

async function open(page: Page, search: { failing: boolean }, layout = 'ribbon') {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://s3.amazonaws.com/elevation-tiles-prod/**', (route) => route.abort())
  await page.route('https://datacube.services.geo.ca/**', (route) => route.abort())
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.route('https://earth-search.aws.element84.com/v1/search', (route) => {
    if (search.failing) return route.fulfill({ status: 503, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' })
    return route.fulfill({
      headers: { 'Access-Control-Allow-Origin': '*' },
      json: {
        type: 'FeatureCollection',
        features: [item(LATER, '2025-08-20T19:29:42Z', 12), item(EARLIER, '2019-08-14T19:29:40Z', 3)],
      },
    })
  })
  await page.route(`${COGS}/**`, serveCog)
  await page.goto(`/dev/forestry/road-design?interface=${layout}&example=training`)
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  return errors
}

async function toggleFromRibbon(page: Page) {
  const ribbon = page.getByRole('region', { name: 'Command ribbon' })
  await ribbon.getByRole('tablist', { name: 'Ribbon tabs' }).getByRole('tab', { name: 'View', exact: true }).click()
  const command = ribbon.getByRole('button', { name: 'Sentinel-2 imagery', exact: true })
  await command.click()
  return command
}

/** The plan map's own state: the imagery layer, its place in the stack and its credit. */
async function imagery(page: Page, camera?: { center: [number, number]; zoom: number }, layerId = 'road-sentinel2') {
  return page.evaluate(
    ({ camera, layerId }) => {
      const container = document.querySelector('[data-testid="road-plan-view"] .maplibregl-map')
      const key = container && Object.keys(container).find((name) => name.startsWith('__reactFiber$'))
      if (!container || !key) return null
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
          if (camera) map.jumpTo({ ...camera, pitch: 0, bearing: 0, roll: 0 })
          const ids = (map.getStyle().layers ?? []).map((layer) => layer.id)
          const source = map.getSource(layerId) as { attribution?: string; type?: string } | undefined
          return {
            layer: !!map.getLayer(layerId),
            quad: (source as { coordinates?: number[][] } | undefined)?.coordinates ?? null,
            regional: !!map.getLayer('road-regional-hillshade'),
            hrdem: !!map.getLayer('road-hrdem-relief'),
            type: source?.type ?? null,
            belowContours: ids.indexOf(layerId) >= 0 && ids.indexOf(layerId) < ids.indexOf('road-contours'),
            aboveHillshade: ids.indexOf(layerId) > ids.indexOf('road-terrain'),
            credit: source?.attribution ?? null,
            attribution:
              document.querySelector('[data-testid="road-plan-view"] .maplibregl-ctrl-attrib')?.textContent ?? '',
          }
        }
      }
      return null
    },
    { camera, layerId },
  )
}

test('Sentinel-2 imagery: the ribbon toggle adds the layer under the road, lists scenes and dates a clearing as an interval', async ({
  page,
}) => {
  const errors = await open(page, { failing: false })
  const command = await toggleFromRibbon(page)
  await expect(command).toHaveAttribute('aria-pressed', 'true')

  const panel = page.getByTestId('road-sentinel2-panel')
  const scenes = panel.getByRole('list', { name: 'Sentinel-2 scenes' })
  await expect(scenes.getByRole('listitem')).toHaveCount(2)
  await expect(scenes.getByRole('button', { pressed: true })).toContainText('2025-08-20')
  await expect(scenes.getByRole('button', { name: /2019-08-14.*clear 100%/ })).toBeVisible()

  await expect
    .poll(() => imagery(page))
    .toMatchObject({
      layer: true,
      type: 'image',
      belowContours: true,
      aboveHillshade: true,
      credit: 'Contains modified Copernicus Sentinel data 2025',
    })
  await expect
    .poll(async () => (await imagery(page))?.attribution)
    .toContain('Contains modified Copernicus Sentinel data 2025')

  // An older scene from the list replaces the picture.
  await scenes.getByRole('button', { name: /2019-08-14/ }).click()
  await expect.poll(async () => (await imagery(page))?.credit).toBe('Contains modified Copernicus Sentinel data 2019')

  await choose(panel.getByRole('combobox', { name: 'Sentinel-2 display' }), 'NDVI change')
  await expect(page.getByTestId('road-sentinel2-change')).toContainText(
    /Clearing on \d+(\.\d)? ha: first seen between 2019-08-14 and 2025-08-20 \(snow gap\) \(Sentinel-2\)/,
  )
  await expect
    .poll(async () => (await imagery(page))?.credit)
    .toBe('Contains modified Copernicus Sentinel data 2019, 2025')

  // dNBR reads the 20 m SWIR band onto the same window and dates the burn or clearing the same way.
  await choose(panel.getByRole('combobox', { name: 'Sentinel-2 display' }), 'dNBR (burn)')
  await expect(page.getByTestId('road-sentinel2-change')).toContainText(
    /Burned or cleared on \d+(\.\d)? ha: first seen between 2019-08-14 and 2025-08-20 \(snow gap\) \(Sentinel-2\)/,
  )

  // Off again from the same command: the layer and its credit leave the map.
  await command.click()
  await expect(command).toHaveAttribute('aria-pressed', 'false')
  await expect(panel).toBeHidden()
  await expect.poll(async () => (await imagery(page))?.layer).toBe(false)
  expect(errors).toEqual([])
})

test('Sentinel-2 area series: a drawn area charts the index through time, brackets the fall and draws its histogram', async ({
  page,
}) => {
  const errors = await open(page, { failing: false })
  await toggleFromRibbon(page)
  const panel = page.getByTestId('road-sentinel2-panel')
  await expect(panel.getByRole('list', { name: 'Sentinel-2 scenes' }).getByRole('listitem')).toHaveCount(2)
  await expect.poll(async () => (await imagery(page))?.layer).toBe(true)

  await panel.getByRole('button', { name: 'Draw area', exact: true }).click()
  const plan = (await page.getByTestId('road-plan-view').boundingBox())!
  // Left of the card in the plan's top-right corner, which widens while an area is drawn.
  const [cx, cy] = [plan.x + plan.width * 0.3, plan.y + plan.height * 0.6]
  for (const [dx, dy] of [
    [-40, -40],
    [40, -40],
    [40, 40],
    [-40, 40],
  ])
    await page.mouse.click(cx + dx, cy + dy)
  await expect(page.getByTestId('road-sentinel2-sketch-vertex')).toHaveCount(4)
  // The first point closes the area.
  await page.mouse.click(cx - 40, cy - 40)

  const area = page.getByTestId('road-sentinel2-area')
  await expect(area.getByTestId('road-sentinel2-area-name')).toContainText(/Drawn area · \d+(\.\d)? ha · NDVI/)
  await expect(area.getByRole('group', { name: /Mean NDVI over Drawn area in 2 clear scenes/ })).toBeVisible()
  await expect(area.getByTestId('road-sentinel2-series-drop')).toContainText(
    /NDVI fell \d\.\d\d: first seen between 2019-08-14 and 2025-08-20 \(snow gap\) \(Sentinel-2\)/,
  )
  // The selected (newest) scene's histogram: every clear pixel inside the area is cleared ground.
  const histogram = area.getByTestId('road-sentinel2-histogram')
  await expect(histogram.getByRole('img')).toHaveAttribute(
    'aria-label',
    /NDVI in Drawn area on 2025-08-20: [1-9]\d* pixels from -0\.40 to 1\.00; mean -0\.20/,
  )

  // The series follows the display's index.
  await choose(panel.getByRole('combobox', { name: 'Sentinel-2 display' }), 'NDMI')
  await expect(area.getByTestId('road-sentinel2-area-name')).toContainText('NDMI')
  await expect(area.getByTestId('road-sentinel2-series-drop')).toContainText(/NDMI fell \d\.\d\d: first seen between/)

  await area.getByRole('button', { name: 'Clear the Sentinel-2 area' }).click()
  await expect(area.getByRole('button', { name: 'Draw area', exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

test('Sentinel-2 imagery: a failed search states why and retries', async ({ page }) => {
  const search = { failing: true }
  await open(page, search)
  await toggleFromRibbon(page)
  const panel = page.getByTestId('road-sentinel2-panel')
  await expect(panel.getByRole('alert')).toContainText('The Sentinel-2 scene search failed (HTTP 503).')
  expect((await imagery(page))?.layer).toBe(false)
  search.failing = false
  await panel.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(panel.getByRole('list', { name: 'Sentinel-2 scenes' }).getByRole('listitem')).toHaveCount(2)
  await expect.poll(async () => (await imagery(page))?.layer).toBe(true)
})

/** Count rendered frames on which the imagery source is missing, from the first frame it is there. */
async function watchSource(page: Page, layerId = 'road-sentinel2') {
  await page.evaluate((layerId) => {
    const container = document.querySelector('[data-testid="road-plan-view"] .maplibregl-map')
    const key = container && Object.keys(container).find((name) => name.startsWith('__reactFiber$'))
    if (!container || !key) throw new Error('No plan map')
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
        const watch = { frames: 0, missing: 0, seen: false }
        ;(window as unknown as { __imageryWatch: typeof watch }).__imageryWatch = watch
        map.on('render', () => {
          const present = !!map.getSource(layerId) && !!map.getLayer(layerId)
          if (present) watch.seen = true
          if (!watch.seen) return
          watch.frames++
          if (!present) watch.missing++
        })
        return
      }
    }
    throw new Error('No plan map')
  }, layerId)
  return () =>
    page.evaluate(() => (window as unknown as { __imageryWatch: { frames: number; missing: number } }).__imageryWatch)
}

test('Sentinel follows the view as it moves: the picture stays through a pan, a pan inside the listed tiles makes no search, and it pauses below z12', async ({
  page,
}) => {
  const searches: number[][] = []
  page.on('request', (request) => {
    if (request.url().includes('earth-search') && request.method() === 'POST')
      searches.push(request.postDataJSON().bbox)
  })
  const errors = await open(page, { failing: false })
  await imagery(page, { center: [-122.71, 53.895], zoom: 10 })
  await toggleFromRibbon(page)
  const panel = page.getByTestId('road-sentinel2-panel')
  await expect(panel).toContainText('Zoom in to level 12')
  await page.waitForTimeout(1100)
  expect(searches).toHaveLength(0)
  await imagery(page, { center: [-122.71, 53.895], zoom: 14 })
  await expect.poll(() => imagery(page)).toMatchObject({ layer: true, regional: true, hrdem: true })
  expect(searches).toHaveLength(1)
  // The figures say what area they cover: the read window, larger than the view.
  await expect(panel.getByTestId('road-sentinel2-area-read')).toContainText(/area read: \d+(\.\d)? × \d+(\.\d)? km/)
  await expect(panel).not.toContainText('when you stop moving')
  const first = (await imagery(page))!.quad
  const watch = await watchSource(page)
  // A pan inside the read window reads nothing new: the same picture at the same corners.
  await imagery(page, { center: [-122.705, 53.896], zoom: 14 })
  await page.waitForTimeout(400)
  expect((await imagery(page))?.quad).toEqual(first)
  // A pan out of it reads a new window, and the listed scenes still hold it: no search.
  await imagery(page, { center: [-122.65, 53.94], zoom: 14 })
  await expect.poll(async () => (await imagery(page))?.quad).not.toEqual(first)
  // Back again: the earlier window, from the band cache.
  await imagery(page, { center: [-122.71, 53.895], zoom: 14 })
  await expect.poll(async () => (await imagery(page))?.quad).toEqual(first)
  expect(searches).toHaveLength(1)
  // The picked scene stayed the reviewer's through the pans.
  await expect(
    panel.getByRole('list', { name: 'Sentinel-2 scenes' }).getByRole('button', { pressed: true }),
  ).toContainText('2025-08-20')
  const watched = await watch()
  expect(watched.frames).toBeGreaterThan(0)
  expect(watched.missing).toBe(0)
  // Below z12 the layer is paused, a stated state rather than a movement.
  await imagery(page, { center: [-122.71, 53.895], zoom: 10 })
  await expect.poll(async () => (await imagery(page))?.layer).toBe(false)
  await expect(panel).toContainText('Zoom in to level 12')
  expect(searches).toHaveLength(1)
  expect(errors).toEqual([])
})

test('Wayback timeline respects its deployment flag and only requests the selected releases', async ({ page }) => {
  let catalogs = 0
  const tiles: string[] = []
  const headers = { 'Access-Control-Allow-Origin': '*' }
  await page.route('**/waybackconfig.json', (route) => {
    catalogs++
    if (catalogs === 1) return route.fulfill({ status: 503, headers })
    return route.fulfill({
      headers,
      json: Object.fromEntries(
        ['2016-01-06', '2019-06-12', '2024-08-21'].map((date, id) => [
          id,
          {
            itemTitle: `World Imagery (Wayback ${date})`,
            itemURL: `https://wayback.maptiles.arcgis.com/test/${id}/{level}/{row}/{col}`,
          },
        ]),
      ),
    })
  })
  await page.route('https://wayback.maptiles.arcgis.com/**', (route) => {
    const path = new URL(route.request().url()).pathname
    // Every release brings new imagery here, so the local list keeps all three.
    const tilemap = /\/tilemap\/(\d+)\//.exec(path)
    if (tilemap) return route.fulfill({ headers, json: { data: [1], select: [Number(tilemap[1])] } })
    tiles.push(path.split('/')[2])
    return route.fulfill({
      headers,
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
    })
  })
  const errors = await open(page, { failing: false })
  const settings = page.getByRole('button', { name: 'Map display settings', exact: true })
  await settings.click()
  const toggle = page.getByRole('checkbox', { name: 'Historical imagery timeline' })
  const layer = () => imagery(page, undefined, 'road-wayback')
  await expect.poll(async () => (await layer())?.layer).toBe(false)
  expect(catalogs).toBe(0)
  expect(tiles).toEqual([])
  const enabled = (process.env.VITE_ROAD_WAYBACK_TIMELINE ?? 'true') === 'true'
  if (enabled) await expect(toggle).not.toBeChecked()
  else {
    await expect(toggle).toHaveCount(0)
    await expect(page.getByRole('checkbox', { name: 'Sentinel-2 imagery' })).toBeVisible()
  }
  await page.getByRole('button', { name: 'Close map settings' }).click()
  const ribbon = page.getByRole('region', { name: 'Command ribbon' })
  await ribbon.getByRole('tab', { name: 'View', exact: true }).click()
  const command = ribbon.getByRole('button', { name: 'Historical imagery timeline', exact: true })
  if (enabled) await expect(command).toHaveAttribute('aria-pressed', 'false')
  else await expect(command).toHaveCount(0)
  await ribbon.getByRole('button', { name: 'Find tools' }).click()
  const finder = page.getByRole('dialog', { name: 'Find ribbon tools' })
  await finder.getByRole('combobox').fill('Historical imagery timeline')
  const result = finder.getByRole('option', { name: /Historical imagery timeline/ })
  if (!enabled) {
    await expect(result).toHaveCount(0)
    await page.keyboard.press('Escape')
    await ribbon.getByRole('button', { name: 'Customize ribbon', exact: true }).click()
    const customize = page.getByRole('complementary', { name: 'Customize ribbon' })
    await customize.getByRole('button', { name: 'Map layers', exact: true }).click()
    await expect(customize.getByText('Historical imagery timeline', { exact: true })).toHaveCount(0)
    await expect(customize.getByText('Sentinel-2 imagery', { exact: true })).toBeVisible()
    expect(catalogs).toBe(0)
    return
  }
  await result.click()
  await expect(command).toHaveAttribute('aria-pressed', 'true')
  const card = page.getByRole('region', { name: 'Historical imagery timeline' })
  await expect(card.getByRole('alert')).toContainText('503')
  await card.getByRole('button', { name: 'Retry Wayback catalog' }).click()
  const slider = card.getByRole('slider')
  await expect(slider).toHaveAttribute('aria-valuetext', '2024-08-21')
  await expect(card.getByTestId('road-wayback-count')).toHaveText('3 of 3')
  await expect.poll(() => tiles.includes('2')).toBe(true)
  await expect.poll(async () => (await layer())?.belowContours).toBe(true)
  await expect.poll(async () => (await layer())?.aboveHillshade).toBe(true)
  await slider.press('ArrowLeft')
  await expect.poll(() => tiles.includes('1')).toBe(true)
  await slider.press('Home')
  await expect(slider).toHaveAttribute('aria-valuetext', '2016-01-06')
  await expect.poll(() => tiles.includes('0')).toBe(true)
  await card.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(slider).toHaveAttribute('aria-valuetext', '2019-06-12')
  await card.getByRole('button', { name: 'Pause' }).click()
  await card.getByRole('button', { name: 'Close timeline' }).click()
  await expect.poll(async () => (await layer())?.layer).toBe(false)
  await settings.click()
  await expect(toggle).not.toBeChecked()
  await expect(command).toHaveAttribute('aria-pressed', 'false')
  await toggle.check()
  await expect(command).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(async () => (await layer())?.layer).toBe(true)
  await page.getByRole('checkbox', { name: 'Sentinel-2 imagery' }).check()
  await expect(toggle).not.toBeChecked()
  await expect.poll(async () => (await layer())?.layer).toBe(false)
  await expect(command).toHaveAttribute('aria-pressed', 'false')
  expect(catalogs).toBe(2)
  expect(errors).toEqual([])
})

test('Wayback lists only the releases that change the map centre and reads their capture dates', async ({ page }) => {
  test.skip((process.env.VITE_ROAD_WAYBACK_TIMELINE ?? 'true') !== 'true', 'Wayback is hidden in this deployment')
  const headers = { 'Access-Control-Allow-Origin': '*' }
  const releases = ['2016-01-06', '2019-06-12', '2019-11-20', '2024-08-21']
  // 2024 reuses the November 2019 imagery here; the other three are their own.
  const from: Record<string, number> = { 0: 0, 1: 1, 2: 2, 3: 2 }
  const captured: Record<string, number> = { 0: 20150801, 1: 20190515, 2: 20190901, 3: 20240701 }
  await page.route('**/waybackconfig.json', (route) =>
    route.fulfill({
      headers,
      json: Object.fromEntries(
        releases.map((date, id) => [
          id,
          {
            itemTitle: `World Imagery (Wayback ${date})`,
            itemURL: `https://wayback.maptiles.arcgis.com/test/${id}/{level}/{row}/{col}`,
            metadataLayerUrl: `https://metadata.maptiles.arcgis.com/test${id}/MapServer`,
          },
        ]),
      ),
    }),
  )
  await page.route('https://wayback.maptiles.arcgis.com/**', (route) => {
    const tilemap = /\/tilemap\/(\d+)\//.exec(new URL(route.request().url()).pathname)
    if (tilemap) return route.fulfill({ headers, json: { data: [1], select: [from[tilemap[1]]] } })
    return route.abort()
  })
  await page.route('https://metadata.maptiles.arcgis.com/**', (route) => {
    const id = /\/test(\d+)\//.exec(new URL(route.request().url()).pathname)![1]
    return route.fulfill({
      headers,
      json: {
        features: [{ attributes: { SRC_DATE: captured[id], SRC_RES: 0.3, SRC_ACC: 5, NICE_DESC: 'Test supplier' } }],
      },
    })
  })
  const errors = await open(page, { failing: false })
  await page.getByRole('button', { name: 'Map display settings', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Historical imagery timeline' }).check()
  await page.getByRole('button', { name: 'Close map settings' }).click()
  const card = page.getByRole('region', { name: 'Historical imagery timeline' })
  const slider = card.getByRole('slider')
  await expect(card.getByTestId('road-wayback-count')).toHaveText('3 of 4')
  // The newest release shows November 2019's imagery here, so the timeline stands on it.
  await expect(slider).toHaveAttribute('aria-valuetext', '2019-11-20')
  await expect(slider).toHaveAttribute('aria-valuemax', '2')
  await expect(card.getByTestId('road-wayback-captured')).toHaveText('Captured 2019-09-01 · 30 cm')
  await expect(card.getByTestId('road-wayback-captured')).toHaveAttribute('title', 'Test supplier')
  const only = card.getByRole('switch', { name: 'Only releases that change this spot' })
  await only.click()
  await expect(only).toHaveAttribute('aria-checked', 'false')
  await expect(slider).toHaveAttribute('aria-valuetext', '2024-08-21')
  await expect(slider).toHaveAttribute('aria-valuemax', '3')
  await expect(card.getByTestId('road-wayback-captured')).toHaveText('Captured 2024-07-01 · 30 cm')
  await only.click()
  await slider.press('Home')
  await expect(slider).toHaveAttribute('aria-valuetext', '2016-01-06')
  await expect(card.getByTestId('road-wayback-captured')).toHaveText('Captured 2015-08-01 · 30 cm')
  // A year on the axis opens it on its first release; its dates then select within it.
  await card.getByRole('button', { name: 'Show 2019', exact: true }).click()
  await expect(slider).toHaveAttribute('aria-valuetext', '2019-06-12')
  await expect(slider).toHaveAttribute('aria-valuemax', '1')
  await expect(card.getByTestId('road-wayback-year')).toHaveText('‹ All years')
  await card.getByRole('button', { name: 'Show 2019-11-20' }).click()
  await expect(slider).toHaveAttribute('aria-valuetext', '2019-11-20')
  await card.getByTestId('road-wayback-year').click()
  await expect(slider).toHaveAttribute('aria-valuemax', '2')
  await expect(slider).toHaveAttribute('aria-valuetext', '2019-11-20')
  // A year with one release is selected, not opened.
  await card.getByRole('button', { name: 'Show 2016', exact: true }).click()
  await expect(slider).toHaveAttribute('aria-valuetext', '2016-01-06')
  await expect(card.getByTestId('road-wayback-year')).toHaveCount(0)
  expect(errors).toEqual([])
})

for (const layout of ['guided', 'workbench', 'dashboard']) {
  test(`Wayback timeline runs along the bottom of the plan in ${layout}`, async ({ page }) => {
    const enabled = (process.env.VITE_ROAD_WAYBACK_TIMELINE ?? 'true') === 'true'
    let catalogs = 0
    await page.route('**/waybackconfig.json', (route) => {
      catalogs++
      return route.fulfill({
        json: {
          1: {
            itemTitle: 'World Imagery (Wayback 2024-08-21)',
            itemURL: 'https://wayback.maptiles.arcgis.com/test/1/{level}/{row}/{col}',
          },
        },
      })
    })
    await page.route('https://wayback.maptiles.arcgis.com/**', (route) => route.abort())
    const errors = await open(page, { failing: false }, layout)
    const plan = page.getByTestId('road-plan-view')
    const closedHeight = (await plan.boundingBox())!.height
    const settings = page.getByRole('button', { name: 'Map display settings', exact: true })
    if (layout === 'guided') {
      const guide = page.getByRole('region', { name: 'Road layout guide' })
      await guide.getByRole('tab', { name: 'View', exact: true }).click()
      const command = guide.getByRole('button', { name: 'Historical imagery timeline', exact: true })
      if (enabled) await command.click()
      else await expect(command).toHaveCount(0)
    }
    await settings.click()
    const checkbox = page.getByRole('checkbox', { name: 'Historical imagery timeline' })
    if (!enabled) {
      await expect(checkbox).toHaveCount(0)
      expect(catalogs).toBe(0)
      return
    }
    if (layout === 'guided') await expect(checkbox).toBeChecked()
    else await checkbox.check()
    await page.getByRole('button', { name: 'Close map settings' }).click()
    const timeline = page.getByRole('region', { name: 'Historical imagery timeline' })
    await expect(timeline.getByRole('slider')).toHaveAttribute('aria-valuetext', '2024-08-21')
    await expect(timeline.getByRole('button', { name: 'Close timeline' })).toBeInViewport()
    // On the map along its bottom edge, all the way across: the plan keeps its whole height.
    const map = (await plan.boundingBox())!
    const strip = (await timeline.locator('[data-map-timeline]').boundingBox())!
    expect(Math.abs(map.height - closedHeight)).toBeLessThan(2)
    expect(Math.abs(strip.width - (map.width - 20))).toBeLessThan(3)
    expect(map.y + map.height - (strip.y + strip.height)).toBeGreaterThan(0)
    expect(map.y + map.height - (strip.y + strip.height)).toBeLessThan(16)
    // The scale bar stacks above it.
    const scale = (await plan.locator('.road-map-scale').boundingBox())!
    expect(scale.y + scale.height).toBeLessThanOrEqual(strip.y + 1)
    expect(catalogs).toBe(1)
    expect(errors).toEqual([])
  })
}
