import { expect, test } from '@playwright/test'
import type { WorkspaceLayout } from '../../src/components/interfaces/workspaceLayouts'

test('Ribbon help follows an unpinned command and resumes the shared sketch lesson', async ({ page }) => {
  await page.route('**/workspace-layouts.json', async (route) => {
    const layouts = (await (await route.fetch()).json()) as WorkspaceLayout[]
    const road = layouts
      .find((layout) => layout.id === 'ribbon')!
      .toolbar!.groups.find((group) => group.editor === 'design')!
    road.label = 'Road design'
    await route.fulfill({ json: layouts })
  })
  await page.addInitScript(() => {
    const label = JSON.stringify(['Create alignment', 0])
    localStorage.setItem(
      'pgmaps-road-ribbon-order:ribbon',
      JSON.stringify([
        {
          tab: 'Road design',
          sections: [{ label, items: ['peg'], more: ['sketch'] }],
        },
      ]),
    )
  })
  await page.goto('/help/?layout=ribbon')
  await page.getByRole('link', { name: 'Read the sketch guide' }).click()
  await expect(page.getByRole('heading', { name: '1. Open Road design' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Try in the live Ribbon' })).toHaveAttribute(
    'href',
    /ribbonTab=Road\+design/,
  )
  await page.getByRole('link', { name: 'Play the Ribbon lesson' }).click()
  const player = page.frameLocator('.ribbon-player')
  const stage = player.frameLocator('iframe').frameLocator('iframe')
  for (const [name, nextHeading] of [
    ['Road design', 'Open Create alignment'],
    ['Open Create alignment settings', 'Sketch a road'],
    ['Sketch a road', 'Choose a starting point'],
  ]) {
    const target = stage.locator('[data-lesson-target]')
    await expect(target).toHaveAccessibleName(name)
    await expect(async () => {
      if (await target.getAttribute('aria-label') === name) await target.click()
      await expect(player.getByRole('heading', { name: nextHeading, exact: true })).toBeVisible({ timeout: 500 })
    }).toPass({ timeout: 4000 })
  }
  await expect(player.getByRole('heading', { name: 'Choose a starting point' })).toBeVisible()
})

test('lesson navigation keeps the topic, view and custom Ribbon across workspaces', async ({ page }) => {
  await page.route('**/workspace-layouts.json', async (route) => {
    const layouts = (await (await route.fetch()).json()) as WorkspaceLayout[]
    layouts.push({ ...layouts.find((layout) => layout.id === 'ribbon')!, id: 'field-team', name: 'Field team' })
    await route.fulfill({ json: layouts })
  })
  await page.goto('/help/import-line/tour.html?interface=field-team')
  const header = page.getByRole('navigation', { name: 'Help navigation' })
  await header.locator('summary').click()
  await header.getByRole('link', { name: 'Ribbon', exact: true }).click()
  await expect(header.locator('summary')).toHaveText('Field team')
  await expect(page.locator('.ribbon-player')).toBeVisible()
  await header.getByRole('link', { name: 'Open written guide' }).click()
  await header.locator('summary').click()
  await header.getByRole('link', { name: 'Engineering workbench' }).click()
  await expect(page).toHaveURL(/\/help\/import-line\/index\.html\?interface=field-team$/)
  await header.getByRole('link', { name: 'Play interactive lesson' }).click()
  await expect(page.getByRole('heading', { name: 'Import a road line', exact: true })).toBeVisible()
  await header.getByRole('link', { name: 'All workflows' }).click()
  await page.getByRole('link', { name: 'Ribbon', exact: true }).click()
  await page.getByRole('link', { name: 'Read the sketch guide' }).click()
  await expect(header.locator('summary')).toHaveText('Field team')
})
