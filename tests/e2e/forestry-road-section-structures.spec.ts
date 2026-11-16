import { expect, test, type Page } from '@playwright/test'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { offsetCoordinate } from '../../src/pages/dev-forestry-roads/engine'
import { DEMO_ORIGIN, demoTerrain, roadProjection } from '../../src/pages/dev-forestry-roads/terrain'
import { openWorkbench } from './road-workbench'
import { chooseExport, dismissExampleNoticeWhenShown, replaceSavedProjectWhenAsked } from './road-files'
import { openRoadPanel } from './road-sidebar'
import { choose } from './styled-select'

// A generated RoadEng design (Softree's sample roads use none of these): a 200 m spur in a 3 m cut on
// the training hillside whose template has a 4:1 base course over the lane, a ditch with a 4:1 inslope
// and a 2:1 backslope, Slope VI benches in cut, a retaining wall on the right, a guard rail on the
// left and a sub-cut below the subgrade on the left. Imported, shown, edited and written back.
test.use({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', acceptDownloads: true })
test.setTimeout(240_000)

const LENGTH = 200
const CUT = 3
function design() {
  const toGrid = roadProjection(3157)
  const start = offsetCoordinate(DEMO_ORIGIN, 60, 500)
  const along = (s: number) => offsetCoordinate(start, 20, s)
  const ground = (s: number) => demoTerrain.elevationAt(...along(s))!
  const z0 = ground(0) - CUT,
    z1 = ground(LENGTH) - CUT
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
  ].join('\r\n')
  const component = (c: number, head: string, side: 'left' | 'right', params: [string, number, number][]) => [
    `T0-C${c}=${head}`,
    `T0-C${c}-F0=1,SGL,Fragment,${131072 + (side === 'left' ? 1 : 0)},1,0,0,-`,
    ...params.map(([name, flags, value], u) => `T0-C${c}-U${u}=${name}~${name}.|${flags}|${value}|-1|0|1000|`),
  ]
  const lane: [string, number, number][] = [
    ['AcpThick', 0, 0],
    ['AcpWidth', 256, 4],
    ['BaseThick', 0, 0.2],
    ['BaseFillSlope', 1, 0.25],
    ['_SUPER', 37, -0.03],
  ]
  const ditch: [string, number, number][] = [
    ['DitchProbeDepth', 0, 99],
    ['bDitchInclude', 0, 1],
    ['DitchDepth', 0, 0.5],
    ['DitchInSlp', 1, 0.25],
    ['DitchBotWd', 0, 0.5],
    ['DitchBackSlp', 1, 0.5],
  ]
  const benches: [string, number, number][] = [
    ['bApplyInCut', 0, 1],
    ['bApplyInFill', 0, 0],
    ['FinalCutSlp', 1, 1],
    ['FinalFillSlp', 1, 0.5],
    ['BenchSlope', 1, 2],
    ['BenchHeight', 0, 1.5],
    ['BenchBaseWidth', 0, 1],
    ['BenchBaseSlope', 1, 0],
  ]
  const dsn = [
    '[Software]',
    'Version=11.000',
    'Version2=11.0.673.0',
    '[design]',
    'surface=Spur.terx',
    'units=10000',
    '[LocationParms]',
    '0=999999999,0,0,0,0,0,0,0,0,0,-,*1,999999,-,999999,-,OB,ST,ST,RE,RE,0,0,-1,-1,0,0,0,0,RE,RE,9999,999999000,1',
    'nparams=1',
    '[TemplatesSct]',
    'T0=10,ST,Structured spur,-0.03,-0.03,1,0,2,2',
    ...component(0, '4,RDWY,Rural I!^!Lane.,5,0,146', 'left', lane),
    ...component(1, '4,RDWY,Rural I!^!Lane.,5,0,146', 'right', lane),
    ...component(2, '3,DTCHS,Ditch I Standard!^!Ditch.,6,0,145', 'left', ditch),
    ...component(3, '3,DTCHS,Ditch I Standard!^!Ditch.,6,0,145', 'right', ditch),
    ...component(4, '11,SLPS,Slope VI - Benches!^!Benches.,8,0,145', 'left', benches),
    ...component(5, '11,SLPS,Slope VI - Benches!^!Benches.,8,0,145', 'right', benches),
    ...component(6, '7,Retain,Wall IV - Retaining Wall!^!Retaining wall.,2,0,145', 'right', [
      ['WallThick', 0, 0.3],
      ['WallHeight', 576, 1],
    ]),
    ...component(7, '5,Guard Rail,Barrier I - Guard Rail!^!Guard rail.,4,0,146', 'left', [
      ['bIncludeBarrier', 0, 1],
      ['BarrierCL_Offset', 256, 3.6],
      ['PostThickness', 0, 0.2],
      ['PostHeight', 0, 0.9],
    ]),
    ...component(8, '4,SC,SubCut II - Under SG!^!Subcut below subgrade.,3,0,145', 'left', [
      ['SubCutDepth', 0, 0.4],
      ['SubCutWidthL', 0, 4],
      ['SubCutSlopeOut', 1, 1],
    ]),
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
  const station = page.getByRole('spinbutton', { name: 'Station' }).first()
  await station.fill(String(chainage))
  await station.press('Enter')
  await expect.poll(() => readout(page, 'L-Stn')).toBe(`0+${String(chainage).padStart(3, '0')}.0`)
}
const daylight = async (page: Page) => (await readout(page, 'Dayl L/R'))!.split(' / ').map(Number)

test('benches, walls, barriers, sub-cuts, course slopes and an uneven ditch read, drawn, edited and written back', async ({
  page,
}, info) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
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

  // The 4 m lane over 0.2 m of base at 4:1: a 4.8 m formation each side.
  await goTo(page, 100)
  await expect.poll(() => readout(page, 'Width L/R')).toBe('4.8 / 4.8')

  // The section draws the wall, the rail and the sub-cut, and the sloped course.
  const section = page.getByTestId('road-section-chart').first()
  await expect(page.locator('[data-testid="road-section-structure-barrier"]').first()).toBeAttached()
  await expect(page.locator('[data-testid="road-section-structure-sub-cut"]').first()).toBeAttached()
  await expect(page.locator('[data-testid="road-section-course"]').first()).toBeAttached()
  await page.screenshot({ path: info.outputPath('section-structures.png') })
  if (await section.count()) await section.screenshot({ path: info.outputPath('section-chart.png') })

  // The Section tab lists them, with their quantities, and edits them.
  await page.getByRole('tab', { name: 'Section', exact: true }).first().click()
  await openRoadPanel(page, 'Benches, walls, barriers and sub-cuts')
  const editor = page.getByTestId('road-section-structures')
  await expect(editor.getByTestId('road-benches-left-cut')).toBeVisible()
  await expect(editor.getByTestId('road-section-wall')).toHaveCount(1)
  await expect(editor.getByTestId('road-section-barrier')).toHaveCount(1)
  await expect(editor.getByTestId('road-subcut-left')).toBeVisible()
  const quantities = page.getByTestId('road-structure-quantities')
  await expect(quantities).toContainText('Wall IV - Retaining Wall')
  await expect(quantities).toContainText('Barrier I - Guard Rail')
  await expect(quantities).toContainText('SubCut II - Under SG')

  // The ditch keeps its own inslope.
  await openRoadPanel(page, 'Template components')
  const components = page.getByTestId('road-template-components')
  await components.getByRole('button', { name: 'Left ditch', exact: true }).click()
  await expect(components.getByLabel(/^Inslope \(H:V\)/)).toHaveValue('4')
  await expect(components.getByLabel(/^Backslope \(H:V\)/)).toHaveValue('2')
  await page.screenshot({ path: info.outputPath('section-tab.png'), fullPage: false })

  // A wider bench moves the left daylight out.
  const before = await daylight(page)
  const width = editor.getByTestId('road-benches-left-cut').getByLabel(/^Bench width \(m\)/)
  await width.fill('3')
  await width.press('Tab')
  await expect.poll(async () => (await daylight(page))[0]).toBeGreaterThan(before[0])
  // The wall twice as high.
  const height = editor.getByTestId('road-section-wall').getByLabel(/^Height at most \(m\)/)
  await height.fill('2')
  await height.press('Tab')
  await editor.screenshot({ path: info.outputPath('structures-editor.png') })

  // Written back into the parameters they came from; the rest as read.
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const button = await chooseExport(page, 'RoadEng design')
  const download = page.waitForEvent('download')
  await button.click()
  const chunks: Buffer[] = []
  for await (const part of (await (await download).createReadStream())!) chunks.push(Buffer.from(part))
  const dsn = strFromU8(unzipSync(new Uint8Array(Buffer.concat(chunks)))['Location1.dsn'], true)
  expect(dsn).toMatch(/^T0-C4-U6=BenchBaseWidth~BenchBaseWidth\.\|0\|3\|/m)
  expect(dsn).toMatch(/^T0-C5-U6=BenchBaseWidth~BenchBaseWidth\.\|0\|1\|/m)
  expect(dsn).toMatch(/^T0-C6-U1=WallHeight~WallHeight\.\|576\|2\|/m)
  expect(dsn).toMatch(/^T0-C7-U1=BarrierCL_Offset~BarrierCL_Offset\.\|256\|3\.6\|/m)
  expect(dsn).toMatch(/^T0-C2-U3=DitchInSlp~DitchInSlp\.\|1\|0\.25\|/m)
  expect(errors).toEqual([])
})
