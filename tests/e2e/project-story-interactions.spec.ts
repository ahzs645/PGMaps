import { test, expect } from '@playwright/test'

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  for (const example of [
    {
      slug: 'comparison',
      type: 'choices',
      targets: ['Economic', 'Census', 'Health', 'Overlap'],
      titles: ['Economic', 'Census', 'Health', 'Overlap'],
    },
    {
      slug: 'relationships',
      type: 'bars',
      targets: ['Northern', 'Interior', 'Vancouver Coastal'],
      titles: ['Northern Health', 'Interior Health', 'Vancouver Coastal Health'],
    },
    {
      slug: 'hierarchy',
      type: 'hierarchy',
      targets: [
        'Cariboo',
        'Fraser-Fort George',
        'Prince George (city)',
        'Northern Health',
        'Northern Interior',
        'Prince George (LHA)',
      ],
      titles: [
        'Cariboo',
        'Fraser-Fort George',
        'Prince George (city)',
        'Northern Health',
        'Northern Interior',
        'Prince George (LHA)',
      ],
    },
  ]) {
    test(`${example.slug} linked controls at ${viewport.width}px`, async ({ page }) => {
      test.setTimeout(90_000)
      await page.setViewportSize(viewport)
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text())
      })
      await page.goto(`/dev/projects/example-${example.slug}`)
      await expect(page.locator('.maplibregl-canvas')).toBeVisible()
      const block = page.locator(`[data-story-interaction="${example.type}"]:visible`)
      for (const i of [...example.targets.keys(), ...[...example.targets.keys()].reverse()]) {
        const target = block.getByRole('button', { name: example.targets[i], exact: example.type !== 'bars' })
        await target.click()
        await expect(page.getByRole('heading', { level: 2, name: example.titles[i], exact: true })).toBeVisible()
        await expect(
          block.getByRole('button', { name: example.targets[i], exact: example.type !== 'bars' }),
        ).toHaveAttribute('aria-pressed', 'true')
        await expect(
          block.getByRole('button', { name: example.targets[i], exact: example.type !== 'bars' }),
        ).toBeFocused()
        // Widget arrow presses must not also turn the story page.
        await page.keyboard.press('ArrowRight')
        await expect(page.getByRole('heading', { level: 2, name: example.titles[i], exact: true })).toBeVisible()
      }
      await expect(page.getByText('Loading map data', { exact: true })).toBeHidden()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.screenshot({ path: `/tmp/pgmaps-example-${example.slug}-${viewport.width}.png` })
      expect(errors).toEqual([])
    })
  }
}

test('example folder exposes all twelve projects', async ({ page }) => {
  await page.goto('/dev/projects?collection=example')
  await expect(page.getByRole('heading', { name: 'example', exact: true })).toBeVisible()
  for (const title of [
    '01 · Docked narrative',
    '02 · Guided slides',
    '03 · Scroll-driven story',
    '04 · Boundary comparison',
    '05 · Map + relationship bars',
    '06 · Linked hierarchy',
    '07 · StoryMaps — docked',
    '08 · StoryMaps — floating',
    '09 · StoryMaps — guided',
    '10 · StoryMaps — mixed',
    'The Diverse Prague',
    '12 · Native editorial toolkit',
  ]) {
    await expect(page.getByText(title, { exact: true }).first()).toBeVisible()
  }
})
