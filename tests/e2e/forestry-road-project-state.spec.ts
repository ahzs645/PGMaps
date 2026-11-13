import { expect, test } from '@playwright/test'
import { createDemoProject } from '../../src/pages/dev-forestry-roads/terrain'
import { choose } from './styled-select'

test.use({ serviceWorkers: 'block', viewport: { width: 1280, height: 800 } })
test.setTimeout(60_000)

test('a project opened from training survives reload, and incomplete-section status stays outside the plot', async ({
  page,
}) => {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.goto('/dev/forestry/road-design?interface=workbench&example=training')
  await expect(page.getByTestId('road-save-state')).toHaveAttribute('data-save', 'training')
  const project = createDemoProject()
  project.name = 'Imported project that survives reload'
  // A deliberately high formation needs a fill toe beyond this section's reach.
  for (const road of project.alignments) for (const pvi of road.vertical) pvi.elevation += 100
  const picker = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await (
    await picker
  ).setFiles({
    name: 'imported.road.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  })
  await expect(page.getByTestId('road-project-name')).toContainText(project.name)
  await expect(page.getByTestId('road-save-state')).toHaveAttribute('data-save', 'saved')
  expect(new URL(page.url()).searchParams.has('example')).toBe(false)
  await page.reload()
  await expect(page.getByTestId('road-project-name')).toContainText(project.name)
  await expect(page.getByTestId('road-save-state')).toHaveAttribute('data-save', 'saved')
  await choose(page.getByRole('combobox', { name: 'Road view layout', exact: true }), { value: 'engineering' })
  await page.getByRole('button', { name: 'Fullscreen Cross-section', exact: true }).click()
  await page.setViewportSize({ width: 560, height: 600 })
  // At phone widths the workspace switches to one pane; bring its section pane forward.
  await page.getByRole('tab', { name: 'Detail', exact: true }).click()
  const notice = page.getByTestId('road-section-incomplete')
  const section = page.getByTestId('road-section-chart')
  await expect(notice).toBeVisible()
  await expect(notice).toContainText('It is left out of quantities.')
  await expect(section).toBeVisible()
  const toggle = page.getByRole('button', { name: 'Details below chart', exact: true }).filter({ visible: true })
  if ((await toggle.getAttribute('aria-pressed')) === 'true') await toggle.click()
  await expect(notice).toBeVisible()
  expect(await notice.evaluate((element) => !!element.closest('svg'))).toBe(false)
  await expect(section.getByText(/Incomplete section/)).toHaveCount(0)
  await expect
    .poll(async () => {
      const statusBox = await notice.boundingBox()
      const plotBox = await section.boundingBox()
      return !!statusBox && !!plotBox && statusBox.y + statusBox.height <= plotBox.y
    })
    .toBe(true)
  expect(await notice.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
})
