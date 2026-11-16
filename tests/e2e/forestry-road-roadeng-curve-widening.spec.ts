import { expect, test, type Page } from '@playwright/test'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { landXml } from '../../src/pages/dev-forestry-roads/designExports'
import { alignmentLength, analyzeRoad, offsetCoordinate } from '../../src/pages/dev-forestry-roads/engine'
import { roadEngDesign } from '../../src/pages/dev-forestry-roads/roadEngExport'
import {
  DEFAULT_ROAD_SETTINGS,
  DEFAULT_TEMPLATE,
  DEMO_ORIGIN,
  demoTerrain,
  localMetricGrid,
  roadProjection,
} from '../../src/pages/dev-forestry-roads/terrain'
import type { Alignment } from '../../src/pages/dev-forestry-roads/types'
import { openWorkbench } from './road-workbench'
import { chooseExport, dismissExampleNoticeWhenShown, replaceSavedProjectWhenAsked } from './road-files'
import { choose } from './styled-select'

// Generated files only (no Softree sample is committed). A RoadEng design with RoadEng's example
// widening table and two R 40 m curves turning 60°: H1 with Auto widening on the inside (flag 1521,
// bit 7 set) holding the table's 1.5 m inside and nothing outside, as Location 18 does; H2 with it
// off (1393) and 0.9 m typed inside, as the bluff road does. And a LandXML file PGMaps writes with
// a superelevated curve.
test.use({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', acceptDownloads: true })
test.setTimeout(240_000)

const widening = [
  'LTable-03-Desc-00=Widening Table - meters',
  'LTable-03-Options=0',
  'LTable-03-Row-000=,0,20,30,40,60,80,100,180',
  'LTable-03-Row-001=20,0,0.5,1,1.5,2,3,3.5,4',
  'LTable-03-Row-002=30,0,0,0.5,1,1.5,2,2.5,3',
  'LTable-03-Row-003=50,0,0,0,0.5,1,1.5,2,2.5',
  'LTable-03-Row-004=80,0,0,0,0,0,0.5,0.5,0.5',
  'LTable-03-Row-005=50000,0,0,0,0,0,0,0,0',
]

function road(): Alignment {
  const a = offsetCoordinate(DEMO_ORIGIN, 60, 500)
  const b = offsetCoordinate(a, 20, 200)
  const c = offsetCoordinate(b, 80, 200)
  const d = offsetCoordinate(c, 20, 200)
  const alignment: Alignment = {
    id: 'r',
    name: 'Bluff',
    color: '#000000',
    points: [
      { id: 'a', coordinate: a, radiusM: 0 },
      { id: 'b', coordinate: b, radiusM: 40 },
      { id: 'c', coordinate: c, radiusM: 40 },
      { id: 'd', coordinate: d, radiusM: 0 },
    ],
    vertical: [],
    template: { ...DEFAULT_TEMPLATE },
    overrides: [],
  }
  alignment.vertical = [
    { id: 'v0', chainage: 0, elevation: demoTerrain.elevationAt(...a)!, curveLength: 0 },
    { id: 'v1', chainage: alignmentLength(alignment), elevation: demoTerrain.elevationAt(...d)!, curveLength: 0 },
  ]
  return alignment
}

function design() {
  const toGrid = roadProjection(3157)
  const common = { emax: 0.06, runoffIn: 20, runoffOut: 20, transitionFraction: 0.667, designSpeedMs: 50 / 3.6, e: 0 }
  const written = unzipSync(
    roadEngDesign(
      [
        {
          alignment: road(),
          curves: {
            b: { ...common, flags: 1521, widening: { insideM: 1.5, outsideM: 0 } },
            c: { ...common, flags: 1393, widening: { insideM: 0.9, outsideM: 0 } },
          },
        },
      ],
      (coordinate) => toGrid.forward(coordinate) as [number, number],
    ).bytes,
  )
  // As RoadEng writes it: no [PGMaps] section, and the widening table in the template table.
  const dsn = strFromU8(written['Location1.dsn'], true).split('[PGMaps]')[0]
  written['Location1.dsn'] = strToU8(`${dsn.trimEnd()}\r\n[TemplatesSct]\r\n${widening.join('\r\n')}\r\n`, true)
  return zipSync(written)
}
const curves = (bytes: Uint8Array) =>
  strFromU8(unzipSync(bytes)['Location1.ds2'], true)
    .split(/\r?\n/)
    .filter((l) => l.startsWith('108,'))
    .map((l) => l.split(','))

async function download(page: Page, label: string) {
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const button = await chooseExport(page, label)
  const file = page.waitForEvent('download')
  await button.click()
  const chunks: Buffer[] = []
  for await (const part of (await (await file).createReadStream())!) chunks.push(Buffer.from(part))
  await page.keyboard.press('Escape')
  return new Uint8Array(Buffer.concat(chunks))
}

async function importFile(page: Page, name: string, buffer: Buffer, mimeType: string) {
  await page.getByRole('button', { name: 'Import line', exact: true }).click()
  await page.getByTestId('road-file-input').setInputFiles({ name, mimeType, buffer })
}

async function openCurves(page: Page) {
  await page.getByRole('tab', { name: 'Section', exact: true }).first().click()
  await page.getByText('Superelevation & widening', { exact: true }).first().click()
  const panel = page.getByTestId('road-curve-design')
  await expect(panel).toBeVisible()
  return panel
}

test.beforeEach(async ({ page }) => {
  await page.route('https://**', (route) => route.abort())
  await replaceSavedProjectWhenAsked(page)
  await dismissExampleNoticeWhenShown(page)
  await openWorkbench(page, '/dev/forestry/road-design')
})

test('RoadEng per-curve widening read by side, shown, edited and written back with its Auto bit', async ({ page }) => {
  const bytes = design()
  const read = curves(bytes)
  await importFile(page, 'Bluff.dsnx', Buffer.from(bytes), 'application/zip')
  const question = page.getByTestId('road-terrain-import-question')
  await choose(question.getByRole('combobox', { name: 'CRS of the design' }), '3157')
  await question.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(page.getByText(/Imported from Bluff\.dsnx/).first()).toBeVisible({ timeout: 60_000 })
  await choose(page.getByLabel('Active road').first(), { label: /Bluff/ })

  // H1 takes the table on its inside only; H2 keeps its typed 0.9 m (starred).
  const panel = await openCurves(page)
  const cells = panel.getByTestId('road-curve-widening')
  await expect(cells).toHaveText(['1.50 / 0.00', '0.90* / 0.00'])

  // H1 given its own 1.25 m inside: starred, and the field shows it over the table's 1.50.
  await panel.getByRole('button', { name: /^Curve H1\b/ }).click()
  const own = page.getByTestId('road-curve-own-values')
  const inside = own.getByRole('spinbutton', { name: 'Widening inside (m)', exact: true })
  await expect(inside).toHaveAttribute('placeholder', '1.50')
  await inside.fill('1.25')
  await inside.press('Enter')
  await expect(cells.nth(0)).toHaveText('1.25* / 0.00')

  const out = curves(await download(page, 'RoadEng design'))
  expect(out).toHaveLength(2)
  // H1: inside 1.25 with Auto widening off (bit 7 cleared), outside and the rest as read.
  expect(Number(out[0][17])).toBeCloseTo(1.25, 9)
  expect(out[0][18]).toBe(read[0][18])
  // Bit 7 (inside Auto widening) cleared, and nothing else: no bit is written for a typed e.
  expect(Number(out[0][9])).toBe(1521 & ~128)
  for (const field of [8, 10, 12, 13, 14]) expect(out[0][field]).toBe(read[0][field])
  // H2 as read: its typed widening, inside Auto widening off.
  expect([Number(out[1][9]) & 128, out[1][17], out[1][18]]).toEqual([0, read[1][17], read[1][18]])
})

test('LandXML superelevation read into each curve, shown, and written back out', async ({ page }) => {
  const alignment: Alignment = {
    ...road(),
    name: 'Superelevated',
    points: road().points.map((p) => (p.radiusM ? { ...p, radiusM: 120 } : p)),
    curveDesign: {
      designSpeedKmh: 50,
      maxSuperelevationPercent: 8,
      sideFrictionFactor: 0.15,
      runoffLengthM: 30,
      wideningVehicleLengthM: null,
      transitionFraction: 0.667,
    },
  }
  alignment.points[1] = { ...alignment.points[1], curve: { superelevationPercent: 6, runoffInM: 40, runoffOutM: 40 } }
  const grid = localMetricGrid(DEMO_ORIGIN)
  const text = landXml({
    name: 'Job',
    alignment,
    analysis: analyzeRoad(alignment, demoTerrain, DEFAULT_ROAD_SETTINGS),
    terrain: { kind: 'geotiff', name: 'DEM', resolutionM: 1, verticalReference: 'CGVD2013' },
    ...grid,
  })
  expect(text.match(/<Superelevation /g)).toHaveLength(2)
  await importFile(page, 'Superelevated.xml', Buffer.from(text), 'application/xml')
  await expect(page.getByText(/Imported from Superelevated\.xml/).first()).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText(/Superelevation read for 2 of 2 curves/).first()).toBeVisible()
  await choose(page.getByLabel('Active road').first(), { label: /Superelevated/ })

  const panel = await openCurves(page)
  const rows = panel.getByTestId('road-curve-row')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText('6.00% stated')
  await expect(rows.nth(0)).toContainText('40 m')
  await expect(rows.nth(1)).toContainText('stated')

  const written = strFromU8(await download(page, 'LandXML alignment'), true)
  const elements = written.match(/<Superelevation [\s\S]*?<\/Superelevation>/g) ?? []
  expect(elements).toHaveLength(2)
  expect(elements[0]).toMatch(/<FullSuperelev>6\.000000<\/FullSuperelev>/)
  const at = (tag: string) => Number(new RegExp(`<${tag}>([^<]+)</${tag}>`).exec(elements[0])![1])
  // A 40 m runoff, two thirds of it before the BC.
  expect(at('FullSuperSta') - at('BeginRunoffSta')).toBeCloseTo(40, 1)
})
