import { parseTimestamp, normalizeMonitoring } from './monitoring'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { importWorkspace, EMPTY_WORKSPACE } from './workspace'
import { categoryColor, checkedCategoryStyle, checkedSldUrl, makeCategoryStyle } from './vectorStyle'
import { checkedProjectLibrary, nativeProjectSave, projectMutation, saveLocalProject } from './projectManager'
import {
  checkedMonitorPage,
  checkedMonitorRelations,
  monitorPageRequest,
  monitorAttributePageRequest,
  monitorPageTable,
  monitorAttributeRecordIds,
  monitoringSourceContext,
} from './monitoringRelations'
import type { FeatureCollection } from 'geojson'
const features: FeatureCollection = {
  type: 'FeatureCollection',
  features: [1, '1', false, null].map((value) => ({
    type: 'Feature',
    properties: { kind: value },
    geometry: { type: 'Point', coordinates: [-124, 54] },
  })),
}
const relation = checkedMonitorRelations([
  { schemaName: 'Climate', schemaId: 13, layerName: 'Station', layerId: 386, submissionId: 1477, schema_rec_seq_id: 1 },
])[0]
describe('typed vector categories and safe SLD references', () => {
  it('keeps source number, text, boolean and null categories distinct in paint and roundtrip', () => {
    const categories = makeCategoryStyle(features, 'kind', '#123456')
    expect(categories.rules.map((rule) => rule.value)).toEqual([1, '1', false, null])
    expect(categoryColor(categories, '#000000')).toEqual([
      'case',
      ['==', ['get', 'kind'], ['literal', 1]],
      '#2563eb',
      ['==', ['get', 'kind'], ['literal', '1']],
      '#d97706',
      ['==', ['get', 'kind'], ['literal', false]],
      '#16a34a',
      ['==', ['get', 'kind'], ['literal', null]],
      '#9333ea',
      '#123456',
    ])
    const workspace = importWorkspace({
      ...EMPTY_WORKSPACE,
      vectors: [
        { id: 'a', name: 'Categories', data: features, categories, color: '#123456', visible: true, pointRadius: 9 },
      ],
    })
    expect(importWorkspace(JSON.parse(JSON.stringify(workspace))).vectors[0].categories).toEqual(categories)
    expect(workspace.vectors[0].data.features.map((feature) => feature.properties?.kind)).toEqual([1, '1', false, null])
  })
  it('rejects duplicate typed values, objects and excess categories rather than silently truncating', () => {
    expect(() =>
      checkedCategoryStyle({
        property: 'x',
        fallback: '#123456',
        rules: [
          { value: 1, color: '#123456' },
          { value: 1, color: '#123456' },
        ],
      }),
    ).toThrow('Duplicate')
    expect(() =>
      makeCategoryStyle(
        { ...features, features: [{ ...features.features[0], properties: { x: {} } }] },
        'x',
        '#123456',
      ),
    ).toThrow('objects')
    expect(() =>
      makeCategoryStyle(
        {
          ...features,
          features: Array.from({ length: 41 }, (_, index) => ({ ...features.features[0], properties: { x: index } })),
        },
        'x',
        '#123456',
      ),
    ).toThrow('40')
  })
  it('rejects insecure and credential-bearing SLD references', () => {
    for (const value of ['http://example.org/a.sld', 'javascript:alert(1)', 'https://user:password@example.org/a.sld'])
      expect(() => checkedSldUrl(value)).toThrow()
    expect(checkedSldUrl('https://example.org/a.sld')).toBe('https://example.org/a.sld')
  })
})
describe('original and browser project workflows', () => {
  it.each([4, 6, 9, 10, 12, 14, 15, 21, 27])(
    'preserves all source layers including unsupported data when reviewing native project %i save',
    (id) => {
      const source = JSON.parse(readFileSync(`public/data/nechako-showcase/public-projects/project-${id}.json`, 'utf8'))
      const workspace = importWorkspace(source)
      workspace.camera.center = [-125, 55]
      const saved = nativeProjectSave(workspace)
      const native = JSON.parse(saved.projectJson)
      expect(native.coordinates).toEqual([-125, 55])
      expect(native.scale).toBeCloseTo(source.attributes.scale, 4)
      expect(native.layers).toHaveLength(source.attributes.layers.length)
      native.layers.forEach((layer: Record<string, unknown>, index: number) => {
        expect(layer.src).toEqual(source.attributes.layers[index].src)
        expect(layer.urls).toEqual(source.attributes.layers[index].urls)
        expect(layer.portalSld).toEqual(source.attributes.layers[index].portalSld)
      })
      expect(source.attributes.coordinates).not.toEqual([-125, 55])
    },
  )
  it('refuses to pretend PGMaps-only sources have a supported native serializer', () => {
    expect(() => nativeProjectSave(EMPTY_WORKSPACE)).toThrow('Load an original')
    const source = JSON.parse(readFileSync('public/data/nechako-showcase/public-projects/project-27.json', 'utf8'))
    const workspace = importWorkspace(source)
    workspace.layers.pop()
    expect(() => nativeProjectSave(workspace)).toThrow('additions/removals')
  })
  it('preserves an authenticated workspace marker through explicit local export/import', () => {
    const workspace = importWorkspace({ ...EMPTY_WORKSPACE, sessionBound: true })
    expect(importWorkspace(JSON.parse(JSON.stringify(workspace))).sessionBound).toBe(true)
    expect(importWorkspace(EMPTY_WORKSPACE).sessionBound).toBe(false)
  })
  it('stores prior snapshots and default IDs independently of later edits', () => {
    const empty = { schema: 'nechako-local-projects-v1' as const, projects: [] }
    const initial = saveLocalProject(empty, EMPTY_WORKSPACE, 'River', 'one', '2026-10-12T00:00:00Z')
    const next = saveLocalProject(
      initial,
      { ...EMPTY_WORKSPACE, camera: { ...EMPTY_WORKSPACE.camera, zoom: 9 } },
      'River revised',
      'one',
      '2026-10-12T01:00:00Z',
    )
    expect(next.projects[0].history[0].workspace.camera.zoom).toBe(6)
    expect(next.projects[0].workspace.camera.zoom).toBe(9)
    expect(initial.projects[0].name).toBe('River')
    expect(() => checkedProjectLibrary({ ...next, defaultId: 'missing' })).toThrow('default')
  })
  it('builds only exact observed mutation parameters without sending writes', () => {
    expect(projectMutation('shareProject', '27', { additions: ['3', '3'], removals: ['4'] }).params).toEqual({
      mode: 'shareProject',
      projectId: '27',
      permissionAdditions: '[3]',
      permissionRemovals: '[4]',
    })
    expect(projectMutation('unsetDefault', '')).toMatchObject({
      path: 'rest/openmap/setDefaultProject.php',
      params: { projectId: 'unset' },
    })
    expect(projectMutation('save', '27', { projectJson: '{}' }).params).toEqual({
      mode: 'save',
      projectId: '27',
      projectJson: '{}',
    })
    expect(() => projectMutation('shareProject', '27', { additions: ['3'], removals: ['3'] })).toThrow('both')
  })
})
describe('native monitoring relations and bounded pages', () => {
  it('uses parent submission and native schema record sequence ID with zero-based pages', () => {
    expect(monitorPageRequest(relation, '1477', 1, 500)).toEqual({
      schemaId: '13',
      recId: '1',
      submissionId: '1477',
      getDraft: 'true',
      pageSize: '500',
      pageNumber: '1',
    })
    expect(() => monitorPageRequest(relation, '1477', 0, 501)).toThrow('1–500')
    expect(() => monitorPageRequest(relation, '1477', -1, 500)).toThrow('zero-based')
  })
  it('supports the original Attributes Layer and Schema branches without inventing form relationships or draft flags', () => {
    expect(monitorAttributePageRequest('layer', '386', '1', 0, 500)).toEqual({
      layerId: '386',
      recId: '1',
      pageSize: '500',
      pageNumber: '0',
    })
    expect(monitorAttributePageRequest('schema', '13', '1', 2, 500)).toEqual({
      schemaId: '13',
      getSingleLayerInfo: 'true',
      recId: '1',
      pageSize: '500',
      pageNumber: '2',
    })
    expect(() => monitorAttributePageRequest('layer', '386', '', 0, 500)).toThrow('native numeric ID')
    expect(() => monitorAttributePageRequest('schema', '13', '1', 0, 1000)).toThrow('1–500')
  })
  it('binds an actual layer record context without inferring form or schema IDs', () => {
    expect(monitoringSourceContext({ layerId: '386', recId: '1' })).toEqual({
      mode: 'layer',
      sourceId: '386',
      recordId: '1',
    })
    expect(monitoringSourceContext({ layerId: '386' })).toEqual({ mode: 'submission', sourceId: '', recordId: '' })
    expect(monitoringSourceContext({})).toEqual({ mode: 'submission', sourceId: '', recordId: '' })
  })
  it('extracts only enabled actual record IDs from the native source attribute matrix', () => {
    expect(
      monitorAttributeRecordIds({
        attributes: ['schema_rec_seq_id', 'monitor_status', 'submission_id'],
        rows: [
          ['1', 'ENABLED', 1477],
          ['2', 'DISABLED', 1478],
        ],
      }),
    ).toEqual(['1'])
    expect(() => monitorAttributeRecordIds({ attributes: ['id'], rows: [[1]] })).toThrow('monitoring record IDs')
    expect(() =>
      monitorAttributeRecordIds({ attributes: ['schema_rec_seq_id', 'monitor_status'], rows: [[1]] }),
    ).toThrow('do not match')
  })
  it('charts source daily dates only after an explicit format and time-zone choice, retaining negative values and originals', () => {
    expect(parseTimestamp('15/05/1951', 'UTC', 'dmy')).toBe(Date.parse('1951-05-15T00:00:00Z'))
    expect(parseTimestamp('05/06/1951', 'UTC', 'dmy')).toBe(Date.parse('1951-06-05T00:00:00Z'))
    expect(parseTimestamp('05/06/1951', 'UTC', 'mdy')).toBe(Date.parse('1951-05-06T00:00:00Z'))
    expect(() => parseTimestamp('15/05/1951', 'UTC')).toThrow('ISO')
    expect(() => parseTimestamp('15/05/1951', 'embedded', 'dmy')).toThrow('offset')
    expect(() => parseTimestamp('31/04/1951', 'UTC', 'dmy')).toThrow('calendar')
    const records = [{ date: '15/05/1951', min_temp_c: '-8.50' }]
    const result = normalizeMonitoring(records, {
      timestamp: 'date',
      station: '',
      primary: 'min_temp_c',
      secondary: '',
      primaryUnit: 'C',
      secondaryUnit: '',
      timezone: 'UTC',
      dateFormat: 'dmy',
    })
    expect(result.errors).toEqual([])
    expect(result.observations[0].primary).toBe(-8.5)
    expect(result.observations[0].source).toEqual(records[0])
  })
  it('feeds source negative measurements and UTC offsets to charts without spreadsheet CSV safety prefixes', () => {
    const page = checkedMonitorPage(
      {
        fields: ['temperature', 'offset', 'missing'],
        data: [{ temperature: '-8.50', offset: '-07:00', missing: null }],
        recordCount: 1,
      },
      500,
    )
    expect(monitorPageTable(page)).toEqual({
      headers: ['temperature', 'offset', 'missing'],
      records: [{ temperature: '-8.50', offset: '-07:00', missing: '' }],
    })
    expect(page.data[0].temperature).toBe('-8.50')
  })
  it('retains source timestamps, missing values and full record count without inventing units', () => {
    const page = checkedMonitorPage(
      {
        fields: ['date', 'value'],
        data: [
          { date: '1950-01-01', value: null },
          { date: '1950-01-02', value: '2.40' },
        ],
        recordCount: 77799,
        noData: false,
      },
      500,
    )
    expect(page.data[1].value).toBe('2.40')
    expect(page.recordCount).toBe(77799)
    expect(checkedMonitorPage({ ...page, recordCount: '77799' }, 500).recordCount).toBe(77799)
    expect(() => checkedMonitorPage({ ...page, recordCount: '9007199254740993' }, 500)).toThrow('Invalid')
    expect(page.data[0].value).toBeNull()
    expect(() => checkedMonitorPage({ ...page, data: Array(501).fill(page.data[0]) }, 500)).toThrow('oversized')
    expect(checkedMonitorPage({ noData: true }, 500)).toEqual({ fields: [], data: [], recordCount: 0, noData: true })
  })
})
