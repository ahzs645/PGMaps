import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import type { RelationshipGraph } from '@/lib/acknowledgement/engine'
import { createNationResolver } from './nations'

const graph = JSON.parse(
  readFileSync(new URL('../../../../public/data/acknowledgement/relationship-graph.json', import.meta.url), 'utf8'),
) as RelationshipGraph
const canonicalize = createNationResolver(graph)

describe('createNationResolver', () => {
  it('resolves Nations already in the graph', () => {
    expect(canonicalize('Musqueam')).toMatchObject({ status: 'nation', id: 'musqueam' })
    expect(canonicalize('Lheidli T’enneh First Nation')).toMatchObject({ status: 'nation', id: 'lheidli-tenneh' })
  })

  it('closes the alias gaps via the manual map', () => {
    expect(canonicalize('Squamish')).toMatchObject({ status: 'nation', id: 'squamish' })
    expect(canonicalize('Tsleil-Waututh')).toMatchObject({ status: 'nation', id: 'tsleil-waututh' })
    expect(canonicalize('Syilx')).toMatchObject({ status: 'nation', id: 'syilx-okanagan-nation' })
  })

  it('resolves people-group names', () => {
    expect(canonicalize('Ts’msyen').status).toBe('people-group')
    expect(canonicalize('Coast Salish').status).toBe('people-group')
  })

  it('flags Nations not in our database as unlisted', () => {
    expect(canonicalize('Snuneymuxw First Nation')).toMatchObject({ status: 'unlisted' })
    expect(canonicalize('Wet’suwet’en').status).toBe('unlisted')
  })
})
