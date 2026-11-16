import { expect, test } from '@playwright/test'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { alignmentLength, offsetCoordinate } from '../../src/pages/dev-forestry-roads/engine'
import { roadEngDesign } from '../../src/pages/dev-forestry-roads/roadEngExport'
import { DEFAULT_TEMPLATE, DEMO_ORIGIN, demoTerrain, roadProjection } from '../../src/pages/dev-forestry-roads/terrain'
import type { Alignment } from '../../src/pages/dev-forestry-roads/types'
import { openWorkbench } from './road-workbench'
import { chooseExport, dismissExampleNoticeWhenShown, replaceSavedProjectWhenAsked } from './road-files'
import { choose, selectedLabel } from './styled-select'

// A generated RoadEng design (no Softree sample has a table that every curve reads at its own
// speed): a spur on the training hillside with two curves, its superelevation and runoff tables,
// curve H1 at 60 km/h on the table (5 %) and curve H2 at 40 km/h with Use Minimum Radius (flag
// bit 1), held at its e max, 6 %. Imported into the example project, edited per curve, written back.
test.use({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', acceptDownloads: true })
test.setTimeout(240_000)

const tables = [
  'LTable-00-Desc-00= Superelevation table, radius in meters, speed in km/hr',
  'LTable-00-Options=0',
  'LTable-00-Row-000=,40,60',
  'LTable-00-Row-001=100,0.04,0.05',
  'LTable-00-Row-002=400,0.04,0.05',
  'LTable-02-Desc-00= Superelevation Runoff table',
  'LTable-02-Options=0',
  'LTable-02-Row-000=,40,60',
  'LTable-02-Row-001=100,30,40',
  'LTable-02-Row-002=400,30,40',
  'RoadOptions=111,16.6666666667,0.31,2.5,2,3,0.09,1000,1000,50,0.1,-0.1,spur,0.06,1,0,100',
]

function design(method: 'table' | 'sideFriction' = 'table') {
  const toGrid = roadProjection(3157)
  const a = offsetCoordinate(DEMO_ORIGIN, 60, 500)
  const b = offsetCoordinate(a, 20, 200)
  const c = offsetCoordinate(b, 80, 200)
  const d = offsetCoordinate(c, 20, 200)
  const points: Alignment['points'] = [
    { id: 'a', coordinate: a, radiusM: 0 },
    { id: 'b', coordinate: b, radiusM: 200 },
    { id: 'c', coordinate: c, radiusM: 120 },
    { id: 'd', coordinate: d, radiusM: 0 },
  ]
  const road: Alignment = {
    id: 'r',
    name: 'Spur',
    color: '#000000',
    points,
    vertical: [],
    template: { ...DEFAULT_TEMPLATE },
    overrides: [],
  }
  const length = alignmentLength(road)
  road.vertical = [
    { id: 'v0', chainage: 0, elevation: demoTerrain.elevationAt(...a)!, curveLength: 0 },
    { id: 'v1', chainage: length, elevation: demoTerrain.elevationAt(...d)!, curveLength: 0 },
  ]
  const common = { emax: 0.06, runoffIn: 40, runoffOut: 40, transitionFraction: 0.667 }
  // RoadEng's side friction method: e max 0.1, f max 0.16, e = 0.1 · V²/(9.81 R) / 0.26.
  const friction = (v: number, r: number) => ({
    ...common,
    designSpeedMs: v / 3.6,
    emax: 0.1,
    fLimit: 0.16,
    e: (0.1 * (v / 3.6) ** 2) / (9.81 * r) / 0.26,
    flags: 5329,
  })
  const written = unzipSync(
    roadEngDesign(
      [
        {
          alignment: road,
          curves:
            method === 'table'
              ? {
                  b: { ...common, designSpeedMs: 60 / 3.6, e: 0.05, flags: 5585 },
                  c: {
                    ...common,
                    designSpeedMs: 40 / 3.6,
                    e: 0.06,
                    runoffIn: 30,
                    runoffOut: 30,
                    flags: 5587,
                  },
                }
              : { b: friction(60, 200), c: friction(40, 120) },
        },
      ],
      (coordinate) => toGrid.forward(coordinate) as [number, number],
    ).bytes,
  )
  // As RoadEng writes it: no [PGMaps] section, and the tables in the template table; with the side
  // friction method, each curve's e and side friction at the radius its record holds.
  const ds2 = strFromU8(written['Location1.ds2'], true)
  const eol = ds2.includes('\r\n') ? '\r\n' : '\n'
  if (method === 'sideFriction')
    written['Location1.ds2'] = strToU8(
      ds2
        .split(eol)
        .map((line) => {
          const f = line.split(',')
          if (f[0] !== '108') return line
          const lateral = Number(f[8]) ** 2 / (9.81 * Math.abs(Number(f[3])))
          const e = (0.1 * lateral) / 0.26
          f[15] = String(Number(e.toPrecision(12)))
          f[16] = String(Number((lateral - e).toPrecision(12)))
          return f.join(',')
        })
        .join(eol),
      true,
    )
  const dsn = strFromU8(written['Location1.dsn'], true).split('[PGMaps]')[0]
  written['Location1.dsn'] = strToU8(`${dsn.trimEnd()}\r\n[TemplatesSct]\r\n${tables.join('\r\n')}\r\n`, true)
  return zipSync(written)
}
const curves = (bytes: Uint8Array) =>
  strFromU8(unzipSync(bytes)['Location1.ds2'], true)
    .split(/\r?\n/)
    .filter((l) => l.startsWith('108,'))
    .map((l) => l.split(','))

test('per-curve superelevation read from RoadEng tables, shown, edited and written back', async ({ page }) => {
  await page.route('https://**', (route) => route.abort())
  await replaceSavedProjectWhenAsked(page)
  await dismissExampleNoticeWhenShown(page)
  await openWorkbench(page, '/dev/forestry/road-design')

  const bytes = design()
  const read = curves(bytes)
  await page.getByRole('button', { name: 'Import line', exact: true }).click()
  await page
    .getByTestId('road-file-input')
    .setInputFiles({ name: 'Spur.dsnx', mimeType: 'application/zip', buffer: Buffer.from(bytes) })
  const question = page.getByTestId('road-terrain-import-question')
  await choose(question.getByRole('combobox', { name: 'CRS of the design' }), '3157')
  await question.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(page.getByText(/Imported from Spur\.dsnx/).first()).toBeVisible({ timeout: 60_000 })
  await choose(page.getByLabel('Active road').first(), { label: /Spur/ })

  // Section → Superelevation & widening: table mode, each curve at its own speed and e.
  await page.getByRole('tab', { name: 'Section', exact: true }).first().click()
  await page.getByText('Superelevation & widening', { exact: true }).first().click()
  const panel = page.getByTestId('road-curve-design')
  await expect(panel).toBeVisible()
  expect(await selectedLabel(panel.getByRole('combobox', { name: 'Superelevation from' }))).toBe('Lookup table')
  await expect(page.getByTestId('road-superelevation-table')).toContainText('2 radii × 2 speeds')
  const rows = panel.getByTestId('road-curve-row')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText('5.00% table')
  await expect(rows.nth(0)).toContainText('40 m')
  await expect(rows.nth(1)).toContainText('6.00% minimum radius: e max')
  await expect(rows.nth(1)).toContainText('30 m')
  await expect(rows.nth(1).locator('td').nth(2)).toHaveText('40')

  // H1 given its own 4.5 %: the row says so, and only its record changes on the way out.
  await panel.getByRole('button', { name: /^Curve H1\b/ }).click()
  const own = page.getByTestId('road-curve-own-values')
  await expect(own.getByRole('spinbutton', { name: 'Superelevation (%)', exact: true })).toHaveAttribute(
    'placeholder',
    '5.00',
  )
  await own.getByRole('spinbutton', { name: 'Superelevation (%)', exact: true }).fill('4.5')
  await own.getByRole('spinbutton', { name: 'Superelevation (%)', exact: true }).press('Enter')
  await expect(rows.nth(0)).toContainText('4.50% stated')
  await expect(panel.getByRole('button', { name: 'Curve H1, own values' })).toBeVisible()

  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const button = await chooseExport(page, 'RoadEng design')
  const download = page.waitForEvent('download')
  await button.click()
  const chunks: Buffer[] = []
  for await (const part of (await (await download).createReadStream())!) chunks.push(Buffer.from(part))
  const out = curves(new Uint8Array(Buffer.concat(chunks)))
  expect(out).toHaveLength(2)
  // H1: e 0.045 written as a value, its flag word, speed, transitions and fraction as read.
  expect(Number(out[0][15])).toBeCloseTo(0.045, 9)
  expect(out[0][9]).toBe(read[0][9])
  for (const field of [8, 10, 12, 13, 14]) expect(out[0][field]).toBe(read[0][field])
  // H2 as read, with Use Minimum Radius at 6 %.
  expect(out[1].slice(6)).toEqual(read[1].slice(6))
})

test('RoadEng’s side friction method read, shown, edited and written back', async ({ page }) => {
  await page.route('https://**', (route) => route.abort())
  await replaceSavedProjectWhenAsked(page)
  await dismissExampleNoticeWhenShown(page)
  await openWorkbench(page, '/dev/forestry/road-design')

  const bytes = design('sideFriction')
  const read = curves(bytes)
  await page.getByRole('button', { name: 'Import line', exact: true }).click()
  await page
    .getByTestId('road-file-input')
    .setInputFiles({ name: 'Spur.dsnx', mimeType: 'application/zip', buffer: Buffer.from(bytes) })
  const question = page.getByTestId('road-terrain-import-question')
  await choose(question.getByRole('combobox', { name: 'CRS of the design' }), '3157')
  await question.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(page.getByText(/Imported from Spur\.dsnx/).first()).toBeVisible({ timeout: 60_000 })
  await choose(page.getByLabel('Active road').first(), { label: /Spur/ })

  await page.getByRole('tab', { name: 'Section', exact: true }).first().click()
  await page.getByText('Superelevation & widening', { exact: true }).first().click()
  const panel = page.getByTestId('road-curve-design')
  await expect(panel).toBeVisible()
  expect(await selectedLabel(panel.getByRole('combobox', { name: 'Superelevation from' }))).toBe(
    'Side friction e/e max = f/f max',
  )
  await expect(panel.getByRole('spinbutton', { name: 'Side friction f max', exact: true })).toHaveValue('0.16')
  const rows = panel.getByTestId('road-curve-row')
  await expect(rows).toHaveCount(2)
  // e = 0.1 × V²/(9.81 R) / 0.26 at each record's radius in the design's grid.
  const methodE = (f: string[], fMax: number) =>
    (100 * 0.1 * Number(f[8]) ** 2) / (9.81 * Math.abs(Number(f[3]))) / (0.1 + fMax)
  await expect(rows.nth(0)).toContainText(`${methodE(read[0], 0.16).toFixed(2)}% side friction`)
  await expect(rows.nth(1)).toContainText(`${methodE(read[1], 0.16).toFixed(2)}% side friction`)

  // Unedited, both records go back as read.
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const exportOnce = async () => {
    const button = await chooseExport(page, 'RoadEng design')
    const download = page.waitForEvent('download')
    await button.click()
    const chunks: Buffer[] = []
    for await (const part of (await (await download).createReadStream())!) chunks.push(Buffer.from(part))
    await page.keyboard.press('Escape')
    return curves(new Uint8Array(Buffer.concat(chunks)))
  }
  expect((await exportOnce()).map((f) => f.slice(6))).toEqual(read.map((f) => f.slice(6)))

  // H1 given its own f max of 0.12: its e follows, and its record takes the new f max and e.
  await panel.getByRole('button', { name: /^Curve H1\b/ }).click()
  const own = page.getByTestId('road-curve-own-values')
  const fMax = own.getByRole('spinbutton', { name: 'Side friction f max', exact: true })
  await expect(fMax).toHaveAttribute('placeholder', '0.16')
  await fMax.fill('0.12')
  await fMax.press('Enter')
  await expect(rows.nth(0)).toContainText(`${methodE(read[0], 0.12).toFixed(2)}% side friction`)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const out = await exportOnce()
  expect(Number(out[0][11])).toBe(0.12)
  expect(Number(out[0][15])).toBeCloseTo(methodE(read[0], 0.12) / 100, 6)
  expect(Number(out[0][9]) & 258).toBe(0)
  expect(out[1].slice(6)).toEqual(read[1].slice(6))
})
