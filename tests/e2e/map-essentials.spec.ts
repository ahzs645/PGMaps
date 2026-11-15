import { expect, test, type Page } from '@playwright/test'

test.use({ serviceWorkers: 'block' })

/** Opens a plain map page and returns a point on its map, away from the sidebar and controls. */
async function openMap(page: Page) {
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.goto('/dev/boundaries')
  const canvas = page.locator('.maplibregl-canvas').first()
  await expect(canvas).toBeVisible()
  await expect(page.getByTestId('map-status-bar')).toBeVisible()
  const box = (await canvas.boundingBox())!
  return { x: box.x + box.width * 0.6, y: box.y + box.height * 0.5 }
}

test('the status bar follows the pointer and cycles coordinate formats', async ({ page }) => {
  const at = await openMap(page)
  const coordinate = page.getByTestId('map-status-coordinate')
  await page.mouse.move(at.x, at.y)
  await expect(coordinate).toHaveAttribute('data-source', 'pointer')
  await expect(coordinate).toHaveText(/^\d+\.\d{5}° N, \d+\.\d{5}° W$/)
  await expect(page.getByTestId('map-status-camera')).toHaveText(/^z \d+\.\d$/)

  await coordinate.click()
  await expect(coordinate).toHaveText(/^\d+°\d\d′\d\d\.\d″ N, \d+°\d\d′\d\d\.\d″ W$/)
  await coordinate.click()
  await expect(coordinate).toHaveText(/^\d+°\d\d\.\d{3}′ N/)
  await coordinate.click()
  await expect(coordinate).toHaveText(/^\d{1,2}[C-X] \d{6} E \d{7} N$/)
  // The choice is remembered for every map.
  await page.reload()
  await expect(page.getByTestId('map-status-coordinate')).toHaveText(/^\d{1,2}[C-X] \d{6} E \d{7} N$/)
})

test('right-click opens the map menu, copies a coordinate and closes on Escape', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const at = await openMap(page)
  const menu = page.getByTestId('map-context-menu')

  await page.mouse.click(at.x, at.y, { button: 'right' })
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem').first()).toBeFocused()
  await expect(menu.getByRole('menuitem', { name: /What’s here/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)

  await page.mouse.click(at.x, at.y, { button: 'right' })
  await menu.getByRole('menuitem', { name: /Copy coordinates/ }).click()
  await expect(menu.getByRole('menuitem', { name: /Copied/ })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^\d+\.\d{5}, -\d+\.\d{5}$/)
  await expect(menu).toHaveCount(0)

  await page.mouse.click(at.x, at.y, { button: 'right' })
  await menu.getByRole('menuitem', { name: /What’s here/ }).click()
  await expect(page.getByTestId('map-whats-here')).toBeVisible()
})

test('a right-drag turns the map without opening the menu, and N turns it back north', async ({ page }) => {
  const at = await openMap(page)
  await page.mouse.move(at.x, at.y)
  await page.mouse.down({ button: 'right' })
  for (let step = 1; step <= 10; step++) await page.mouse.move(at.x + step * 15, at.y, { steps: 2 })
  await page.mouse.up({ button: 'right' })
  await expect(page.getByTestId('map-status-camera')).toContainText('↻')
  await expect(page.getByTestId('map-context-menu')).toHaveCount(0)

  await page.mouse.move(at.x, at.y)
  await page.keyboard.press('n')
  await expect(page.getByTestId('map-status-camera')).not.toContainText('↻')

  await page.keyboard.press('?')
  await expect(page.getByRole('dialog', { name: 'Map keyboard shortcuts' })).toBeVisible()
  // Keys typed while the dialog is open belong to the dialog.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Map keyboard shortcuts' })).toHaveCount(0)
})

test('the colour-vision preview filters the page until it is turned off', async ({ page }) => {
  const at = await openMap(page)
  await page.mouse.click(at.x, at.y, { button: 'right' })
  const menu = page.getByTestId('map-context-menu')
  await menu.getByRole('menuitem', { name: /Colour-vision preview/ }).click()
  await menu.getByRole('menuitemradio', { name: /Deuteranopia/ }).click()

  const notice = page.getByTestId('color-vision-notice')
  await expect(notice).toContainText('deuteranopia')
  expect(await page.evaluate(() => document.documentElement.style.filter)).toContain('pgmaps-color-vision-deuteranopia')

  await notice.getByRole('button', { name: 'Turn off' }).click()
  await expect(notice).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.style.filter)).toBe('')
})
