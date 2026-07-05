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

  it('resolves organization-source spellings added from official acknowledgements', () => {
    expect(canonicalize('Liǧʷiłdax̌ʷ people')).toMatchObject({ status: 'people-group', inGraph: false })
    expect(canonicalize('Wei Wai Kum')).toMatchObject({ status: 'nation', inGraph: false })
    expect(canonicalize('We Wai Kai')).toMatchObject({ status: 'nation', inGraph: false })
    expect(canonicalize('shíshálh Nation')).toMatchObject({ status: 'nation', inGraph: false })
    expect(canonicalize('ƛaʔuukʷiʔatḥ (Tla-o-qui-aht First Nation)')).toMatchObject({ status: 'nation', inGraph: false })
    expect(canonicalize('q̓ic̓əy̓ (Katzie) First Nation')).toMatchObject({ status: 'nation', inGraph: false })
    expect(canonicalize('W̱JOȽEȽP (Tsartlip)')).toMatchObject({ status: 'nation', inGraph: false })
    expect(canonicalize('SȾÁUTW̱ (Tsawout)')).toMatchObject({ status: 'nation', inGraph: false })
    expect(canonicalize('xʷsepsəm (Kosapsum) Nation')).toMatchObject({ status: 'nation', inGraph: true, id: 'esquimalt' })
    expect(canonicalize('Yuułuʔiłʔatḥ')).toMatchObject({ status: 'nation', inGraph: false })
    expect(canonicalize('Quw\'utsun First Nation')).toMatchObject({ status: 'nation', inGraph: false })
    expect(canonicalize('Cowichan Tribes')).toMatchObject({ status: 'nation', inGraph: false })
    expect(canonicalize('Halalt First Nation')).toMatchObject({ status: 'nation', inGraph: false })
    expect(canonicalize('Lyackson First Nation')).toMatchObject({ status: 'nation', inGraph: false })
    expect(canonicalize('Ts\'uubaa-asatx Nation')).toMatchObject({ status: 'nation', inGraph: false })
    expect(canonicalize('Ditidaht First Nation')).toMatchObject({ status: 'nation', inGraph: false })
    expect(canonicalize('Ehattesaht/Chinehkint First Nation')).toMatchObject({ status: 'nation', inGraph: false })
    expect(canonicalize('Ka:\'yu:\'k\'t\'h\'/Che:k\'tles7et\'h\' First Nations')).toMatchObject({ status: 'nation', inGraph: false })
    expect(canonicalize('Kwiakah First Nation')).toMatchObject({ status: 'nation', inGraph: false })
    expect(canonicalize('Mowachaht/Muchalaht First Nation')).toMatchObject({ status: 'nation', inGraph: false })
    expect(canonicalize('Nuchatlaht First Nation')).toMatchObject({ status: 'nation', inGraph: false })
    expect(canonicalize('Tlowitsis Nation')).toMatchObject({ status: 'nation', inGraph: false })
    expect(canonicalize('Southern Dakelh')).toMatchObject({ status: 'people-group', inGraph: false })
    expect(canonicalize('Tsilhqot\'in')).toMatchObject({ status: 'people-group' })
    expect(canonicalize('Secwepemc')).toMatchObject({ status: 'people-group' })
    expect(canonicalize('Lheidli T\'enneh First Nation')).toMatchObject({ status: 'nation', inGraph: true, id: 'lheidli-tenneh' })
    expect(canonicalize('kʷikʷəƛ̓əm (Kwikwetlem) First Nation')).toMatchObject({ status: 'nation', inGraph: false })
    expect(canonicalize('q̓ʷɑ:n̓ƛ̓ən̓ (Kwantlen) First Nation')).toMatchObject({ status: 'nation', inGraph: false })
    expect(canonicalize('Máthxwi (Matsqui) First Nation')).toMatchObject({ status: 'nation', inGraph: false })
    expect(canonicalize('se’mya’me (Semiahmoo) First Nation')).toMatchObject({ status: 'nation', inGraph: false })
    expect(canonicalize('Sḵwx̱wú7mesh Úxwumixw')).toMatchObject({ status: 'nation', inGraph: true, id: 'squamish' })
    expect(canonicalize('səlilwətaɬ (Tsleil-Waututh)')).toMatchObject({ status: 'nation', inGraph: true, id: 'tsleil-waututh' })
    expect(canonicalize('Tk̓emlúps te Secwépemc')).toMatchObject({ status: 'nation', inGraph: false })
    expect(canonicalize('Lhtako Dene Nation')).toMatchObject({ status: 'nation', inGraph: true })
    expect(canonicalize('Nazko First Nation')).toMatchObject({ status: 'nation', inGraph: true })
    expect(canonicalize('Lhoosk\'uz Dené Nation')).toMatchObject({ status: 'nation', inGraph: true })
    expect(canonicalize('ʔEsdilagh First Nation')).toMatchObject({ status: 'nation', inGraph: true })
    expect(canonicalize('Nanoose First Nation')).toMatchObject({ status: 'nation', inGraph: false })
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
