import { expect, test, type Page } from '@playwright/test'

for (const device of [
  { name: 'desktop', width: 1512, height: 982, touch: false },
  { name: 'phone', width: 390, height: 844, touch: true },
])
  test.describe(device.name, () => {
    test.use({
      viewport: { width: device.width, height: device.height },
      hasTouch: device.touch,
      isMobile: device.touch,
      serviceWorkers: 'block',
      actionTimeout: 15000,
    })
    test.setTimeout(120000)

    async function showControls(page: Page) {
      const show = page.getByRole('button', { name: 'Show road controls', exact: true })
      if (await show.isVisible()) await show.click()
    }

    test('physical section edits, stripping, course demand and component references save and reopen', async ({
      page,
    }, info) => {
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.route('https://basemaps.cartocdn.com/**', (route) =>
        route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
      )
      await page.goto('/dev/forestry/road-design?example=training')
      await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
      await showControls(page)
      const workflow = page.getByRole('tablist', { name: 'Road workflow', exact: true })
      await workflow.getByRole('tab', { name: 'Section', exact: true }).click()
      const editor = page.getByTestId('road-template-components').getByTestId('road-section-assembly')
      await editor.getByRole('button', { name: 'Add component', exact: true }).click()
      await editor.getByLabel('Component 1 name', { exact: true }).fill('Survey bench')
      await editor.getByRole('combobox', { name: 'Component 1 condition', exact: true }).selectOption('always')
      await editor.getByLabel('Component 1 width (m)', { exact: true }).fill('2')
      await editor.getByLabel('Component 1 width (m)', { exact: true }).press('Tab')
      await editor.getByLabel('Component 1 point code', { exact: true }).fill('survey-bench-edge')
      await editor.getByRole('button', { name: 'Add surface course', exact: true }).click()
      await editor.getByLabel('Course 1 name', { exact: true }).fill('Wearing course')
      await editor.getByLabel('Course 1 depth (m)', { exact: true }).fill('.2')
      await editor.getByLabel('Course 1 depth (m)', { exact: true }).press('Tab')
      await editor.getByText('Reference feature or surface', { exact: true }).click()
      await expect(editor.getByRole('combobox', { name: 'Component 1 reference surface', exact: true })).toBeVisible()
      await expect(
        editor.getByRole('combobox', { name: 'Component 1 reference surface', exact: true }).locator('option'),
      ).toContainText(['Relative rise / feature level', 'Original ground', 'Prepared ground'])
      await page.screenshot({ path: info.outputPath(`${device.name}-section-assembly.png`) })

      await workflow.getByRole('tab', { name: 'Engineering', exact: true }).click()
      await page
        .getByRole('tablist', { name: 'Engineering inputs', exact: true })
        .getByRole('tab', { name: 'Ground', exact: true })
        .click()
      const stripping = page.getByTestId('road-site-preparation')
      await stripping.getByRole('button', { name: 'Add stripping range', exact: true }).click()
      await stripping.getByLabel('Stripping 1 Removal depth (m)', { exact: true }).fill('.3')
      await stripping.getByLabel('Stripping 1 Removal depth (m)', { exact: true }).press('Tab')
      await expect(stripping.getByRole('combobox', { name: 'Stripping 1 material', exact: true })).not.toHaveValue('')
      await page.screenshot({ path: info.outputPath(`${device.name}-site-preparation.png`) })
      const overflowing = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        controls: [
          ...document.querySelectorAll(
            '[data-testid="road-site-preparation"] input, [data-testid="road-site-preparation"] select',
          ),
        ].filter((e) => {
          const b = e.getBoundingClientRect()
          return b.width && (b.left < -1 || b.right > innerWidth + 1)
        }).length,
      }))
      expect(overflowing).toEqual({ document: false, controls: 0 })

      await page.getByRole('button', { name: 'Save', exact: true }).click()
      const pending = page.waitForEvent('download')
      await page.getByRole('button', { name: 'Save project JSON', exact: true }).click()
      const download = await pending,
        chunks: Buffer[] = []
      for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk))
      const bytes = Buffer.concat(chunks),
        project = JSON.parse(bytes.toString('utf8'))
      const road = project.alignments.find((a: { id: string }) => a.id === project.activeAlignmentId)
      expect(road.template.components[0]).toMatchObject({ name: 'Survey bench', widthM: 2, code: 'survey-bench-edge' })
      expect(road.template.layers[0]).toMatchObject({ name: 'Wearing course', depthM: 0.2 })
      expect(road.engineering.sitePreparation[0].depthM).toBe(0.3)
      expect(
        road.engineering.materials.find((m: { id: string }) => m.id === road.engineering.sitePreparation[0].materialId),
      ).toMatchObject({ purpose: 'stripping', reusableFraction: 0 })
      await page
        .getByRole('dialog', { name: 'Save & export', exact: true })
        .getByRole('button', { name: 'Close', exact: true })
        .click()
      const chooser = page.waitForEvent('filechooser')
      await page.getByRole('button', { name: 'Open', exact: true }).click()
      await (await chooser).setFiles({ name: 'assembly.road.json', mimeType: 'application/json', buffer: bytes })
      await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
      await showControls(page)
      await workflow.getByRole('tab', { name: 'Section', exact: true }).click()
      await expect(editor.getByLabel('Component 1 name', { exact: true })).toHaveValue('Survey bench')
      await expect(editor.getByLabel('Course 1 depth (m)', { exact: true })).toHaveValue('0.2')
      expect(errors).toEqual([])
    })
  })
