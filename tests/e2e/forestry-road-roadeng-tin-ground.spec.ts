import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import proj4 from 'proj4'
import { expect, test, type Page } from '@playwright/test'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { projectedCrsDefinition } from '../../src/lib/geo/projectedCrs'
import { alignmentLength } from '../../src/pages/dev-forestry-roads/engine'
import type { XY } from '../../src/pages/dev-forestry-roads/landXmlImport'
import { roadEngDesign } from '../../src/pages/dev-forestry-roads/roadEngExport'
import { ROADENG_FLAG_POINT_SET } from '../../src/pages/dev-forestry-roads/roadEngTerrain'
import { buildTer } from '../../src/pages/dev-forestry-roads/roadEngTerrain.testkit'
import type { Alignment, Coordinate } from '../../src/pages/dev-forestry-roads/types'
import { openWorkbench } from './road-workbench'
import { chooseExport, dismissExampleNoticeWhenShown, replaceSavedProjectWhenAsked } from './road-files'
import { choose } from './styled-select'

// A generated RoadEng project (never a Softree sample): a knoll of 25 posts 60 m apart in a TIN,
// uneven enough that a grid made from it cuts its facets down, and a road starting on one facet.
// Sections and the profile read the TIN at that facet; a grid over its box is kept to write it back.
const E0 = 515_000,
  N0 = 5_975_000
const utm10 = proj4('EPSG:4326', projectedCrsDefinition(26910)!)
const lonLat = (x: number, y: number) => utm10.inverse([E0 + x, N0 + y]) as Coordinate
const level = (i: number, j: number) => 800 + 6 * ((i * 7 + j * 13) % 5)
const posts: [number, number, number][] = []
for (let j = 0; j <= 4; j++) for (let i = 0; i <= 4; i++) posts.push([E0 + i * 60, N0 + j * 60, level(i, j)])
const at = (i: number, j: number) => j * 5 + i
const triangles: [number, number, number][] = []
for (let j = 0; j < 4; j++)
  for (let i = 0; i < 4; i++)
    triangles.push([at(i, j), at(i, j + 1), at(i + 1, j)], [at(i + 1, j), at(i, j + 1), at(i + 1, j + 1)])
const terx = zipSync({
  'Terrain1.ter': buildTer({
    features: [{ name: 'Knoll posts', points: posts, flags: ROADENG_FLAG_POINT_SET | 1, kind: 3 }],
    tin: { vertices: posts.map((_, k): [number, number] => [0, k]), triangles },
  }),
  'Terrain1.tlt': strToU8(['[main]', 'CoordSys=1|51|10010', ''].join('\r\n')),
})
// The road starts 15 m east and 10 m north of post (1, 1), on the facet through posts (1, 1), (1, 2)
// and (2, 1): the plane there is level(1,1) + (level(1,2) − level(1,1)) / 6 + (level(2,1) − level(1,1)) / 4.
const facetAtStart = level(1, 1) + (level(1, 2) - level(1, 1)) / 6 + (level(2, 1) - level(1, 1)) / 4
const road: Alignment = {
  id: 'r',
  name: 'Knoll spur',
  color: '#000000',
  points: [
    { id: 'a', coordinate: lonLat(75, 70), radiusM: 0 },
    { id: 'b', coordinate: lonLat(200, 190), radiusM: 0 },
  ],
  vertical: [],
  template: {
    leftWidth: 3,
    rightWidth: 3,
    crossfallPercent: 3,
    cutSlope: 0.75,
    fillSlope: 1.5,
    ditchWidth: 1,
    ditchDepth: 0.5,
    surfaceDepth: 0.25,
  },
  overrides: [],
}
const dsnx = roadEngDesign(
  [
    {
      alignment: {
        ...road,
        vertical: [
          { id: 'v0', chainage: 0, elevation: 806, curveLength: 0 },
          { id: 'v1', chainage: alignmentLength(road), elevation: 810, curveLength: 0 },
        ],
      },
    },
  ],
  (c) => utm10.forward([...c]) as XY,
  { terrainName: 'Knoll.terx' },
).bytes

test.use({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', acceptDownloads: true })
test.setTimeout(240_000)

async function openFiles(page: Page, paths: string[]) {
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open', exact: true }).first().click()
  await (await chooser).setFiles(paths)
  const question = page.getByTestId('road-terrain-import-question')
  await expect(question).toBeVisible({ timeout: 60_000 })
  await choose(question.getByLabel('Vertical datum of the elevations', { exact: true }), {
    value: 'CGVD2013 (CGG2013), EPSG:6647; metres',
  })
  await question.getByText('Elevations are in metres').click()
  await question.getByRole('button', { name: 'Import', exact: true }).click()
}

/** The terrain line and the RoadEng terrain summary say the TIN is the ground read. */
async function expectTinGround(page: Page) {
  await page.getByRole('tab', { name: 'Terrain', exact: true }).click()
  await expect(page.getByTestId('road-terrain-spacing')).toContainText('TIN, 60 m median edge · plan drawn at ≈', {
    timeout: 60_000,
  })
  const summary = page.getByTestId('road-roadeng-terrain-summary')
  const ground = summary.getByText("RoadEng's TIN, read at its facets", { exact: true })
  if (!(await ground.isVisible())) await summary.getByText('RoadEng terrain', { exact: true }).click()
  await expect(ground).toBeVisible()
  await expect(summary).toContainText('Median edge 60 m over 6 ha')
  await expect(summary).toContainText(/Kept grid\s*\d+\.\d\d m cells over its box, \d+% holding ground/)
  // The section at station 0 reads the facet under the road, to the centimetre.
  await expect(page.getByTestId('road-section-readout')).toContainText(`Grd Z:${facetAtStart.toFixed(2)}`)
}

test('a RoadEng terrain is read at its TIN facets, kept through a reload and written back as read', async ({
  page,
}, info) => {
  await page.route('https://**', (route) => route.abort())
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await replaceSavedProjectWhenAsked(page)
  await dismissExampleNoticeWhenShown(page)
  const terrainPath = info.outputPath('Knoll.terx'),
    designPath = info.outputPath('Knoll spur.dsnx')
  await mkdir(dirname(terrainPath), { recursive: true })
  await writeFile(terrainPath, terx)
  await writeFile(designPath, dsnx)
  await openWorkbench(page, '/dev/forestry/road-design')
  await openFiles(page, [designPath, terrainPath])
  const opened = page
    .getByText(/read its facets \(median edge 60\.0 m\), and a [\d.]+ m grid over its box is kept/)
    .first()
  await expect(opened).toBeVisible({ timeout: 60_000 })
  await expectTinGround(page)

  // Keeping the TIN changes nothing RoadEng gets back: its Terrain1.ter goes back byte for byte.
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
  const inner = Object.entries(outer).find(([name]) => name.endsWith('.terx'))![1]
  expect(Buffer.from(unzipSync(inner)['Terrain1.ter']).equals(Buffer.from(unzipSync(terx)['Terrain1.ter']))).toBe(true)
  await page.keyboard.press('Escape')

  // The project in this browser keeps the TIN: reopened, the ground is still its facets.
  await expect(page.getByText(/^Saved \d{1,2}:\d{2}/).first()).toBeVisible({ timeout: 60_000 })
  await page.reload()
  await expectTinGround(page)
})
