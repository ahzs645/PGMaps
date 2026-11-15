import { expect, test } from '@playwright/test'
import { openRoadPanel } from './road-sidebar'
import { openWorkbench } from './road-workbench'
import { choose } from './styled-select'

test.use({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 }, actionTimeout: 15_000 })
test.setTimeout(180_000)

// A generated Softree ASCII traverse with field notes at every station: labels, ground layers with
// depths, a culvert, HI/HT, a backshot, side-shot depths, slopes beyond the shots, an IFS shot (a
// located point) and a station equation (50 written where the distances give 45.5).
const lines = [
  'V3 PGMaps test',
  '0.000,45.000,,20.000,,6.000,Start,,500000.000,5970000.000,700.000,7,,,,HP,0.300,RK,1.200,SD,1.500,1.400,4.000,-10.000,0.100,,0.000,-8.000,,,5.000,5.000,0.200,0.400,0.000,6.000,,,0,0',
  '20.000,60.250,225.100,25.500,,-3.500,Culvert,between,,,,0,600.000xx2.500x150.000x0x0.000x,10.000,30.000,OR,0.150,,,,,,0.000,,,,0.000,,,,0.000,,,,0.000,,,,0,0',
  '45.500,300.000,,12.000,,2.000,Spring,,,,,8,,,,,,,,,,,0.000,,,,0.000,,,,0.000,,,,0.000,,,,0,0',
  '50.000,350.000,,31.250,,12.000,TP3,,,,,0,,,,,,,,,1.600,1.600,6.500,4.000,,0.050,0.000,,,,0.000,,,,0.000,,,,0,0',
  '81.250,,,,,,End,,,,,0,,,,,,,,,,,0.000,,,,0.000,,,,0.000,,,,0.000,,,,0,0',
]
const traverse = lines.join('\r\n') + '\r\n'

test('a traverse file’s field notes are shown, corrected and written back in the traverse file', async ({
  page,
}, info) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await openWorkbench(page, '/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await page
    .getByRole('tablist', { name: 'Road workflow', exact: true })
    .getByRole('tab', { name: 'Terrain', exact: true })
    .click()
  await openRoadPanel(page, 'Survey field book')
  const book = page.getByTestId('road-survey-field-book')
  const notes = page.getByTestId('road-survey-field-notes')

  const load = async (text: string) => {
    await page
      .getByLabel('Traverse file', { exact: true })
      .setInputFiles({ name: 'detailed.asc', mimeType: 'text/plain', buffer: Buffer.from(text) })
    // Traverse files state no unit: it is asked for every file.
    await choose(page.getByRole('combobox', { name: 'Traverse measured in', exact: true }), '1')
    await book.getByRole('button', { name: 'Read traverse', exact: true }).click()
    await expect(notes).toBeVisible()
  }
  await load(traverse)

  // Each station with notes reads at a glance; the IFS shot is a located point.
  const station = (name: string) => notes.getByRole('button', { name: `Field notes at station ${name}`, exact: true })
  await expect(station('Start')).toContainText('HP 0.30 / RK 1.20 / SD')
  await expect(station('Start')).toContainText('HI 1.50 · HT 1.40 m')
  await expect(station('20.000')).toContainText('Culvert 600 mm')
  await expect(station('50.000')).toContainText('TP3')
  await expect(station('81.250')).toContainText('End')
  await expect(page.getByTestId('road-survey-located-points')).toContainText('Spring')
  await expect(page.getByTestId('road-survey-located-points')).toContainText('from 20.000')
  await expect(
    page.getByTestId('road-survey-station-equations').getByLabel('Equation 1 ahead station (m)'),
  ).toHaveValue('50')
  await notes.scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('survey-field-notes.png') })

  // Correct the culvert's size as a field note would be.
  await station('20.000').click()
  const culvert = page.getByTestId('road-survey-culvert')
  await expect(culvert.getByLabel('Diameter or height (mm)')).toHaveValue('600')
  await culvert.getByLabel('Diameter or height (mm)').fill('750')
  await culvert.getByLabel('Diameter or height (mm)').press('Tab')
  await expect(station('20.000')).toContainText('Culvert 750 mm')
  await page.getByTestId('road-survey-station-notes').screenshot({ path: info.outputPath('survey-culvert-edit.png') })

  // Written back in its own format and unit, only the culvert's field changes.
  const pending = page.waitForEvent('download')
  await book.getByRole('button', { name: 'Export traverse file', exact: true }).click()
  const download = await pending
  expect(download.suggestedFilename()).toBe('survey-traverse.asc')
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  const exported = Buffer.concat(chunks).toString('utf8')
  expect(exported.split('\r\n')).toEqual(
    traverse.split('\r\n').map((line, i) => (i === 2 ? line.replace('600.000xx', '750.000xx') : line)),
  )

  // Read back, the corrected culvert is there.
  await load(exported)
  await expect(station('20.000')).toContainText('Culvert 750 mm')
  await station('20.000').click()
  await expect(page.getByTestId('road-survey-culvert').getByLabel('Diameter or height (mm)')).toHaveValue('750')

  // Saved to the project, the book then saves in place.
  await book.getByRole('button', { name: 'Save field book to project', exact: true }).click()
  await expect(book.getByRole('button', { name: 'Save Survey 1', exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath('survey-field-notes-reloaded.png') })
  expect(errors).toEqual([])
})
