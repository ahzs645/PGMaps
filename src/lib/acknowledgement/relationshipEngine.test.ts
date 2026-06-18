import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  buildRegionalAcknowledgement,
  buildRelationshipAcknowledgement,
  compareNationSets,
  defaultWordingOptions,
  haversineKm,
  matchRelationshipPlace,
  matchBoundaryRelationshipPlace,
  type RelationshipGraph,
  type ReferenceAreaRecord,
  relationshipCorePhrase,
  summarizeMultiPoint,
} from './engine'

const graph = JSON.parse(
  readFileSync(new URL('../../../public/data/acknowledgement/relationship-graph.json', import.meta.url), 'utf8'),
) as RelationshipGraph

function matchKnownPlace(fullAddress: string, addressInput = fullAddress) {
  const match = matchRelationshipPlace(graph, { fullAddress, latitude: 0, longitude: 0 }, addressInput, {
    place: true,
    municipality: true,
    boundary: true,
  })
  if (!match) throw new Error(`Expected relationship match for ${fullAddress}`)
  return match
}

function geometrySourceUrl(source: ReferenceAreaRecord['geometrySource']) {
  if (!source) return null
  if (source.dataset === 'native-land') return `../../../public/data/native-land/${source.category}.geojson`
  if (source.category === 'first_nations_treaty_areas') return '../../../public/data/indigenous/first_nations_treaty_areas.geojson'
  if (source.category === 'first_nations_treaty_lands') return '../../../public/data/indigenous/first_nations_treaty_lands.geojson'
  return null
}

function loadGeoJson(url: string) {
  return Promise.resolve(JSON.parse(readFileSync(new URL(url, import.meta.url), 'utf8')) as GeoJSON.FeatureCollection)
}

describe('matchRelationshipPlace fixtures', () => {
  it('matches the UNBC Prince George campus before the municipality fallback', () => {
    const match = matchKnownPlace('3333 University Way, Prince George, BC')

    expect(match.place.id).toBe('unbc-prince-george-campuses')
    expect(match.relationships.map((relationship) => relationship.id)).toEqual(['unbc-pg-lheidli-dakelh'])
  })

  it('matches downtown Prince George UNBC aliases to the campus relationship', () => {
    const match = matchKnownPlace('499 George Street, Prince George, BC')

    expect(match.place.id).toBe('unbc-prince-george-campuses')
    expect(match.relationships[0].nationIds).toEqual(['lheidli-tenneh'])
  })

  it('matches Fort St. John to the Treaty 8 Dane-zaa relationship', () => {
    const match = matchKnownPlace('9820 120 Avenue, Fort St. John, BC')

    expect(match.place.id).toBe('unbc-peace-river-liard-fort-st-john')
    expect(relationshipCorePhrase(graph, match.relationships[0])).toBe(
      'Treaty 8 territory on the traditional lands of the Dane-zaa Peoples of Doig River First Nation, Blueberry River First Nations, and Halfway River First Nation',
    )
  })

  it('matches Terrace to the UNBC Northwest Ts’msyen relationship', () => {
    const match = matchKnownPlace('Terrace, BC', 'UNBC Northwest campus, Terrace, BC')

    expect(match.place.id).toBe('unbc-northwest-terrace')
    expect(relationshipCorePhrase(graph, match.relationships[0])).toBe(
      'unceded traditional territory of Kitsumkalum First Nation and Kitselas First Nation, part of the Ts\'msyen (Tsimshian) territory',
    )
  })

  it('matches Prince Rupert to the UNBC satellite Ts’msyen relationship', () => {
    const match = matchKnownPlace('Prince Rupert, BC', 'UNBC Prince Rupert satellite campus')

    expect(match.place.id).toBe('unbc-northwest-prince-rupert')
    expect(relationshipCorePhrase(graph, match.relationships[0])).toBe(
      'on or near unceded traditional Ts\'msyen (Tsimshian) territories including Lax Kw’alaams Band, Metlakatla First Nation, Gitxaała Nation, Gitga’at First Nation, and Kitasoo Band',
    )
  })

  it('matches Quesnel to the Dakelh and Tsilhqot’in relationship', () => {
    const match = matchKnownPlace('100 Campus Way, Quesnel, BC')

    expect(match.place.id).toBe('unbc-south-central-quesnel')
    expect(relationshipCorePhrase(graph, match.relationships[0])).toBe(
      'unceded traditional territories of Lhtako Dene Nation, Nazko First Nation, Lhoosk’uz Dené Nation, and ?Esdilagh First Nation',
    )
  })

  it('matches UBC Point Grey to the Musqueam academic-campus relationship', () => {
    const match = matchKnownPlace('2329 West Mall, Vancouver, BC', 'UBC Vancouver-Point Grey academic campus')

    expect(match.place.id).toBe('ubc-vancouver-point-grey-campus')
    expect(match.relationships.map((relationship) => relationship.id)).toEqual(['ubc-point-grey-musqueam'])
    expect(relationshipCorePhrase(graph, match.relationships[0])).toBe(
      'the traditional, ancestral unceded territory of the hən̓q̓əmin̓əm̓-speaking xʷməθkʷəy̓əm (Musqueam)',
    )
  })

  it('matches broader UBC Vancouver operations to Musqueam, Squamish, and Tsleil-Waututh context', () => {
    const match = matchKnownPlace('UBC operations in Vancouver')

    expect(match.place.id).toBe('ubc-vancouver-operations')
    expect(relationshipCorePhrase(graph, match.relationships[0])).toBe(
      'unceded territories of the Coast Salish Peoples, including xʷməθkʷəy̓əm (Musqueam), Skwxwú7mesh (Squamish), and səl̓ilwətaɁɬ (Tsleil-Waututh)',
    )
  })

  it('matches UBC Robson Square to broader Coast Salish template context', () => {
    const match = matchKnownPlace('800 Robson Street, Vancouver, BC')

    expect(match.place.id).toBe('ubc-robson-square')
    expect(relationshipCorePhrase(graph, match.relationships[0])).toBe(
      'unceded territories of the Coast Salish Peoples, including xʷməθkʷəy̓əm (Musqueam), Skwxwú7mesh (Squamish), Stó:lō, and səl̓ilwətaɁɬ (Tsleil-Waututh)',
    )
  })

  it('matches UBC Okanagan to Syilx Okanagan territory', () => {
    const match = matchKnownPlace('3333 University Way, Kelowna, BC', 'UBC Okanagan')

    expect(match.place.id).toBe('ubc-okanagan-campus')
    expect(relationshipCorePhrase(graph, match.relationships[0])).toBe(
      'the traditional, ancestral unceded territory of the Syilx Okanagan Nation',
    )
  })

  it('matches UVic to Lək̓ʷəŋən and W̱SÁNEĆ relationship context', () => {
    const match = matchKnownPlace('3800 Finnerty Road, Victoria, BC', 'University of Victoria')

    expect(match.place.id).toBe('university-of-victoria-campus')
    expect(match.relationships.map((relationship) => relationship.id)).toEqual([
      'uvic-lekwungen-territory',
      'uvic-lekwungen-wsanec-continuing-relationships',
    ])
    expect(match.relationships.map((relationship) => relationshipCorePhrase(graph, relationship))).toEqual([
      'the territory of the Songhees Nation and Xʷsepsəm (Esquimalt) Nation',
      'traditional territories of Songhees Nation, Xʷsepsəm (Esquimalt) Nation, and W̱SÁNEĆ Peoples',
    ])
  })

  it('does not match outside known places without boundary context', () => {
    const match = matchRelationshipPlace(graph, {
      fullAddress: '700 West Georgia Street, Vancouver, BC',
      latitude: 49.2827,
      longitude: -123.1207,
    }, 'Vancouver, BC', { place: true, municipality: true, boundary: false })

    expect(match).toBeNull()
  })
})

describe('matchBoundaryRelationshipPlace fixtures', () => {
  it('uses the official BC Treaty 8 area for Fort St. John boundary context', async () => {
    const match = await matchBoundaryRelationshipPlace(
      graph,
      { fullAddress: 'Fort St. John, BC', latitude: 56.246, longitude: -120.847 },
      geometrySourceUrl,
      loadGeoJson,
    )

    expect(match?.place.id).toBe('treaty-8-boundary-context')
    expect(match?.relationships[0].id).toBe('boundary-treaty8-dane-zaa')
  })

  it('uses Ts’msyen and Lheidli polygons as contextual boundary triggers', async () => {
    const terrace = await matchBoundaryRelationshipPlace(
      graph,
      { fullAddress: 'Terrace, BC', latitude: 54.516, longitude: -128.603 },
      geometrySourceUrl,
      loadGeoJson,
    )
    const princeGeorge = await matchBoundaryRelationshipPlace(
      graph,
      { fullAddress: 'Prince George, BC', latitude: 53.9171, longitude: -122.7497 },
      geometrySourceUrl,
      loadGeoJson,
    )

    expect(terrace?.place.id).toBe('tsmsyen-boundary-context')
    expect(princeGeorge?.place.id).toBe('lheidli-tenneh-boundary-context')
  })

  it('uses bundled Native Land polygons as context triggers for UBC and UVic areas', async () => {
    const pointGrey = await matchBoundaryRelationshipPlace(
      graph,
      { fullAddress: 'UBC Point Grey, Vancouver, BC', latitude: 49.2606, longitude: -123.246 },
      geometrySourceUrl,
      loadGeoJson,
    )
    const kelowna = await matchBoundaryRelationshipPlace(
      graph,
      { fullAddress: 'Kelowna, BC', latitude: 49.888, longitude: -119.496 },
      geometrySourceUrl,
      loadGeoJson,
    )
    const victoria = await matchBoundaryRelationshipPlace(
      graph,
      { fullAddress: 'Victoria, BC', latitude: 48.4634, longitude: -123.3117 },
      geometrySourceUrl,
      loadGeoJson,
    )

    expect(pointGrey?.relationships[0].referenceAreaIds).toContain('native-land-musqueam')
    expect(kelowna?.relationships[0].referenceAreaIds).toContain('native-land-syilx-okanagan')
    expect(victoria?.relationships[0].referenceAreaIds).toContain('native-land-lekwungen-songhees')
  })
})

describe('buildRelationshipAcknowledgement fixtures', () => {
  it('generates event wording for UNBC Prince George', () => {
    const match = matchKnownPlace('3333 University Way, Prince George, BC')

    expect(buildRelationshipAcknowledgement('event', graph, match)).toBe(
      'We are grateful to gather today at UNBC Prince George campuses, situated unceded traditional territory of Lheidli T’enneh First Nation, part of the Dakelh (Carrier) Peoples territory.',
    )
  })

  it('keeps Quesnel people-group affiliations when a subset of Nations is selected', () => {
    const match = matchKnownPlace('100 Campus Way, Quesnel, BC')

    expect(buildRelationshipAcknowledgement('formal', graph, match, ['lhtako-dene', 'esdilagh'])).toBe(
      'We respectfully acknowledge that UNBC South-Central campus is situated unceded traditional territories of Lhtako Dene Nation and ?Esdilagh First Nation. Lhtako Dene Nation is part of the Dakelh (Carrier) Peoples and ?Esdilagh First Nation is part of the Tsilhqot’in Nation.',
    )
  })

  it('can generate variants without treaty or people-group context', () => {
    const match = matchKnownPlace('9820 120 Avenue, Fort St. John, BC')

    expect(buildRelationshipAcknowledgement('short', graph, match, [], {
      ...defaultWordingOptions,
      includeTreatyContext: false,
      includePeopleGroupContext: false,
    })).toBe(
      'UNBC Peace River-Liard campus is situated the traditional lands of Doig River First Nation, Blueberry River First Nations, and Halfway River First Nation.',
    )
  })

  it('keeps institutional wording distinct from short event wording', () => {
    const match = matchKnownPlace('100 Campus Way, Quesnel, BC')

    expect(buildRelationshipAcknowledgement('institutional', graph, match, ['lhtako-dene', 'esdilagh'])).toBe(
      'UNBC South-Central campus is situated unceded traditional territories of Lhtako Dene Nation and ?Esdilagh First Nation. Lhtako Dene Nation is part of the Dakelh (Carrier) Peoples and ?Esdilagh First Nation is part of the Tsilhqot’in Nation.',
    )
  })

  it('generates a formal UBC Point Grey variant from structured relationship facts', () => {
    const match = matchKnownPlace('2329 West Mall, Vancouver, BC', 'UBC Vancouver-Point Grey academic campus')

    expect(buildRelationshipAcknowledgement('formal', graph, match)).toBe(
      'We respectfully acknowledge that UBC Vancouver-Point Grey academic campus is situated the traditional, ancestral unceded territory of the hən̓q̓əmin̓əm̓-speaking xʷməθkʷəy̓əm (Musqueam).',
    )
  })
})

describe('speaker perspective', () => {
  const pgMatch = () => matchKnownPlace('3333 University Way, Prince George, BC')

  it('keeps the collective voice as the default', () => {
    expect(buildRelationshipAcknowledgement('short', graph, pgMatch())).toBe(
      'UNBC Prince George campuses is situated unceded traditional territory of Lheidli T’enneh First Nation, part of the Dakelh (Carrier) Peoples territory.',
    )
  })

  it('speaks in the first person for the individual voice', () => {
    expect(buildRelationshipAcknowledgement('event', graph, pgMatch(), [], {
      ...defaultWordingOptions,
      perspective: 'individual',
    })).toBe(
      'I am grateful to be at UNBC Prince George campuses today, on unceded traditional territory of Lheidli T’enneh First Nation, part of the Dakelh (Carrier) Peoples territory.',
    )
  })

  it('names the organization for the organization voice', () => {
    expect(buildRelationshipAcknowledgement('short', graph, pgMatch(), [], {
      ...defaultWordingOptions,
      perspective: 'organization',
      organizationName: 'UNBC',
    })).toBe(
      'UNBC operates at UNBC Prince George campuses, on unceded traditional territory of Lheidli T’enneh First Nation, part of the Dakelh (Carrier) Peoples territory.',
    )
  })

  it('falls back to a generic organization subject when unnamed', () => {
    expect(buildRelationshipAcknowledgement('short', graph, pgMatch(), [], {
      ...defaultWordingOptions,
      perspective: 'organization',
    })).toBe(
      'Our organization operates at UNBC Prince George campuses, on unceded traditional territory of Lheidli T’enneh First Nation, part of the Dakelh (Carrier) Peoples territory.',
    )
  })
})

describe('regional acknowledgement', () => {
  it('names a region instead of specific Nations, in each voice', () => {
    expect(buildRegionalAcknowledgement('short')).toBe(
      'We acknowledge the traditional territories of First Nations across British Columbia.',
    )
    expect(buildRegionalAcknowledgement('short', { perspective: 'individual' })).toBe(
      'I acknowledge the traditional territories of First Nations across British Columbia.',
    )
    expect(buildRegionalAcknowledgement('short', { perspective: 'organization', organizationName: 'BC Ferries' })).toBe(
      'BC Ferries operates on the traditional territories of First Nations across British Columbia.',
    )
  })

  it('honours a custom region name', () => {
    expect(buildRegionalAcknowledgement('event', {
      perspective: 'organization',
      organizationName: 'Northern Health',
      regionName: 'northern British Columbia',
    })).toBe(
      'On behalf of Northern Health, we are grateful to carry out our work on the traditional territories of First Nations across northern British Columbia.',
    )
  })
})

describe('summarizeMultiPoint', () => {
  const pg = { latitude: 53.9171, longitude: -122.7497 }
  const vancouver = { latitude: 49.2827, longitude: -123.1207 }

  it('unions Nation names across points, deduped in first-seen order', () => {
    const summary = summarizeMultiPoint([
      { ...pg, nationNames: ['Lheidli T’enneh First Nation'] },
      { ...pg, nationNames: ['Lheidli T’enneh First Nation', 'Nazko First Nation'] },
    ])
    expect(summary.nationNames).toEqual(['Lheidli T’enneh First Nation', 'Nazko First Nation'])
    expect(summary.distinctNationCount).toBe(2)
    expect(summary.suggestRegional).toBe(false)
  })

  it('suggests regional when points are far apart', () => {
    const summary = summarizeMultiPoint([
      { ...pg, nationNames: ['A'] },
      { ...vancouver, nationNames: ['B'] },
    ])
    expect(summary.maxSpreadKm).toBeGreaterThan(400)
    expect(summary.suggestRegional).toBe(true)
  })

  it('suggests regional when many distinct Nations are named', () => {
    const summary = summarizeMultiPoint([{ ...pg, nationNames: ['A', 'B', 'C', 'D', 'E'] }])
    expect(summary.suggestRegional).toBe(true)
  })
})

describe('haversineKm', () => {
  it('approximates the Prince George to Vancouver distance', () => {
    const km = haversineKm(53.9171, -122.7497, 49.2827, -123.1207)
    expect(km).toBeGreaterThan(490)
    expect(km).toBeLessThan(540)
  })
})

describe('compareNationSets', () => {
  it('matches fuzzily and flags missed + extra', () => {
    const result = compareNationSets(
      ['Musqueam', 'Lheidli T’enneh First Nation'],
      ['xʷməθkʷəy̓əm (Musqueam) *', 'Dakeł Keyoh *'],
    )
    expect(result.matched).toEqual(['Musqueam'])
    expect(result.missed).toEqual(['Lheidli T’enneh First Nation'])
    expect(result.extra).toEqual(['Dakeł Keyoh *'])
  })
})
