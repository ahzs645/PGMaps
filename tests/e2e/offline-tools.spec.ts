import { expect, test, type Page } from '@playwright/test'

/**
 * The forestry tools open with no network after one online visit
 * (docs/app-updates-and-caching.md, **Offline tools**).
 *
 * Runs only against the built site: the dev server registers no service worker. Build with
 * `npx vite build`, serve with `npx vite preview --host 127.0.0.1 --port 42173 --strictPort`, then
 * `PGMAPS_E2E_BASE_URL=http://127.0.0.1:42173 PGMAPS_E2E_PRODUCTION=1 npx playwright test tests/e2e/offline-tools.spec.ts`.
 */
test.skip(
  process.env.PGMAPS_E2E_PRODUCTION !== '1',
  'Requires built dist served by vite preview and PGMAPS_E2E_PRODUCTION=1; development disables the service worker.',
)
test.use({ serviceWorkers: 'allow', viewport: { width: 1440, height: 900 } })

const TOOLS = [
  { id: 'road-design', path: '/dev/forestry/road-design', title: /Forest road design/, dialog: 'Save and export' },
  { id: 'visual-quality', path: '/dev/forestry/visual-quality', title: /Visual quality/, dialog: 'Save & export' },
] as const

/** What the service worker holds for a tool, asked the way `src/lib/offline/offlineTools.ts` asks. */
async function heldOffline(page: Page, tool: string) {
  return page.evaluate(async (id) => {
    const registration = await navigator.serviceWorker.ready
    const status = await new Promise<{
      shell: { files: number; held: number } | null
      groups: Record<string, { kept: boolean; files: number; held: number }>
    } | null>((resolve) => {
      const channel = new MessageChannel()
      channel.port1.onmessage = (event) => resolve(event.data)
      registration.active!.postMessage({ type: 'pgmaps-offline', groups: [id], statusOnly: true }, [channel.port2])
      setTimeout(() => resolve(null), 15_000)
    })
    const group = status?.groups[id]
    return {
      shell: !!status?.shell && status.shell.held === status.shell.files,
      tool: !!group && group.kept && group.files > 0 && group.held === group.files,
    }
  }, tool)
}

for (const tool of TOOLS) {
  test(`${tool.id} opens with no network after one online visit`, async ({ page, context }) => {
    test.setTimeout(240_000)
    await page.goto(tool.path)
    await expect(page).toHaveTitle(tool.title, { timeout: 90_000 })
    await expect(page.locator('.maplibregl-canvas').first()).toBeVisible({ timeout: 90_000 })
    // The page asks for its tool a few seconds after it mounts; the worker then fetches every file.
    await expect.poll(() => heldOffline(page, tool.id), { timeout: 150_000 }).toEqual({ shell: true, tool: true })

    const origin = new URL(page.url()).origin
    const failed: string[] = []
    page.on('requestfailed', (request) => {
      const url = new URL(request.url())
      // The deployed-version check is network-only on purpose, and a bare build ships no /data.
      if (
        url.origin !== origin ||
        url.pathname.startsWith('/pluginWebUpdateNotice/') ||
        url.pathname.startsWith('/data/')
      )
        return
      failed.push(url.pathname)
    })

    await context.setOffline(true)
    await page.reload()
    await expect(page).toHaveTitle(tool.title, { timeout: 60_000 })
    // No map can start without MapLibre's worker, a hashed .mjs the old cache rule never kept.
    await expect(page.locator('.maplibregl-canvas').first()).toBeVisible({ timeout: 60_000 })
    // With the worker missing the canvas still mounts and the map waits on this notice for ever.
    await expect(page.getByText('Loading map data')).toBeHidden({ timeout: 60_000 })

    // A dialog never opened online: its code was fetched ahead, not on the earlier visit.
    await page.getByRole('button', { name: tool.dialog }).first().click()
    await expect(page.getByRole('dialog').first()).toBeVisible({ timeout: 30_000 })
    expect(failed).toEqual([])
  })
}

test('the storage dialog shows what is kept and lets a person clear or keep it', async ({ page }) => {
  test.setTimeout(300_000)
  await page.goto('/dev/forestry/visual-quality')
  await expect(page.locator('.maplibregl-canvas').first()).toBeVisible({ timeout: 90_000 })
  await expect
    .poll(() => heldOffline(page, 'visual-quality'), { timeout: 150_000 })
    .toEqual({ shell: true, tool: true })

  await page.getByRole('button', { name: 'Offline and storage' }).first().click()
  const dialog = page.getByTestId('storage-dialog')
  const tools = dialog.locator('section[aria-label="Offline tools"]')
  const status = dialog.getByTestId('offline-visual-quality')
  await expect(status).toHaveText('Ready to open offline', { timeout: 30_000 })
  await expect(dialog.getByTestId('storage-usage')).toContainText('used')

  // The scene this page saved is listed with a size, and nothing in that list can be removed here.
  await expect(dialog.getByTestId('size-visual-quality')).not.toHaveText(/Measuring|Nothing kept/, { timeout: 60_000 })
  await expect(dialog.locator('section[aria-label="Your work"] button')).toHaveCount(0)

  // Clearing takes two clicks: the first says what it costs.
  const tiles = dialog.locator('li', { hasText: 'Map tiles' })
  await expect(dialog.getByTestId('size-map-tiles')).not.toHaveText(/Measuring|Nothing kept/, { timeout: 60_000 })
  await tiles.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(tiles).toContainText('do not draw offline')
  await tiles.getByRole('button', { name: /^Clear \d/ }).click()
  await expect(dialog.getByTestId('size-map-tiles')).toHaveText('Nothing kept', { timeout: 30_000 })

  // Forgetting a tool and keeping it again.
  await tools.locator('li', { hasText: 'Visual quality' }).getByRole('button', { name: 'Remove' }).click()
  await expect(status).toHaveText('Not kept', { timeout: 30_000 })
  expect(await heldOffline(page, 'visual-quality')).toMatchObject({ tool: false })
  await tools.locator('li', { hasText: 'Visual quality' }).getByRole('button', { name: 'Keep offline' }).click()
  await expect(status).toHaveText('Ready to open offline', { timeout: 120_000 })
})

test('visual quality answers from dated inventory copies offline only once the option is on', async ({
  page,
  context,
}) => {
  test.setTimeout(300_000)
  const copies = () =>
    page.evaluate(async () =>
      (await caches.has('pgmaps-inventory-copies-v1'))
        ? (await (await caches.open('pgmaps-inventory-copies-v1')).keys()).length
        : 0,
    )
  const notice = page.getByTestId('inventory-copy-notice')

  await page.goto('/dev/forestry/visual-quality')
  await expect(page.locator('.maplibregl-canvas').first()).toBeVisible({ timeout: 90_000 })
  await expect
    .poll(() => heldOffline(page, 'visual-quality'), { timeout: 150_000 })
    .toEqual({ shell: true, tool: true })
  // Off by default: the page has read the inventories and kept none of it.
  expect(await copies()).toBe(0)

  await page.getByRole('button', { name: 'Offline and storage' }).first().click()
  const dialog = page.getByTestId('storage-dialog')
  await expect(dialog.getByTestId('inventory-copies-state')).toHaveText('Off', { timeout: 30_000 })
  await dialog.getByRole('button', { name: 'Turn on' }).click()
  await expect(dialog.getByTestId('inventory-copies-state')).toHaveText('On', { timeout: 30_000 })
  await page.keyboard.press('Escape')

  // Online again with the option on: the same reads are now kept.
  await page.reload()
  await expect(page.locator('.maplibregl-canvas').first()).toBeVisible({ timeout: 90_000 })
  await expect.poll(copies, { timeout: 120_000 }).toBeGreaterThan(0)
  await expect(notice).toHaveCount(0)

  // Offline: the copies answer, and the page says so with their date.
  await context.setOffline(true)
  await page.reload()
  await expect(page.locator('.maplibregl-canvas').first()).toBeVisible({ timeout: 60_000 })
  await expect(notice).toBeVisible({ timeout: 90_000 })
  await expect(notice).toContainText('kept in this browser')
  await expect(notice).toContainText(String(new Date().getFullYear()))

  // Turning it off deletes every copy.
  await page.getByRole('button', { name: 'Offline and storage' }).first().click()
  await dialog.getByRole('button', { name: 'Turn off' }).click()
  await expect(dialog.getByTestId('inventory-copies-state')).toHaveText('Off', { timeout: 30_000 })
  expect(await copies()).toBe(0)
})
