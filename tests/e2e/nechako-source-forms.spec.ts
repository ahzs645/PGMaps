import { test, expect } from '@playwright/test'
import { Buffer } from 'node:buffer'

const form = {
  name: 'Fixture source form',
  nodes: [
    { field_id: 561, field_type: 'text', field_label: 'Sub-basin Name', nodeInfo: { node_is_dynamic: true } },
    { field_id: 562, field_type: 'number', field_label: 'Observation Count', nodeInfo: { node_is_dynamic: true } },
    { field_id: 563, field_type: 'htmleditor', field_label: 'Other Notes', nodeInfo: { node_is_dynamic: true } },
    {
      field_id: 564,
      field_type: '5',
      field_label: 'Attachments',
      nodeInfo: { node_is_dynamic: false, node_name: 'attachmentsNode.form' },
    },
  ],
}
const sourceReport = {
  rows: {
    '1477': {
      'Submitted Time': '2024-01-01',
      'Submission Title': 'Fixture title',
      'Submission Name': 'Fixture',
      Basin: 'Upper fixture',
      Count: 0,
    },
    '1478': { Basin: 'Missing fixture', Count: null },
    '1479': { Basin: 'Boolean fixture', Count: false },
    '1480': { Basin: 'Precision fixture', Count: '9007199254740993' },
  },
  statistics: { results: 7, sum: { Count: 0, Unavailable: null }, unsupported: { nested: {} } },
}

for (const width of [1440, 390])
  test(`native form fields, source reports and local drafts at ${width}px`, async ({ page }) => {
    test.setTimeout(90000)
    await page.setViewportSize({ width, height: 900 })
    const errors: string[] = [],
      writes: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('https://basemaps.cartocdn.com/**', (route) =>
      route.fulfill({
        json: {
          version: 8,
          sources: {},
          layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#dce9e9' } }],
        },
      }),
    )
    await page.route('https://nechakowatershed-portal.ca/rest/**', async (route) => {
      const endpoint = new URL(route.request().url()).pathname.split('/').pop()
      const params = new URLSearchParams(route.request().postData() || '')
      if (/set|add|save|submit|upload/i.test(endpoint || '')) writes.push(endpoint || '')
      if (endpoint === 'getSubmissionForm.php')
        return route.fulfill({ json: { success: true, status: 'success', attributes: 39 } })
      if (endpoint === 'getForm.php')
        return route.fulfill({ json: { success: true, status: 'success', attributes: form } })
      if (endpoint === 'getFieldValue.php')
        return route.fulfill({
          json: {
            success: true,
            status: 'success',
            attributes:
              params.get('fieldId') === '561'
                ? 'Upper fixture'
                : params.get('fieldId') === '562'
                  ? 0
                  : '<p>Readable source notes</p><script>window.sourceMarkupRan=true</script><a href="https://example.com/source">Source reference</a>',
          },
        })
      if (endpoint === 'getForms.php')
        return route.fulfill({
          json: { success: true, status: 'success', attributes: [{ form_id: 39, form_name: 'Fixture source form' }] },
        })
      if (endpoint === 'GetFormStatistics.php') {
        expect(JSON.parse(params.get('mapping') || '{}')).toEqual({ '561': 'Basin', '562': 'Count' })
        return route.fulfill({ json: { success: true, status: 'success', attributes: sourceReport } })
      }
      return route.fulfill({ json: { success: true, status: 'success', attributes: [] } })
    })
    await page.goto('/dev/nechako/portal?panel=submissions')
    await page.getByLabel('Portal submission ID', { exact: true }).fill('1477')
    await page.getByRole('button', { name: 'Open submission resources', exact: true }).click()
    await page.getByRole('button', { name: 'Load source form preview', exact: true }).click()
    await expect(page.getByText('Upper fixture', { exact: true })).toBeVisible()
    await expect(page.getByText('Readable source notes', { exact: false })).toBeVisible()
    await expect(page.getByRole('link', { name: 'https://example.com/source', exact: false })).toBeVisible()
    expect(
      await page.evaluate(() => (window as unknown as { sourceMarkupRan?: boolean }).sourceMarkupRan),
    ).toBeUndefined()
    const formExport = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export source form and returned values', exact: true }).click()
    await expect((await formExport).suggestedFilename()).toBe('submission-1477-read.json')
    await page.getByRole('button', { name: 'Close portal window', exact: true }).click()
    await page
      .getByRole('navigation', { name: 'Watershed portal' })
      .getByRole('button', { name: 'Reports', exact: true })
      .click()
    await page.getByRole('button', { name: 'Read available report forms', exact: true }).click()
    await page.getByLabel('Source report form', { exact: true }).selectOption('39')
    await page.getByRole('button', { name: 'Load report fields', exact: true }).click()
    await page.getByLabel('Report label Sub-basin Name').fill('Basin')
    await page.getByLabel('Report label Observation Count').fill('Count')
    await page.getByRole('button', { name: 'Generate source report', exact: true }).click()
    await expect(page.getByText('Upper fixture', { exact: true })).toBeVisible()
    await page.getByRole('tab', { name: 'Graphs', exact: true }).click()
    const graphs = page.getByRole('region', { name: 'Form report graphs' })
    await expect(
      graphs.getByText(
        '1 numeric values plotted from 4 returned entries · 3 missing, nonnumeric or unsafe numeric values excluded.',
      ),
    ).toBeVisible()
    await expect(
      graphs.getByText(
        '1 source statistic group(s) have no supported numeric shape. The original values remain in Table.',
      ),
    ).toBeVisible()
    const plotted = graphs.locator('canvas')
    await expect(plotted).toBeVisible()
    const hoverValue = async (fraction: number) => {
      await plotted.scrollIntoViewIfNeeded()
      const bounds = await plotted.boundingBox()
      expect(bounds).not.toBeNull()
      // The toolkit's transparent interaction overlay owns pointer events.
      await page.mouse.move(bounds!.x + bounds!.width * fraction, bounds!.y + bounds!.height / 2)
    }
    // The one measured zero is row 1 of 4, halfway up the [-1, 1] axis.
    await hoverValue(1 / 8)
    await expect(graphs.getByText('Submission 1477', { exact: true })).toBeVisible()
    await expect(graphs.getByText('Count: 0', { exact: true })).toBeVisible()
    await graphs.getByLabel('Report graph dataset', { exact: true }).selectOption('statistics:results')
    await expect(
      graphs.getByText(
        '1 numeric values plotted from 1 returned entries · 0 missing, nonnumeric or unsafe numeric values excluded.',
      ),
    ).toBeVisible()
    await hoverValue(1 / 2)
    // The source says results=7, despite returning 4 rows; the graph must retain 7.
    await expect(graphs.getByText('results: 7', { exact: true })).toBeVisible()
    await graphs.getByLabel('Report graph dataset', { exact: true }).selectOption('statistics:sum')
    await expect(
      graphs.getByText(
        '1 numeric values plotted from 2 returned entries · 1 missing, nonnumeric or unsafe numeric values excluded.',
      ),
    ).toBeVisible()
    await page.getByRole('tab', { name: 'Table', exact: true }).click()
    await expect(page.getByText('Upper fixture', { exact: true })).toBeVisible()
    await expect(page.getByText('9007199254740993', { exact: true })).toBeVisible()
    const reportZip = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download form review ZIP', exact: true }).click()
    await expect((await reportZip).suggestedFilename()).toBe('source-form-review.zip')
    const reportPdf = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download form report PDF', exact: true }).click()
    const pdfDownload = await reportPdf
    await expect(pdfDownload.suggestedFilename()).toBe('source-form-report.pdf')
    await pdfDownload.saveAs(`/tmp/nechako-source-report-${width}.pdf`)
    await page.getByRole('button', { name: 'Close portal window', exact: true }).click()
    await page
      .getByRole('navigation', { name: 'Watershed portal' })
      .getByRole('button', { name: 'Import', exact: true })
      .click()
    await page.getByLabel('Draft review CSV', { exact: true }).setInputFiles({
      name: 'rows.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('Title,ID\nFirst,A\nSecond,A\nThird,B\n'),
    })
    await page.getByRole('button', { name: 'Use source columns as a local review form', exact: true }).click()
    await page.getByLabel('Draft duplicate identifier', { exact: true }).selectOption('ID')
    await page.getByRole('button', { name: 'Select rows without issues', exact: true }).click()
    await expect(
      page.getByText('2 records have review issues · 1 selected · no records merged or uploaded', { exact: true }),
    ).toBeVisible()
    const draftDownload = page.waitForEvent('download')
    await page
      .getByRole('button', { name: 'Download local draft review with originals and issues', exact: true })
      .click()
    await expect((await draftDownload).suggestedFilename()).toBe('local-draft-review.json')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(errors).toEqual([])
    expect(writes).toEqual([])
  })
