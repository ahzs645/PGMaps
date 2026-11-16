import { expect, test, type Page } from '@playwright/test'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { offsetCoordinate } from '../../src/pages/dev-forestry-roads/engine'
import { DEMO_ORIGIN, demoTerrain, roadProjection } from '../../src/pages/dev-forestry-roads/terrain'
import { openWorkbench } from './road-workbench'
import { chooseExport, dismissExampleNoticeWhenShown, replaceSavedProjectWhenAsked } from './road-files'
import { choose } from './styled-select'

// A generated RoadEng design (no Softree sample holds a parameter override): a 200 m spur on the
// training hillside whose template's closing slopes are on AUTO, ground given as the default type
// `**` (OB: 4:1 cut, 2:1 fill), and the right lane widened to 8 m from 60 to 140 m by RoadEng's
// Parameter Overrides. Imported into the example project, edited, and written back.
test.use({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', acceptDownloads: true })
test.setTimeout(240_000)

const LENGTH = 200
const CUT = 3
function design() {
  const toGrid = roadProjection(3157)
  const start = offsetCoordinate(DEMO_ORIGIN, 60, 500)
  const along = (s: number) => offsetCoordinate(start, 20, s)
  const ground = (s: number) => demoTerrain.elevationAt(...along(s))!
  // A straight grade from 3 m below ground at each end: the spur runs in cut.
  const z0 = ground(0) - CUT,
    z1 = ground(LENGTH) - CUT
  const level = (s: number) => z0 + ((z1 - z0) * s) / LENGTH
  const grid = (s: number) => toGrid.forward(along(s)) as [number, number]
  // Grid stations: the plan's own length in the design's grid.
  const [x0, y0] = grid(0),
    [x1, y1] = grid(LENGTH)
  const gridLength = Math.hypot(x1 - x0, y1 - y0)
  const stations = Array.from({ length: 21 }, (_, k) => (k * LENGTH) / 20)
  const ds2 = [
    '100,103,11,11.0.673.0, Softree Technical Systems Inc. - Location Line data file',
    `109,1,4,0,${gridLength / 2},${level(LENGTH / 2)},0,-1,16.6666666667,0,0,-1`,
    ...stations.map((s) => {
      const t = s / LENGTH
      return `110,${s === 0 || s === LENGTH ? 5 : 4},${(x0 + (x1 - x0) * t).toFixed(6)},${(y0 + (y1 - y0) * t).toFixed(6)},${level(s).toFixed(6)},${(gridLength * t).toFixed(6)},-1,0,0,,,256`
    }),
    '104,OB,Overburden (Default),50,25,1,1,12,4,0,8,0.6,4,2.6,2,0,0,0,8,',
  ].join('\r\n')
  const param = (t: number, c: number, u: number, name: string, flags: number, value: number) =>
    `T${t}-C${c}-U${u}=${name}~${name}.|${flags}|${value}|-1|0|1000|`
  const frag = (t: number, c: number, f: number, left: boolean) =>
    `T${t}-C${c}-F${f}=1,SGL,Fragment,${131072 + (left ? 1 : 0)},1,0,0,-`
  const dsn = [
    '[Software]',
    'Version=11.000',
    'Version2=11.0.673.0',
    '[design]',
    'ParmOverrides-1=4',
    'ParmOverrides-2=50|8193|AcpWidth|**|Alignment Start',
    'ParmOverrides-3=60|8193|AcpWidth|8|Alignment Start',
    'ParmOverrides-4=140|8193|AcpWidth|8|Alignment Start',
    'ParmOverrides-5=150|8193|AcpWidth|**|Alignment Start',
    'surface=Spur.terx',
    'units=10000',
    '[LocationParms]',
    '0=999999999,0,0,0,0,0,0,0,0,0,-,*1,999999,-,999999,-,**,LLB,LLB,RE,RE,0,0,-1,-1,0,0,0,0,RE,RE,9999,999999000,1',
    'nparams=1',
    '[TemplatesSct]',
    'T0=3,LLB,Rural 8m Gravel,-0.03,-0.03,1,0,2,2',
    'T0-C0=4,RDWY,Rural I!^!Lane.,3,0,146',
    frag(0, 0, 0, true),
    param(0, 0, 0, 'AcpThick', 0, 0),
    param(0, 0, 1, 'AcpWidth', 256, 4),
    param(0, 0, 2, '_SUPER', 37, -0.03),
    'T0-C1=4,RDWY,Rural I!^!Lane.,3,0,146',
    frag(0, 1, 0, false),
    param(0, 1, 0, 'AcpThick', 0, 0),
    param(0, 1, 1, 'AcpWidth', 256, 4),
    param(0, 1, 2, '_SUPER', 37, -0.03),
    'T0-C2=2,SLPS,Slopes Default!^!Closing slopes.,2,0,129',
    frag(0, 2, 0, true),
    frag(0, 2, 1, false),
    param(0, 2, 0, 'FinalSlpL', 3, 1),
    param(0, 2, 1, 'FinalSlpR', 3, 1),
    '',
  ].join('\r\n')
  return zipSync({
    'Location1.dsn': strToU8(dsn),
    'Location1.ds2': strToU8(ds2),
    'Location1.ds1': new Uint8Array(72),
  })
}

async function readout(page: Page, label: string) {
  return page.evaluate((name) => {
    const cell = [...document.querySelectorAll('*')].find(
      (e) => e.children.length === 0 && e.textContent?.trim() === `${name}:`,
    )
    return cell?.parentElement?.textContent?.slice(name.length + 1).trim() ?? null
  }, label)
}
async function goTo(page: Page, chainage: number) {
  const station = page.getByRole('spinbutton', { name: /^(Station|Selected station metres)$/ }).first()
  await station.fill(String(chainage))
  await station.press('Enter')
  await expect.poll(() => readout(page, 'L-Stn')).toBe(`0+${String(chainage).padStart(3, '0')}.0`)
}
const daylight = async (page: Page) => (await readout(page, 'Dayl L/R'))!.split(' / ').map(Number)

test('AUTO slopes, the default ground type and parameter overrides read, shown and written back', async ({ page }) => {
  await page.route('https://**', (route) => route.abort())
  await replaceSavedProjectWhenAsked(page)
  await dismissExampleNoticeWhenShown(page)
  await openWorkbench(page, '/dev/forestry/road-design?example=training')

  // Imported into the example: the design names no CRS, so it is asked.
  await page.getByRole('button', { name: 'Import line', exact: true }).click()
  await page
    .getByTestId('road-file-input')
    .setInputFiles({ name: 'Spur.dsnx', mimeType: 'application/zip', buffer: Buffer.from(design()) })
  const question = page.getByTestId('road-terrain-import-question')
  await choose(question.getByRole('combobox', { name: 'CRS of the design' }), '3157')
  await question.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(page.getByText(/Imported from Spur\.dsnx/).first()).toBeVisible({ timeout: 60_000 })
  await choose(page.getByLabel('Active road').first(), { label: /Spur/ })

  // The right lane is 8 m inside the override, 4 m outside it; both batters take OB's slopes.
  await goTo(page, 100)
  await expect.poll(() => readout(page, 'Width L/R')).toBe('4.0 / 8.0')
  await expect.poll(() => readout(page, 'Tmpl cut H:V')).toBe('ground / ground')
  await goTo(page, 20)
  await expect.poll(() => readout(page, 'Width L/R')).toBe('4.0 / 4.0')
  const auto = await daylight(page)

  // The right side's batters to the stated 1:1: its daylight comes in.
  await page.getByRole('tab', { name: 'Section', exact: true }).first().click()
  const components = page.getByTestId('road-template-components')
  if (!(await components.isVisible())) await page.getByRole('button', { name: /^Template components/ }).click()
  await components.getByRole('button', { name: 'Right slope', exact: true }).click()
  await expect(components.getByRole('button', { name: 'Right slope', exact: true })).toHaveText('Ground')
  const sources = page.getByTestId('road-batter-sources')
  await choose(sources.getByRole('combobox', { name: 'Right cut batter from' }), 'template')
  await choose(sources.getByRole('combobox', { name: 'Right fill batter from' }), 'template')
  await expect(components.getByRole('button', { name: 'Right slope', exact: true })).toHaveText('C 1 · F 1')
  await expect.poll(() => readout(page, 'Tmpl cut H:V')).toBe('ground / 1.00')
  await expect.poll(async () => (await daylight(page))[1]).toBeLessThan(auto[1] - 1)
  await expect.poll(async () => (await daylight(page))[0]).toBeCloseTo(auto[0], 2)

  // The override is a value by station: 9 m at its second station.
  await page.getByRole('tab', { name: 'Engineering', exact: true }).first().click()
  await page.getByRole('tab', { name: 'Templates', exact: true }).first().click()
  const override = page.getByTestId('road-parameter-override')
  await expect(override).toHaveCount(1)
  await expect(override).toContainText('AcpWidth (right)')
  await expect(override).toContainText('RoadEng parameter AcpWidth (right), 4 rows: Alignment Start.')
  const value = page.getByLabel('Value 1 at station 2', { exact: true })
  if (!(await value.isVisible())) await page.getByRole('button', { name: /^Values by station/ }).click()
  await value.scrollIntoViewIfNeeded()
  await value.fill('9')
  await value.press('Enter')
  await goTo(page, 100)
  await expect.poll(() => readout(page, 'Width L/R')).toBe('4.0 / 8.5')

  // Written back: the right closing slope off AUTO, the edited entry, everything else as read.
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const button = await chooseExport(page, 'RoadEng design')
  const download = page.waitForEvent('download')
  await button.click()
  const chunks: Buffer[] = []
  for await (const part of (await (await download).createReadStream())!) chunks.push(Buffer.from(part))
  const dsn = strFromU8(unzipSync(new Uint8Array(Buffer.concat(chunks)))['Location1.dsn'], true)
  expect(dsn).toMatch(/^T0-C2-U0=FinalSlpL~FinalSlpL\.\|3\|1\|/m)
  expect(dsn).toMatch(/^T0-C2-U1=FinalSlpR~FinalSlpR\.\|1\|1\|/m)
  expect(dsn).toMatch(/^ParmOverrides-1=4\r?$/m)
  expect(dsn).toMatch(/^ParmOverrides-2=50\|8193\|AcpWidth\|\*\*\|Alignment Start\r?$/m)
  expect(dsn).toMatch(/^ParmOverrides-3=60\|8193\|AcpWidth\|9\|Alignment Start\r?$/m)
  expect(dsn).toMatch(/^ParmOverrides-4=140\|8193\|AcpWidth\|8\|Alignment Start\r?$/m)
})
