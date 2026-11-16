import { expect, test, type Page } from '@playwright/test'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { openWorkbench } from './road-workbench'
import { chooseExport, replaceSavedProjectWhenAsked } from './road-files'

// A RoadEng pit whose access station is past the road's end, and the costing a RoadEng design keeps
// of its vertical alignment. The example road is written as a RoadEng design, both are added to its
// .dsn as RoadEng writes them (a generated file, never Softree's samples), and the design is opened:
// the pit is a haul site at the road's end that goes back to RoadEng unchanged, and Compare with
// RoadEng… sets the stored costs beside the road's own with nothing exported.
test.use({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', acceptDownloads: true })
test.setTimeout(240_000)

async function downloadDesign(page: Page): Promise<Uint8Array> {
  // A click that lands as the example card is dismissed opens nothing: click until the dialog shows.
  await expect(async () => {
    if (!(await page.getByTestId('road-files-dialog').isVisible()))
      await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByTestId('road-files-dialog')).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 60_000 })
  const button = await chooseExport(page, 'RoadEng design')
  const pending = page.waitForEvent('download')
  await button.click()
  const file = await pending
  const chunks: Buffer[] = []
  for await (const part of (await file.createReadStream())!) chunks.push(Buffer.from(part))
  await page.keyboard.press('Escape')
  return new Uint8Array(Buffer.concat(chunks))
}

/** The design's `.dsn` with lines added at the top of `[section]`, which is made when absent. */
function addToSection(dsn: string, section: string, lines: string[]) {
  const header = `[${section}]`
  const at = dsn.indexOf(`${header}\r\n`)
  if (at < 0) return `${dsn.replace(/\r\n$/, '')}\r\n${header}\r\n${lines.join('\r\n')}\r\n`
  const after = at + header.length + 2
  return `${dsn.slice(0, after)}${lines.join('\r\n')}\r\n${dsn.slice(after)}`
}

test('a RoadEng pit off the road is a haul site, and the costs the design stores compare without an export', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://**', (route) => route.abort())
  await replaceSavedProjectWhenAsked(page)
  await openWorkbench(page, '/dev/forestry/road-design')
  // The example card arrives late, and dismissing it closes a dialog opened under it: dismiss it
  // before saving.
  const card = page.getByTestId('road-example-start')
  if (
    await card.waitFor({ timeout: 30_000 }).then(
      () => true,
      () => false,
    )
  ) {
    await card.getByRole('button', { name: 'Dismiss the example notice', exact: true }).click()
    await card.waitFor({ state: 'hidden' })
  }

  // The example road as RoadEng would hold it after a costing, with a borrow pit 500 m past its end.
  const parts = unzipSync(await downloadDesign(page))
  const stations = strFromU8(parts['Location1.ds2'], true)
    .split(/\r?\n/)
    .filter((l) => l.startsWith('110,'))
    .map((l) => Number(l.split(',')[5]))
  const [first, last] = [stations[0], stations[stations.length - 1]]
  const pit = `${(last + 500).toFixed(3)},100,9,0,1000,1,Far pit, ,0,0,0,0`
  let dsn = strFromU8(parts['Location1.dsn'], true)
  const used = [...dsn.matchAll(/^OptParms_Pit-(\d+)=/gm)].map((m) => Number(m[1]))
  dsn = addToSection(dsn, 'OptAlignCost-0', [
    `OptParms_CostSolution_v3=2,0,0,${first},${last},1234.5,6789,321,0,0,0.5,1716396832,-1,1`,
    `OptParms_Pit-${used.length ? Math.max(...used) + 1 : 0}=${pit}`,
  ])
  parts['Location1.dsn'] = strToU8(dsn, true)
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open', exact: true }).first().click()
  await (
    await chooser
  ).setFiles({
    name: 'Costed in RoadEng.dsnx',
    mimeType: 'application/zip',
    buffer: Buffer.from(zipSync(parts)),
  })
  await expect(
    page.getByText(/Pits off the road: Far pit \(access station [\d,.]+ m, [\d.]+ m past the road's end\)/).first(),
  ).toBeAttached({
    timeout: 60_000,
  })
  await expect(page.getByText(/the design stores RoadEng's last costing of vertical alignment/).first()).toBeAttached()

  // The pit is a site at the road's end, its access including the stretch past the end.
  await page.getByRole('tab', { name: 'Engineering', exact: true }).first().click()
  await page.getByRole('tab', { name: 'Haul', exact: true }).first().click()
  await page.getByRole('button', { name: 'Haul & cost settings', exact: true }).click()
  const costs = page.getByRole('dialog', { name: 'Haul & cost settings' })
  const past = costs.getByTestId('road-site-past-end')
  await expect(past).toHaveCount(1)
  await expect(past).toHaveText(/^Access joins \d+\.\d m past the road's end along its line/)
  const gap = Number(/joins (\d+\.\d) m/.exec((await past.textContent())!)![1])
  expect(gap).toBeGreaterThan(450)
  expect(gap).toBeLessThan(550)
  await expect(costs.getByRole('textbox', { name: /Haul site name/ }).last()).toHaveValue('Far pit')
  await costs.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(costs).toBeHidden()

  // Written back unedited, the pit is the line it was read from, at its own station.
  const again = strFromU8(unzipSync(await downloadDesign(page))['Location1.dsn'], true)
  expect(again).toMatch(new RegExp(`^OptParms_Pit-\\d+=${pit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\r?$`, 'm'))
  expect(again).toContain(`OptParms_CostSolution_v3=2,0,0,${first},${last},1234.5,6789,321,0,0,0.5,1716396832,-1,1`)

  // Compare with RoadEng… opens on the stored results: no file to choose.
  await page.goto('/dev/forestry/road-design?interface=ribbon')
  const ribbon = page.getByRole('region', { name: 'Command ribbon' })
  await ribbon.getByRole('tablist', { name: 'Ribbon tabs' }).getByRole('tab', { name: 'Review', exact: true }).click()
  await ribbon.getByRole('button', { name: 'Compare with RoadEng…', exact: true }).click()
  const dialog = page.getByTestId('softree-compare-dialog')
  await expect(dialog.getByTestId('softree-compare-file')).toHaveText(
    'Results stored in the RoadEng design · Location1',
  )
  await expect(dialog.getByRole('button', { name: 'Choose a file' })).toHaveCount(0)
  const totals = dialog.getByRole('table', { name: 'Totals' })
  await expect(totals.locator('thead')).toContainText('RoadEng')
  const haul = totals.locator('tbody tr').filter({ hasText: 'Haul' })
  await expect(haul).toContainText('1,234.50')
  await expect(totals.locator('tbody tr').filter({ hasText: 'Total' })).toContainText('8,344.50')
  const range = dialog.getByRole('table', { name: 'Stations' })
  await expect(range.locator('tbody tr[data-agrees="true"]')).toHaveCount(2)
  await expect(dialog).toContainText("RoadEng's last costing of vertical alignment")
  await page.screenshot({ path: test.info().outputPath('stored-results.png'), animations: 'disabled' })

  const csv = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download comparison CSV' }).click()
  const saved = await csv
  expect(saved.suggestedFilename()).toMatch(/-stored-results-compared\.csv$/)

  // The files are one switch away.
  await dialog.getByRole('button', { name: 'A RoadEng or Softree file', exact: true }).click()
  await expect(dialog.getByLabel('RoadEng or Softree file to compare', { exact: true })).toBeAttached()
  await expect(dialog.getByTestId('softree-compare-file')).toHaveCount(0)
  expect(errors).toEqual([])
})
