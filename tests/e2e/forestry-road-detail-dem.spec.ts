import { expect, test } from '@playwright/test'
import { detailWindow, hrdemGeoTiff } from '../../src/pages/dev-forestry-roads/hrdem'
import { choose } from './styled-select'
import { BC_ROADS_SERVICE } from '../../src/pages/dev-forestry-roads/existingRoads'

test.use({ serviceWorkers: 'block', viewport: { width: 1512, height: 982 } })
test.setTimeout(120_000)

test('import prepares separate boxes without downloading; chosen 1 m terrain and optional local FSRs load on request', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('https://basemaps.cartocdn.com/**', (r) =>
    r.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.route('https://s3.amazonaws.com/elevation-tiles-prod/**', (r) => r.abort())
  await page.route('https://datacube.services.geo.ca/ows/**', (r) => r.abort())
  const point: [number, number] = [-122.72, 53.89]
  const window = detailWindow([point], 500)
  const tiff = Buffer.from(
    await hrdemGeoTiff({
      kind: 'terrain',
      id: 'test',
      name: 'NRCan fixture',
      epsg: 3979,
      width: window.width,
      height: window.height,
      origin: [window.bbox[0] + 0.5, window.bbox[3] - 0.5],
      pixelSize: [1, -1],
      values: Array(window.width * window.height).fill(712.25),
      sha256: 'a'.repeat(64),
      acquired: '',
      verticalReference: 'CGVD2013',
    }),
  )
  let searches = 0
  await page.route('https://datacube.services.geo.ca/stac/api/search*', (r) => {
    searches++
    return r.fulfill({
      json: {
        features: [
          {
            id: 'fixture',
            properties: { 'proj:epsg': 3979 },
            assets: {
              dtm: { href: 'https://canelevation-dem.s3.ca-central-1.amazonaws.com/hrdem-mosaic-1m/fixture.tif' },
            },
          },
        ],
      },
    })
  })
  await page.route('https://canelevation-dem.s3.ca-central-1.amazonaws.com/**', (r) => {
    const match = /bytes=(\d+)-(\d*)/.exec(r.request().headers().range ?? '')!
    const first = Number(match[1]),
      last = Math.min(tiff.length - 1, Number(match[2]) || tiff.length - 1)
    return r.fulfill({
      status: 206,
      headers: {
        'content-type': 'image/tiff',
        'content-range': `bytes ${first}-${last}/${tiff.length}`,
        'access-control-allow-origin': '*',
      },
      body: tiff.subarray(first, last + 1),
    })
  })
  const fsrRequests: URL[] = []
  await page.route(`${BC_ROADS_SERVICE}/query*`, (r) => {
    fsrRequests.push(new URL(r.request().url()))
    return r.fulfill({ json: { type: 'FeatureCollection', features: [] } })
  })
  await page.goto('/dev/forestry/road-design?interface=workbench&example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await page.getByRole('button', { name: 'Layers', exact: true }).last().click()
  const pending = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Add files', exact: true }).click()
  await (
    await pending
  ).setFiles({
    name: 'blocks-and-roads.geojson',
    mimeType: 'application/geo+json',
    buffer: Buffer.from(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { name: 'Test block' },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [point[0], point[1]],
                  [point[0] + 0.0002, point[1]],
                  [point[0] + 0.0002, point[1] + 0.0002],
                  [point[0], point[1]],
                ],
              ],
            },
          },
          {
            type: 'Feature',
            properties: { name: 'Test road' },
            geometry: { type: 'LineString', coordinates: [point, [point[0] + 0.001, point[1]]] },
          },
        ],
      }),
    ),
  })
  const imports = page.getByRole('dialog', { name: 'Import layers', exact: true })
  await expect(imports.getByLabel('Prepare 1 m DEM download boxes after import')).toBeChecked()
  await imports.getByRole('button', { name: 'Import layers', exact: true }).click()
  await expect(page.getByTestId('road-save-state')).toHaveAttribute('data-save', 'saved')
  expect(new URL(page.url()).searchParams.has('example')).toBe(false)
  const dialog = page.getByRole('dialog', { name: 'Load 1 m DEM', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('2 boxes')
  expect(searches).toBe(0)
  expect(fsrRequests).toHaveLength(0)
  await expect(dialog.getByLabel('Show nearby active FSR records (1 km)')).not.toBeChecked()
  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download boxes GeoJSON', exact: true }).click()
  const stream = await (await download).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  expect(JSON.parse(Buffer.concat(chunks).toString()).features).toHaveLength(2)
  await choose(dialog.getByRole('combobox', { name: 'Detailed DEM area' }), { label: 'Test block' })
  await dialog.getByLabel('Show nearby active FSR records (1 km)').check()
  await dialog.getByRole('button', { name: 'Load this area', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('road-plan-view')).toBeVisible()
  await expect.poll(() => searches).toBe(1)
  await expect.poll(() => fsrRequests.length).toBe(1)
  expect(fsrRequests[0].searchParams.get('where')).toContain("FILE_TYPE_CODE='B40'")
  await page.getByRole('tab', { name: 'Terrain', exact: true }).click()
  await expect(page.getByTestId('road-scenario-evidence')).toContainText('NRCan HRDEM')
  await expect(page.getByTestId('road-scenario-evidence')).toContainText('1.0 m cells')
  expect(errors).toEqual([])
})
