import { expect, test, type Page } from '@playwright/test'
import { strFromU8, unzipSync, zipSync } from 'fflate'
import { openWorkbench } from './road-workbench'
import { chooseExport, replaceSavedProjectWhenAsked } from './road-files'
import { culvertDetails, selectCulvert } from './road-culverts'

// Culverts placed in a RoadEng design (.ds1). The example road is written as a RoadEng design, two
// culvert records in RoadEng's layout (this file's own values, never Softree's samples) are put in
// its .ds1 behind a floating label, and the design is opened: both culverts are on the road with
// what PGMaps has no field for listed under them, the values RoadEng computes (Auto) named. One is edited and one added; the design written back changes only the
// edited record's fields and adds the new one in station order.
test.use({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', acceptDownloads: true })
test.setTimeout(240_000)

async function downloadDesign(page: Page): Promise<Uint8Array> {
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

/** A floating label in section 1: text, then a 60-byte label format. */
const LABEL = 'Tie-in point%#%\n12.5,-3.25,2,-1'
const label = [LABEL.length, 0, ...[...LABEL].map((c) => c.charCodeAt(0)), ...new Array(60).fill(0)]

/**
 * A `.ds1` laid out as RoadEng writes one: three chunks, section 2 holding the records, section 1 a
 * floating label whose header states one byte fewer than it holds, as Softree's own files do.
 */
function ds1(records: string[]): Uint8Array {
  const payload = records.flatMap((r) => [r.length & 0xff, r.length >> 8, ...[...r].map((c) => c.charCodeAt(0))])
  const header = (section: number, count: number, size: number) => {
    const h = new Uint8Array(24)
    const v = new DataView(h.buffer)
    v.setUint16(0, 12, true)
    v.setUint16(2, section, true)
    v.setUint32(4, count, true)
    v.setUint32(8, size, true)
    return [...h]
  }
  return new Uint8Array([
    ...header(1, 1, label.length - 1),
    ...label,
    ...header(2, records.length, payload.length),
    ...payload,
    ...header(3, 0, 0),
  ])
}

/** Section 2's records of a `.ds1`. */
function records(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const second = 24 + label.length
  const count = view.getUint32(second + 4, true)
  const out: string[] = []
  let at = second + 24
  for (let k = 0; k < count; k++) {
    const length = view.getUint16(at, true)
    out.push(strFromU8(bytes.subarray(at + 2, at + 2 + length), true))
    at += 2 + length
  }
  return out
}

test('culverts placed in a RoadEng design are read, edited, added and written back', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://**', (route) => route.abort())
  await replaceSavedProjectWhenAsked(page)
  await openWorkbench(page, '/dev/forestry/road-design')
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

  const parts = unzipSync(await downloadDesign(page))
  const stations = strFromU8(parts['Location1.ds2'], true)
    .split(/\r?\n/)
    .filter((l) => l.startsWith('110,'))
    .map((l) => Number(l.split(',')[5]))
  const first = stations[0]
  const s1 = (first + 120).toFixed(3),
    s2 = (first + 260.5).toFixed(3)
  const stream = `Spring creek%#%|1,${s1},3.40282346639e+38,900,75,-2,7.5,6.25,0,4508,2,0, 0, 1, 1, 0.6, 3, 2, 0, 3.40282346639e+38`
  const drain = `%#%|0,${s2},3.40282346639e+38,450,95,3,6,6,1.2,272,2,0,0,0,0,0,3,2,0,3.40282346639e+38`
  parts['Location1.ds1'] = ds1([stream, drain])
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open', exact: true }).first().click()
  await (
    await chooser
  ).setFiles({ name: 'Placed culverts.dsnx', mimeType: 'application/zip', buffer: Buffer.from(zipSync(parts)) })
  await expect(page.getByText(/2 placed culverts read from its \.ds1/).first()).toBeAttached({ timeout: 60_000 })

  await page.getByRole('tab', { name: 'Engineering', exact: true }).first().click()
  await page.getByRole('tab', { name: 'Drainage', exact: true }).first().click()
  await expect(page.getByTestId('roadeng-design-culverts')).toHaveText(
    /^2 of this road’s 2 culverts are from its RoadEng design \(Location1\.ds1\)/,
  )
  await expect(page.getByTestId('road-culvert-inventory').getByRole('button', { name: /^Edit / })).toHaveCount(2)
  await selectCulvert(page, 'Spring creek', 'Review')
  const facts = page.getByTestId('culvert-roadeng-design-facts')
  await expect(facts).toHaveCount(1)
  await expect(facts).toHaveText(
    `RoadEng design culvert 1 · L-station ${s1} m · skew 75° clockwise from the L-line · 7.50 m left and 6.25 m right of it · depth 0.00 m · RoadEng computes its gradient and length (Auto) · template override: ditch 1.00 m wide and 0.60 m deep, held 3.00 m, tapered over 2.00 m · option flags 4508`,
  )
  await culvertDetails(page, 'Geometry')
  await expect(page.getByRole('textbox', { name: 'Culvert 1 name' })).toHaveValue('Spring creek')
  await expect(page.getByLabel('Culvert 1 skew from square (°)', { exact: true })).toHaveValue('-15')
  await selectCulvert(page, 'Cross-drain 2')
  await expect(page.getByLabel('Culvert 2 diameter (m)', { exact: true })).toHaveValue('0.45')
  await page
    .getByTestId('road-engineering-controls')
    .screenshot({ path: test.info().outputPath('placed-culverts.png') })

  // Unedited, the .ds1 goes back as it was read, the label included.
  const unedited = unzipSync(await downloadDesign(page))
  expect(unedited['Location1.ds1']).toEqual(parts['Location1.ds1'])
  expect(records(unedited['Location1.ds1'])).toEqual([stream, drain])

  // The first culvert made 1.2 m and its RoadEng gradient −3 %; a cross-drain added at the start.
  await page.getByRole('tab', { name: 'Engineering', exact: true }).first().click()
  await page.getByRole('tab', { name: 'Drainage', exact: true }).first().click()
  await selectCulvert(page, 'Spring creek')
  const diameter = page.getByLabel('Culvert 1 diameter (m)', { exact: true })
  await diameter.fill('1.2')
  await diameter.press('Enter')
  await culvertDetails(page, 'Review')
  const gradient = page.getByLabel('Culvert 1 RoadEng gradient (%)', { exact: true })
  await gradient.fill('-3')
  await gradient.press('Enter')
  // Inspecting a culvert moves the linked station; this new pipe belongs at the road's start.
  await page.getByRole('spinbutton', { name: 'Selected station metres', exact: true }).fill('0')
  await page.getByRole('spinbutton', { name: 'Selected station metres', exact: true }).press('Enter')
  await page.getByRole('button', { name: 'Add culvert at station', exact: true }).click()
  await expect(page.getByTestId('roadeng-design-culverts')).toHaveText(
    /^2 of this road’s 3 culverts are from its RoadEng design \(Location1\.ds1\)/,
  )
  const written = records(unzipSync(await downloadDesign(page))['Location1.ds1'])
  expect(written).toHaveLength(3)
  expect(written[0]).toMatch(/^Culvert 3%#%\|0,[\d.]+,3\.40282346639e\+38,\d+(\.\d+)?,90,/)
  // The typed gradient goes back with RoadEng's Gradient Auto (bit 2) off: 4508 → 4504.
  expect(written[1]).toBe(stream.replace(',900,75,-2,', ',1200,75,-3,').replace(',4508,', ',4504,'))
  expect(written[2]).toBe(drain)
  expect(errors).toEqual([])
})
