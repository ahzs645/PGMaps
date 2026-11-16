import { expect, test, type Page } from '@playwright/test'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { offsetCoordinate } from '../../src/pages/dev-forestry-roads/engine'
import { DEMO_ORIGIN, demoTerrain, roadProjection } from '../../src/pages/dev-forestry-roads/terrain'
import { openWorkbench } from './road-workbench'
import { chooseExport, dismissExampleNoticeWhenShown, replaceSavedProjectWhenAsked } from './road-files'
import { openRoadPanel } from './road-sidebar'
import { choose } from './styled-select'

// A generated RoadEng design (no Softree file), laid out as Softree's public designs that use these
// parts lay them out: a roadway that digs its own sub-cut under its subgrade (the V9 As-Built
// tutorial's `Rural w. Sub-cut`), an older Slope VI that draws five cut benches and four fill
// benches (the Road6 tutorial designs' LOWV), and a guard rail whose posts stand from the road
// edge's point code (the V10 tutorials' BR5). Read, shown, and written back unedited.
test.use({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', acceptDownloads: true })
test.setTimeout(240_000)

const LENGTH = 200
const CUT = 3
/** A parameter word: bit 15 + its U number. */
const word = (u: number) => String(2 ** (15 + u))
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
  // 4.4 m of road over 0.3 m of crushed course at 1:3; the subgrade 0.3 m down, its edge 4.4 + 0.9 m
  // out. The sub-cut's bottom 0.8 m down (0.5 m under the subgrade), 4.5 + 0.9 m out, then straight up.
  const lane: Param[] = [
    ['ROAD_WIDTH', 0, 4.4],
    ['CSTC_THICK', 0, 0.3],
    ['CSTC_SLOPE', 1, 0.333333333333],
    ['CZ_THICK', 0, 0.5],
    ['CZ_WIDTH', 0, 4.5],
    ['CZ_EXT_SLOPE', 1, 9999.99],
    ['SG_DEPTH', 0, 0, '-CSTC_THICK'],
    ['CZ_DEPTH', 0, 0, '-(CSTC_THICK + CZ_THICK)'],
  ]
  const roadway = (c: number, side: 'left' | 'right') => [
    `T0-C${c}=2,RDWY,Rural w. Sub-cut!^!Roadway.,${lane.length},0,146`,
    `T0-C${c}-F0=2,SGL,SC-Bot,${sideBits(side)},2,0,0,-,0,0,--,0,${word(7)},0,0`,
    `T0-C${c}-F0-L0=4.5,0,69148,-1,SG0-,1,0,-0,${word(1)},${word(2)},0,-1,4`,
    `T0-C${c}-F0-L1=0,999999,69148,-1,SG1-,0,0,5,-1`,
    `T0-C${c}-F1=1,SGL,Base-Bottom,${sideBits(side)},1,0,0,-,0,0,--,0,${word(6)},0,0`,
    `T0-C${c}-F1-L0=4.4,0,69148,-1,RE-,1,0,-0,${word(1)},${word(2)},0,-1,0`,
    ...params(c, lane),
  ]
  // Slope VI as the Road6 designs hold it: five Cut Slope and four Fill Slope fragments, no
  // MaxNumberBenches; 4 m faces at 0.5:1 (BenchSlope 2) and 3 m benches.
  const benches = (c: number, side: 'left' | 'right') => [
    `T0-C${c}=11,SLPS,Slope VI - Benches!^!Benches.,8,0,145`,
    ...[...Array(5).keys()].map((k) => `T0-C${c}-F${k}=1,SLPL,Cut Slope,${sideBits(side)},1,0,0,-`),
    `T0-C${c}-F5=1,SLPL,CutClose,${sideBits(side)},1,0,0,-`,
    ...[...Array(4).keys()].map((k) => `T0-C${c}-F${6 + k}=1,SLPL,Fill Slope,${sideBits(side)},1,0,0,-`),
    `T0-C${c}-F10=1,SLPL,FillClose,${sideBits(side)},1,0,0,-`,
    ...params(c, [
      ['bApplyInCut', 0, 1],
      ['bApplyInFill', 0, 1],
      ['FinalCutSlp', 1, 1],
      ['FinalFillSlp', 1, 0.666667],
      ['BenchSlope', 1, 2],
      ['BenchHeight', 0, 4],
      ['BenchBaseWidth', 0, 3],
      ['BenchBaseSlope', 1, 0],
    ]),
  ]
  // A guard rail whose posts stand from the road edge (RE-), 0.5 m past it.
  const rail = (c: number, side: 'left' | 'right') => [
    `T0-C${c}=1,Guard Rail,Guard Rail,3,0,2`,
    `T0-C${c}-F0=1,SLPR,Post,${sideBits(side)},3,0,0,RE-`,
    `T0-C${c}-F0-L0=1,999999,69148,-1,GP1-,0,0,-1,-1`,
    ...params(c, [
      ['POST_THICKNESS', 0, 0.2],
      ['POST_HEIGHT', 0, 0.8],
      ['POST_OFFSET', 0, 0.5],
    ]),
  ]
  const dsn = [
    '[Software]',
    'Version=11.000',
    'Version2=11.0.673.0',
    '[design]',
    'surface=Spur.terx',
    'units=10000',
    // The mass-haul display settings every RoadEng design holds.
    'MHlengths=150,1000,0',
    'MHcutItems=1,SG',
    'MHfillItems=0,SG',
    '[LocationParms]',
    '0=999999999,0,0,0,0,0,0,0,0,0,-,*1,999999,-,999999,-,OB,SC,SC,RE,RE,0,0,-1,-1,0,0,0,0,RE,RE,9999,999999000,1',
    'nparams=1',
    '[TemplatesSct]',
    'T0=6,SC,Sub-cut spur,-0.02,-0.02,1,0,2,2',
    ...roadway(0, 'left'),
    ...roadway(1, 'right'),
    ...benches(2, 'left'),
    ...benches(3, 'right'),
    ...rail(4, 'left'),
    ...rail(5, 'right'),
    '',
  ].join('\r\n')
  return {
    dsn,
    bytes: zipSync({
      'Location1.dsn': strToU8(dsn),
      'Location1.ds2': strToU8(ds2),
      'Location1.ds1': new Uint8Array(72),
    }),
  }
}

async function readout(page: Page, label: string) {
  return page.evaluate((name) => {
    const cell = [...document.querySelectorAll('*')].find(
      (e) => e.children.length === 0 && e.textContent?.trim() === `${name}:`,
    )
    return cell?.parentElement?.textContent?.slice(name.length + 1).trim() ?? null
  }, label)
}

test('a RoadEng roadway’s own sub-cut, Slope VI bench counts and an edge-placed guard rail are read and written back', async ({
  page,
}, info) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://**', (route) => route.abort())
  await replaceSavedProjectWhenAsked(page)
  await dismissExampleNoticeWhenShown(page)
  await openWorkbench(page, '/dev/forestry/road-design?example=training')

  const built = design()
  await page.getByRole('button', { name: 'Import line', exact: true }).click()
  await page
    .getByTestId('road-file-input')
    .setInputFiles({ name: 'Subcut.dsnx', mimeType: 'application/zip', buffer: Buffer.from(built.bytes) })
  const question = page.getByTestId('road-terrain-import-question')
  await choose(question.getByRole('combobox', { name: 'CRS of the design' }), '3157')
  await question.getByRole('button', { name: 'Import', exact: true }).click()
  const imported = page.getByText(/Imported from Subcut\.dsnx/).first()
  await expect(imported).toBeVisible({ timeout: 60_000 })
  await expect(imported).toContainText(
    'Rural w. Sub-cut builds a sub-cut under its subgrade (SC-Bot): 0.5 m deep, out to 5.4 m from the centreline, its outside face vertical',
  )
  await expect(imported).toContainText(
    'Slope VI - Benches benches the fill batter: 4 m faces at 0.5:1 and 3 m benches, up to 4',
  )
  await expect(imported).toContainText(
    'Guard Rail stands 5.8 m from the centreline on the left, 0.5 m past the road edge',
  )
  await choose(page.getByLabel('Active road').first(), { label: /Subcut/ })

  // The sub-cut is part of the section and of its quantities.
  const station = page.getByRole('spinbutton', { name: 'Station' }).first()
  await station.fill('100')
  await station.press('Enter')
  await expect.poll(() => readout(page, 'L-Stn')).toBe('0+100.0')
  await expect(page.locator('[data-testid^="road-section-structure-sub-cut"]').first()).toBeAttached()
  await page.screenshot({ path: info.outputPath('walls-section.png') })

  await page.getByRole('tab', { name: 'Section', exact: true }).first().click()
  await openRoadPanel(page, 'Benches, walls, barriers and sub-cuts')
  const editor = page.getByTestId('road-section-structures')
  const sub = editor.getByTestId('road-subcut-left')
  await expect(sub.getByLabel(/^Depth/)).toHaveValue('0.5')
  await expect(sub.getByLabel(/^Width from centreline/)).toHaveValue('5.4')
  await expect(editor.getByTestId('road-benches-left-cut').getByLabel(/^Benches/)).toHaveValue('5')
  await expect(editor.getByTestId('road-benches-left-fill').getByLabel(/^Benches/)).toHaveValue('4')
  await expect(
    editor
      .getByTestId('road-section-barrier')
      .first()
      .getByLabel(/^Offset from centreline/),
  ).toHaveValue('5.8')
  await expect(page.getByTestId('road-structure-quantities')).toContainText('Rural w. Sub-cut SC-Bot')
  await editor.screenshot({ path: info.outputPath('walls-structures.png') })

  // Unedited, the design goes back with its .dsn as read and [PGMaps] after it.
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const button = await chooseExport(page, 'RoadEng design')
  const download = page.waitForEvent('download')
  await button.click()
  const chunks: Buffer[] = []
  for await (const part of (await (await download).createReadStream())!) chunks.push(Buffer.from(part))
  const dsn = strFromU8(unzipSync(new Uint8Array(Buffer.concat(chunks)))['Location1.dsn'], true)
  expect(dsn.slice(0, dsn.indexOf('[PGMaps]'))).toBe(built.dsn)
  expect(errors).toEqual([])
})
