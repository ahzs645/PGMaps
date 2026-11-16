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

// A generated RoadEng project (never a Softree sample): a road running 2.9 km diagonally across its
// box, on a TIN of posts 2 m apart surveyed only within 50 m of the road, as RoadEng surveys a
// corridor. Half the TIN's median edge is 1 m, and the box around the road and a 60 m buffer holds
// more than 4,194,304 cells of 1 m, so a flow grid over the box had to coarsen. Drainage now routes
// only the ground within the buffer of the road and keeps the TIN's 1 m.
const E0 = 515_000,
  N0 = 5_975_000
const utm10 = proj4('EPSG:4326', projectedCrsDefinition(26910)!)
const lonLat = (x: number, y: number) => utm10.inverse([E0 + x, N0 + y]) as Coordinate
const RUN = 2100,
  SPACING = 2,
  HALF_WIDTH = 50
const ground = (x: number, y: number) =>
  800 + 0.03 * x + 0.06 * y + 1.5 * Math.sin(x / 47) * Math.cos(y / 61) - 3 * Math.exp(-((x - y) ** 2) / 20_000)
const posts: [number, number, number][] = []
const postAt = new Map<string, number>()
const steps = Math.floor(RUN / SPACING)
for (let j = 0; j <= steps; j++)
  for (let i = 0; i <= steps; i++) {
    const x = i * SPACING,
      y = j * SPACING
    // Distance to the line y = x.
    if (Math.abs(x - y) / Math.SQRT2 > HALF_WIDTH) continue
    postAt.set(`${i},${j}`, posts.length)
    posts.push([E0 + x, N0 + y, Math.round(ground(x, y) * 1000) / 1000])
  }
const triangles: [number, number, number][] = []
for (let j = 0; j < steps; j++)
  for (let i = 0; i < steps; i++) {
    const a = postAt.get(`${i},${j}`),
      b = postAt.get(`${i + 1},${j}`),
      c = postAt.get(`${i},${j + 1}`),
      d = postAt.get(`${i + 1},${j + 1}`)
    if (a === undefined || b === undefined || c === undefined || d === undefined) continue
    triangles.push([a, c, b], [b, c, d])
  }
const terx = zipSync({
  'Terrain1.ter': buildTer({
    features: [{ name: 'Corridor posts', points: posts, flags: ROADENG_FLAG_POINT_SET | 1, kind: 3 }],
    tin: { vertices: posts.map((_, k): [number, number] => [0, k]), triangles },
  }),
  'Terrain1.tlt': strToU8(['[main]', 'CoordSys=1|51|10010', ''].join('\r\n')),
})
const road: Alignment = {
  id: 'r',
  name: 'Diagonal haul',
  color: '#000000',
  points: [
    { id: 'a', coordinate: lonLat(20, 20), radiusM: 0 },
    { id: 'b', coordinate: lonLat(RUN - 20, RUN - 20), radiusM: 0 },
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
const length = alignmentLength(road)
const written = unzipSync(
  roadEngDesign(
    [
      {
        alignment: {
          ...road,
          vertical: Array.from({ length: 11 }, (_, k) => {
            const t = k / 10,
              x = 20 + t * (RUN - 40)
            return { id: `v${k}`, chainage: t * length, elevation: ground(x, x) + 0.3, curveLength: 0 }
          }),
        },
      },
    ],
    (c) => utm10.forward([...c]) as XY,
    { terrainName: 'Corridor.terx' },
  ).bytes,
)
const dsnx = zipSync({ ...written, 'Location1.dsn': strToU8(strFromU8(written['Location1.dsn'], true), true) })

test.use({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })
test.setTimeout(300_000)

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
const count = (text: string) => Number(text.replace(/,/g, ''))

test('drainage routes a RoadEng corridor TIN at its own cell, not the cell its whole box would fit', async ({
  page,
}, info) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://**', (route) => route.abort())
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await replaceSavedProjectWhenAsked(page)
  await dismissExampleNoticeWhenShown(page)
  const terrainPath = info.outputPath('Corridor.terx'),
    designPath = info.outputPath('Diagonal haul.dsnx')
  await mkdir(dirname(terrainPath), { recursive: true })
  await writeFile(terrainPath, terx)
  await writeFile(designPath, dsnx)
  await openWorkbench(page, '/dev/forestry/road-design')
  await openFiles(page, [designPath, terrainPath])
  await expect(page.getByText(/and a [\d.]+ m grid over its box is kept to write it back/).first()).toBeVisible({
    timeout: 120_000,
  })

  // The RoadEng terrain summary gives the drainage cell: half the TIN's 2 m median edge.
  await page.getByRole('tab', { name: 'Terrain', exact: true }).click()
  const summary = page.getByTestId('road-roadeng-terrain-summary')
  const facets = summary.getByText("RoadEng's TIN, read at its facets", { exact: true })
  if (!(await facets.isVisible())) await summary.getByText('RoadEng terrain', { exact: true }).click()
  await expect(summary).toContainText(/Drainage cell\s*1\.0 m or coarser past 4,194,304 routed cells/)

  await choose(page.getByRole('combobox', { name: 'Road detail view', exact: true }), { label: 'Drainage' })
  const panel = page.getByTestId('road-drainage')
  const buffer = panel.getByLabel('Upslope buffer (m)', { exact: true })
  await buffer.fill('60')
  await buffer.press('Tab')
  await panel.getByRole('button', { name: 'Run drainage check', exact: true }).click()
  await expect(page.getByTestId('road-workspace-header').getByRole('status')).toContainText('Drainage:', {
    timeout: 180_000,
  })
  const cells = panel.getByTestId('road-drainage-cells')
  await expect(cells).toContainText(/cells routed at 1 m within 60 m of the road's catch lines/)
  const [, routed, box] = (await cells.textContent())!.match(/([\d,]+) cells routed .* of ([\d,]+) in the box/)!
  // The box would not fit the budget at 1 m; the cells along the road do, with room to spare.
  expect(count(box)).toBeGreaterThan(4_194_304)
  expect(count(routed)).toBeLessThan(count(box) / 3)
  await expect(panel).not.toContainText('was coarsened')
  await expect(panel.getByRole('region', { name: 'Cross-drain candidates', exact: true })).toBeVisible()
  await cells.scrollIntoViewIfNeeded()
  await panel.screenshot({ path: info.outputPath('drainage-corridor.png') })
  expect(errors).toEqual([])
})
