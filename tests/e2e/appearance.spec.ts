import { expect, test } from '@playwright/test'
import { fieldTeamProfile } from './brandkit-profile'
import { choose } from './styled-select'

test.use({ serviceWorkers: 'block', colorScheme: 'light', viewport: { width: 1512, height: 982 } })

test('interface colours persist across themes, layouts and toolkit dialogs', async ({ page }) => {
  test.setTimeout(120_000)
  page.setDefaultTimeout(15_000)
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.goto('/')
  const root = page.locator('html')
  const defaultPrimary = await root.evaluate((element) => getComputedStyle(element).getPropertyValue('--primary'))
  const dialog = page.getByRole('dialog', { name: 'Appearance', exact: true })
  const openAppearance = page.getByRole('button', { name: 'Appearance', exact: true })
  await openAppearance.click()
  await dialog.getByLabel('Light mode primary colour', { exact: true }).fill('#5c0f99')
  await dialog.getByLabel('Light mode highlight colour', { exact: true }).fill('#e8d6ff')
  await dialog.getByRole('button', { name: 'Dark', exact: true }).click()
  await dialog.getByLabel('Dark mode primary colour', { exact: true }).fill('#ffff00')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(openAppearance).toBeFocused()
  await expect
    .poll(() => root.evaluate((element) => getComputedStyle(element).getPropertyValue('--primary')))
    .toBe(defaultPrimary)

  await openAppearance.click()
  await dialog.getByLabel('Light mode primary colour', { exact: true }).fill('#5c0f99')
  await dialog.getByLabel('Light mode highlight colour', { exact: true }).fill('#e8d6ff')
  await dialog.getByRole('button', { name: 'Dark', exact: true }).click()
  await dialog.getByLabel('Dark mode primary colour', { exact: true }).fill('#ffff00')
  const radius = dialog.getByRole('slider', { name: 'Corner radius' })
  await radius.press('End')
  await expect(radius).toHaveAttribute('aria-valuenow', '24')
  await expect(dialog.getByRole('button', { name: 'Review design', exact: true })).toHaveCSS('border-radius', '22px')
  await dialog.getByRole('button', { name: 'Export CSS', exact: true }).click()
  await expect(dialog.getByRole('textbox', { name: 'CSS variables' })).toHaveValue(/--radius: 1.5rem;/)
  await dialog.getByRole('button', { name: 'Apply theme', exact: true }).click()
  await page.getByRole('button', { name: 'Toggle theme', exact: true }).click()
  await openAppearance.click()
  const previewAction = dialog.getByRole('button', { name: 'Review design', exact: true })
  await expect(previewAction).toHaveCSS('background-color', 'rgb(255, 255, 0)')
  await expect(previewAction).toHaveCSS('color', 'rgb(0, 0, 0)')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Toggle theme', exact: true }).click()

  for (const layout of ['workbench', 'ribbon', 'guided', 'dashboard']) {
    await page.goto(`/dev/forestry/road-design?interface=${layout}&example=training`)
    const workspace = page.getByTestId('road-workspace')
    await expect(workspace).toHaveAttribute('data-interface', layout)
    await expect(root).toHaveCSS('--radius', '1.5rem')
    await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
    for (const surface of [workspace, workspace.locator('.geo-toolkit').first()]) {
      await expect
        .poll(() =>
          surface.evaluate((element) => {
            const style = getComputedStyle(element)
            return (
              style.getPropertyValue('--primary') === style.getPropertyValue('--interface-light-primary') &&
              style.getPropertyValue('--accent') === style.getPropertyValue('--interface-light-accent')
            )
          }),
        )
        .toBe(true)
    }
  }

  await page.goto('/dev/forestry/road-design?interface=workbench&example=training')
  await page.getByRole('button', { name: 'Branding', exact: true }).click()
  const branding = page.getByRole('dialog', { name: 'Branding', exact: true })
  await branding.getByLabel('Import Brandkit file').setInputFiles({
    name: 'field-team.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fieldTeamProfile)),
  })
  await expect(branding.getByRole('status')).toContainText('Brand imported')
  await branding.getByRole('button', { name: 'Apply choices', exact: true }).click()
  const scope = page.locator('.brand-scope[data-brand-id]')
  await expect(scope).toBeAttached()
  await expect
    .poll(() =>
      scope.evaluate((element) => {
        const style = getComputedStyle(element)
        return style.getPropertyValue('--primary') === style.getPropertyValue('--interface-light-primary')
      }),
    )
    .toBe(true)

  await page.getByRole('button', { name: 'Fullscreen Road workspace', exact: true }).click()
  await expect(page.getByTestId('road-workspace')).toHaveAttribute('data-fullscreen', 'true')
  await page.getByRole('button', { name: 'Branding', exact: true }).click()
  await branding.getByRole('button', { name: 'Interface theme', exact: true }).click()
  await expect(dialog.getByLabel('Light mode primary colour', { exact: true })).toHaveValue('#5c0f99')
  await dialog.getByRole('button', { name: 'Reset theme', exact: true }).click()
  await expect(dialog.getByRole('slider', { name: 'Corner radius' })).toHaveAttribute('aria-valuenow', '8')
  await dialog.getByRole('button', { name: 'Apply theme', exact: true }).click()
  await expect(branding).toBeVisible()
  await expect
    .poll(() =>
      scope.evaluate((element) => {
        const style = getComputedStyle(element)
        return style.getPropertyValue('--primary').trim() === style.getPropertyValue('--brand-ui-primary').trim()
      }),
    )
    .toBe(true)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Main menu', exact: true }).click()
  await openAppearance.click()
  await expect(dialog.getByRole('button', { name: 'Apply theme', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Main menu', exact: true })).toBeFocused()
})

test('presets preview both palettes before saving', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Appearance', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Appearance' })
  await choose(dialog.getByRole('combobox', { name: 'Theme preset' }), 'Forest')
  const card = dialog.getByRole('region', { name: 'Sample project card' })
  await expect(card).toHaveCSS('border-radius', '14px')
  await expect(card).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await dialog.getByRole('button', { name: 'Dark', exact: true }).click()
  await expect(card).toHaveCSS('background-color', 'rgb(24, 40, 34)')
  await expect(page.locator('html')).toHaveCSS('--radius', '0.5rem')
})
