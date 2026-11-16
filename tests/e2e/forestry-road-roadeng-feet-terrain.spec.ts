import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { ROADENG_FLAG_POINT_SET } from '../../src/pages/dev-forestry-roads/roadEngTerrain'
import { buildTer } from '../../src/pages/dev-forestry-roads/roadEngTerrain.testkit'
import { openWorkbench } from './road-workbench'
import { chooseExport, dismissExampleNoticeWhenShown, replaceSavedProjectWhenAsked } from './road-files'
import { choose } from './styled-select'

// A generated RoadEng terrain (never a Softree sample) made as Softree's feet tutorials are: posts
// 60 ft apart in a TIN on a local grid near (9,000 ft, 4,500 ft), its .tlt in feet and carrying
// RoadEng's default coordinate code, NAD83 / UTM zone 10N, which would put it on the equator.
const X0 = 9_000,
  Y0 = 4_500
const posts: [number, number, number][] = []
for (let j = 0; j <= 4; j++)
  for (let i = 0; i <= 4; i++) posts.push([X0 + i * 60, Y0 + j * 60, 4_000 + 5 * ((i * 7 + j * 13) % 5)])
const at = (i: number, j: number) => j * 5 + i
const triangles: [number, number, number][] = []
for (let j = 0; j < 4; j++)
  for (let i = 0; i < 4; i++)
    triangles.push([at(i, j), at(i, j + 1), at(i + 1, j)], [at(i + 1, j), at(i, j + 1), at(i + 1, j + 1)])
const tlt = ['[main]', 'CoordSys=1|51|10010', 'units=3048', '[TerLayers]', 'Layer0=CNTR*,Contours from model,', '']
const terx = zipSync({
  'Terrain1.ter': buildTer({
    features: [{ name: 'Bench posts', points: posts, flags: ROADENG_FLAG_POINT_SET | 1, kind: 3 }],
    tin: { vertices: posts.map((_, k): [number, number] => [0, k]), triangles },
  }),
  'Terrain1.tlt': strToU8(tlt.join('\r\n'), true),
})

test.use({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', acceptDownloads: true })
test.setTimeout(240_000)

async function openTerrain(page: Page, path: string) {
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open', exact: true }).first().click()
  await (await chooser).setFiles([path])
  const question = page.getByTestId('road-terrain-import-question')
  await expect(question).toBeVisible({ timeout: 60_000 })
  await choose(question.getByLabel('Vertical datum of the elevations', { exact: true }), {
    value: 'CGVD2013 (CGG2013), EPSG:6647; metres',
  })
  await question.getByText('Elevations are in metres').click()
  await question.getByRole('button', { name: 'Import', exact: true }).click()
}

test('a RoadEng terrain in feet opens in feet, off a coordinate code that does not fit it, and goes back as read', async ({
  page,
}, info) => {
  await page.route('https://**', (route) => route.abort())
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await replaceSavedProjectWhenAsked(page)
  await dismissExampleNoticeWhenShown(page)
  const path = info.outputPath('Bench.terx')
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, terx)
  await openWorkbench(page, '/dev/forestry/road-design')
  await openTerrain(page, path)

  // The code would put the grid at the equator, so the terrain is on the flat plane, and its posts
  // are 60 ft (18.3 m) apart, read in the feet its .tlt states.
  await expect(
    page
      .getByText(
        /Its terrain states EPSG:26910 \(RoadEng code 1\|51\|10010\), which would put its coordinates at 0\.\d\d° N, 127\.\d\d° W, outside where that system applies/,
      )
      .first(),
  ).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText(/read its facets \(median edge 18\.3 m\)/).first()).toBeVisible()

  // Unedited, RoadEng gets its own files back: the TIN in feet and the .tlt with its code and unit.
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await chooseExport(page, 'RoadEng project')
  const download = page.waitForEvent('download')
  await page
    .getByTestId('road-files-dialog')
    .getByRole('button', { name: 'Download RoadEng project', exact: true })
    .click()
  const chunks: Buffer[] = []
  for await (const part of (await (await download).createReadStream())!) chunks.push(Buffer.from(part))
  const outer = unzipSync(new Uint8Array(Buffer.concat(chunks)))
  const inner = unzipSync(Object.entries(outer).find(([name]) => name.endsWith('.terx'))![1])
  const original = unzipSync(terx)
  for (const name of ['Terrain1.ter', 'Terrain1.tlt'])
    expect(Buffer.from(inner[name]).equals(Buffer.from(original[name])), name).toBe(true)
})
