import { expect, test, type Page } from '@playwright/test'
import { writeArrayBuffer } from 'geotiff'
import proj4 from 'proj4'

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, hasTouch: true, actionTimeout: 15_000 })
test.setTimeout(180_000)

function tile(name: string, shift = 0) {
  const projection = proj4('EPSG:4326', '+proj=utm +zone=10 +datum=WGS84 +units=m +no_defs'),
    xy = projection.forward([-122.72, 53.89])
  const values = Array.from({ length: 32 * 32 }, (_, i) => 100 + Math.floor(i / 32))
  return {
    name,
    mimeType: 'image/tiff',
    buffer: Buffer.from(
      writeArrayBuffer(values, {
        width: 32,
        height: 32,
        BitsPerSample: [8],
        SampleFormat: [1],
        SamplesPerPixel: [1],
        ModelPixelScale: [20, 20, 0],
        ModelTiepoint: [0, 0, 0, xy[0] - 100 + shift, xy[1] + 500, 0],
        ProjectedCSTypeGeoKey: 32610,
        GTModelTypeGeoKey: 1,
        GTRasterTypeGeoKey: 1,
      }),
    ),
  }
}
async function mapBackgrounds(page: Page) {
  return page.evaluate(() => {
    const container = document.querySelector('[data-testid="road-plan-view"] .maplibregl-map'),
      key = container && Object.keys(container).find((k) => k.startsWith('__reactFiber$'))
    if (!container || !key) return []
    type Map = import('maplibre-gl').Map
    type Hook = { memoizedState?: { current?: Map } | Map; next?: Hook }
    type Fiber = { memoizedState?: Hook; return?: Fiber }
    let fiber = (container as unknown as Record<string, Fiber>)[key]
    for (let depth = 0; fiber && depth < 200; depth++, fiber = fiber.return!)
      for (let hook = fiber.memoizedState, n = 0; hook && n < 40; hook = hook.next, n++) {
        const value = hook.memoizedState,
          map = value && typeof value === 'object' && 'current' in value ? value.current : (value as Map | undefined)
        if (typeof map?.getTerrain !== 'function') continue
        return map
          .getStyle()
          .layers.filter((l) => l.id.startsWith('road-background-'))
          .map((l) => ({ id: l.id, visible: map.getLayoutProperty(l.id, 'visibility'), type: l.type }))
      }
    return []
  })
}
async function downloadJson(page: Page) {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save project JSON', exact: true }).click()
  const result = await pending,
    stream = await result.createReadStream(),
    chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
test('phone terrain preparation, independent imagery and survey evidence survive project export', async ({
  page,
}, info) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.goto('/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  const show = page.getByRole('button', { name: 'Show road controls', exact: true })
  if (await show.isVisible()) await show.click()
  await page
    .getByRole('tablist', { name: 'Road workflow', exact: true })
    .getByRole('tab', { name: 'Terrain', exact: true })
    .click()
  await page
    .getByLabel('Terrain mosaic files', { exact: true })
    .setInputFiles([tile('ground-a.tif'), tile('ground-b.tif', 400)])
  await expect(page.getByTestId('road-terrain-preparation')).toContainText('2 source records')
  await page.getByLabel('Import independent terrain background', { exact: true }).setInputFiles(tile('canopy.tif'))
  const backgrounds = page.getByTestId('road-terrain-backgrounds')
  await expect(backgrounds).toContainText('canopy.tif')
  await expect
    .poll(() => mapBackgrounds(page))
    .toEqual([expect.objectContaining({ visible: 'visible', type: 'raster' })])
  await backgrounds.getByLabel('canopy.tif opacity (%)', { exact: true }).fill('45')
  await backgrounds.getByRole('checkbox', { name: 'canopy.tif', exact: true }).uncheck()
  await expect.poll(() => mapBackgrounds(page)).toEqual([expect.objectContaining({ visible: 'none' })])
  await backgrounds.getByRole('checkbox', { name: 'canopy.tif', exact: true }).check()

  const survey = page.getByTestId('road-survey-field-book')
  await survey.getByRole('button', { name: 'Start at selected station ground', exact: true }).click()
  await page
    .getByRole('textbox',{name:'Traverse CSV (station, bearing°, horizontal m, grade %)', exact: true })
    .fill('station,bearing_deg,horizontal_m,grade_pct\nA,0,50,2\nB,90,50,-2')
  await page
    .getByRole('textbox',{name:'Side shots (id, station index, signed offset m, height difference m)', exact: true })
    .fill('left,0,-5,1')
  await survey.getByRole('button', { name: 'Reduce survey observations', exact: true }).click()
  await expect(survey).toContainText('3 stations · 100.00 m')
  await survey.getByRole('button', { name: 'Save field book to project', exact: true }).click()
  await expect(page.getByRole('combobox',{name:'Saved survey field books', exact: true})).toContainText('Survey 1')
  const csvPending = page.waitForEvent('download')
  await survey.getByRole('button', { name: 'Export survey CSV', exact: true }).click()
  expect((await csvPending).suggestedFilename()).toBe('survey-reduction.csv')
  await page.screenshot({ path: info.outputPath('terrain-survey-phone.png') })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1))
    .toBe(true)
  const hide = page.getByRole('button', { name: 'Hide road controls', exact: true })
  if (await hide.isVisible()) await hide.click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const exported = await downloadJson(page)
  expect(exported.terrain.preparation.operation).toBe('mosaic')
  expect(exported.terrain.preparation.sources).toHaveLength(2)
  expect(exported.terrain.backgrounds).toHaveLength(1)
  expect(exported.terrain.backgrounds[0].opacity).toBe(0.45)
  expect(exported.surveyBooks[0].input.legs).toHaveLength(2)
  expect(exported.surveyBooks[0].input.sideShots[0].offsetM).toBe(-5)
  expect(errors).toEqual([])
})
