import JSZip from 'jszip'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { openWorkbench } from './road-workbench'
import { chooseExport } from './road-files'
import { choose } from './styled-select'

test.use({ serviceWorkers: 'block', actionTimeout: 15_000, viewport: { width: 1512, height: 982 } })
test.setTimeout(180_000)

async function prepare(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await openWorkbench(page, '/dev/forestry/road-design?example=training')
  await expect(page.getByRole('heading', { name: 'Forest road design', exact: true })).toBeVisible()
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await expect(page.getByTestId('road-profile-chart').locator('path[stroke="#a07845"]')).not.toHaveAttribute('d', '')
  return errors
}

async function download(page: Page, button: Locator) {
  const pending = page.waitForEvent('download')
  await button.click()
  const result = await pending
  const chunks: Buffer[] = []
  for await (const chunk of (await result.createReadStream())!) chunks.push(Buffer.from(chunk))
  return { name: result.suggestedFilename(), zip: await JSZip.loadAsync(Buffer.concat(chunks)) }
}
const names = (zip: JSZip) => Object.keys(zip.files).filter((name) => !zip.files[name].dir)

test('styled GIS exports carry the plan’s symbols, and an imported style replaces one', async ({ page }) => {
  const errors = await prepare(page)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const dialog = page.getByTestId('road-files-dialog')

  // The plain shapefile zip gains a style of each kind beside each layer.
  const shapefiles = await download(page, await chooseExport(page, 'Shapefile'))
  expect(names(shapefiles.zip)).toEqual(
    expect.arrayContaining([
      'road_centrelines.shp',
      'road_centrelines.qml',
      'road_centrelines.sld',
      'road_centrelines.lyrx',
      'road_culverts.qml',
    ]),
  )
  const roadQml = await shapefiles.zip.file('road_centrelines.qml')!.async('string')
  expect(roadQml).toContain('<renderer-v2')

  // The QGIS project: a .qgz, the data beside it, a .qml per layer and the sheet layouts.
  const qgis = await download(page, await chooseExport(page, 'QGIS project'))
  const qgisFiles = names(qgis.zip)
  expect(qgisFiles.some((name) => name.endsWith('.qgz'))).toBe(true)
  expect(qgisFiles).toEqual(
    expect.arrayContaining(['data/road_centrelines.shp', 'data/road_centrelines.qml', 'README.txt']),
  )
  expect(qgisFiles.filter((name) => name.startsWith('layouts/') && name.endsWith('.qpt'))).toHaveLength(4)

  const arcgis = await download(page, await chooseExport(page, 'ArcGIS Pro map'))
  const arcgisFiles = names(arcgis.zip)
  expect(arcgisFiles.some((name) => name.endsWith('.mapx'))).toBe(true)
  expect(arcgisFiles.some((name) => name.endsWith('.stylx'))).toBe(true)
  expect(arcgisFiles).toEqual(expect.arrayContaining(['road_centrelines.lyrx', 'data/road_centrelines.shp']))

  const web = await download(page, await chooseExport(page, 'Web map styles'))
  const style = JSON.parse(await web.zip.file('maplibre/style.json')!.async('string'))
  expect(style.version).toBe(8)
  expect(names(web.zip)).toEqual(expect.arrayContaining(['maplibre/sprite.png', 'maplibre/sprite@2x.json']))
  expect(names(web.zip).some((name) => name.startsWith('geolibre/') && name.endsWith('.geolibre'))).toBe(true)

  const library = await download(page, await chooseExport(page, 'Symbol library'))
  expect(names(library.zip).some((name) => name.endsWith('.stylx'))).toBe(true)
  expect(names(library.zip).some((name) => name.startsWith('qgis/') && name.endsWith('.xml'))).toBe(true)

  // Import the culvert style back from the exported QML, recoloured, and draw culverts with it.
  const culvertQml = (await shapefiles.zip.file('road_culverts.qml')!.async('string')).replaceAll(
    '2,132,199',
    '200,30,30',
  )
  await chooseExport(page, 'QGIS project')
  await dialog.getByRole('button', { name: 'Styles', exact: true }).click()
  const panel = dialog.getByTestId('road-style-library')
  await panel
    .getByLabel('Import a style file', { exact: true })
    .setInputFiles({ name: 'red-culvert.qml', mimeType: 'application/xml', buffer: Buffer.from(culvertQml) })
  await expect(panel.getByRole('list', { name: 'Symbols found in the file', exact: true })).toBeVisible()
  await panel.getByRole('button', { name: /^Save \d+ to library$/ }).click()
  await expect(panel.getByRole('list', { name: 'Saved styles', exact: true }).getByRole('listitem')).toHaveCount(1)
  // The first option is PGMaps' own symbol; the imported style follows it.
  await choose(panel.getByRole('combobox', { name: 'Style for Culverts', exact: true }), { index: 1 })

  const restyled = await download(page, await chooseExport(page, 'QGIS project'))
  const restyledCulverts = await restyled.zip.file('data/road_culverts.qml')!.async('string')
  expect(restyledCulverts).toContain('200,30,30')
  expect(await restyled.zip.file('README.txt')!.async('string')).toContain("browser's style library")
  expect(errors).toEqual([])
})
