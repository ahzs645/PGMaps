import process from 'node:process'
import { strict as assert } from 'node:assert'
import { fileURLToPath, URL } from 'node:url'
import { chromium } from '@playwright/test'

// Run against the independent consumer's Vite server. The fixture imports dist,
// uses no app aliases and checks actual scoped CSS in a real browser.
const baseUrl = process.env.PGMAPS_TOOLKIT_TEST_BASE_URL ?? 'http://127.0.0.1:42175'
const browser = await chromium.launch({
  ...(process.env.PGMAPS_PLAYWRIGHT_EXECUTABLE_PATH
    ? { executablePath: process.env.PGMAPS_PLAYWRIGHT_EXECUTABLE_PATH }
    : {}),
  headless: true,
  args: ['--no-sandbox'],
})
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const fixturePath = fileURLToPath(new URL('./nested-workspace.html', import.meta.url)).replaceAll('\\', '/')
  await page.goto(`${baseUrl}/@fs${fixturePath}`, { waitUntil: 'networkidle' })
  await page.locator('[data-presentation-probe="inner"]').filter({ hasText: 'mobile' }).waitFor()
  assert.equal(await page.locator('[data-presentation-probe="outer"]').textContent(), 'desktop')
  assert.equal(await page.locator('[data-presentation-probe="inherited"]').textContent(), 'desktop')
  assert.equal(
    await page.locator('[data-desktop-marker="outer"]').isVisible(),
    true,
    'desktop scoped utility positively applies',
  )
  assert.equal(
    await page.locator('[data-desktop-marker="inner"]').isVisible(),
    false,
    'outer desktop scope stops at compact child',
  )
  const outerBackground = await page
    .locator('[data-presentation-probe="outer"]')
    .evaluate((element) => getComputedStyle(element).backgroundColor)
  assert.equal(outerBackground, 'rgb(2, 6, 23)', 'dark scoped utility positively applies to outer workspace')
  const bounds = await page.locator('[data-compact-fixture="true"]').boundingBox()
  const handle = page.locator('[data-map-mobile-sheet-handle="true"]')
  assert.equal(await handle.isVisible(), true, 'inner mobile handle remains visible inside a desktop provider')
  assert.equal(
    await page.getByRole('button', { name: 'Hide sidebar', exact: true }).isVisible(),
    false,
    'outer desktop utilities do not override inner mobile layout',
  )
  const theme = await page.locator('[data-map-layout-root="true"]').evaluate((root) => ({
    background: getComputedStyle(root).backgroundColor,
    tokens: getComputedStyle(root).getPropertyValue('--background').trim(),
    parentTheme: root.closest('.geo-toolkit')?.getAttribute('data-theme'),
  }))
  assert.equal(theme.parentTheme, 'light')
  assert.equal(theme.background, 'rgb(241, 245, 249)', 'outer dark utility does not override explicit inner light')
  const inheritedTheme = await page
    .locator('[data-presentation-probe="inherited"]')
    .evaluate((probe) => probe.closest('.geo-toolkit')?.getAttribute('data-theme'))
  assert.equal(inheritedTheme, 'dark', 'undefined child theme inherits the parent explicitly')
  await page.locator('[data-compact-fixture="true"]').evaluate((element) => {
    element.style.width = '800px'
  })
  await page.locator('[data-presentation-probe="inner"]').filter({ hasText: 'desktop' }).waitFor()
  assert.equal(
    await page.locator('[data-desktop-marker="inner"]').isVisible(),
    true,
    'resized inner desktop scoped utility positively applies',
  )
  assert.equal(await handle.isVisible(), false, 'resized desktop workspace hides its mobile handle')
  assert.equal(await page.getByRole('button', { name: 'Hide sidebar', exact: true }).isVisible(), true)
  await page.locator('[data-compact-fixture="true"]').evaluate((element) => {
    element.style.width = '420px'
  })
  await page.locator('[data-presentation-probe="inner"]').filter({ hasText: 'mobile' }).waitFor()
  await page.getByRole('button', { name: 'Open scoped dialog', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  const dialogBounds = await dialog.boundingBox()
  assert.ok(bounds && dialogBounds)
  assert.ok(
    dialogBounds.x >= bounds.x - 1 && dialogBounds.x + dialogBounds.width <= bounds.x + bounds.width + 1,
    'embedded dialog stays within its own workspace width',
  )
  assert.ok(
    dialogBounds.y >= bounds.y - 1 && dialogBounds.y + dialogBounds.height <= bounds.y + bounds.height + 1,
    'embedded dialog stays within its own workspace height',
  )
  const dialogTheme = await dialog.evaluate((element) => element.closest('.geo-toolkit')?.getAttribute('data-theme'))
  assert.equal(dialogTheme, 'light', 'portal preserves its workspace theme')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })

  const readingLayout = async (id) =>
    page.locator(`[data-reading-examples="${id}"]`).evaluate((root) => {
      const sidecar = root.querySelector('.editorial-immersive')
      const narrative = root.querySelector('.sidecar-narrative')
      const stage = root.querySelector('.sidecar-stage')
      const workspace = root.closest('.geo-toolkit')
      return {
        editorialDisplay: getComputedStyle(sidecar).display,
        narrativeWidth: narrative.getBoundingClientRect().width,
        stageWidth: stage.getBoundingClientRect().width,
        theme: root.querySelector('.editorial-story').getAttribute('data-theme'),
        mode: workspace.getAttribute('data-workspace-responsive'),
        container: getComputedStyle(workspace).containerName,
      }
    })
  await page.locator('[data-reading-examples="container"] .editorial-immersive').waitFor()
  const narrow = await readingLayout('container')
  assert.equal(narrow.mode, 'container')
  assert.equal(narrow.container, 'geo-reading')
  assert.equal(narrow.editorialDisplay, 'block', '400px editorial stacks on a 1440px desktop viewport')
  assert.ok(Math.abs(narrow.narrativeWidth - narrow.stageWidth) < 1, '400px scene narrative uses full width')
  assert.equal(narrow.theme, 'light', 'narrow editorial resolves explicit light inside dark host')
  const viewport = await readingLayout('viewport')
  assert.equal(viewport.mode, 'viewport')
  assert.equal(viewport.container, 'none', 'viewport child does not become a size container')
  assert.equal(viewport.editorialDisplay, 'grid', 'viewport editorial ignores narrow outer container rules')
  assert.ok(viewport.narrativeWidth < viewport.stageWidth / 2, 'viewport scene preserves its desktop sidecar')
  await page.locator('[data-reading-frame="true"]').evaluate((element) => {
    element.style.width = '900px'
  })
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector('[data-reading-examples="container"] .editorial-immersive')).display ===
      'grid',
  )
  const wide = await readingLayout('container')
  assert.ok(wide.narrativeWidth < wide.stageWidth / 2, 'resized wide container returns to desktop scene layout')
  assert.equal(
    (await readingLayout('viewport')).editorialDisplay,
    'grid',
    'nested viewport remains independent on resize',
  )
  console.log(
    'Nested responsive/theme scopes, bounded dialog and container narrative layouts passed against built package.',
  )
} finally {
  await browser.close()
}
