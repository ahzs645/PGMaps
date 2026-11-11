import { expect, test, type Page } from '@playwright/test'
import { expectSelected } from './styled-select'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { decode } from 'fast-png'

test.use({ serviceWorkers: 'block' })
test.setTimeout(180_000)

async function open(page: Page) {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.goto('/dev/forestry/thlb-impact')
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    await page.locator('[data-map-mobile-sheet-handle]').press('End')
  }
  await expect(page.getByRole('button', { name: 'Run synthetic example' })).toBeVisible()
}

async function bytes(download: import('@playwright/test').Download) {
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

test('runs the synthetic example, exports its ledgers, and protects stale results', async ({ page }, testInfo) => {
  await open(page)
  await page.locator('[data-thlb-demo]').click()
  await expect(page.getByRole('status').filter({ hasText: 'Analysis complete' })).toBeVisible({ timeout: 60_000 })
  const rows = page.locator('[data-thlb-results]')
  await expect(rows).toContainText('Example WHA A')
  await expect(rows).toContainText('2.50')
  await expect(rows).toContainText('Example WHA B')
  await expect(page.getByText('Assessment areas overlap.', { exact: false })).toBeVisible()
  // Inspect canvas pixels too: an empty map must not pass on sidebar text.
  await expect(page.locator('.maplibregl-canvas')).toBeVisible()
  await expect
    .poll(async () => {
      const png = decode(await page.locator('.maplibregl-canvas').screenshot())
      let green = 0,
        purple = 0
      for (let i = 0; i < png.data.length; i += png.channels) {
        const [r, g, b] = [png.data[i], png.data[i + 1], png.data[i + 2]]
        if (r < 180 && g > r + 20 && g > b) green++
        if (b > g + 30 && r > g + 10) purple++
      }
      return Math.min(green, purple)
    })
    .toBeGreaterThan(100)
  await page.screenshot({ path: testInfo.outputPath('thlb-impact.png'), fullPage: true })

  const [excel] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('[data-thlb-download="excel"]').click(),
  ])
  expect(excel.suggestedFilename()).toBe('SYNTHETIC_EXAMPLE_THLB.xlsx')
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(await bytes(excel))
  expect(book.getWorksheet('Combined union')!.getCell('H2').value).toBe(2.5)
  expect(book.getWorksheet('By assessment area')!.getCell('H3').value).toBe(0.5)

  const [geojson] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('[data-thlb-download="geojson"]').click(),
  ])
  const collection = JSON.parse((await bytes(geojson)).toString())
  expect(collection.features[0].properties.Synthetic_example).toBe(true)
  expect(
    collection.features.reduce(
      (sum: number, feature: GeoJSON.Feature) => sum + Number(feature.properties?.Known_THLB_ha),
      0,
    ),
  ).toBe(3)

  const [gdb] = await Promise.all([page.waitForEvent('download'), page.locator('[data-thlb-download="gdb"]').click()])
  const archive = await JSZip.loadAsync(await bytes(gdb))
  expect(
    Object.keys(archive.files).some(
      (name) => name.startsWith('SYNTHETIC_EXAMPLE_THLB.gdb/') && name.endsWith('.gdbtable'),
    ),
  ).toBe(true)

  await page.locator('[data-thlb-tab="settings"]').click()
  await page.getByLabel('Mature age threshold (assumption)').fill('120')
  await page.locator('[data-thlb-tab="results"]').click()
  await expect(page.getByText('Inputs or assumptions changed.', { exact: false })).toBeVisible()
  await expect(page.locator('[data-thlb-download="excel"]')).toBeDisabled()
  await page.locator('[data-thlb-run]').click()
  await expect(page.locator('[data-thlb-download="excel"]')).toBeEnabled()
})

const CRS = { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::3005' } }
const X = 1_210_000,
  Y = 960_000
function file(name: string, x: number, width: number, properties: Record<string, unknown>) {
  return {
    name,
    mimeType: 'application/geo+json',
    buffer: Buffer.from(
      JSON.stringify({
        type: 'FeatureCollection',
        crs: CRS,
        features: [
          {
            type: 'Feature',
            properties,
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [x, Y],
                  [x + width, Y],
                  [x + width, Y + 100],
                  [x, Y + 100],
                  [x, Y],
                ],
              ],
            },
          },
        ],
      }),
    ),
  }
}

test('imports real files through GDAL, gives official coverage precedence, and remounts after export', async ({
  page,
}) => {
  await open(page)
  await page.locator('[data-thlb-files="areas"]').setInputFiles(file('areas.geojson', X, 200, { AREA_ID: 'WHA-1' }))
  await expectSelected(page.locator('[data-thlb-entry="areas"] [data-select-trigger]').nth(1), 'AREA_ID', {
    timeout: 60_000,
  })
  await page
    .locator('[data-thlb-files="official"]')
    .setInputFiles(file('official.geojson', X, 100, { thlb_fact: 0.75, tsr_report_year: 2024 }))
  await expectSelected(page.locator('[data-thlb-entry="official"] [data-select-trigger]').nth(1), 'thlb_fact')
  await page.locator('[data-thlb-files="proxy"]').setInputFiles(file('proxy.geojson', X, 200, { pthlb_fact: 0.5 }))
  await expectSelected(page.locator('[data-thlb-entry="proxy"] [data-select-trigger]').nth(1), 'pthlb_fact')
  await page.locator('[data-thlb-tab="results"]').click()
  await page.locator('[data-thlb-run]').click()
  await expect(page.getByRole('status').filter({ hasText: 'Analysis complete' })).toBeVisible({ timeout: 60_000 })
  const row = page.locator('[data-thlb-results] tbody tr')
  await expect(row).toContainText('WHA-1')
  await expect(row.locator('td').nth(1)).toHaveText('0.75')
  await expect(row.locator('td').nth(2)).toHaveText('0.50')
  await expect(row.locator('td').nth(3)).toHaveText('1.25')

  const [gdb] = await Promise.all([page.waitForEvent('download'), page.locator('[data-thlb-download="gdb"]').click()])
  expect(gdb.suggestedFilename()).toBe('THLB_Impact.gdb.zip')
  await page.locator('[data-thlb-run]').click()
  await expect(page.getByRole('status').filter({ hasText: 'Analysis complete' })).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-thlb-results] tbody tr td').nth(3)).toHaveText('1.25')

  // No nearby THLB is a valid result; even its empty piece layers must export.
  await page.locator('[data-thlb-tab="inputs"]').click()
  await page.getByRole('button', { name: 'Remove areas.geojson', exact: true }).click()
  await page
    .locator('[data-thlb-files="areas"]')
    .setInputFiles(file('uncovered.geojson', X + 5000, 200, { AREA_ID: 'Uncovered' }))
  await expectSelected(page.locator('[data-thlb-entry="areas"] [data-select-trigger]').nth(1), 'AREA_ID')
  await page.locator('[data-thlb-tab="results"]').click()
  await page.locator('[data-thlb-run]').click()
  await expect(page.getByRole('status').filter({ hasText: 'Analysis complete' })).toBeVisible()
  await expect(page.locator('[data-thlb-results] tbody tr td').nth(3)).toHaveText('0.00')
  await expect(page.locator('[data-thlb-results] tbody tr td').nth(4)).toHaveText('2.00')
  const [uncoveredGdb] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('[data-thlb-download="gdb"]').click(),
  ])
  expect(uncoveredGdb.suggestedFilename()).toBe('THLB_Impact.gdb.zip')
})

test('keeps mobile results and exports reachable inside the sidebar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page)
  await page.locator('[data-thlb-demo]').click()
  await expect(page.getByRole('status').filter({ hasText: 'Analysis complete' })).toBeVisible()
  const exportButton = page.locator('[data-thlb-download="excel"]')
  await exportButton.scrollIntoViewIfNeeded()
  await expect(exportButton).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
