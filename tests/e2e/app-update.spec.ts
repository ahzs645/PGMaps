import { expect, test } from '@playwright/test'

test('shows and dismisses the PGMaps update notice', async ({ page }) => {
  await page.goto('/')

  await page.evaluate(() => {
    document.body.dispatchEvent(
      new CustomEvent('plugin_web_update_notice', {
        detail: { version: 'abcdef123456' },
        bubbles: true,
      }),
    )
  })

  const notice = page.getByRole('status', { name: 'Application update available' })
  await expect(notice).toContainText('PGMaps update ready')
  await expect(notice).toContainText('abcdef12')

  await notice.getByRole('button', { name: 'Later' }).click()
  await expect(notice).toBeHidden()

  await page.evaluate(() => {
    document.body.dispatchEvent(
      new CustomEvent('plugin_web_update_notice', {
        detail: { version: 'abcdef123456' },
        bubbles: true,
      }),
    )
  })
  await expect(notice).toBeHidden()

  await page.evaluate(() => {
    document.body.dispatchEvent(
      new CustomEvent('plugin_web_update_notice', {
        detail: { version: 'fedcba654321' },
        bubbles: true,
      }),
    )
  })
  await expect(notice).toContainText('fedcba65')
})
