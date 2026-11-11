import { expect, test, type Page, type Route } from '@playwright/test'
import { writeArrayBuffer } from 'geotiff'
import { DEMO_BOUNDS } from '../../src/pages/dev-forestry-roads/terrain'
import { sceneWindow } from '../../src/pages/dev-forestry-roads/sentinel/window'
import { choose } from './styled-select'

test.use({ serviceWorkers: 'block', actionTimeout: 20_000, viewport: { width: 1512, height: 982 } })
test.setTimeout(120_000)

const COGS = 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/test'
const EARLIER = 'S2B_10UEE_20190814_0_L2A',
  LATER = 'S2C_10UEE_20250820_0_L2A'

// The training example's terrain is the demo grid; the stubbed COGs cover its read window in UTM 10N
// at 40 m, so every request the page makes lands inside them.
const window = sceneWindow(DEMO_BOUNDS, 32610)
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

async function open(page: Page, search: { failing: boolean }) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
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
  await page.goto('/dev/forestry/road-design?interface=ribbon&example=training')
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
async function imagery(page: Page) {
  return page.evaluate(() => {
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
        const ids = (map.getStyle().layers ?? []).map((layer) => layer.id)
        const source = map.getSource('road-sentinel2') as { attribution?: string; type?: string } | undefined
        return {
          layer: !!map.getLayer('road-sentinel2'),
          type: source?.type ?? null,
          belowContours:
            ids.indexOf('road-sentinel2') >= 0 && ids.indexOf('road-sentinel2') < ids.indexOf('road-contours'),
          aboveHillshade: ids.indexOf('road-sentinel2') > ids.indexOf('road-terrain'),
          credit: source?.attribution ?? null,
          attribution:
            document.querySelector('[data-testid="road-plan-view"] .maplibregl-ctrl-attrib')?.textContent ?? '',
        }
      }
    }
    return null
  })
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

  // Off again from the same command: the layer and its credit leave the map.
  await command.click()
  await expect(command).toHaveAttribute('aria-pressed', 'false')
  await expect(panel).toBeHidden()
  await expect.poll(async () => (await imagery(page))?.layer).toBe(false)
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
