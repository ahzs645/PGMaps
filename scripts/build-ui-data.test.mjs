import { test } from 'node:test'
import assert from 'node:assert/strict'
import { restaurantLocations, searchRows } from './build-ui-data.mjs'

test('restaurant read model preserves join keys, coordinates, and place metadata only', () => {
  const restaurant = {
    dataset: 'restaurants',
    source_index: 9,
    latitude: 53.9,
    longitude: -122.7,
    google_place_id: 'abc',
    google_partial_match: false,
    unused: 'large provider response',
  }
  const source = { locations: [{ dataset: 'water', latitude: 0 }, restaurant] }
  assert.deepEqual(restaurantLocations(source), {
    locations: [
      {
        dataset: 'restaurants',
        source_index: 9,
        latitude: 53.9,
        longitude: -122.7,
        google_place_id: 'abc',
        google_partial_match: false,
      },
    ],
  })
  assert.equal(source.locations.length, 2)
  assert.equal(restaurant.unused, 'large provider response')
})

test('search read models omit geometry and histories and use current park attribute names', () => {
  assert.deepEqual(
    searchRows('parks', [
      { attributes: { OBJECTID: 4, ParkName: 'Park A', ParkClassification: 'Nature' }, geometry: { rings: [[1]] } },
    ]),
    [{ id: 'park-4', label: 'Park A', sublabel: 'Nature', params: { tab: 'parks', q: 'Park A' } }],
  )
  const rows = searchRows('properties', {
    features: [
      { properties: { oid_evbc: 'p', address: '1 Main St', desc: 'Home' }, geometry: { coordinates: [1, 2] } },
    ],
  })
  assert.equal(rows[0].label, '1 Main St')
  assert.equal(JSON.stringify(rows).includes('coordinates'), false)
  assert.equal(
    JSON.stringify(searchRows('restaurants', [{ name: 'Cafe', inspections: ['detail'] }])).includes('inspections'),
    false,
  )
})
