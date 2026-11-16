import { expect, test, type Page } from '@playwright/test'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { offsetCoordinate } from '../../src/pages/dev-forestry-roads/engine'
import { DEMO_ORIGIN, demoTerrain, roadProjection } from '../../src/pages/dev-forestry-roads/terrain'
import { openWorkbench } from './road-workbench'
import { chooseExport, dismissExampleNoticeWhenShown, replaceSavedProjectWhenAsked } from './road-files'
import { openRoadPanel } from './road-sidebar'
import { choose } from './styled-select'

// A generated RoadEng design (no Softree file): a 200 m spur in a 3 m cut whose roadway builds its
// subgrade edge the way RoadEng's component library does, from a subgrade leg that adds each course's
// thickness over its fill slope, with a retaining wall and its backfill on the right and a sub-cut with
// its own bottom slope on the left. Read from its construction, shown, edited and written back.
test.use({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', acceptDownloads: true })
test.setTimeout(240_000)

const LENGTH = 200
const CUT = 3
/** A parameter word: bit 15 + its U number, plus 1 for a depth below the attachment point. */
const word = (u: number, below = false) => String(2 ** (15 + u) + (below ? 1 : 0))
type Param = [name: string, flags: number, value: number, formula?: string]

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
  const params = (c: number, list: Param[]) =>
    list.flatMap(([name, flags, value, formula], u) => [
      `T0-C${c}-U${u}=${name}~${name}.|${flags}|${value}|-1|0|1000|`,
      ...(formula ? [`T0-C${c}-U${u}-1=${formula}`] : []),
    ])
  const sideBits = (side: 'left' | 'right') => 131072 + (side === 'left' ? 1 : 0)
  // Lane and shoulder 4 m, 0.1 m of pavement over 0.2 m of base at 2:1. The subgrade leg adds the
  // pavement and the base over the base's fill slope: 4 + 0.2 + 0.4 = 4.6 m; the subgrade 0.3 m down.
  const lane: Param[] = [
    ['AcpThick', 0, 0.1],
    ['AcpWidth', 256, 3.5],
    ['BaseThick', 0, 0.2],
    ['BaseFillSlope', 1, 0.5],
    ['_SUPER', 37, -0.03],
    ['ShoulderWidth', 0, 0.5],
    ['ROAD_WIDTH', 0, 0, 'AcpWidth+ShoulderWidth'],
    ['SG_DEPTH', 0, 0, 'AcpThick + BaseThick'],
    ['S_ADJ', 64, 0, 'AcpThick'],
  ]
  const roadway = (c: number, side: 'left' | 'right') => [
    `T0-C${c}=3,RDWY,Rural I!^!Lane.,${lane.length},0,146`,
    `T0-C${c}-F0=1,SGL,Subgrade,${sideBits(side)},1,0,0,-,0,0,--,0,${word(7, true)},0,0`,
    `T0-C${c}-F0-L0=1,0,69148,-1,RE-,2,0,-0,${word(8)},${word(3)},0,-0,${word(2)},${word(3)},0,-1,6`,
    `T0-C${c}-F1=1,SGL,Base,${sideBits(side)},3,0,0,-,0,0,--,0,${word(0, true)},0,0`,
    `T0-C${c}-F1-L0=1,0,69148,-1,--,0,0,-1,6`,
    `T0-C${c}-F2=1,-?-,Surface,${sideBits(side)},4,0,0,-,0,0,--,0,0,0,0`,
    `T0-C${c}-F2-L0=1,0,69148,-1,--,0,0,-1,1`,
    ...params(c, lane),
  ]
  const ditch = (c: number, side: 'left' | 'right') => [
    `T0-C${c}=1,DTCHS,Ditch I Standard!^!Ditch.,5,0,145`,
    `T0-C${c}-F0=1,DL,Ditch,${sideBits(side)},1,0,0,-`,
    ...params(c, [
      ['bDitchInclude', 0, 1],
      ['DitchDepth', 0, 0.5],
      ['DitchInSlp', 1, 0.5],
      ['DitchBotWd', 0, 0.5],
      ['DitchBackSlp', 1, 0.5],
    ]),
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
    'T0=6,ST,Built spur,-0.03,-0.03,1,0,2,2',
    ...roadway(0, 'left'),
    ...roadway(1, 'right'),
    ...ditch(2, 'left'),
    ...ditch(3, 'right'),
    'T0-C4=1,Retain,Wall IV - Retaining Wall!^!Retaining wall.,7,0,145',
    `T0-C4-F0=1,SLPR,Wall,${sideBits('right')},1,0,0,-`,
    ...params(4, [
      ['WallThick', 0, 0.3],
      ['WallHeight', 576, 1],
      ['WallFactor', 0, 1.5],
      ['WallBackSlope', 1, 1],
      ['bBackFillToTopo', 0, 1],
      ['WallBackfillSlope', 1, -0.3],
      ['WallBFillOffset', 32, 0, 'WallHeight*WallFactor'],
    ]),
    'T0-C5=1,SC,SubCut II - Under SG!^!Subcut below subgrade.,6,0,145',
    `T0-C5-F0=1,SGL,SCBot,${sideBits('left')},1,0,0,-`,
    ...params(5, [
      ['SubCutDepth', 0, 0.4],
      ['SubCutWidthL', 0, 4],
      ['SubCutSlopeOut', 1, 1],
      ['SubCutBotSlope', 1, -0.02],
      ['bApplySuper', 0, 0],
      ['SubCutSlopeIn', 1, 9999.99],
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

test('a RoadEng roadway builds its subgrade edge from its construction; wall backfill and sub-cut bottom read and written back', async ({
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
    .setInputFiles({ name: 'Built.dsnx', mimeType: 'application/zip', buffer: Buffer.from(design()) })
  const question = page.getByTestId('road-terrain-import-question')
  await choose(question.getByRole('combobox', { name: 'CRS of the design' }), '3157')
  await question.getByRole('button', { name: 'Import', exact: true }).click()
  const imported = page.getByText(/Imported from Built\.dsnx/).first()
  await expect(imported).toBeVisible({ timeout: 60_000 })
  await expect(imported).toContainText(
    'the subgrade edge, where the ditch and the batters start, is 4.6 m from the centreline on each side, as Rural I builds it: ROAD_WIDTH 4 m + S_ADJ ÷ BaseFillSlope 0.2 m + BaseThick ÷ BaseFillSlope 0.4 m',
  )
  await choose(page.getByLabel('Active road').first(), { label: /Built/ })

  // The 4.6 m formation each side, not the 4 m lane.
  await goTo(page, 100)
  await expect.poll(() => readout(page, 'Width L/R')).toBe('4.6 / 4.6')
  await expect(page.locator('[data-testid="road-section-structure-wall-backfill"]').first()).toBeAttached()
  await page.screenshot({ path: info.outputPath('components-section.png') })

  // The lane shows its running surface: RoadEng's 4 m, the courses spreading 0.6 m below it.
  await page.getByRole('tab', { name: 'Section', exact: true }).first().click()
  await openRoadPanel(page, 'Template components')
  const components = page.getByTestId('road-template-components')
  await components.getByRole('button', { name: 'Left lane', exact: true }).click()
  await expect(page.getByTestId('road-lane-running-surface')).toContainText(
    "Running surface 4 m; the courses' side slopes spread 0.6 m out to the subgrade edge at 4.6 m",
  )

  // The retaining wall's backfill and the sub-cut's own bottom.
  await openRoadPanel(page, 'Benches, walls, barriers and sub-cuts')
  const editor = page.getByTestId('road-section-structures')
  const wall = editor.getByTestId('road-section-wall')
  await expect(wall.getByLabel('Wall 1 backfill')).toContainText('Refilled to the cut')
  await expect(wall.getByLabel(/^Backfill offset from heel \(m\)/)).toHaveValue('1.5')
  await expect(page.getByTestId('road-structure-quantities')).toContainText('Wall IV - Retaining Wall backfill')
  const sub = editor.getByTestId('road-subcut-left')
  await expect(sub.getByLabel(/^Bottom slope/)).toHaveValue('-2')
  await expect(sub.getByLabel('Left sub-cut bottom')).toContainText('Own slope')
  await sub.getByLabel(/^Bottom slope/).fill('-5')
  await sub.getByLabel(/^Bottom slope/).press('Tab')
  await editor.screenshot({ path: info.outputPath('components-structures.png') })

  // Written back into SubCutBotSlope, as rise over run; the roadway's parameters as read.
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const button = await chooseExport(page, 'RoadEng design')
  const download = page.waitForEvent('download')
  await button.click()
  const chunks: Buffer[] = []
  for await (const part of (await (await download).createReadStream())!) chunks.push(Buffer.from(part))
  const dsn = strFromU8(unzipSync(new Uint8Array(Buffer.concat(chunks)))['Location1.dsn'], true)
  expect(dsn).toMatch(/^T0-C5-U3=SubCutBotSlope~SubCutBotSlope\.\|1\|-0\.05\|/m)
  expect(dsn).toMatch(/^T0-C0-U1=AcpWidth~AcpWidth\.\|256\|3\.5\|/m)
  expect(dsn).toMatch(/^T0-C0-U3=BaseFillSlope~BaseFillSlope\.\|1\|0\.5\|/m)
  expect(errors).toEqual([])
})
