import { expect, test } from '@playwright/test'

test('the worker-backed map globe keeps producing frames', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto('/dev/load')

  const loader = page.getByRole('status', { name: 'Loading map data' })
  await expect(loader).toBeVisible()
  const canvas = loader.locator('canvas')
  await expect(canvas).toHaveCount(1)

  const firstFrame = await canvas.screenshot()
  await page.waitForTimeout(250)
  const nextFrame = await canvas.screenshot()

  expect(nextFrame.equals(firstFrame)).toBe(false)
  expect(pageErrors).toEqual([])
})
