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
import { chooseExport, dismissExampleNoticeWhenShown, replaceSavedProjectWhenAsked } from './road-files'
import { choose } from './styled-select'

// A generated RoadEng project (never a Softree sample), costed the way RoadEng costs one: a TIN
// knoll, a road whose grade runs above it so it is all fill, no pits, two ground types with their own
// embankment cost and swell, and a stored costing. The road reads with the economic material plan
// and RoadEng's pit of last resort, its fill comes from underflow at the road's start and is priced
// per bank m³ of the material placed, and an edit to that rate goes back to that ground type alone.
const E0 = 515_000,
  N0 = 5_975_000
const utm10 = proj4('EPSG:4326', projectedCrsDefinition(26910)!)
const lonLat = (x: number, y: number) => utm10.inverse([E0 + x, N0 + y]) as Coordinate
const posts: [number, number, number][] = []
for (let j = 0; j <= 4; j++)
  for (let i = 0; i <= 4; i++) posts.push([E0 + i * 60, N0 + j * 60, 800 + 6 * ((i * 7 + j * 13) % 5)])
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
const road: Alignment = {
  id: 'r',
  name: 'Fill spur',
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
    ditchWidth: 0,
    ditchDepth: 0,
    surfaceDepth: 0,
  },
  overrides: [],
}
const written = roadEngDesign(
  [
    {
      alignment: {
        ...road,
        vertical: [
          // A PVI inside the road, so RoadEng's file carries a design profile.
          { id: 'v0', chainage: 0, elevation: 830, curveLength: 0 },
          { id: 'v1', chainage: alignmentLength(road) / 2, elevation: 831, curveLength: 0 },
          { id: 'v2', chainage: alignmentLength(road), elevation: 832, curveLength: 0 },
        ],
      },
    },
  ],
  (c) => utm10.forward([...c]) as XY,
  { terrainName: 'Fill spur.terx' },
)
// Two ground types: OB places fill at 6 per bank m³ and swells 1 bank m³ to 1.25 compacted (fill
// expansion 0.8); GR at 3 with no swell. The design stores a costing of its vertical alignment.
const GROUND = [
  '104,OB,Overburden (Default),100,400,1,0.8,12,6,0,8,0.6,4,2.6,2,0,0,0,0,',
  '104,GR,Gravel,66.67,66.67,1,1,12,3,0,8,0.6,4,2.6,2,2,0,0,0,',
]
const parts = unzipSync(written.bytes)
const ds2 = strFromU8(parts['Location1.ds2'], true)
const rows = ds2.split('\r\n').filter((l) => !l.startsWith('104,'))
rows.splice(
  rows.findIndex((l) => l.startsWith('110,')),
  0,
  ...GROUND,
)
parts['Location1.ds2'] = strToU8(rows.join('\r\n'), true)
const stations = ds2
  .split(/\r?\n/)
  .filter((l) => l.startsWith('110,'))
  .map((l) => Number(l.split(',')[5]))
const dsn = strFromU8(parts['Location1.dsn'], true)
parts['Location1.dsn'] = strToU8(
  `${dsn.replace(/\r\n$/, '')}\r\n[OptAlignCost-0]\r\nOptParms_CostSolution_v3=2,0,0,${stations[0]},${stations[stations.length - 1]},500,9000,700,0,0,0.5,1716396832,-1,1\r\n`,
  true,
)
const dsnx = zipSync(parts)

test.use({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', acceptDownloads: true })
test.setTimeout(240_000)

async function download(page: Page, label: string): Promise<Uint8Array> {
  await expect(async () => {
    if (!(await page.getByTestId('road-files-dialog').isVisible()))
      await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByTestId('road-files-dialog')).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 60_000 })
  const button = await chooseExport(page, label)
  const pending = page.waitForEvent('download')
  await button.click()
  const file = await pending
  const chunks: Buffer[] = []
  for await (const part of (await file.createReadStream())!) chunks.push(Buffer.from(part))
  await page.keyboard.press('Escape')
  return new Uint8Array(Buffer.concat(chunks))
}

const groundTypes = (bytes: Uint8Array) =>
  strFromU8(unzipSync(bytes)['Location1.ds2'], true)
    .split(/\r?\n/)
    .filter((l) => l.startsWith('104,'))
    .map((l) => l.split(','))

test("a RoadEng design costs its haul as RoadEng does, and its fill by each ground type's embankment cost", async ({
  page,
}, info) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://**', (route) => route.abort())
  await replaceSavedProjectWhenAsked(page)
  await dismissExampleNoticeWhenShown(page)
  const terrainPath = info.outputPath('Fill spur.terx'),
    designPath = info.outputPath('Fill spur.dsnx')
  await mkdir(dirname(terrainPath), { recursive: true })
  await writeFile(terrainPath, terx)
  await writeFile(designPath, dsnx)
  await openWorkbench(page, '/dev/forestry/road-design')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open', exact: true }).first().click()
  await (await chooser).setFiles([designPath, terrainPath])
  const question = page.getByTestId('road-terrain-import-question')
  await expect(question).toBeVisible({ timeout: 60_000 })
  await choose(question.getByLabel('Vertical datum of the elevations', { exact: true }), {
    value: 'CGVD2013 (CGG2013), EPSG:6647; metres',
  })
  await question.getByText('Elevations are in metres').click()
  await question.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(page.getByText(/Material is allocated by the economic plan/).first()).toBeAttached({ timeout: 60_000 })
  await expect(
    page.getByText(/Overflow and underflow: material no pit, cut or sidecast can take or give/).first(),
  ).toBeAttached()
  await expect(page.getByText(/OB 6, GR 3 per m³\) is its material's fill rate/).first()).toBeAttached()

  // Haul & cost settings: the economic plan, and the pit of last resort on.
  await page.getByRole('tab', { name: 'Engineering', exact: true }).first().click()
  await page.getByRole('tab', { name: 'Haul', exact: true }).first().click()
  await page.getByRole('button', { name: 'Haul & cost settings', exact: true }).click()
  const costs = page.getByRole('dialog', { name: 'Haul & cost settings' })
  const lastResort = costs.getByTestId('road-haul-last-resort')
  await lastResort.scrollIntoViewIfNeeded()
  await expect(lastResort).toBeChecked()
  await expect(costs.getByText('Overflow free; underflow at each material’s excavation rate.')).toBeVisible()
  await expect(costs.getByText('Economic material flow', { exact: true }).first()).toBeVisible()
  await page.screenshot({ path: info.outputPath('haul-settings.png'), animations: 'disabled' })
  await costs.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(costs).toBeHidden()

  // Each material places fill at its ground type's embankment cost, per bank m³.
  await page.getByRole('tab', { name: 'Ground', exact: true }).first().click()
  const placement = page.getByTestId('road-material-placement-rate').first()
  await placement.scrollIntoViewIfNeeded()
  const field = placement.getByRole('spinbutton').or(placement.getByRole('textbox')).first()
  await expect(field).toHaveValue('6')
  await expect(placement).toContainText('$4.80/compacted m³ placed.')
  await page.screenshot({ path: info.outputPath('material-fill-rate.png'), animations: 'disabled' })

  // The road is all fill and there is no pit: the economic plan takes it from underflow at the road's
  // start, and the covered estimate prices it per bank m³ of the material placed.
  await page.getByRole('button', { name: 'Show how the covered estimate is calculated', exact: true }).click()
  const estimate = page.getByRole('dialog', { name: 'Covered estimate', exact: true })
  await expect(estimate.getByText(/^Fill placement · /).first()).toBeVisible({ timeout: 60_000 })
  await expect(estimate).toContainText('$/bank m³')
  await expect(estimate).toContainText('Borrow supply · Underflow · OB')
  await page.screenshot({ path: info.outputPath('covered-estimate.png'), animations: 'disabled' })
  await page.keyboard.press('Escape')
  await expect(estimate).toBeHidden()

  // An edit to one material's rate goes back to that ground type's embankment cost alone, and a road
  // as RoadEng gives it carries no allocation or pit setting in [PGMaps].
  await page.getByRole('tab', { name: 'Ground', exact: true }).first().click()
  await field.fill('7.5')
  await field.press('Tab')
  await expect(placement).toContainText('$6.00/compacted m³ placed.')
  const design = await download(page, 'RoadEng design')
  const types = groundTypes(design)
  expect(types.find((t) => t[1] === 'OB')![8]).toBe('7.5')
  expect(types.find((t) => t[1] === 'GR')![8]).toBe('3')
  expect(strFromU8(unzipSync(design)['Location1.dsn'], true)).not.toMatch(/^Costs=.*"(allocation|lastResort)"/m)
  expect(errors).toEqual([])
})
