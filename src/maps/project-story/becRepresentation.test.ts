import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { normalizeProjectPackage } from '@/lib/projectPackages'

const root = path.resolve(__dirname, '../../..')
const readJson = (file: string) => {
  const bytes = readFileSync(path.join(root, 'public', file))
  return JSON.parse((file.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8'))
}

type MapProperties = {
  code: string
  zone: string
  representationClass: string
  representationLabel: string
  display: string
  title: string
  details: string
  protectedPercent?: number | null
}
type StudyUnit = {
  code: string
  protectedPercent: number | null
  representationClass: string
}
type StudyClass = { id: string; count: number; minInclusive: number | null }

const rawProject = readJson('data/projects/bec-protected-areas.json')
const project = normalizeProjectPackage(rawProject)!
const study = readJson('data/bec-representation/representation.json') as {
  source: { commit: string }
  summary: { unitCount: number; finiteRatioCount: number }
  classes: StudyClass[]
  units: StudyUnit[]
}
const geography = readJson('data/bec-representation/bec-units.geojson.gz') as {
  type: string
  features: Array<{ geometry: { type: string; coordinates: unknown[] }; properties: MapProperties }>
}
const attributes = readJson('data/bec-representation/map-attributes.json') as {
  records: MapProperties[]
  coverage: { matchedStudyCodeCount: number; missingStudyCodes: string[]; currentCodesWithoutStudy: string[] }
}
const byCode = new Map(attributes.records.map((record) => [record.code, record]))
const joined = geography.features.map((feature) => ({
  ...feature.properties,
  ...byCode.get(feature.properties.code),
}))

describe('BEC representation project', () => {
  it('preserves the authored story, data join, and all nine chapters through the real parser', () => {
    expect(project).not.toBeNull()
    expect(project.slug).toBe('bec-protected-areas')
    expect(project.scenes.map((scene) => scene.label)).toEqual(
      rawProject.scenes.map((scene: { label: string }) => scene.label),
    )
    expect(project.scenes).toHaveLength(9)
    expect(project.workspace?.type).toBe('story-map')
    if (project.workspace?.type !== 'story-map') throw new Error('Story workspace missing')
    expect(project.workspace.options).toMatchObject({ layout: 'sidecar', storyCover: true, chapterNavigation: true })
    expect(project.workspace.layers[0].attributes).toEqual({
      data: '/data/bec-representation/map-attributes.json',
      boundaryProperty: 'code',
      attributeProperty: 'code',
      recordsProperty: 'records',
    })
    expect(project.workspace.layers[0].selectionDetailProperty).toBe('details')
  })

  it('keeps the historical study complete while disclosing exact-code geography coverage', () => {
    expect(attributes.records).toHaveLength(213)
    expect(new Set(attributes.records.map((record) => record.code))).toEqual(
      new Set(study.units.map((unit) => unit.code)),
    )
    expect(geography.type).toBe('FeatureCollection')
    expect(geography.features).toHaveLength(222)
    expect(new Set(geography.features.map((feature) => feature.properties.code)).size).toBe(222)
    expect(
      geography.features.every(
        (feature) =>
          ['Polygon', 'MultiPolygon'].includes(feature.geometry.type) && feature.geometry.coordinates.length > 0,
      ),
    ).toBe(true)
    expect(attributes.coverage.matchedStudyCodeCount).toBe(198)
    expect(attributes.coverage.missingStudyCodes).toHaveLength(15)
    expect(attributes.coverage.currentCodesWithoutStudy).toHaveLength(24)
    expect(joined.filter((properties) => properties.representationClass === 'not-in-study')).toHaveLength(24)
    for (const properties of joined.filter((entry) => entry.representationClass === 'not-in-study')) {
      expect(properties.protectedPercent ?? null).toBeNull()
      expect(properties.title).toContain(properties.code)
      expect(properties.details).toMatch(/2023|study/i)
    }
    expect(project.sourceNote).toMatch(/v13\.1/)
    expect(project.sourceNote).toMatch(/not.*recalculated/)
    expect(project.details?.join(' ')).toContain('198 study codes')
  })

  it('never turns missing or infinite source results into zero or high representation', () => {
    expect(byCode.get('CDFmm')).toMatchObject({ protectedPercent: null, representationClass: 'invalid-denominator' })
    for (const code of ['CWHms2', 'ICHmc1a', 'SBPSmk', 'SBSmc1']) {
      expect(byCode.get(code)).toMatchObject({
        protectedPercent: null,
        representationClass: 'no-recorded-intersection',
      })
    }
    for (const code of ['BWBSvk', 'ESSFmm2', 'SWBvks']) {
      expect(byCode.get(code)!.protectedPercent).toBeGreaterThan(100)
      expect(byCode.get(code)!.details).toContain('rounding')
    }
    for (const record of attributes.records) {
      expect(record.details).not.toContain('\\n')
      expect(record.details).toContain('\n\n')
      expect(record.details).toContain('2023')
      expect(record.details).toContain('v13.1')
    }
  })

  it('pins the displayed geometry bytes and keeps cartography outside the study calculations', () => {
    const provenance = readJson('data/bec-representation/geometry-provenance.json')
    const compressed = readFileSync(path.join(root, 'public/data/bec-representation/bec-units.geojson.gz'))
    const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
    expect(digest(compressed)).toBe(provenance.geometry.compressedSha256)
    expect(digest(gunzipSync(compressed))).toBe(provenance.geometry.sha256)
    expect(provenance.geometry.featureCount).toBe(geography.features.length)
    expect(provenance.geometry.analyticUse).toBe(false)
    expect(provenance.source.version).toBe('13.1')
    expect(provenance.crosswalk.studyBoundaryVersion).toBe('12')
    expect(provenance.crosswalk.missingStudyCodes).toEqual(attributes.coverage.missingStudyCodes)
    expect(provenance.crosswalk.currentCodesWithoutStudy).toEqual(attributes.coverage.currentCodesWithoutStudy)
    expect(project.workspace?.map.maxZoom).toBe(9)
  })

  it('computes the overview bars from all 208 finite study results with an explicit unit denominator', () => {
    const interaction = project.scenes[0].interaction!
    expect(interaction.type).toBe('bars')
    expect(interaction.description).toContain('208')
    expect(interaction.description).toContain('not a share of land area')
    const classes = study.classes.filter((entry) => entry.minInclusive !== null)
    expect(interaction.items).toHaveLength(classes.length)
    expect(classes.map((entry) => entry.count)).toEqual([14, 56, 65, 41, 32])
    interaction.items.forEach((item, index) => {
      expect(item.share).toBeCloseTo(classes[index].count / study.summary.finiteRatioCount, 12)
      expect(project.scenes.some((scene) => scene.label === item.sceneLabel)).toBe(true)
    })
    expect(interaction.items.reduce((total, item) => total + (item.share ?? 0), 0)).toBeCloseTo(1, 12)
  })

  it('highlights only real joined properties and uses explicit legend labels for every visible class', () => {
    const workspace = project.workspace
    if (workspace?.type !== 'story-map') throw new Error('Story workspace missing')
    const layerIds = new Set(workspace.layers.map((layer) => layer.id))
    for (const scene of project.scenes) {
      expect(scene.focus).toContain('2023')
      expect(scene.focus).toContain('2026')
      for (const id of scene.visibleLayerIds) expect(layerIds.has(id)).toBe(true)
      for (const highlight of scene.highlights ?? []) {
        const actualValues = new Set(joined.map((properties) => properties[highlight.property as keyof MapProperties]))
        for (const value of highlight.values) expect(actualValues).toContain(value)
      }
    }
    const colors = workspace.layers[0].category!.colors
    for (const properties of joined) expect(colors[properties.representationLabel]).toMatch(/^#[a-f0-9]{6}$/i)
  })

  it('ships every local source link and pins the original study rather than a moving branch', () => {
    expect(project.links?.find((link) => link.label === 'Original study and analysis code')?.href).toContain(
      study.source.commit,
    )
    for (const link of project.links ?? []) {
      if (link.href.startsWith('/')) expect(existsSync(path.join(root, 'public', link.href))).toBe(true)
    }
    expect(project.catalogMetrics.find((metric) => metric.label === 'Study units')?.value).toBe(
      String(study.summary.unitCount),
    )
    const syncScript = readFileSync(path.join(root, 'scripts/sync-bcdatamapper-data.mjs'), 'utf8')
    expect(syncScript).toContain("'bec-representation'")
  })
})
