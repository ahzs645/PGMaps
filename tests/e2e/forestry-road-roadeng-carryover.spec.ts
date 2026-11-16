import { expect, test, type Page } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'
import { openWorkbench } from './road-workbench'
import { chooseExport, dismissExampleNoticeWhenShown, replaceSavedProjectWhenAsked } from './road-files'

// What a RoadEng design carries that the designer once left out: a template range's transitions to
// its neighbours, minimum vertical curve and tangent lengths, and cost settings RoadEng has no field
// for. Set on the example road, written as a RoadEng design, read back from the file, and opened.
test.use({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', acceptDownloads: true })
test.setTimeout(240_000)

async function setNumber(page: Page, label: string, value: number) {
  const field = page.getByLabel(label, { exact: true }).first()
  await field.scrollIntoViewIfNeeded()
  await field.fill(String(value))
  await field.press('Enter')
  await field.blur()
}
async function goTo(page: Page, chainage: number) {
  const station = page.getByRole('spinbutton', { name: 'Station' }).first()
  await station.fill(String(chainage))
  await station.press('Enter')
  await expect.poll(() => readout(page, 'L-Stn')).toBe(`0+${String(chainage).padStart(3, '0')}.0`)
}
/** The section readout's value for a label, `Width L/R` and the like. */
async function readout(page: Page, label: string) {
  return page.evaluate((name) => {
    const cell = [...document.querySelectorAll('*')].find(
      (e) => e.children.length === 0 && e.textContent?.trim() === `${name}:`,
    )
    return cell?.parentElement?.textContent?.slice(name.length + 1).trim() ?? null
  }, label)
}

/** Closes the cost settings dialog and waits until it has gone, so the sidebar takes clicks again. */
async function closeCostSettings(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Haul & cost settings' })
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toBeHidden()
}
test('template transitions, minimum lengths and costs go out to RoadEng and come back', async ({ page }) => {
  await page.route('https://**', (route) => route.abort())
  await replaceSavedProjectWhenAsked(page)
  await dismissExampleNoticeWhenShown(page)
  await openWorkbench(page, '/dev/forestry/road-design')

  // A named template 6 m a side over 500–600 m, changing from the base section over 20 m each end.
  await page.getByRole('tab', { name: 'Engineering', exact: true }).first().click()
  await page.getByRole('button', { name: 'Add named template', exact: true }).click()
  const base = Number(await page.getByLabel('Template left width (m)', { exact: true }).inputValue())
  await setNumber(page, 'Template left width (m)', 6)
  await setNumber(page, 'Template right width (m)', 6)
  await page.getByRole('button', { name: 'Save template', exact: true }).click()
  await goTo(page, 500)
  await page.getByRole('button', { name: 'Assign selected template', exact: true }).click()
  await expect(page.getByLabel('Assignment 1 start (m)', { exact: true })).toHaveValue('500')
  await setNumber(page, 'Assignment 1 transition in (m)', 20)
  await setNumber(page, 'Assignment 1 transition out (m)', 20)

  // Halfway through the transition in, the section is halfway between the two, and says so.
  await goTo(page, 510)
  await expect.poll(() => readout(page, 'Width L/R')).toBe(`${(base + 6) / 2} / ${(base + 6) / 2}`)
  await expect
    .poll(() => readout(page, 'Tmpl L/R'))
    .toMatch(/^Base section → .+ · transition \/ Base section → .+ · transition$/)

  // Use this section for… gives the full-strength section to 800–900 with 10 m transitions.
  await goTo(page, 550)
  await page.getByRole('button', { name: 'Section view options' }).first().click()
  await page.getByRole('button', { name: 'Use this section for…', exact: true }).click()
  const form = page.getByTestId('road-section-range')
  await form.getByLabel('Range from station metres').fill('800')
  await form.getByLabel('Range to station metres').fill('900')
  await form.getByLabel('Transition at each end metres').fill('10')
  await form.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(page.getByLabel('Assignment 2 start (m)', { exact: true })).toHaveValue('800')
  await expect(page.getByLabel('Assignment 2 transition in (m)', { exact: true })).toHaveValue('10')
  await expect(page.getByLabel('Assignment 2 transition out (m)', { exact: true })).toHaveValue('10')

  // Minimum vertical curve and tangent lengths, judged by Review.
  await page.getByRole('tab', { name: 'Design', exact: true }).first().click()
  const standards = page.getByTestId('road-vertical-standards')
  await standards.scrollIntoViewIfNeeded()
  if (!(await page.getByLabel('Min curve (m)', { exact: true }).isVisible())) await standards.click()
  await setNumber(page, 'Min curve (m)', 50)
  await setNumber(page, 'Min tangent (m)', 30)
  await page.getByRole('tab', { name: 'Review', exact: true }).first().click()
  const row = page.locator('[data-check="vertical-lengths"]')
  await expect(row).toHaveAttribute('data-state', /^(met|attention)$/)

  // A cost RoadEng has no field for.
  await page.getByRole('tab', { name: 'Engineering', exact: true }).first().click()
  await page.getByRole('tab', { name: 'Haul', exact: true }).first().click()
  await page.getByRole('button', { name: 'Haul & cost settings', exact: true }).click()
  await setNumber(page, 'Contingency (%)', 12)
  await closeCostSettings(page)

  // Written as a RoadEng design: the lengths in the optimizer standards, the rest in [PGMaps].
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const button = await chooseExport(page, 'RoadEng design')
  const download = page.waitForEvent('download')
  await button.click()
  const file = await download
  const path = await file.path()
  const chunks: Buffer[] = []
  for await (const part of (await file.createReadStream())!) chunks.push(Buffer.from(part))
  const dsn = strFromU8(unzipSync(new Uint8Array(Buffer.concat(chunks)))['Location1.dsn'], true)
  const optimizer = /^OptParmsNew=(.*)$/m.exec(dsn)![1].replace(/\r$/, '').split(',')
  expect([optimizer[3], optimizer[11], optimizer[28]]).toEqual(['50', '23', '30'])
  // A road made here keeps its nearest-site allocation and no pit of last resort, which a plain
  // RoadEng read would set otherwise (`ROADENG_READ_HAUL`).
  expect(dsn).toMatch(
    /^Costs=\{"version":1,"haul":\{"contingencyPercent":12,"allocation":"nearest","lastResort":false\}\}\r?$/m,
  )
  expect(dsn).toMatch(/"transitionInM":20,"transitionOutM":20/)
  expect(dsn).toMatch(/^Native=[0-9a-z]+-[0-9a-f]{8}\r?$/m)
  await page.keyboard.press('Escape')

  // Opened again: each comes back.
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open', exact: true }).first().click()
  await (await chooser).setFiles(path!)
  await page.getByRole('tab', { name: 'Engineering', exact: true }).first().click()
  await page.getByRole('tab', { name: 'Templates', exact: true }).first().click()
  await expect(page.getByLabel('Assignment 1 transition in (m)', { exact: true })).toHaveValue('20', {
    timeout: 60_000,
  })
  await expect(page.getByLabel('Assignment 2 transition out (m)', { exact: true })).toHaveValue('10')
  await page.getByRole('tab', { name: 'Haul', exact: true }).first().click()
  await page.getByRole('button', { name: 'Haul & cost settings', exact: true }).click()
  await expect(page.getByLabel('Contingency (%)', { exact: true }).first()).toHaveValue('12')
  await closeCostSettings(page)
  await page.getByRole('tab', { name: 'Design', exact: true }).first().click()
  await expect(page.getByLabel('Min curve (m)', { exact: true })).toHaveValue('50')
  await expect(page.getByLabel('Min tangent (m)', { exact: true })).toHaveValue('30')
})
