import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { ROADENG_FLAG_NOT_MODELLED, ROADENG_FLAG_POINT_SET } from '../../src/pages/dev-forestry-roads/roadEngTerrain'
import { buildTer, chunk, type SynthFeature } from '../../src/pages/dev-forestry-roads/roadEngTerrain.testkit'
import { openWorkbench } from './road-workbench'
import { chooseExport, dismissExampleNoticeWhenShown, replaceSavedProjectWhenAsked } from './road-files'
import { choose } from './styled-select'

// A generated RoadEng terrain (never a Softree sample): DEM posts in a TIN in UTM zone 10, a stream,
// a model contour and a schema chunk. Opened, it goes back to RoadEng as its own Terrain1.ter, byte
// for byte, while the file is in this browser; without it, the export writes the grid and says why.
const E0 = 515_000,
  N0 = 5_975_000
const posts: [number, number, number][] = []
for (let j = 0; j <= 10; j++) for (let i = 0; i <= 10; i++) posts.push([E0 + i * 20, N0 + j * 20, 800 + i])
const at = (i: number, j: number) => j * 11 + i
const triangles: [number, number, number][] = []
for (let j = 0; j < 10; j++)
  for (let i = 0; i < 10; i++)
    triangles.push([at(i, j), at(i, j + 1), at(i + 1, j)], [at(i + 1, j), at(i, j + 1), at(i + 1, j + 1)])
const features: SynthFeature[] = [
  { name: 'DEM posts', points: posts, flags: ROADENG_FLAG_POINT_SET | 1, kind: 3 },
  {
    name: 'Sml Stream',
    points: [
      [E0 + 30, N0, 803],
      [E0 + 40, N0 + 100, 804],
      [E0 + 50, N0 + 200, 805],
    ],
    flags: ROADENG_FLAG_NOT_MODELLED,
  },
  {
    name: 'CNTR805',
    points: [
      [E0 + 100, N0, 805],
      [E0 + 100, N0 + 200, 805],
    ],
    flags: ROADENG_FLAG_NOT_MODELLED,
    kind: 2,
  },
]
const ter = buildTer({
  features,
  tin: { vertices: posts.map((_, k): [number, number] => [0, k]), triangles },
  attributes: chunk(100, -1, strToU8('7000|1|0|4|General|General|0|0|Comment|Comment|0|0|0\n\0')),
})
const terx = zipSync({
  'Terrain1.ter': ter,
  'Terrain1.tlt': strToU8(
    ['[main]', 'CoordSys=1|51|10010', '[TerLayers]', 'Layer0=CNTR*,Contours from model,', ''].join('\r\n'),
  ),
})

test.use({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', acceptDownloads: true })
test.setTimeout(240_000)

async function open(page: Page, path: string) {
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open', exact: true }).first().click()
  await (await chooser).setFiles(path)
  const question = page.getByTestId('road-terrain-import-question')
  await expect(question).toBeVisible({ timeout: 60_000 })
  await choose(question.getByLabel('Vertical datum of the elevations', { exact: true }), {
    value: 'CGVD2013 (CGG2013), EPSG:6647; metres',
  })
  await question.getByText('Elevations are in metres').click()
  await question.getByRole('button', { name: 'Import', exact: true }).click()
}

/** Downloads the RoadEng project from the open Save & export dialog and returns its Terrain1.ter. */
async function exportedTer(page: Page) {
  const download = page.waitForEvent('download')
  await page
    .getByTestId('road-files-dialog')
    .getByRole('button', { name: 'Download RoadEng project', exact: true })
    .click()
  const file = await download
  const chunks: Buffer[] = []
  for await (const part of (await file.createReadStream())!) chunks.push(Buffer.from(part))
  const outer = unzipSync(new Uint8Array(Buffer.concat(chunks)))
  const inner = Object.entries(outer).find(([name]) => name.endsWith('.terx'))![1]
  return unzipSync(inner)['Terrain1.ter']
}

test('a RoadEng terrain goes back as its own Terrain1.ter, and the grid when its file is gone', async ({
  page,
}, info) => {
  await page.route('https://**', (route) => route.abort())
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await replaceSavedProjectWhenAsked(page)
  await dismissExampleNoticeWhenShown(page)
  const path = info.outputPath('Valley.terx')
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, terx)
  await openWorkbench(page, '/dev/forestry/road-design')
  await open(page, path)

  // The terrain summary names the TIN, the features and the file kept in this browser.
  await page.getByRole('tab', { name: 'Terrain', exact: true }).click()
  const summary = page.getByTestId('road-roadeng-terrain-summary')
  await expect(summary).toBeVisible({ timeout: 60_000 })
  await summary.getByText('RoadEng terrain', { exact: true }).click()
  await expect(summary).toContainText('200 triangles')
  await expect(summary).toContainText('3: 1 contour from the model, 1 point set, 1 stream')
  await expect(summary).toContainText('In this browser')
  await expect(summary).toContainText("RoadEng's own terrain file")

  // Save & export lists what goes back, and the file is the one read.
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await chooseExport(page, 'RoadEng project')
  const preview = page.getByTestId('road-files-dialog').frameLocator('iframe').first()
  await expect(preview.locator('body')).toContainText('What goes back to RoadEng', { timeout: 60_000 })
  await expect(preview.locator('[data-carry="unchanged"]')).toContainText("200 triangles of RoadEng's TIN")
  await expect(preview.locator('[data-carry="unchanged"]')).toContainText('1 stream')
  await expect(preview.locator('[data-carry="rewritten"]')).toContainText('Nothing is rewritten.')
  expect(Buffer.from(await exportedTer(page)).equals(Buffer.from(ter))).toBe(true)
  await page.keyboard.press('Escape')

  // Without the file in this browser the export writes the grid and says why; choosing the .terx
  // again restores it.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase('pgmaps-forestry-roads-files-v1')
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      }),
  )
  await page.reload()
  await page.getByRole('tab', { name: 'Terrain', exact: true }).click()
  await expect(summary).toBeVisible({ timeout: 60_000 })
  await summary.getByText('RoadEng terrain', { exact: true }).click()
  await expect(summary).toContainText('Not in this browser')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await chooseExport(page, 'RoadEng project')
  await expect(preview.locator('[data-carry="ground"]')).toContainText('not stored in this browser', {
    timeout: 60_000,
  })
  await expect(preview.locator('[data-carry="left-out"]')).toContainText("200 triangles of RoadEng's TIN")
  expect(Buffer.from(await exportedTer(page)).equals(Buffer.from(ter))).toBe(false)
  await page.keyboard.press('Escape')

  await summary.getByTestId('road-roadeng-terrain-file').setInputFiles(path)
  await expect(summary).toContainText('In this browser')
  await expect(summary.getByRole('status')).toContainText('now kept in this browser')
})
