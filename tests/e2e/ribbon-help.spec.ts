import { expect, test, type Page } from '@playwright/test'
import type { WorkspaceLayout } from '../../src/components/interfaces/workspaceLayouts'
import { readFileSync } from 'node:fs'

async function openOffline(page: Page, html: string) {
  const requests: string[] = []
  await page.goto('about:blank')
  // A supplied document is the only response. Its scripts, fonts and replay assets
  // must all be embedded; this also works in managed browsers that block file://.
  await page.route('**/*', (route) => {
    if (route.request().isNavigationRequest() && route.request().frame() === page.mainFrame())
      return route.fulfill({ contentType: 'text/html', body: html })
    requests.push(route.request().url())
    return route.abort()
  })
  await page.context().setOffline(true)
  await page.goto('/offline-lesson.html')
  return requests
}

const lessons = [
  'sketch-road',
  'terrain',
  'import-line',
  'vertical-profile',
  'road-section',
  'station-200',
  'stream-crossing',
  'quantities-cost',
  'compare-roads',
  'review-design',
  'save-project',
  'export-stations',
]

for (const lesson of lessons) {
  test(`${lesson} portable player opens, advances and resets offline`, async ({ page }) => {
    const html = readFileSync(new URL(`../../public/help/${lesson}/tour.html`, import.meta.url), 'utf8')
    const capture = JSON.parse(
      html.match(/<script id="tourkit-capture-data" type="application\/json">([\s\S]*?)<\/script>/)![1],
    )
    const steps = capture.steps.filter((step: { disabled?: boolean }) => !step.disabled)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const requests = await openOffline(page, html)
    const stage = page.frameLocator('iframe').frameLocator('iframe')
    await expect(stage.locator('body > *').first()).toBeAttached()
    await expect(page.locator('.tk-capture-stage-error')).toHaveCount(0)
    await expect(page.locator('.tk-capture-lesson-copy h2')).toHaveText(steps[0].title)
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(page.locator('.tk-capture-lesson-copy h2')).toHaveText(steps[1].title)
    await page.getByRole('button', { name: 'Reset', exact: true }).click()
    await expect(page.locator('.tk-capture-lesson-copy h2')).toHaveText(steps[0].title)
    expect(errors).toEqual([])
    expect(requests).toEqual([])
  })
}

test('help corners follow the shared radius in guides, players and Ribbon captures', async ({ page }) => {
  await page.goto('/help/')
  await expect(page.locator('.feature')).toHaveCSS('border-radius', '12px')
  await page.evaluate(() => document.documentElement.style.setProperty('--radius', '1rem'))
  await expect(page.locator('.feature')).toHaveCSS('border-radius', '20px')
  await page.goto('/help/sketch-road/tour.html')
  await expect(page.locator('.tk-capture-player')).toHaveCSS('border-radius', '12px')
  await page.evaluate(() => document.documentElement.style.setProperty('--radius', '1rem'))
  await expect(page.locator('.tk-capture-player')).toHaveCSS('border-radius', '20px')
  await expect(page.getByRole('button', { name: 'Reset', exact: true })).toHaveCSS('border-radius', '14px')
  await page.route('**/help/designTokens.css', (route) =>
    route.fulfill({ contentType: 'text/css', body: ':root { --radius: 1rem; }' }),
  )
  await page.goto('/help/ribbon.html?lesson=sketch-road&view=tour&interface=ribbon')
  const stage = page.frameLocator('.ribbon-player').frameLocator('iframe').frameLocator('iframe')
  await expect(stage.locator('.ribbon-excerpt')).toHaveCSS('border-radius', '14px')
})

test('downloaded Ribbon lessons replay without a server or schema runtime', async ({ page }, testInfo) => {
  await page.goto('/help/ribbon.html?lesson=sketch-road&view=tour&interface=ribbon')
  await expect(
    page.frameLocator('.ribbon-player').frameLocator('iframe').frameLocator('iframe').locator('[data-lesson-target]'),
  ).toBeVisible()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download offline lesson', exact: true }).click()
  const file = testInfo.outputPath('ribbon.html')
  await (await downloading).saveAs(file)
  const html = readFileSync(file, 'utf8')
  expect(html).not.toMatch(/\bZod(?:Type|Error)\b/)
  const requests = await openOffline(page, html)
  const stage = page.frameLocator('iframe').frameLocator('iframe')
  await expect(stage.locator('[data-lesson-target]')).toBeVisible()
  await expect(stage.locator('.ribbon-excerpt')).toHaveCSS('border-radius', '6px')
  await stage.locator('[data-lesson-target]').click()
  await expect(page.locator('.tk-capture-lesson-copy h2')).toHaveText('Sketch a road')
  expect(requests).toEqual([])
})

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
      if ((await target.getAttribute('aria-label')) === name) await target.click()
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
  await header.getByRole('link', { name: 'Guided mode' }).click()
  await expect(page).toHaveURL(/\/help\/import-line\/index\.html\?interface=field-team$/)
  await header.getByRole('link', { name: 'Play interactive lesson' }).click()
  await expect(page.getByRole('heading', { name: 'Import a road line', exact: true })).toBeVisible()
  await header.getByRole('link', { name: 'All workflows' }).click()
  await page.getByRole('link', { name: 'Ribbon', exact: true }).click()
  await page.getByRole('link', { name: 'Read the sketch guide' }).click()
  await expect(header.locator('summary')).toHaveText('Field team')
})
