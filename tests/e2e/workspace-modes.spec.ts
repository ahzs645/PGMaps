import { expect, test, type Page } from '@playwright/test'
import { openWorkbench } from './road-workbench'
import { choose } from './styled-select'
import { fieldTeamProfile } from './brandkit-profile'

test.use({ serviceWorkers: 'block', viewport: { width: 1512, height: 982 }, actionTimeout: 15000 })
test.setTimeout(180000)
const layouts = [
  ['workbench', 'Guided mode'],
  ['ribbon', 'Ribbon'],
  ['guided', 'Guided map'],
  ['dashboard', 'Dashboard'],
] as const

async function open(page: Page) {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await openWorkbench(page, '/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
}

test('all four layouts share the project, station, branding and chosen legend symbols', async ({ page }) => {
  await open(page)
  const projectName = await page.getByTestId('road-project-name').innerText()
  const station = page.getByRole('spinbutton', { name: 'Selected station metres', exact: true })
  await station.fill('200')
  await station.press('Enter')
  await page.getByRole('button', { name: 'Branding', exact: true }).click()
  const branding = page.getByRole('dialog', { name: 'Branding', exact: true })
  await branding.getByLabel('Import Brandkit file').setInputFiles({
    name: 'field-team.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fieldTeamProfile)),
  })
  await expect(branding.getByRole('status')).toContainText('Brand imported')
  await branding.getByRole('button', { name: 'Apply choices', exact: true }).click()
  await page.getByRole('button', { name: 'Map display settings', exact: true }).click()
  await choose(page.getByRole('combobox', { name: 'Legend and map symbols', exact: true }), 'block-sheet')
  await page.getByRole('checkbox', { name: 'Contours', exact: true }).uncheck()
  await page.getByRole('button', { name: 'Close map settings', exact: true }).click()
  await choose(page.getByRole('combobox', { name: 'Terrain display', exact: true }), 'slope')
  const edit = page
    .getByRole('group', { name: 'Road map tool', exact: true })
    .getByRole('button', { name: 'Edit points', exact: true })
  await edit.click()

  for (const [id, name] of [...layouts, layouts[0]]) {
    await page.getByRole('button', { name: 'Switch workspace interface', exact: true }).click()
    const chooser = page.getByRole('dialog', { name: 'Choose your workspace', exact: true })
    await expect(chooser.getByRole('button', { name: 'Open Guided mode', exact: true })).toBeVisible()
    await chooser.getByRole('button', { name: 'Open ' + name, exact: true }).click()
    await expect(page.getByTestId('road-workspace')).toHaveAttribute('data-interface', id)
    await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
    await expect(page.locator('img[alt="Field team"]:visible').first()).toBeVisible()
    await expect(page.getByTestId('road-project-name')).toHaveText(projectName)
    await expect(station).toHaveValue('200')
    await expect(edit).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('combobox', { name: 'Terrain display', exact: true })).toHaveAttribute(
      'data-value',
      'slope',
    )
    await page.getByRole('button', { name: 'Map display settings', exact: true }).click()
    await expect(page.getByRole('checkbox', { name: 'Contours', exact: true })).not.toBeChecked()
    await expect(page.getByRole('combobox', { name: 'Legend and map symbols', exact: true })).toHaveAttribute(
      'data-value',
      'block-sheet',
    )
    await page.getByRole('button', { name: 'Close map settings', exact: true }).click()
    const legend = page.getByTestId('road-terrain-legend')
    const expand = legend.getByRole('button', { name: 'Expand legend', exact: true })
    if (await expand.isVisible()) await expand.click()
    await expect(legend.locator('[data-sheet-symbol="Stream"]')).toBeVisible()
    const help = page.getByRole('link', { name: 'Workflow help (opens in a new tab)', exact: true })
    expect(new URL((await help.getAttribute('href'))!, page.url()).searchParams.get('interface')).toBe(id)
  }
})

for (const [id, name] of layouts) {
  test(`${name} help keeps the workspace in guides and lessons`, async ({ page, context }) => {
    await open(page)
    await page.getByRole('button', { name: 'Switch workspace interface', exact: true }).click()
    await page.getByRole('button', { name: 'Open ' + name, exact: true }).click()
    const helpUrl = (await page
      .getByRole('link', { name: 'Workflow help (opens in a new tab)', exact: true })
      .getAttribute('href'))!
    await page.getByRole('button', { name: 'Switch workspace interface', exact: true }).click()
    const chooser = page.getByRole('dialog', { name: 'Choose your workspace', exact: true })
    await expect(chooser.getByRole('link', { name: 'Workflow help', exact: true })).toHaveAttribute('href', helpUrl)
    const help = await context.newPage()
    await help.goto(new URL(helpUrl, page.url()).href)
    await help.getByRole('link', { name: 'Read the sketch guide', exact: true }).click()
    expect(new URL(help.url()).searchParams.get('interface')).toBe(id)
    const launch = help.locator('a[href*="/dev/forestry/road-design"]').first()
    await expect
      .poll(async () => new URL((await launch.getAttribute('href'))!, help.url()).searchParams.get('interface'))
      .toBe(id)
    await help
      .getByRole('navigation', { name: 'Help navigation' })
      .getByRole('link', { name: 'Play interactive lesson', exact: true })
      .click()
    expect(new URL(help.url()).searchParams.get('interface')).toBe(id)
    await expect(help.locator(id === 'ribbon' ? '.ribbon-player' : '.tk-capture-player-header')).toBeVisible()
    // Non-Ribbon workspaces can still choose the Ribbon tutorial from the same workflow.
    if (id !== 'ribbon') {
      const nav = help.getByRole('navigation', { name: 'Help navigation' })
      await nav.locator('summary').click()
      await nav.getByRole('link', { name: 'Ribbon', exact: true }).click()
      expect(new URL(help.url()).searchParams.get('interface')).toBe('ribbon')
      await expect(help.locator('.ribbon-player')).toBeVisible()
    }
    await help.close()
  })
}
