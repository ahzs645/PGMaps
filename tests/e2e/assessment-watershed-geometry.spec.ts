import { expect, test } from '@playwright/test'

test('loads assessment watersheds without GeoJSON worker errors', async ({ page }) => {
  const geometryErrors: string[] = []
  const captureGeometryError = (message: string) => {
    if (message.includes("Cannot read properties of undefined (reading 'length')")) {
      geometryErrors.push(message)
    }
  }

  page.on('console', (message) => {
    if (message.type() === 'error') captureGeometryError(message.text())
  })
  page.on('pageerror', (error) => captureGeometryError(error.message))

  await page.goto('/dev/boundaries', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Add' }).first().click()
  await page.getByRole('button', { name: 'Choose a level for Watershed boundaries' }).click()
  await page.getByRole('button', { name: 'Assessment Watershed', exact: true }).click()
  await page.getByRole('button', { name: /Done/ }).click()

  await expect(
    page.getByText('Watershed boundaries · Assessment Watershed · 2,401'),
  ).toBeVisible({ timeout: 45_000 })
  await page.waitForTimeout(1_500)

  expect(geometryErrors).toEqual([])
})
