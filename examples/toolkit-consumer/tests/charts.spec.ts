import { expect, test } from '@playwright/test'

test('numeric range, series colors and missing gaps work through compiled exports in independent workspaces', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/charts')
  const a = page.getByRole('region', { name: 'Energy A', exact: true })
  const b = page.getByRole('region', { name: 'Energy B', exact: true })
  await expect(a.getByLabel('Energy A observations', { exact: true })).toHaveText('49 hours · 97 points')
  await expect(a.getByRole('region', { name: 'Energy envelope' }).locator('.recharts-area')).toHaveCount(2)
  await expect(a.locator('canvas')).toHaveCount(1)
  await expect(a.locator('.recharts-scatter')).toHaveCount(0)
  const curve = a.getByRole('region', { name: 'Energy timeline' }).locator('.recharts-line-curve').first()
  await expect(curve).toHaveAttribute('stroke', '#d97706')
  expect((await curve.getAttribute('d'))?.match(/M/g)?.length).toBe(2) // The missing hour leaves a gap.
  await a.getByRole('button', { name: '24h', exact: true }).click()
  await expect(a.getByLabel('Energy A observations', { exact: true })).toHaveText('25 hours · 50 points')
  await expect(b.getByLabel('Energy B observations', { exact: true })).toHaveText('49 hours · 97 points')
  await a.getByLabel('Energy A end hour').fill('30')
  await expect(a.getByLabel('Energy A observations', { exact: true })).toHaveText('7 hours · 14 points')
  const solar = a.getByRole('button', { name: 'Show series Solar', exact: true }).first()
  await solar.click()
  await expect(solar).toHaveAttribute('aria-pressed', 'false')
  await expect(a.getByLabel('Energy A observations', { exact: true })).toHaveText('7 hours · 7 points')
  await expect(b.getByRole('button', { name: 'Show series Solar', exact: true }).first()).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await solar.click()
  await expect(
    a.getByRole('region', { name: 'Energy timeline' }).locator('.recharts-line-curve[stroke="#d97706"]'),
  ).toHaveCount(2)
  await a.getByRole('button', { name: 'Remove Battery', exact: true }).click()
  await expect(a.getByRole('button', { name: 'Show series Battery', exact: true })).toHaveCount(0)
  await expect(b.getByRole('button', { name: 'Show series Battery', exact: true }).first()).toBeVisible()
  expect(errors).toEqual([])
})

test('zoom, fullscreen and narrow containers preserve local state without touching another workspace', async ({
  page,
}) => {
  await page.goto('/charts')
  const a = page.getByRole('region', { name: 'Energy A', exact: true })
  const b = page.getByRole('region', { name: 'Energy B', exact: true })
  const scatter = a.getByRole('region', { name: 'Energy observations', exact: true })
  const xy = scatter.getByTestId('xy-plot')
  await xy.focus()
  await xy.press('+')
  await expect(scatter.getByRole('button', { name: 'Reset zoom' })).toBeVisible()
  await expect(b.getByRole('button', { name: 'Reset zoom' })).toHaveCount(0)
  await scatter.getByRole('button', { name: 'Fullscreen Energy observations', exact: true }).click()
  await expect(scatter).toHaveAttribute('data-fullscreen', 'true')
  await expect(scatter.getByRole('button', { name: 'Reset zoom' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(scatter).not.toHaveAttribute('data-fullscreen', 'true')
  await a.getByRole('button', { name: '24h', exact: true }).click()
  await a.getByRole('button', { name: 'Narrow embed', exact: true }).click()
  await expect(a.getByRole('group', { name: 'Page controls', exact: true })).toHaveAttribute('data-inline', 'false')
  await expect(a.getByLabel('Energy A observations', { exact: true })).toHaveText('25 hours · 50 points')
  expect(await a.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  await expect(scatter.getByRole('button', { name: 'Reset zoom' })).toBeVisible()
  await xy.focus()
  await xy.press('Home')
  await expect(scatter.getByRole('button', { name: 'Reset zoom' })).toHaveCount(0)
  await a.getByRole('button', { name: 'Expand embed', exact: true }).click()
  await expect(a.getByLabel('Energy A observations', { exact: true })).toHaveText('25 hours · 50 points')
})

test('canvas hover preserves host metadata and units for a zero-valued observation', async ({ page }) => {
  await page.goto('/charts')
  const a = page.getByRole('region', { name: 'Energy A', exact: true })
  // Reduce to Solar so the zero point is unambiguous. All supplied raw observations remain available.
  await a.getByRole('button', { name: 'Show series Battery', exact: true }).first().click()
  const scatter = a.getByRole('region', { name: 'Energy observations', exact: true })
  const canvas = scatter.locator('canvas')
  await canvas.scrollIntoViewIfNeeded()
  const bounds = await canvas.boundingBox()
  expect(bounds).not.toBeNull()
  // Solar's supplied band defines Y [-12, 12]; hour zero has y=0 at the left-center.
  await page.mouse.move(bounds!.x + 1, bounds!.y + bounds!.height / 2)
  await expect(scatter.getByRole('tooltip')).toHaveText('Solar · Hour 0 · 0.0 kWh')
  await a.getByRole('button', { name: '24h', exact: true }).click()
  await expect(scatter.getByRole('tooltip')).toHaveCount(0)
})
