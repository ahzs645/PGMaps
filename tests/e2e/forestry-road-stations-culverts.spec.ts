import { expect, test, type Page } from '@playwright/test'
import { openRoadPanel } from './road-sidebar'
import { openWorkbench } from './road-workbench'
import { chooseExport, replaceSavedProjectWhenAsked } from './road-files'
import { choose } from './styled-select'
import type { RoadProject } from '../../src/pages/dev-forestry-roads/types'

// Station equations and RoadEng's culverts on a road, from generated files only. The example road is
// written as LandXML and read back with a start station of 1+000 and a station equation (1+100 back
// = 2+000 ahead): every station label, the station box and the exports name its stations so. A
// Softree ASCII traverse run along the road's first leg, with two culverts in its CREEK field, is
// read as a field book; RoadEng's Culverts Re-Import is the Drainage tab's Read from book, and Write
// to book puts an edited culvert back into the book RoadEng re-imports from.
test.use({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', acceptDownloads: true })
test.setTimeout(300_000)

async function download(page: Page, label: string) {
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const button = await chooseExport(page, label)
  const pending = page.waitForEvent('download')
  await button.click()
  const file = await pending
  const chunks: Buffer[] = []
  for await (const part of (await file.createReadStream())!) chunks.push(Buffer.from(part))
  await page.keyboard.press('Escape')
  return Buffer.concat(chunks).toString('utf8')
}
function workflow(page: Page, name: string) {
  return page.getByRole('tablist', { name: 'Road workflow', exact: true }).getByRole('tab', { name, exact: true })
}

/** A Softree ASCII traverse of four legs along a line, culverts at its first and third stations. */
function traverseAlong(start: [number, number], end: [number, number]) {
  const azimuth = ((Math.atan2(end[0] - start[0], end[1] - start[1]) * 180) / Math.PI + 360) % 360
  const step = Math.min(20, Math.hypot(end[0] - start[0], end[1] - start[1]) / 4)
  const az = (a: number) => ((a % 360) + 360) % 360
  const f = (n: number) => n.toFixed(3)
  const tail = ',,,,,,,,,,0.000,,,,0.000,,,,0,0'
  const lines = [
    'V3 PGMaps culvert test',
    `0.000,${f(azimuth)},,${f(step)},,0.000,Start,,${f(start[0])},${f(start[1])},700.000,7,${tail}`,
    // Square to the road, flowing to its right.
    `${f(step)},${f(azimuth)},,${f(step)},,0.000,Creek A,,,,,0,600.000xx2.500x${f(az(azimuth + 90))}x0x0.000x${tail}`,
    `${f(2 * step)},${f(azimuth)},,${f(step)},,0.000,,,,,,0,${tail}`,
    // A 1.2 m by 2 m box 20° off square.
    `${f(3 * step)},${f(azimuth)},,${f(step)},,0.000,Creek B,,,,,0,1200.000x2000.000x4.000x${f(az(azimuth + 110))}x0x0.000x${tail}`,
    `${f(4 * step)},,,,,,End,,,,,0,${tail}`,
  ]
  return lines.join('\r\n') + '\r\n'
}

test('station equations name a road’s stations, and RoadEng culverts are read from and written to its traverse', async ({
  page,
}, info) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await replaceSavedProjectWhenAsked(page)
  await openWorkbench(page, '/dev/forestry/road-design')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 })
  // The example's card, dismissed before a dialog opens: dismissing it later closes the dialog.
  const example = page.getByTestId('road-example-start')
  if (
    await example.waitFor({ timeout: 10_000 }).then(
      () => true,
      () => false,
    )
  )
    await example.getByRole('button', { name: 'Dismiss the example notice', exact: true }).click()

  // The example road as LandXML, given a start station and an equation.
  const xml = await download(page, 'LandXML alignment')
  expect(xml).toMatch(/staStart="0">/)
  expect(xml).not.toMatch(/StaEquation/)
  const shifted = xml
    .replace(/<Alignment name="[^"]*"([^>]*)staStart="0">/, '<Alignment name="Stationed spur"$1staStart="1000">')
    .replace(
      /<\/CoordGeom>/,
      '</CoordGeom><StaEquation staInternal="1100" staBack="1100" staAhead="2000" desc="New survey"/>',
    )
    .replace(/staStart="([\d.]+)"(?=[^>]*>\s*<Start>)/g, (_, s) => `staStart="${(Number(s) + 1000).toFixed(3)}"`)
    .replace(
      /<(PVI|ParaCurve)([^>]*)>([\d.]+) /g,
      (_, tag, attrs, s) => `<${tag}${attrs}>${(Number(s) + 1000).toFixed(3)} `,
    )
    .replace(/(<ProfSurf[^>]*><PntList2D>)([^<]*)/g, (_, head, list: string) => {
      const n = list.trim().split(/\s+/)
      return head + n.map((v, k) => (k % 2 ? v : (Number(v) + 1000).toFixed(3))).join(' ')
    })
    .replace(/<CrossSect sta="([\d.]+)"/g, (_, s) => `<CrossSect sta="${(Number(s) + 1000).toFixed(3)}"`)
  const first = /<Line[^>]*><Start>([\d.]+) ([\d.]+)<\/Start><End>([\d.]+) ([\d.]+)<\/End>/.exec(xml)!
  const start: [number, number] = [Number(first[2]), Number(first[1])]
  const end: [number, number] = [Number(first[4]), Number(first[3])]
  await page.getByRole('button', { name: 'Import line', exact: true }).click()
  await page
    .getByTestId('road-file-input')
    .setInputFiles({ name: 'Stationed road.xml', mimeType: 'application/xml', buffer: Buffer.from(shifted) })
  await expect(page.getByText(/with 1 station equation, which name its stations/).first()).toBeAttached({
    timeout: 60_000,
  })
  await choose(page.getByLabel('Active road').first(), { label: /Stationed spur/ })

  // The Stationing section states the start and the equation, and the station box takes names.
  await workflow(page, 'Design').click()
  // Folded, the section's row states the start and the count.
  await expect(page.getByRole('button', { name: 'Stationing Start 1+000.0 · 1 equation', exact: true })).toBeVisible()
  await openRoadPanel(page, 'Stationing')
  const section = page.getByTestId('road-stationing-section')
  await expect(page.getByRole('spinbutton', { name: 'Start station', exact: true })).toHaveValue('1000')
  await expect(page.getByRole('spinbutton', { name: 'Equation 1 back station', exact: true })).toHaveValue('1100')
  await expect(page.getByRole('spinbutton', { name: 'Equation 1 ahead station', exact: true })).toHaveValue('2000')
  const box = page.getByRole('spinbutton', { name: 'Selected station metres', exact: true })
  await box.fill('2050')
  await box.press('Enter')
  await expect(box).toHaveValue('2050')
  // The station bar's readout names it.
  await expect(page.getByRole('status').filter({ hasText: '2+050.0' }).first()).toBeVisible()
  // A station the equation skips goes to the equation, and says so.
  await box.fill('1900')
  await box.press('Enter')
  await expect(page.getByText(/A station equation skips station 1,900; showing 2\+000\.0\./).first()).toBeVisible()
  await section.scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('stationing-section.png') })
  // The station table marks the equation between the rows it falls between.
  const detail = page.getByRole('combobox', { name: 'Road detail view', exact: true })
  await choose(detail, { label: 'Stations' })
  await expect(page.getByTestId('road-station-equation-row')).toHaveText(
    'Station equation: 1+100.0 back = 2+000.0 ahead · New survey',
  )
  await page.getByTestId('road-station-table').screenshot({ path: info.outputPath('station-table.png') })

  // The station CSV and LandXML name the stations; the equation travels.
  const again = await download(page, 'LandXML alignment')
  expect(again).toContain('staStart="1000.000"')
  // The internal station is the road's own chainage from the start; the names are the file's.
  expect(again).toMatch(
    /<StaEquation staInternal="1\d{3}\.\d{3}" staBack="1100\.000" staAhead="2000\.000" staIncrement="increasing" desc="New survey"\/>/,
  )

  // A traverse along the road's first leg, with two culverts, read as a field book.
  await workflow(page, 'Terrain').click()
  await openRoadPanel(page, 'Survey field book')
  const book = page.getByTestId('road-survey-field-book')
  await page
    .getByLabel('Traverse file', { exact: true })
    .setInputFiles({ name: 'p-line.asc', mimeType: 'text/plain', buffer: Buffer.from(traverseAlong(start, end)) })
  await choose(page.getByRole('combobox', { name: 'Traverse measured in', exact: true }), '1')
  await book.getByRole('button', { name: 'Read traverse', exact: true }).click()
  await expect(page.getByTestId('road-survey-field-notes')).toBeVisible()
  await book.getByRole('button', { name: 'Save field book to project', exact: true }).click()

  // RoadEng's Culverts Re-Import: the book's culverts onto the road.
  await workflow(page, 'Engineering').click()
  await page
    .getByRole('tablist', { name: 'Engineering inputs', exact: true })
    .getByRole('tab', { name: 'Drainage', exact: true })
    .click()
  const panel = page.getByTestId('roadeng-culverts')
  await expect(panel).toContainText('2 culverts in Survey 1.')
  await panel.getByRole('button', { name: 'Read from book', exact: true }).click()
  await expect(panel).toContainText('2 culverts read from Survey 1; 0 removed.')
  const facts = page.getByTestId('culvert-roadeng-facts')
  await expect(facts).toHaveCount(2)
  await expect(facts.nth(1)).toContainText('box 2.00 m wide')
  await expect(page.getByRole('spinbutton', { name: 'Culvert 2 skew from square (°)', exact: true })).toHaveValue('20')
  await expect(page.getByRole('spinbutton', { name: 'Culvert 1 diameter (m)', exact: true })).toHaveValue('0.6')
  // The culvert's station field takes the road's station names.
  const at = Number(await page.getByRole('spinbutton', { name: 'Culvert 1 station', exact: true }).inputValue())
  expect(at).toBeGreaterThan(1000)
  await panel.scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('roadeng-culverts.png') })

  // A bigger pipe goes back into the book.
  const diameter = page.getByRole('spinbutton', { name: 'Culvert 1 diameter (m)', exact: true })
  await diameter.fill('0.75')
  await diameter.press('Tab')
  await panel.getByRole('button', { name: 'Write to book', exact: true }).click()
  await expect(panel).toContainText('2 culverts written to Survey 1; 0 it held along the road removed.')

  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save project JSON', exact: true }).click()
  const file = await pending
  const chunks: Buffer[] = []
  for await (const part of (await file.createReadStream())!) chunks.push(Buffer.from(part))
  await page.keyboard.press('Escape')
  const project = JSON.parse(Buffer.concat(chunks).toString('utf8')) as RoadProject
  const road = project.alignments.find((a) => a.id === project.activeAlignmentId)!
  expect(road.stationing).toMatchObject({ startStation: 1000, equations: [{ ahead: 2000, description: 'New survey' }] })
  expect(road.engineering?.culverts.map((c) => c.roadEng?.traverseStation)).toEqual([1, 3])
  const culverts = project.surveyBooks![0].softree!.extras.filter((e) => e.culvert).map((e) => e.culvert!)
  // The edited pipe is written afresh; the box, unchanged, keeps the field as read.
  expect(culverts[0].sizeY).toBeCloseTo(750, 6)
  expect(culverts[0].raw).toBeUndefined()
  expect(culverts[1].raw).toMatch(/^1200\.000x2000\.000x4\.000x/)
  expect(errors).toEqual([])
})
