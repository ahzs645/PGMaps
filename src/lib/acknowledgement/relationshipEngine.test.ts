import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  buildRegionalAcknowledgement,
  buildLocatedAcknowledgement,
  buildFallbackAcknowledgement,
  buildMultiPointAcknowledgement,
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
  const fixtures: [RegExp, number, number][] = [
    [/Prince George/i, 53.8939, -122.8136],
    [/Fort St. John/i, 56.2465, -120.8476],
    [/Terrace/i, 54.5182, -128.5996],
    [/Prince Rupert/i, 54.3122, -130.3271],
    [/Quesnel/i, 52.9784, -122.4944],
    [/Victoria|UVic/i, 48.4634, -123.3117],
    [/Kelowna|Okanagan/i, 49.9395, -119.396],
    [/Vancouver|UBC/i, 49.2606, -123.246],
  ]
  const fixture = fixtures.find(([pattern]) => pattern.test(fullAddress))
  if (!fixture) throw new Error(`Missing test coordinates for ${fullAddress}`)
  const [, latitude, longitude] = fixture
  const match = matchRelationshipPlace(graph, { fullAddress, latitude, longitude }, addressInput, {
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
  if (source.category === 'first_nations_treaty_areas')
    return '../../../public/data/indigenous/first_nations_treaty_areas.geojson'
  if (source.category === 'first_nations_treaty_lands')
    return '../../../public/data/indigenous/first_nations_treaty_lands.geojson'
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
      'the traditional lands of Doig River First Nation, Blueberry River First Nations, and Halfway River First Nation in Treaty 8 territory',
    )
  })

  it('matches Terrace to the UNBC Northwest Ts’msyen relationship', () => {
    const match = matchKnownPlace('UNBC Northwest campus, Terrace, BC', 'UNBC Northwest campus, Terrace, BC')

    expect(match.place.id).toBe('unbc-northwest-terrace')
    expect(relationshipCorePhrase(graph, match.relationships[0])).toBe(
      'unceded traditional territory of Kitsumkalum First Nation and Kitselas First Nation',
    )
  })

  it('matches Prince Rupert to the UNBC satellite Ts’msyen relationship', () => {
    const match = matchKnownPlace(
      'UNBC Prince Rupert satellite campus, Prince Rupert, BC',
      'UNBC Prince Rupert satellite campus',
    )

    expect(match.place.id).toBe('unbc-northwest-prince-rupert')
    expect(relationshipCorePhrase(graph, match.relationships[0])).toBe(
      "on or near unceded traditional Ts'msyen (Tsimshian) territories including Lax Kw’alaams Band, Metlakatla First Nation, Gitxaała Nation, Gitga’at First Nation, and Kitasoo Band",
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
      '',
    ])
  })

  it('does not match outside known places without boundary context', () => {
    const match = matchRelationshipPlace(
      graph,
      {
        fullAddress: '700 West Georgia Street, Vancouver, BC',
        latitude: 49.2827,
        longitude: -123.1207,
      },
      'Vancouver, BC',
      { place: true, municipality: true, boundary: false },
    )

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

  it('does not boundary-match institution/campus areas to a specific campus', async () => {
    // A point inside a broad territory polygon proves territory, not that you are
    // at that institution's campus. Campus/operations-typed places are therefore
    // excluded from boundary matching (only generic boundary-context places match
    // by polygon), so a point near — but not at — UBC/UVic/UBCO no longer locks
    // onto that campus and instead falls through to the Native Land source.
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

    expect(pointGrey).toBeNull()
    expect(kelowna).toBeNull()
    expect(victoria).toBeNull()
  })
})

describe('buildRelationshipAcknowledgement fixtures', () => {
  it('generates event wording for UNBC Prince George', () => {
    const match = matchKnownPlace('3333 University Way, Prince George, BC')

    expect(buildRelationshipAcknowledgement('event', graph, match)).toBe(
      'We are grateful to gather on unceded traditional territory of Lheidli T’enneh First Nation. Lheidli T’enneh First Nation is part of the Dakelh (Carrier) Peoples.',
    )
  })

  it('keeps Quesnel people-group affiliations when a subset of Nations is selected', () => {
    const match = matchKnownPlace('100 Campus Way, Quesnel, BC')

    expect(buildRelationshipAcknowledgement('formal', graph, match, ['lhtako-dene', 'esdilagh'])).toBe(
      'We respectfully acknowledge that we are on unceded traditional territories of Lhtako Dene Nation and ?Esdilagh First Nation. Lhtako Dene Nation is part of the Dakelh (Carrier) Peoples and ?Esdilagh First Nation is part of the Tsilhqot’in Nation.',
    )
  })

  it('can generate variants without treaty or people-group context', () => {
    const match = matchKnownPlace('9820 120 Avenue, Fort St. John, BC')

    expect(
      buildRelationshipAcknowledgement('short', graph, match, undefined, {
        ...defaultWordingOptions,
        includeTreatyContext: false,
        includePeopleGroupContext: false,
      }),
    ).toBe(
      'We are on the traditional lands of Doig River First Nation, Blueberry River First Nations, and Halfway River First Nation.',
    )
  })

  it('keeps institutional wording distinct from short event wording', () => {
    const match = matchKnownPlace('100 Campus Way, Quesnel, BC')

    expect(buildRelationshipAcknowledgement('institutional', graph, match, ['lhtako-dene', 'esdilagh'])).toBe(
      'We are on unceded traditional territories of Lhtako Dene Nation and ?Esdilagh First Nation. Lhtako Dene Nation is part of the Dakelh (Carrier) Peoples and ?Esdilagh First Nation is part of the Tsilhqot’in Nation.',
    )
  })

  it('generates a formal UBC Point Grey variant from structured relationship facts', () => {
    const match = matchKnownPlace('2329 West Mall, Vancouver, BC', 'UBC Vancouver-Point Grey academic campus')

    expect(buildRelationshipAcknowledgement('formal', graph, match)).toBe(
      'We respectfully acknowledge that we are on the traditional, ancestral unceded territory of the hən̓q̓əmin̓əm̓-speaking xʷməθkʷəy̓əm (Musqueam). xʷməθkʷəy̓əm (Musqueam) is part of the Coast Salish Peoples.',
    )
  })
})

describe('speaker perspective', () => {
  const pgMatch = () => matchKnownPlace('3333 University Way, Prince George, BC')

  it('keeps the collective voice as the default', () => {
    expect(buildRelationshipAcknowledgement('short', graph, pgMatch())).toBe(
      'We are on unceded traditional territory of Lheidli T’enneh First Nation.',
    )
  })

  it('speaks in the first person for the individual voice', () => {
    expect(
      buildRelationshipAcknowledgement('event', graph, pgMatch(), undefined, {
        ...defaultWordingOptions,
        perspective: 'individual',
      }),
    ).toBe(
      'I am grateful to be on unceded traditional territory of Lheidli T’enneh First Nation. Lheidli T’enneh First Nation is part of the Dakelh (Carrier) Peoples.',
    )
  })

  it('names the organization for the organization voice', () => {
    expect(
      buildRelationshipAcknowledgement('short', graph, pgMatch(), undefined, {
        ...defaultWordingOptions,
        perspective: 'organization',
        organizationName: 'UNBC',
      }),
    ).toBe('On behalf of UNBC, we are on unceded traditional territory of Lheidli T’enneh First Nation.')
  })

  it('falls back to a generic organization subject when unnamed', () => {
    expect(
      buildRelationshipAcknowledgement('short', graph, pgMatch(), undefined, {
        ...defaultWordingOptions,
        perspective: 'organization',
      }),
    ).toBe('On behalf of Our organization, we are on unceded traditional territory of Lheidli T’enneh First Nation.')
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
      'BC Ferries acknowledges the traditional territories of First Nations across British Columbia.',
    )
  })

  it('honours a custom region name', () => {
    expect(
      buildRegionalAcknowledgement('event', {
        perspective: 'organization',
        organizationName: 'Northern Health',
        regionName: 'northern British Columbia',
      }),
    ).toBe(
      'Northern Health acknowledges the traditional territories of First Nations across northern British Columbia.',
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

  it('builds deduped specific wording for nearby multi-point footprints', () => {
    const summary = summarizeMultiPoint([
      { ...pg, nationNames: ['Lheidli T’enneh First Nation'] },
      { ...pg, nationNames: ['Lheidli T’enneh First Nation', 'Nazko First Nation'] },
    ])

    expect(buildMultiPointAcknowledgement('short', summary)).toBe(
      'We acknowledge and respect Lheidli T’enneh First Nation and Nazko First Nation.',
    )
  })

  it('does not silently replace far-apart locations with a regional statement', () => {
    const summary = summarizeMultiPoint([
      { ...pg, nationNames: ['Lheidli T’enneh First Nation'] },
      { ...vancouver, nationNames: ['Musqueam'] },
    ])

    expect(buildMultiPointAcknowledgement('short', summary)).toBe(
      'We acknowledge and respect Lheidli T’enneh First Nation and Musqueam.',
    )
  })

  it('can force specific wording for organization-provided Nation lists', () => {
    const summary = summarizeMultiPoint([
      { ...pg, nationNames: ['Geometry Nation A'] },
      { ...vancouver, nationNames: ['Geometry Nation B'] },
    ])

    expect(
      buildMultiPointAcknowledgement('short', summary, {
        nationNames: ['Org Nation A', 'Org Nation B'],
        forceSpecific: true,
      }),
    ).toBe('We acknowledge and respect Org Nation A and Org Nation B.')
  })

  it('retains names unless regional scope is explicitly requested', () => {
    const summary = summarizeMultiPoint([{ ...pg, nationNames: ['A', 'B', 'C', 'D', 'E'] }])

    expect(buildMultiPointAcknowledgement('event', summary, { regionName: 'northern British Columbia' })).toBe(
      'We acknowledge and respect A, B, C, D, and E.',
    )
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

describe('semantic generation regressions', () => {
  const uvic = () => matchKnownPlace('3800 Finnerty Road, Victoria, BC')
  const pg = () => matchKnownPlace('3333 University Way, Prince George, BC')
  const fsj = () => matchKnownPlace('9820 120 Avenue, Fort St. John, BC')
  const modes = ['short', 'event', 'formal', 'institutional'] as const

  it.each(modes)('respects UVic selection without turning continuing relationships into territory (%s)', (mode) => {
    const text = buildRelationshipAcknowledgement(mode, graph, uvic(), ['wsanec-peoples'])
    expect(text).toContain('continuing relationships of W̱SÁNEĆ Peoples')
    expect(text).not.toMatch(/Songhees|Esquimalt|territor/)
    const subset = buildRelationshipAcknowledgement(mode, graph, uvic(), ['songhees'])
    expect(subset).toContain('Songhees')
    expect(subset).not.toMatch(/Esquimalt|W̱SÁNEĆ/)
  })

  it('keeps explicit empty and unknown selections empty', () => {
    expect(buildRelationshipAcknowledgement('event', graph, uvic(), [])).toBe('')
    expect(buildRelationshipAcknowledgement('event', graph, uvic(), ['not-a-nation'])).toBe('')
  })

  it('does not duplicate territorial phrases when sources repeat a relationship', () => {
    const match = pg()
    const text = buildRelationshipAcknowledgement('formal', graph, {
      ...match,
      relationships: [...match.relationships, ...match.relationships],
    })
    expect(text.match(/unceded traditional territory/g)).toHaveLength(1)
    expect(text.match(/is part of/g)).toHaveLength(1)
    expect(text).not.toContain('Peoples territory')
  })

  it.each(modes)('preserves facts per operating location across presentation modes (%s)', (mode) => {
    const text = buildLocatedAcknowledgement(
      mode,
      graph,
      [
        { label: 'Prince George', match: pg(), selectedIds: ['lheidli-tenneh'] },
        { label: 'Fort St. John', match: fsj(), selectedIds: ['doig-river'] },
      ],
      {
        ...defaultWordingOptions,
        purpose: 'operations',
        perspective: 'organization',
        organizationName: 'Example organization',
      },
    )
    const [first, second] = text.split('\n\n')
    expect(first).toContain('At Prince George:')
    expect(first).toContain('operates on unceded traditional territory of Lheidli')
    expect(first).not.toContain('Treaty 8')
    expect(second).toContain('At Fort St. John:')
    expect(second).toContain('Doig River First Nation in Treaty 8 territory')
    expect(second).not.toMatch(/Lheidli|unceded|gather/)
  })

  it('requires one venue and never merges a list of event locations', () => {
    const location = { label: 'Prince George', match: pg(), selectedIds: ['lheidli-tenneh'] }
    expect(buildLocatedAcknowledgement('event', graph, [location, location])).toBe('')
    expect(buildLocatedAcknowledgement('event', graph, [location])).toContain('grateful to gather')
  })

  it('retains on-or-near qualification for remote participants', () => {
    const match = matchKnownPlace('UNBC Prince Rupert satellite campus, Prince Rupert, BC')
    const text = buildLocatedAcknowledgement(
      'event',
      graph,
      [{ label: 'Prince Rupert', match, selectedIds: ['gitgaat'] }],
      { ...defaultWordingOptions, purpose: 'distributed' },
    )
    expect(text).toContain('For participants joining from Prince Rupert:')
    expect(text).toContain('this location is on or near unceded')
    expect(text).not.toMatch(/we are|gather|operates/i)
  })

  it('does not promote boundary, template, or unknown verification evidence', () => {
    for (const verificationStatus of ['boundary_context', 'template_context', 'unknown']) {
      const match = pg()
      expect(
        buildRelationshipAcknowledgement(
          'event',
          graph,
          { ...match, relationships: match.relationships.map((relation) => ({ ...relation, verificationStatus })) },
          ['lheidli-tenneh'],
        ),
      ).toBe('')
    }
    const relationship = graph.placeRelationships.find((relation) => relation.id === 'boundary-nisgaa-treaty')!
    expect(relationshipCorePhrase(graph, relationship)).toBe('')
  })

  it('blocks a mixed draft when any selected Nation lacks a documented relationship', () => {
    expect(
      buildLocatedAcknowledgement(
        'formal',
        graph,
        [
          { label: 'Prince George', match: pg(), selectedIds: ['lheidli-tenneh'] },
          { label: 'Reserve or nearby community lookup', match: null, selectedIds: ['doig-river'] },
        ],
        { ...defaultWordingOptions, purpose: 'operations' },
      ),
    ).toBe('')
    expect(buildRelationshipAcknowledgement('event', graph, pg(), ['lheidli-tenneh', 'doig-river'])).toBe('')
    expect(buildFallbackAcknowledgement('event', ['Doig River First Nation'])).toBe(
      'We acknowledge and respect Doig River First Nation.',
    )
  })

  it.each(modes)('does not infer living, working, or gathering from regional scope (%s)', (mode) => {
    expect(buildRegionalAcknowledgement(mode, { perspective: 'individual' })).not.toMatch(/live|work|gather|I am/)
    expect(buildRegionalAcknowledgement(mode, { perspective: 'organization' })).not.toMatch(/operates|gather|work/)
  })

  it('rejects a street-name collision in another city and a partial civic number', () => {
    const options = { place: true, municipality: false, boundary: false }
    expect(
      matchRelationshipPlace(
        graph,
        { fullAddress: '499 George Street, Victoria, BC', latitude: 48.4634, longitude: -123.3117 },
        '',
        options,
      ),
    ).toBeNull()
    expect(
      matchRelationshipPlace(
        graph,
        { fullAddress: '1499 George Street, Prince George, BC', latitude: 53.8939, longitude: -122.8136 },
        '',
        options,
      ),
    ).toBeNull()
    expect(
      matchRelationshipPlace(
        graph,
        { fullAddress: '499 George Street, Prince George, BC', latitude: 48.4634, longitude: -123.3117 },
        '',
        options,
      ),
    ).toBeNull()
    expect(
      matchRelationshipPlace(
        graph,
        { fullAddress: '3333 University Way, Kelowna, BC', latitude: 49.9395, longitude: -119.396 },
        '',
        options,
      )?.place.id,
    ).toBe('ubc-okanagan-campus')
  })

  it('does not let an unconfirmed input override the returned address', () => {
    expect(
      matchRelationshipPlace(
        graph,
        { fullAddress: '100 Other Street, Prince George, BC', latitude: 53.8939, longitude: -122.8136 },
        '3333 University Way',
        { place: true, municipality: false, boundary: false },
      ),
    ).toBeNull()
  })

  it('retains overlapping boundary contexts instead of taking the first relationship', async () => {
    const boundary = graph.placeRelationships.find((relation) => relation.id === 'boundary-lheidli-dakelh')!
    const overlapGraph = { ...graph, placeRelationships: [boundary, { ...boundary, id: 'overlapping-context' }] }
    const match = await matchBoundaryRelationshipPlace(
      overlapGraph,
      { fullAddress: 'Map point', latitude: 53.9171, longitude: -122.7497 },
      geometrySourceUrl,
      loadGeoJson,
    )
    expect(match?.relationships.map((relation) => relation.id)).toEqual([boundary.id, 'overlapping-context'])
    expect(buildRelationshipAcknowledgement('short', overlapGraph, match!)).toBe('')
  })
})
