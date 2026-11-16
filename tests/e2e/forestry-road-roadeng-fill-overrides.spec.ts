import { expect, test } from '@playwright/test'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { offsetCoordinate } from '../../src/pages/dev-forestry-roads/engine'
import { DEMO_ORIGIN, demoTerrain, roadProjection } from '../../src/pages/dev-forestry-roads/terrain'
import { openWorkbench } from './road-workbench'
import { chooseExport, dismissExampleNoticeWhenShown, replaceSavedProjectWhenAsked } from './road-files'
import { choose } from './styled-select'

// A generated RoadEng design (no Softree file): a 200 m spur on the training hillside over
// overburden with gravel 1 m down, its subgrade fill `*2` (the gravel) but solid rock (SR) from 80
// to 120 m, laid out as Softree's Hart Rd holds its rock fill; and a pullout widening the right
// lane, its overrides laid out as Softree's Location 18 holds them: the side as the code (8192),
// ±FLT_MAX at the alignment's ends, a description per row and a step at 130 m.
test.use({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', acceptDownloads: true })
test.setTimeout(240_000)

const LENGTH = 200
const range = (end: string, fill: string) =>
  `${end},0,0,0,0,0,0,0,0,0,-,${fill},-1,GR,999999,-,OB,LLB,LLB,RE,RE,0,0,-1,-1,0,0,0,0,RE,RE,9999,999999000,1`
const OVERRIDES = [
  '-3.40282346639e+38|8192|AcpWidth|**|Alignment Start',
  '60|8192|AcpWidth|**|Taper Start',
  '70|8192|AcpWidth|8|Pullout Start',
  '130|8192|AcpWidth|8|Pullout End',
  '130|8192|AcpWidth|6|Pullout End',
  '140|8192|AcpWidth|**|Taper End',
  '3.40282346639e+38|8192|AcpWidth|**|Alignment End',
]
function design() {
  const toGrid = roadProjection(3157)
  const start = offsetCoordinate(DEMO_ORIGIN, 60, 500)
  const along = (s: number) => offsetCoordinate(start, 20, s)
  const ground = (s: number) => demoTerrain.elevationAt(...along(s))!
  const z0 = ground(0) - 1,
    z1 = ground(LENGTH) - 1
  const level = (s: number) => z0 + ((z1 - z0) * s) / LENGTH
  const grid = (s: number) => toGrid.forward(along(s)) as [number, number]
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
    '104,GR,Gravel,50,50,1,0.9,12,4,0,8,0.6,4,2.6,2,2,0,0,8,',
    '104,SR,Solid Rock,100,400,1,0.8,48,4,0,8,0.6,4,2.6,2,3,0,0,8,',
  ].join('\r\n')
  const param = (c: number, u: number, name: string, flags: number, value: number) =>
    `T0-C${c}-U${u}=${name}~${name}.|${flags}|${value}|-1|0|1000|`
  const frag = (c: number, f: number, left: boolean) =>
    `T0-C${c}-F${f}=1,SGL,Fragment,${131072 + (left ? 1 : 0)},1,0,0,-`
  const dsn = [
    '[Software]',
    'Version=11.000',
    'Version2=11.0.673.0',
    '[design]',
    `ParmOverrides-1=${OVERRIDES.length}`,
    ...OVERRIDES.map((o, k) => `ParmOverrides-${k + 2}=${o}`),
    'surface=Spur.terx',
    'units=10000',
    '[LocationParms]',
    `0=${range('80', '*2')}`,
    `1=${range('120', 'SR')}`,
    `2=${range('999999999', '*2')}`,
    'nparams=3',
    '[TemplatesSct]',
    'T0=3,LLB,Rural 8m Gravel,-0.03,-0.03,1,0,2,2',
    'T0-C0=4,RDWY,Rural I!^!Lane.,2,0,146',
    frag(0, 0, true),
    param(0, 0, 'AcpThick', 0, 0),
    param(0, 1, 'AcpWidth', 256, 4),
    'T0-C1=4,RDWY,Rural I!^!Lane.,2,0,146',
    frag(1, 0, false),
    param(1, 0, 'AcpThick', 0, 0),
    param(1, 1, 'AcpWidth', 256, 4),
    'T0-C2=2,SLPS,Slopes Default!^!Closing slopes.,2,0,129',
    frag(2, 0, true),
    frag(2, 1, false),
    param(2, 0, 'FinalSlpL', 3, 1),
    param(2, 1, 'FinalSlpR', 3, 1),
    '',
  ].join('\r\n')
  return zipSync({
    'Location1.dsn': strToU8(dsn),
    'Location1.ds2': strToU8(ds2),
    'Location1.ds1': new Uint8Array(72),
  })
}

test('RoadEng fill material by range and side-coded overrides read, shown, edited and written back', async ({
  page,
}) => {
  await page.route('https://**', (route) => route.abort())
  await replaceSavedProjectWhenAsked(page)
  await dismissExampleNoticeWhenShown(page)
  await openWorkbench(page, '/dev/forestry/road-design?example=training')

  await page.getByRole('button', { name: 'Import line', exact: true }).click()
  await page
    .getByTestId('road-file-input')
    .setInputFiles({ name: 'Spur.dsnx', mimeType: 'application/zip', buffer: Buffer.from(design()) })
  const question = page.getByTestId('road-terrain-import-question')
  await choose(question.getByRole('combobox', { name: 'CRS of the design' }), '3157')
  await question.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(page.getByText(/Imported from Spur\.dsnx/).first()).toBeVisible({ timeout: 60_000 })
  await choose(page.getByLabel('Active road').first(), { label: /Spur/ })

  // The pullout: one right-side override, its rows' descriptions shown.
  await page.getByRole('tab', { name: 'Engineering', exact: true }).first().click()
  await page.getByRole('tab', { name: 'Templates', exact: true }).first().click()
  const override = page.getByTestId('road-parameter-override')
  await expect(override).toHaveCount(1)
  await expect(page.getByTestId('road-parameter-override-source')).toHaveText(
    'RoadEng parameter AcpWidth (right), 7 rows: Alignment Start, Taper Start, Pullout Start, Pullout End, Taper End, Alignment End.',
  )
  await expect(override).toContainText('AcpWidth (right)')
  // The step at 130 m (in road chainage, a little short of the design's station): 8 m up to it, 6 m after.
  await expect(override).toContainText(/(129\.9|130) m 8, \1 m 6/)

  // The fill: gravel, then solid rock from 80 to 120 m, then gravel, each a RoadEng fill type.
  await page.getByRole('tab', { name: 'Haul', exact: true }).first().click()
  await page.getByRole('button', { name: 'Haul & cost settings', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Haul & cost settings' })
  const policy = dialog.getByTestId('road-material-allocation-policy')
  await expect(policy.getByTestId('road-fill-requirement-roadeng')).toHaveText([
    /RoadEng fill type GR/,
    /RoadEng fill type SR/,
    /RoadEng fill type GR/,
  ])
  // The rock fill carried on to 150 m: the gravel after it starts there first.
  const field = (label: RegExp) => policy.getByRole('spinbutton', { name: label })
  await field(/^Requirement 3 start/).fill('150')
  await field(/^Requirement 3 start/).press('Enter')
  await field(/^Requirement 2 end/).fill('150')
  await field(/^Requirement 2 end/).press('Enter')
  await expect(field(/^Requirement 2 end/)).toHaveValue(/^150(\.0+)?$/)
  await page.keyboard.press('Escape')

  // Written back: the SR row ends at 150 m, *2 either side, the overrides as read.
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const button = await chooseExport(page, 'RoadEng design')
  const download = page.waitForEvent('download')
  await button.click()
  const chunks: Buffer[] = []
  for await (const part of (await (await download).createReadStream())!) chunks.push(Buffer.from(part))
  const dsn = strFromU8(unzipSync(new Uint8Array(Buffer.concat(chunks)))['Location1.dsn'], true)
  const rows = [...dsn.matchAll(/^(\d+)=([^\r\n]*)$/gm)].map((m) => m[2].split(',')).filter((f) => f.length > 30)
  expect(rows.map((f) => f[11])).toEqual(['*2', 'SR', '*2'])
  expect(rows[0][0]).toBe('80')
  // Typed in road chainage: the design's station is within the plan's grid scale of it.
  expect(Math.abs(Number(rows[1][0]) - 150)).toBeLessThan(0.5)
  expect(rows[2][0]).toBe('999999999')
  for (const [k, entry] of OVERRIDES.entries()) expect(dsn).toContain(`ParmOverrides-${k + 2}=${entry}`)
})
