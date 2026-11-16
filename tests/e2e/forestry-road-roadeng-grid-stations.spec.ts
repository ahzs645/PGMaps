import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import proj4 from 'proj4'
import { expect, test, type Page } from '@playwright/test'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { projectedCrsDefinition } from '../../src/lib/geo/projectedCrs'
import { alignmentLength } from '../../src/pages/dev-forestry-roads/engine'
import type { XY } from '../../src/pages/dev-forestry-roads/landXmlImport'
import { roadEngDesign } from '../../src/pages/dev-forestry-roads/roadEngExport'
import { ROADENG_FLAG_POINT_SET } from '../../src/pages/dev-forestry-roads/roadEngTerrain'
import { buildTer } from '../../src/pages/dev-forestry-roads/roadEngTerrain.testkit'
import type { Alignment, Coordinate } from '../../src/pages/dev-forestry-roads/types'
import { openWorkbench } from './road-workbench'
import { dismissExampleNoticeWhenShown, replaceSavedProjectWhenAsked } from './road-files'
import { choose } from './styled-select'

// A generated RoadEng project (never a Softree sample). Its terrain is a TIN of 25 posts 60 m apart
// in one corner of a long, thin survey: a strip of posts runs 1.2 km east from it, so the TIN covers
// a small share of its box. Its design's L-line starts at station 1+400, as Softree's GuardRail
// does, and carries no [PGMaps] section: the start station is RoadEng's own.
// The terrain is stated by its TIN's point spacing (Review, the terrain line), drawn and routed at
// sizes from the ground it covers, and the road's range fields take its station names.
const E0 = 515_000,
  N0 = 5_975_000
const utm10 = proj4('EPSG:4326', projectedCrsDefinition(26910)!)
const lonLat = (x: number, y: number) => utm10.inverse([E0 + x, N0 + y]) as Coordinate
const level = (i: number, j: number) => 800 + 6 * ((i * 7 + j * 13) % 5) + i
const posts: [number, number, number][] = []
const COLUMNS = 21,
  ROWS = 3
for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLUMNS; i++) posts.push([E0 + i * 60, N0 + j * 60, level(i, j)])
// A post 1.2 km north of the strip's west end stretches the box, where the TIN draws no triangle.
posts.push([E0, N0 + 1200, 900])
const at = (i: number, j: number) => j * COLUMNS + i
const triangles: [number, number, number][] = []
for (let j = 0; j < ROWS - 1; j++)
  for (let i = 0; i < COLUMNS - 1; i++)
    triangles.push([at(i, j), at(i, j + 1), at(i + 1, j)], [at(i + 1, j), at(i, j + 1), at(i + 1, j + 1)])
const terx = zipSync({
  'Terrain1.ter': buildTer({
    features: [{ name: 'Strip posts', points: posts, flags: ROADENG_FLAG_POINT_SET | 1, kind: 3 }],
    tin: { vertices: posts.map((_, k): [number, number] => [0, k]), triangles },
  }),
  'Terrain1.tlt': strToU8(['[main]', 'CoordSys=1|51|10010', ''].join('\r\n')),
})
const road: Alignment = {
  id: 'r',
  name: 'Strip spur',
  color: '#000000',
  points: [
    { id: 'a', coordinate: lonLat(30, 60), radiusM: 0 },
    { id: 'b', coordinate: lonLat(1150, 60), radiusM: 0 },
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
  stationing: { startStation: 1400, equations: [] },
}
const written = unzipSync(
  roadEngDesign(
    [
      {
        alignment: {
          ...road,
          vertical: [
            { id: 'v0', chainage: 0, elevation: 812, curveLength: 0 },
            { id: 'v1', chainage: alignmentLength(road), elevation: 830, curveLength: 0 },
          ],
        },
      },
    ],
    (c) => utm10.forward([...c]) as XY,
    { terrainName: 'Strip.terx' },
  ).bytes,
)
// RoadEng saving the design drops sections it does not know: [PGMaps] goes, the L-line's 1+400 stays.
const nativeDsn = strFromU8(written['Location1.dsn'], true).replace(/\[PGMaps\][\s\S]*?(?=\r?\n\[|$)/, '')
const dsnx = zipSync({ ...written, 'Location1.dsn': strToU8(nativeDsn, true) })

test.use({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', acceptDownloads: true })
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
async function setNumber(page: Page, label: string, value: number) {
  const field = page.getByLabel(label, { exact: true }).first()
  await field.scrollIntoViewIfNeeded()
  await field.fill(String(value))
  await field.press('Enter')
  await field.blur()
}
/** The active road of the project this browser autosaved: what the fields store. */
function savedRoad(page: Page) {
  return page.evaluate(
    () =>
      new Promise<Alignment | undefined>((resolve, reject) => {
        const request = indexedDB.open('pgmaps-forestry-roads-v1', 1)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const store = request.result.transaction('projects', 'readonly').objectStore('projects')
          const active = store.get('active')
          active.onsuccess = () => {
            const project = store.get(`project:${active.result}`)
            project.onsuccess = () => {
              const p = project.result as { activeAlignmentId: string; alignments: Alignment[] } | undefined
              resolve(p?.alignments.find((a) => a.id === p.activeAlignmentId))
            }
          }
        }
      }),
  )
}

test('a RoadEng TIN is stated by its point spacing, and the road’s range fields take its station names', async ({
  page,
}, info) => {
  await page.route('https://**', (route) => route.abort())
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await replaceSavedProjectWhenAsked(page)
  await dismissExampleNoticeWhenShown(page)
  const terrainPath = info.outputPath('Strip.terx'),
    designPath = info.outputPath('Strip spur.dsnx')
  await mkdir(dirname(terrainPath), { recursive: true })
  await writeFile(terrainPath, terx)
  await writeFile(designPath, dsnx)
  await openWorkbench(page, '/dev/forestry/road-design')
  await openFiles(page, [designPath, terrainPath])
  await expect(page.getByText(/and a [\d.]+ m grid over its box is kept to write it back/).first()).toBeVisible({
    timeout: 60_000,
  })

  // The terrain line and the RoadEng terrain summary: the TIN's spacing, the plan's pixels sized
  // from the ground it covers, drainage at half its median edge, and the grid kept over its box.
  await page.getByRole('tab', { name: 'Terrain', exact: true }).click()
  await expect(page.getByTestId('road-terrain-spacing')).toContainText(/TIN, 60 m median edge · plan drawn at ≈ \d/)
  const summary = page.getByTestId('road-roadeng-terrain-summary')
  const ground = summary.getByText("RoadEng's TIN, read at its facets", { exact: true })
  if (!(await ground.isVisible())) await summary.getByText('RoadEng terrain', { exact: true }).click()
  await expect(summary).toContainText(/Plan drawing\s*About \d+(\.\d)? m pixels over its ground/)
  await expect(summary).toContainText(/Drainage cell\s*30 m or coarser/)
  await expect(summary).toContainText(/Kept grid\s*\d+\.\d\d m cells over its box, \d+% holding ground/)
  await summary.screenshot({ path: info.outputPath('terrain-summary.png') })

  // Review states the TIN's point spacing, not the grid's cells.
  await page.getByRole('tab', { name: 'Review', exact: true }).click()
  await expect(
    page.getByText('Terrain is too coarse for earthworks: TIN, 60 m median point spacing', { exact: true }).first(),
  ).toBeVisible({ timeout: 60_000 })

  // The road starts at 1+400: a template range is typed and shown in its stations, stored in chainage.
  await page.getByRole('tab', { name: 'Engineering', exact: true }).first().click()
  await page.getByRole('button', { name: 'Add named template', exact: true }).click()
  await setNumber(page, 'Template left width (m)', 5)
  await page.getByRole('button', { name: 'Save template', exact: true }).click()
  await page.getByRole('button', { name: 'Assign selected template', exact: true }).click()
  const start = page.getByLabel('Assignment 1 start (station)', { exact: true })
  await expect(start).toBeVisible()
  expect(Number(await start.inputValue())).toBeGreaterThanOrEqual(1400)
  await setNumber(page, 'Assignment 1 start (station)', 1650)
  await setNumber(page, 'Assignment 1 end (station)', 1800)
  await expect(start).toHaveValue('1650')
  await expect(page.getByLabel('Assignment 1 end (station)', { exact: true })).toHaveValue('1800')
  await start.screenshot({ path: info.outputPath('assignment-stations.png') })
  // Stored as chainage: 250 and 400 m of file stations past 1+400, at the file's grid-to-road scale.
  await expect
    .poll(async () => {
      const a = await savedRoad(page)
      const scale = a?.stationing?.chainageScale ?? 1
      return a?.stationing?.startStation === 1400
        ? a.engineering?.assignments.map((x) =>
            [x.start / scale, x.end / scale].map((v) => Math.round(v * 1000) / 1000),
          )
        : null
    })
    .toEqual([[250, 400]])
})
