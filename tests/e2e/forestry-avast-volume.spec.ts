import { expect, test, type Page } from '@playwright/test'
import { encode } from 'fast-png'
import JSZip from 'jszip'
import ExcelJS from 'exceljs'

test.use({ serviceWorkers: 'block' })
test.setTimeout(180_000)

// Terrarium tiles that decode to one flat elevation: every cell is 0% slope.
const flat = new Uint8Array(256 * 256 * 3)
for (let index = 0; index < flat.length; index += 3) {
  flat[index] = 131
  flat[index + 1] = 32
}
const FLAT_TILE = Buffer.from(encode({ width: 256, height: 256, data: flat, channels: 3 }))

async function stubNetwork(page: Page) {
  await page.route('https://basemaps.cartocdn.com/**', (route) => route.fulfill({ json: { version: 8, sources: {}, layers: [] } }))
  await page.route('**/elevation-tiles-prod/terrarium/**', (route) => route.fulfill({ contentType: 'image/png', body: FLAT_TILE }))
}

const CRS = { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::3005' } }
const square = (x: number, y: number, width: number, height: number) => ({
  type: 'Polygon',
  coordinates: [[[x, y], [x + width, y], [x + width, y + height], [x, y + height], [x, y]]],
})
const X = 1_210_000
const Y = 960_000

// TB1: 2 ha, half on 200 m³/ha and half on 100 m³/ha AVAST → 300 m³.
// TB2: 1 ha with no AVAST under it.
const BLOCKS = {
  type: 'FeatureCollection', crs: CRS,
  features: [
    { type: 'Feature', properties: { BLOCK_ID: 'TB1', OPERATING_: 'Test Lake', MERCH_AREA: 2 }, geometry: square(X, Y, 200, 100) },
    { type: 'Feature', properties: { BLOCK_ID: 'TB2', OPERATING_: 'Test Lake', MERCH_AREA: 1 }, geometry: square(X + 5000, Y, 100, 100) },
  ],
}
const AVAST = {
  type: 'FeatureCollection', crs: CRS,
  features: [
    { type: 'Feature', properties: { CMM_m3ha: 200, Avg_Slope: 10, OPERATING_AREA: 'Test Lake' }, geometry: square(X - 100, Y - 100, 200, 300) },
    { type: 'Feature', properties: { CMM_m3ha: 100, Avg_Slope: 50, OPERATING_AREA: 'Test Lake' }, geometry: square(X + 100, Y - 100, 300, 300) },
  ],
}

const json = (name: string, value: unknown) => ({ name, mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify(value)) })

test('runs the AVAST procedure on dropped files and exports the workbook and geodatabase', async ({ page }) => {
  await stubNetwork(page)
  await page.goto('/dev/forestry/avast-volume')
  await page.locator('[data-avast-files="candidates"]').setInputFiles([json('Test_blocks.geojson', BLOCKS)])
  await page.locator('[data-avast-files="avast"]').setInputFiles([json('TimberAnalysis_Base.geojson', AVAST)])
  await expect(page.locator('[data-avast-candidates]')).toHaveAttribute('data-avast-candidates', '2', { timeout: 60_000 })
  await expect(page.locator('[data-avast-input="avast"] select').first()).toHaveValue('CMM_m3ha')

  await page.locator('[data-avast-tab="results"]').click()
  await page.locator('[data-avast-run]').click()
  await expect(page.locator('[data-avast-run]')).toHaveText(/Run again/, { timeout: 90_000 })
  const results = page.locator('#avast-steps-panel-results')
  await expect(results).toContainText('300 m³')
  await expect(results).toContainText('Volume on <35%')
  await expect(results).toContainText('TB2')

  const [workbookDownload] = await Promise.all([page.waitForEvent('download'), page.locator('[data-avast-download="excel"]').click()])
  expect(workbookDownload.suggestedFilename()).toBe('Test_Volume_Summary_All_Blocks.xlsx')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await streamToBuffer(await workbookDownload.createReadStream()))
  const inputs = workbook.getWorksheet('Block Volume Inputs')!
  expect(inputs.getCell('B6').value).toBe('TB1')
  expect(inputs.getCell('F6').value).toBeCloseTo(300, 6)
  expect(inputs.getCell('E6').value).toBe(150)
  expect(String(inputs.getCell('I7').value)).toContain('Little/no AVAST coverage')

  const [gdbDownload] = await Promise.all([page.waitForEvent('download'), page.locator('[data-avast-download="gdb"]').click()])
  expect(gdbDownload.suggestedFilename()).toBe('Test_AVAST_Volume.gdb.zip')
  const zip = await JSZip.loadAsync(await streamToBuffer(await gdbDownload.createReadStream()))
  const entries = Object.keys(zip.files)
  expect(entries.some((name) => name.startsWith('Test_AVAST_Volume.gdb/') && name.endsWith('.gdbtable'))).toBe(true)
})

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer))
  return Buffer.concat(chunks)
}
