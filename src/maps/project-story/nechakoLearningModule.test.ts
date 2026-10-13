import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeProjectPackage } from '@/lib/projectPackages'

const read = (file: string) => JSON.parse(readFileSync(path.resolve(__dirname, '../../../public', file), 'utf8'))
const raw = read('data/projects/nechako-learning-module.json')
const boundary = read('data/boundaries/BCFWA/echoscreen_fraser_nechako.geojson')
const locations = read('data/nechako-showcase/research-locations.geojson')

describe('Nechako learning module adaptation', () => {
  it('retains all five cases and 25 discussion prompts through normalization', () => {
    const project = normalizeProjectPackage(raw)!
    expect(project.workspace?.type).toBe('story-map')
    expect(project.scenes).toHaveLength(7)
    const cases = project.scenes.slice(1, 6)
    expect(cases.map((scene) => scene.label)).toEqual([
      'Prince George',
      'Vanderhoof',
      'Fraser Lake',
      'Burns Lake',
      'Fort St. James',
    ])
    for (const scene of cases) expect(scene.paragraphs).toHaveLength(5)
    expect(cases.flatMap((scene) => scene.paragraphs ?? [])).toHaveLength(25)
  })

  it('matches the watershed spotlight to actual source values with the correct type', () => {
    for (const scene of raw.scenes) {
      const highlight = scene.highlights[0]
      const matches = boundary.features.filter((feature: { properties: Record<string, unknown> }) =>
        highlight.values.includes(feature.properties[highlight.property]),
      )
      expect(matches).toHaveLength(1)
      expect(matches[0].properties.namedWatershedId).toBe(8886)
    }
  })

  it('keeps community markers tied to the existing public context coordinates', () => {
    const workspace = raw.workspace
    for (const place of workspace.places) {
      const location = locations.features.find(
        (feature: { properties: { location_id: string } }) =>
          feature.properties.location_id === place.id.replaceAll('-', '_'),
      )
      expect(location?.geometry.type).toBe('Point')
      expect(place.coordinates).toEqual(location.geometry.coordinates)
    }
    expect(raw.status).toBe('Public module adaptation')
    expect(raw.sourceNote).toContain('approximate context markers')
  })
})
