import { expect, test, type Page } from '@playwright/test'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { openWorkbench } from './road-workbench'
import { chooseExport, replaceSavedProjectWhenAsked } from './road-files'
import { choose } from './styled-select'

// A RoadEng design's P-line, from generated files only. The example road is written as a RoadEng
// design and given what a design with a P-line holds: `[design] roadname` naming a traverse and a
// station range whose ground is the default ground type (**). A traverse in RoadEng's own `.tr1`
// layout (this file's own stations and layers, never Softree's samples) is laid along the road.
// Opened together, the survey's layers become the road's horizons, Between and then Ahead; the
// RoadEng project written back carries the traverse as read and the changed GndRange. Opened
// without it, the ground stays unclassified until the traverse is read from the panel.
test.use({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', acceptDownloads: true })
test.setTimeout(300_000)

async function download(page: Page, label: string): Promise<Uint8Array> {
  await expect(async () => {
    if (!(await page.getByTestId('road-files-dialog').isVisible()))
      await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByTestId('road-files-dialog')).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 60_000 })
  const button = await chooseExport(page, label)
  const pending = page.waitForEvent('download')
  await button.click()
  const file = await pending
  const chunks: Buffer[] = []
  for await (const part of (await file.createReadStream())!) chunks.push(Buffer.from(part))
  await page.keyboard.press('Escape')
  return new Uint8Array(Buffer.concat(chunks))
}

async function open(page: Page, files: { name: string; bytes: Uint8Array }[]) {
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open', exact: true }).first().click()
  await (
    await chooser
  ).setFiles(files.map((f) => ({ name: f.name, mimeType: 'application/octet-stream', buffer: Buffer.from(f.bytes) })))
  const keep = page.getByRole('button', { name: 'Keep both', exact: true })
  if (
    await keep.waitFor({ timeout: 5_000 }).then(
      () => true,
      () => false,
    )
  )
    await keep.click()
}

async function showGround(page: Page) {
  await page.getByRole('tab', { name: 'Engineering', exact: true }).first().click()
  await page.getByRole('tab', { name: 'Ground', exact: true }).first().click()
  await expect(page.getByTestId('roadeng-pline')).toBeVisible()
}

test('a RoadEng design’s P-line gives the road its ground layers and goes back as read', async ({ page }) => {
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

  // The example road as a RoadEng design, given a P-line and ground taken from it.
  const parts = unzipSync(await download(page, 'RoadEng design'))
  let dsn = strFromU8(parts['Location1.dsn'], true)
  let ds2 = strFromU8(parts['Location1.ds2'], true)
  const codes = ds2
    .split(/\r?\n/)
    .filter((l) => l.startsWith('104,'))
    .map((l) => l.split(',')[1])
  if (codes.length < 2) {
    ds2 = ds2.replace(
      /^(100,[^\r\n]*\r?\n)/,
      '$1104,AA,Silt,66.7,100,1,0.9,12,4,0,8,0.6,4,2.6,2,0,0,0,\r\n104,BB,Till,66.7,100,1,0.9,20,4,0,8,0.6,4,2.6,2,1,0,0,\r\n',
    )
    codes.splice(0, codes.length, 'AA', 'BB')
  }
  const [top, below] = codes
  dsn = dsn.replace(/\[design\]\r?\n/, (m) => `${m}GndRange=0\r\nroadname=Spur line.tr1\r\n`)
  // As RoadEng saves it: no [PGMaps] section, and one station range over the road whose ground is `**`.
  dsn = dsn.replace(/\[PGMaps\][\s\S]*$/, '')
  dsn += `[LocationParms]\r\n0=999999999,0,0,0,0,0,0,0,0,0,-,*1,999999,-,999999,-,**,RE,RE,RE,RE,0,0,-1,-1,0,0,0,0,RE,RE,9999,999999000,1\r\nnparams=1\r\n`
  expect(dsn).toMatch(/,\*\*,/)
  parts['Location1.dsn'] = strToU8(dsn, true)
  parts['Location1.ds2'] = strToU8(ds2, true)
  const design = zipSync(parts)
  // The traverse: four stations on the road's own calculated stations, the first giving two
  // layers, the third one, the others carrying the one before.
  const stations = ds2
    .split(/\r?\n/)
    .filter((l) => l.startsWith('110,'))
    .map((l) => l.split(',').map(Number))
  const picks = [0, 1, 2, 3].map((k) => stations[Math.round((k * (stations.length - 1)) / 3)])
  let chain = 0
  const tr1 =
    [
      '100,100,7.001, PGMaps test traverse data file',
      ...picks.map((s, k) => {
        if (k) chain += Math.hypot(s[2] - picks[k - 1][2], s[3] - picks[k - 1][3])
        const ground = k === 0 ? `${top},0.5,${below},,` : k === 2 ? `${below},,,,` : ',,,,'
        return `101,${k},${chain.toFixed(3)},0,0,10,10,0,,,${s[2]},${s[3]},${s[4]},${k ? 0 : 7},,${ground},0,0,-5,5,0`
      }),
    ].join('\r\n') + '\r\n'
  const tr2 = '[ControlBars-Bar0]\r\nBarID=59393\r\n[Traverse]\r\nDescription=PGMaps test\r\n'
  const tr1File = { name: 'Spur line.tr1', bytes: strToU8(tr1, true) }
  const tr2File = { name: 'Spur line.tr2', bytes: strToU8(tr2, true) }

  // Opened with its P-line: the survey's layers, Between.
  await open(page, [{ name: 'P-line spur.dsnx', bytes: design }, tr1File, tr2File])
  await expect(
    page.getByText(/its P-line Spur line\.tr1 was read: 4 surveyed stations, 2 giving/).first(),
  ).toBeAttached({
    timeout: 60_000,
  })
  await showGround(page)
  const panel = page.getByTestId('roadeng-pline')
  await expect(page.getByTestId('roadeng-pline-summary')).toContainText('4 surveyed stations')
  await expect(page.getByTestId('roadeng-pline-horizons')).toHaveText(/^[1-9]\d* horizons? from the P-line/)
  await panel.screenshot({ path: test.info().outputPath('pline-between.png') })

  // Ahead, as one edit.
  await choose(page.getByLabel('P-line survey applies to', { exact: true }), { value: 'ahead' })
  await expect(page.getByTestId('roadeng-pline-message')).toHaveText(/horizons? from the P-line\./)
  const zip = unzipSync(await download(page, 'RoadEng project'))
  expect(zip['Spur line.tr1']).toEqual(tr1File.bytes)
  expect(zip['Spur line.tr2']).toEqual(tr2File.bytes)
  const written = Object.entries(zip).find(([name]) => name.endsWith('.dsnx'))![1]
  const writtenDsn = strFromU8(unzipSync(written)['Location1.dsn'], true)
  expect(writtenDsn).toMatch(/GndRange=1\r\n/)
  expect(writtenDsn).toMatch(/roadname=Spur line\.tr1\r\n/)

  // Opened without it: unclassified, said so, until the traverse is read from the panel.
  await open(page, [{ name: 'Without its P-line.dsnx', bytes: design }])
  await expect(page.getByRole('button', { name: 'Project: Without its P-line. Rename', exact: true })).toBeVisible({
    timeout: 60_000,
  })
  await showGround(page)
  await expect(panel).toContainText('Spur line.tr1 was not opened with the design')
  await expect(page.getByTestId('roadeng-pline-horizons')).toHaveCount(0)
  await panel.screenshot({ path: test.info().outputPath('pline-missing.png') })
  const chooser = page.waitForEvent('filechooser')
  await panel.getByRole('button', { name: 'Read Spur line.tr1', exact: true }).click()
  await (
    await chooser
  ).setFiles([tr1File, tr2File].map((f) => ({ name: f.name, mimeType: 'text/plain', buffer: Buffer.from(f.bytes) })))
  await expect(page.getByTestId('roadeng-pline-horizons')).toHaveText(/^[1-9]\d* horizons? from the P-line/)
  await panel.screenshot({ path: test.info().outputPath('pline-read.png') })
  expect(errors).toEqual([])
})
