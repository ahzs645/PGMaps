import { expect, test, type Locator, type Page } from '@playwright/test'
import type { RoadProject } from '../../src/pages/dev-forestry-roads/types'

test.use({
  serviceWorkers: 'block',
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  actionTimeout: 15000,
})
test.setTimeout(120000)

async function prepare(page: Page) {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.goto('/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
}

async function seedSavedProjects(page: Page) {
  await page.getByRole('button', { name: 'Save', exact: true }).tap()
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save project JSON', exact: true }).tap()
  const stream = (await pending).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of (await stream)!) chunks.push(Buffer.from(chunk))
  const project = JSON.parse(Buffer.concat(chunks).toString()) as RoadProject
  await page
    .getByRole('dialog', { name: 'Save & export', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .tap()
  const names = [
    'Tabor block — access alternatives and seasonal road planning',
    'Nearby gravel and existing-road rehabilitation',
  ]
  await page.evaluate(
    async ({ project, names }) => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('pgmaps-forestry-roads-v1', 1)
        request.onupgradeneeded = () => request.result.createObjectStore('projects')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const transaction = db.transaction('projects', 'readwrite')
          const store = transaction.objectStore('projects')
          const entries = names.map((name, index) => {
            const id = `mobile-project-${index}`
            store.put({ ...project, name }, `project:${id}`)
            return {
              id,
              name,
              roads: project.alignments.length,
              updatedAt: Date.now() - index,
              terrain: `${project.terrain.name} · classified ground · detailed source description with vertical datum and resolution`,
            }
          })
          store.put(entries, 'library')
          store.put(entries[0].id, 'active')
          transaction.oncomplete = () => {
            db.close()
            resolve()
          }
          transaction.onerror = () => {
            db.close()
            reject(transaction.error)
          }
        }
      })
    },
    { project, names },
  )
  await page.goto('/dev/forestry/road-design')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  return names
}

async function expectDialogFits(dialog: Locator) {
  await expect
    .poll(() =>
      dialog.evaluate((element) => {
        const issues: string[] = []
        const bounds = element.getBoundingClientRect()
        if (bounds.left < -1 || bounds.right > window.innerWidth + 1) issues.push('dialog outside viewport')
        for (const child of element.querySelectorAll('fieldset, ul, li, button, input, select, p')) {
          const rect = child.getBoundingClientRect()
          if (!rect.width || !rect.height) continue
          if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)
            issues.push(`${child.tagName} outside dialog`)
          if (child.tagName === 'FIELDSET' && child.scrollWidth > child.clientWidth + 1)
            issues.push('fieldset overflow')
        }
        return issues
      }),
    )
    .toEqual([])
}

test('saved Projects fit touch phones with long terrain labels and keep library actions reachable', async ({
  page,
}, info) => {
  await prepare(page)
  const names = await seedSavedProjects(page)
  await page.getByRole('button', { name: 'Projects', exact: true }).tap()
  const dialog = page.getByTestId('road-projects-dialog')
  const saved = dialog.getByRole('list', { name: 'Saved projects', exact: true })
  await expect(saved.getByRole('listitem')).toHaveCount(2)
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 375, height: 667 },
    { width: 320, height: 568 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport)
    await expectDialogFits(dialog)
  }
  await page.setViewportSize({ width: 375, height: 667 })
  await page.screenshot({ path: info.outputPath('mobile-projects.png') })
  await dialog.getByRole('button', { name: `Duplicate ${names[1]}`, exact: true }).tap()
  await expect(saved.getByRole('listitem')).toHaveCount(3)
  await dialog.getByRole('button', { name: `Delete ${names[1]}`, exact: true }).tap()
  await expectDialogFits(dialog)
  await saved.getByRole('button', { name: 'Delete', exact: true }).tap()
  await expect(saved.getByRole('listitem')).toHaveCount(2)
  await dialog.getByRole('button', { name: `Open ${names[1]} copy`, exact: true }).tap()
  await expect(dialog).not.toBeVisible()
  await page.getByRole('button', { name: 'Projects', exact: true }).tap()
  await expect(saved.getByRole('listitem').filter({ hasText: `${names[1]} copy` })).toContainText('Open now')
  await dialog.getByRole('button', { name: /Browse \d+ example scenarios/ }).tap()
  await expectDialogFits(dialog)
  await dialog.getByRole('button', { name: 'All projects', exact: true }).tap()
  await dialog.getByRole('button', { name: 'New project', exact: true }).tap()
  await expectDialogFits(dialog)
  await dialog.getByLabel('Project name', { exact: true }).fill('Mobile fresh project')
  await dialog.getByRole('radio', { name: /Training example/ }).tap()
  await dialog.getByRole('button', { name: 'Create project', exact: true }).tap()
  await expect(dialog).not.toBeVisible()
  await page.getByRole('button', { name: 'Projects', exact: true }).tap()
  await expect(saved.getByRole('listitem').filter({ hasText: 'Mobile fresh project' })).toContainText('Open now')
})

test('the profile view switch stays as short as the adjacent controls on a touch screen', async ({ page }, info) => {
  await prepare(page)
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
  await page
    .getByRole('tablist', { name: 'Visible road pane', exact: true })
    .getByRole('tab', { name: 'Profile', exact: true })
    .tap()
  const panel = page.getByRole('region', { name: 'Road profile · ground & formation', exact: true })
  const switcher = panel.getByRole('group', { name: 'Chart details layout', exact: true })
  const fullscreen = panel.getByRole('button', { name: 'Fullscreen Road profile · ground & formation', exact: true })
  expect((await switcher.boundingBox())!.height).toBeLessThanOrEqual((await fullscreen.boundingBox())!.height + 1)
  for (const [label, view] of [
    ['Chart only', 'chart'],
    ['Details only', 'details'],
    ['Chart with details below', 'both'],
  ]) {
    await switcher.getByRole('button', { name: label, exact: true }).tap()
    await expect(panel.locator('[data-chart-slot]')).toHaveAttribute('data-chart-view', view)
  }
  await page.screenshot({ path: info.outputPath('mobile-profile-switcher.png') })
})
