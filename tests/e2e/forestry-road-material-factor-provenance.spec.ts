import { expect, test, type Locator, type Page } from '@playwright/test'
import { createEngineeringDesign } from '../../src/pages/dev-forestry-roads/engineeringTypes'
import { createTrainingScenario } from '../../src/pages/dev-forestry-roads/scenarios'
import type { RoadProject } from '../../src/pages/dev-forestry-roads/types'
import { dialogsClosed } from './road-dialogs'

test.setTimeout(180_000)

const materialId = 'factor-test-soil'
const materialName = 'TEST soil'
const source = 'Entered tutorial-review assumption, pp. 242–243; cut factor 1'
const reusableFraction = 0.65

async function activate(locator: Locator) {
  if ((locator.page().viewportSize()?.width ?? 0) >= 1000) await locator.click()
  else await locator.tap()
}

async function prepare(page: Page, url = '/dev/forestry/road-design?example=training') {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.goto(url)
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  return errors
}

function fixture(): RoadProject {
  const project = createTrainingScenario('training-full-cost-access')
  const road = project.alignments.find((item) => item.id === project.activeAlignmentId)!
  road.engineering = createEngineeringDesign()
  road.engineering.materials = [
    {
      id: materialId,
      name: materialName,
      color: '#806040',
      cutRate: 5,
      reusableFraction,
      compactionFactor: 0.9,
    },
  ]
  project.name = 'TEST material factor provenance'
  project.alignments = [road]
  project.context = []
  project.cables = []
  return project
}

async function importProject(page: Page, bytes: Buffer, activeAlignmentId: string) {
  await activate(page.getByRole('button', { name: 'Open', exact: true }))
  await page.getByTestId('road-file-input').setInputFiles({
    name: 'material-factor-provenance.road.json',
    mimeType: 'application/json',
    buffer: bytes,
  })
  const save = page.getByRole('button', { name: 'Save', exact: true })
  await expect
    .poll(
      async () => ({
        loading: await page.getByTestId('workspace-toast-loading').count(),
        saveEnabled: await save.isEnabled(),
      }),
      { timeout: 60_000, message: 'Imported factor project finishes loading and enables saving' },
    )
    .toEqual({ loading: 0, saveEnabled: true })
  await expect(page.getByLabel('Active road', { exact: true })).toHaveValue(activeAlignmentId)
  await expect(page.getByTestId('workspace-toast-error')).toHaveCount(0)
}

async function showMaterialConverter(page: Page) {
  const show = page.getByRole('button', { name: 'Show road controls', exact: true })
  if (await show.isVisible()) await activate(show)
  await activate(
    page.getByRole('tablist', { name: 'Road workflow', exact: true }).getByRole('tab', {
      name: 'Engineering',
      exact: true,
    }),
  )
  await activate(
    page.getByRole('tablist', { name: 'Engineering inputs', exact: true }).getByRole('tab', {
      name: 'Ground',
      exact: true,
    }),
  )
  await expect(page.getByRole('textbox', { name: 'Ground material name', exact: true })).toHaveValue(materialName)
  await activate(page.getByTestId(`material-factor-converter-${materialId}`))
  await expect(page.getByLabel(`${materialName} entered volume factor`, { exact: true })).toBeVisible()
}

async function savedProject(page: Page): Promise<{ bytes: Buffer; project: RoadProject }> {
  await activate(page.getByRole('button', { name: 'Save', exact: true }))
  const dialog = page.getByRole('dialog', { name: 'Save & export', exact: true })
  const pending = page.waitForEvent('download')
  await activate(dialog.getByRole('button', { name: 'Save project JSON', exact: true }))
  const stream = await (await pending).createReadStream()
  expect(stream).not.toBeNull()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  const bytes = Buffer.concat(chunks)
  await activate(dialog.getByRole('button', { name: 'Close', exact: true }))
  await expect(dialog).not.toBeVisible()
  await dialogsClosed(page)
  return { bytes, project: JSON.parse(bytes.toString('utf8')) as RoadProject }
}

function savedMaterial(project: RoadProject) {
  const road = project.alignments.find((item) => item.id === project.activeAlignmentId)!
  const material = road.engineering!.materials.find((item) => item.id === materialId)!
  expect(material).toBeDefined()
  return material
}

for (const size of [
  { name: 'desktop', width: 1512, height: 982 },
  { name: 'phone', width: 390, height: 844 },
]) {
  test.describe(size.name, () => {
    test.use({
      viewport: { width: size.width, height: size.height },
      hasTouch: true,
      isMobile: size.name === 'phone',
      serviceWorkers: 'block',
      actionTimeout: 20_000,
    })

    test('factor convention and source survive a fresh import; direct edits clear provenance and invalid input cannot apply', async ({
      page,
      browser,
    }, info) => {
      const errors = await prepare(page)
      const initial = fixture()
      await importProject(page, Buffer.from(JSON.stringify(initial)), initial.activeAlignmentId)
      await showMaterialConverter(page)
      const reuse = page.getByRole('spinbutton', { name: `${materialName} reusable fraction`, exact: true })
      await expect(reuse).toHaveValue(String(reusableFraction))
      await activate(page.getByRole('combobox', { name: `${materialName} factor convention`, exact: true }))
      await activate(page.getByRole('option', { name: 'Bank / compacted', exact: true }))
      await page.getByLabel(`${materialName} entered volume factor`, { exact: true }).fill('1.1')
      await page.getByLabel(`${materialName} factor source (optional)`, { exact: true }).fill(source)
      await expect(page.getByLabel(`${materialName} canonical factor preview`, { exact: true })).toContainText(
        '0.909090909091 compacted / bank',
      )
      const apply = page.getByRole('button', { name: `Apply ${materialName} factor conversion`, exact: true })
      await expect(apply).toBeEnabled()
      await activate(apply)
      await expect(page.getByTestId(`material-factor-record-${materialId}`)).toContainText('1.1 bank / compacted')
      await expect(reuse).toHaveValue(String(reusableFraction))
      const canonical = page.getByRole('spinbutton', { name: `${materialName} compacted / bank factor`, exact: true })
      await expect(canonical).toHaveValue('0.909091')
      await page.getByTestId(`material-factor-record-${materialId}`).scrollIntoViewIfNeeded()
      await page.screenshot({ path: info.outputPath(`material-factor-${size.name}.png`) })
      // Focusing the rounded display without editing must keep full saved precision and evidence.
      await canonical.focus()
      await canonical.press('Tab')
      const saved = await savedProject(page)
      const material = savedMaterial(saved.project)
      expect(material.compactionFactor).toBe(1 / 1.1)
      expect(material.compactionFactor).not.toBe(0.909091)
      expect(material.reusableFraction).toBe(reusableFraction)
      expect(material.volumeFactorProvenance).toEqual({
        convention: 'bank-per-compacted',
        enteredFactor: 1.1,
        canonicalFactor: 1 / 1.1,
        source,
      })

      const freshContext = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        hasTouch: true,
        isMobile: size.name === 'phone',
        serviceWorkers: 'block',
      })
      freshContext.setDefaultTimeout(20_000)
      try {
        const fresh = await freshContext.newPage()
        // An explicitly created context has no inherited baseURL or previous IndexedDB autosave.
        const freshErrors = await prepare(fresh, new URL('/dev/forestry/road-design?example=training', page.url()).href)
        await importProject(fresh, saved.bytes, saved.project.activeAlignmentId)
        await showMaterialConverter(fresh)
        await expect(
          fresh.getByRole('combobox', { name: `${materialName} factor convention`, exact: true }),
        ).toContainText('Bank / compacted')
        const entered = fresh.getByLabel(`${materialName} entered volume factor`, { exact: true })
        await expect(entered).toHaveValue('1.1')
        await expect(fresh.getByLabel(`${materialName} factor source (optional)`, { exact: true })).toHaveValue(source)
        await expect(fresh.getByTestId(`material-factor-record-${materialId}`)).toContainText('1.1 bank / compacted')
        expect(savedMaterial((await savedProject(fresh)).project)).toEqual(material)

        const editedCanonical = fresh.getByRole('spinbutton', {
          name: `${materialName} compacted / bank factor`,
          exact: true,
        })
        await editedCanonical.fill('1.05')
        await editedCanonical.press('Tab')
        await expect(editedCanonical).toHaveValue('1.05')
        await expect(fresh.getByTestId(`material-factor-record-${materialId}`)).toHaveCount(0)
        await expect(
          fresh.getByRole('spinbutton', { name: `${materialName} reusable fraction`, exact: true }),
        ).toHaveValue(String(reusableFraction))
        const applyInvalid = fresh.getByRole('button', {
          name: `Apply ${materialName} factor conversion`,
          exact: true,
        })
        for (const invalid of ['0', '-1', 'Infinity']) {
          await entered.fill(invalid)
          await expect(applyInvalid).toBeDisabled()
          await expect(fresh.getByLabel(`${materialName} canonical factor preview`, { exact: true })).toHaveText(
            'No valid conversion',
          )
        }
        const edited = savedMaterial((await savedProject(fresh)).project)
        expect(edited.compactionFactor).toBe(1.05)
        expect(edited.reusableFraction).toBe(reusableFraction)
        expect(edited).not.toHaveProperty('volumeFactorProvenance')
        expect(freshErrors).toEqual([])
      } finally {
        await freshContext.close()
      }
      expect(errors).toEqual([])
    })
  })
}
