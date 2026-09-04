import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { normalizeProjectPackage } from '@/lib/projectPackages'

const projectRaw: unknown = JSON.parse(
  readFileSync(
    path.resolve(__dirname, '../../../public/data/projects/inaturalist-species-at-risk-live-bc.json'),
    'utf8',
  ),
)
const manifest = JSON.parse(
  readFileSync(
    path.resolve(
      __dirname,
      '../../../vendor/bcdatamapper/datascrapers/bc/forest-map-sources/output/species-at-risk/inaturalist_species_at_risk_live_2026-08-28.manifest.json',
    ),
    'utf8',
  ),
)

describe('inaturalist-species-at-risk-live-bc story package', () => {
  const project = normalizeProjectPackage(projectRaw)

  it('uses one compressed submodule-owned dataset for four thematic scenes', () => {
    expect(project).not.toBeNull()
    expect(project!.workspace?.type).toBe('story-map')
    if (project!.workspace?.type !== 'story-map') throw new Error('expected a story-map workspace')
    expect(project!.workspace.layers).toHaveLength(1)
    expect(project!.workspace.layers[0].data).toBe(
      '/data/forest/species-at-risk/inaturalist_species_at_risk_live_2026-08-28.geojson.gz',
    )
    expect(project!.scenes).toHaveLength(4)
    expect(project!.scenes.every((scene) => scene.visibleLayerIds[0] === 'live-observations')).toBe(true)
  })

  it('recolours the shared source by period, accuracy, and observation frequency', () => {
    const properties = project!.scenes
      .slice(1)
      .map((scene) => scene.layerOverrides?.['live-observations']?.category?.property)
    expect(properties).toEqual(['observation_period', 'accuracy_band', 'observation_frequency_band'])

    const periodColors = project!.scenes[1].layerOverrides?.['live-observations']?.category?.colors ?? {}
    const accuracyColors = project!.scenes[2].layerOverrides?.['live-observations']?.category?.colors ?? {}
    expect(new Set(Object.keys(periodColors))).toEqual(new Set(Object.keys(manifest.counts.byObservationPeriod)))
    expect(new Set(Object.keys(accuracyColors))).toEqual(new Set(Object.keys(manifest.counts.byAccuracyBand)))
  })

  it('keeps catalog claims aligned with the verified live manifest', () => {
    expect(manifest.counts).toMatchObject({ observations: 118350, uniqueTaxa: 1665 })
    expect(project!.catalogMetrics).toEqual([
      { label: 'Observations', value: '118,350' },
      { label: 'Taxa', value: '1,665' },
      { label: 'Observation years', value: '1973–2026' },
    ])
    expect(manifest.topTaxa[0]).toEqual({
      taxonId: '4956',
      name: 'Great Blue Heron · Ardea herodias',
      observations: 11135,
    })
  })
})
