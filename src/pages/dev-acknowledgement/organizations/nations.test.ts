import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import type { RelationshipGraph } from '@/lib/acknowledgement/engine'
import { createNationResolver } from './nations'

const graph = JSON.parse(
  readFileSync(new URL('../../../../public/data/acknowledgement/relationship-graph.json', import.meta.url), 'utf8'),
) as RelationshipGraph
const communities = JSON.parse(
  readFileSync(new URL('../../../../public/data/indigenous/first_nation_community_locations.geojson', import.meta.url), 'utf8'),
) as GeoJSON.FeatureCollection
const canonicalize = createNationResolver(graph)
const canonicalizeWithGis = createNationResolver(graph, communities.features)

describe('createNationResolver', () => {
  it('resolves Nations already in the graph', () => {
    expect(canonicalize('Musqueam')).toMatchObject({ status: 'nation', id: 'musqueam' })
    expect(canonicalize('Lheidli T’enneh First Nation')).toMatchObject({ status: 'nation', id: 'lheidli-tenneh' })
  })

  it('closes the alias gaps to graph Nations (registry-linked)', () => {
    expect(canonicalize('Squamish')).toMatchObject({ status: 'nation', id: 'squamish', inGraph: true })
    expect(canonicalize('Tsleil-Waututh')).toMatchObject({ status: 'nation', id: 'tsleil-waututh', inGraph: true })
    expect(canonicalize('Syilx')).toMatchObject({ status: 'nation', id: 'syilx-okanagan-nation', inGraph: true })
  })

  it('resolves people-group names', () => {
    expect(canonicalize('Ts’msyen').status).toBe('people-group')
    expect(canonicalize('Coast Salish').status).toBe('people-group')
  })

  it('resolves registry-only Nations not in the graph (inGraph false)', () => {
    expect(canonicalize('Snuneymuxw First Nation')).toMatchObject({ status: 'nation', inGraph: false })
    expect(canonicalize('Snuneymuxw')).toMatchObject({ status: 'nation', inGraph: false })
    expect(canonicalize('Wet’suwet’en')).toMatchObject({ status: 'nation', inGraph: false })
    expect(canonicalize('Nuu-chah-nulth')).toMatchObject({ status: 'people-group', inGraph: false })
  })

  it('still flags genuinely unknown names as unlisted', () => {
    expect(canonicalize('Definitely Not A Nation 123').status).toBe('unlisted')
  })

  it('enriches with GIS data (coordinates) when community locations are supplied', () => {
    const withoutGis = canonicalize('Snuneymuxw First Nation')
    expect(withoutGis.gis).toBeUndefined()

    const withGis = canonicalizeWithGis('Snuneymuxw First Nation')
    expect(withGis.gis).toBeDefined()
    expect(withGis.gis?.coordinates).toHaveLength(2)
    expect(withGis.gis?.name).toMatch(/Snuneymuxw/)
  })
})
