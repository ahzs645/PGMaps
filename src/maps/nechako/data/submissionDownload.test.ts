import { expect, it } from 'vitest'
import JSZip from 'jszip'
import { buildPublicSubmissionArchive } from './submissionDownload'

it('packages the full public capture and its definitions with explicit file exclusions', async () => {
  const record = {
    id: '9',
    title: 'Fixture',
    name: '',
    formId: '8',
    formName: 'Literature',
    date: '',
    sourceUrl: 'https://nechakowatershed-portal.ca/',
    fields: [{ id: '107', type: 'text', label: 'Title', value: 'Water' }],
    attachments: [],
    layers: [],
    media: [],
    searchText: 'Water',
  }
  const snapshot = {
    records: [record],
    manifest: {
      schema: 'nechako-public-content-manifest-v1' as const,
      source: record.sourceUrl,
      capturedAt: '2026-10-12',
      scope: 'anonymous',
      recordCount: 1,
      fieldCount: 1,
      mediaCount: 0,
      attachmentCount: 0,
      layerCount: 0,
    },
  }
  const forms = {
    schema: 'nechako-public-form-definitions-v1' as const,
    source: record.sourceUrl,
    capturedAt: '2026-10-12',
    forms: [{ id: '8', name: 'Literature', pages: [{ id: 1 }], nodes: [] }],
  }
  const blob = await buildPublicSubmissionArchive(snapshot, forms)
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  expect(Object.keys(zip.files).sort()).toEqual(['README.txt', 'forms.json', 'manifest.json', 'submissions.json'])
  expect(JSON.parse(await zip.file('submissions.json')!.async('text')).records[0].fields[0].value).toBe('Water')
  expect(await zip.file('README.txt')!.async('text')).toContain('private records are excluded')
})
