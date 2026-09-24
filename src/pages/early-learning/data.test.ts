import { describe, expect, it } from 'vitest'
import { boundaryWithNames, describeCrosswalk, formatObservation, joinFor, mapValues, type Boundary, type CrosswalkFamily, type Dataset, type Family, type Join, type Manifest } from './data'
import type { FeatureCollection } from 'geojson'
const dataset = { id: 'dashboard-2026-09-22' } as Dataset
const boundary = { id: 'dashboard-2026-09-22-CHSA-9', family: 'CHSA', reportedWaves: [9], joinPolicy: 'dashboard_only' } as Boundary
const publisher: Join = { kind: 'publisher', inferred: false }
const none: Join = { kind: 'none' }
const manifestWith = (...boundaries: Boundary[]) => ({ boundaries }) as Manifest
const canMap = (d: Dataset, b: Boundary, wave: number) => joinFor(manifestWith(b), d, b, wave).kind === 'publisher'
const geometry: FeatureCollection = { type:'FeatureCollection', features:[{type:'Feature',properties:{regionId:'CHSA_2211'},geometry:{type:'Polygon',coordinates:[]}}] }
const family: Family = { regions:[{ id:'CHSA_2210',name:'New Westminster',observations:[{wave:9,measure:'pct_overall_vulnerable',value:30.6,status:'reported'}] }] }
describe('EDI compatibility', () => {
 it('reuses geometry without leaking labels between editions or changing join eligibility', () => {
  const first = boundaryWithNames(geometry, { CHSA_2211: 'First edition name' })
  const second = boundaryWithNames(geometry, { CHSA_2211: 'Later edition name' })
  expect(first.features[0].properties?.regionName).toBe('First edition name')
  expect(second.features[0].properties?.regionName).toBe('Later edition name')
  expect(geometry.features[0].properties?.regionName).toBeUndefined()
  expect(first.features[0].geometry).toBe(geometry.features[0].geometry)
  expect(boundaryWithNames(geometry)).toBe(geometry)
  expect(mapValues(first,family,9,'pct_overall_vulnerable',publisher).features[0].properties?.value).toBeNull()
 })
 it('allows only the captured dashboard wave on its matching edition', () => {
  expect(canMap(dataset,boundary,9)).toBe(true)
  expect(canMap(dataset,boundary,8)).toBe(false)
  expect(canMap(dataset,{...boundary,reportedWaves:[8]},8)).toBe(true)
  expect(canMap(dataset,{...boundary,id:'dashboard-2025-01-01-CHSA'},9)).toBe(false)
  expect(canMap({id:'workbook-x'} as Dataset,boundary,8)).toBe(false)
  expect(canMap(dataset,{...boundary,joinPolicy:'reference_only'},9)).toBe(false)
 })
 it('never assigns a historical parent result to a newer subdivision', () => {
  expect(mapValues(geometry,family,9,'pct_overall_vulnerable',publisher).features[0].properties?.value).toBeNull()
  const matching = {...geometry,features:geometry.features.map(f=>({...f,properties:{regionId:'CHSA_2210'}}))}
  expect(mapValues(matching,family,9,'pct_overall_vulnerable',none).features[0].properties?.value).toBeNull()
  expect(mapValues(matching,family,9,'pct_overall_vulnerable',publisher).features[0].properties?.value).toBe(30.6)
 })
 it('draws only the wave membership from a shared polygon library', () => {
  const library: FeatureCollection = { type:'FeatureCollection', features:['CHSA_2210','CHSA_1110'].map(regionId => ({type:'Feature',properties:{regionId},geometry:{type:'Polygon',coordinates:[]}})) }
  expect(boundaryWithNames(library, undefined, ['CHSA_1110']).features.map(f => f.properties?.regionId)).toEqual(['CHSA_1110'])
  expect(boundaryWithNames(library, { CHSA_2210: 'New Westminster' }, ['CHSA_2210']).features[0].properties?.regionName).toBe('New Westminster')
 })
 it('maps workbook values by area code only for families whose overlapping values agree', () => {
  const wave8 = { ...boundary, id: 'dashboard-2026-09-22-CHSA-8', reportedWaves: [8], joinPolicy: 'edi_wave' } as Boundary
  const workbook = { id: 'workbook-x', mapJoin: { policy: 'inferred_by_region_id', boundaryRelease: 'dashboard-2026-09-22', families: { CHSA: { eligible: true, overlappingValues: 9470, disagreements: 0 } } } } as unknown as Dataset
  expect(joinFor(manifestWith(wave8), workbook, wave8, 8)).toEqual({ kind: 'publisher', inferred: true })
  expect(joinFor(manifestWith(wave8), workbook, wave8, 7).kind).toBe('none')
  const disagreeing = { ...workbook, mapJoin: { ...workbook.mapJoin!, families: { CHSA: { eligible: false, overlappingValues: 10, disagreements: 1 } } } }
  expect(joinFor(manifestWith(wave8), disagreeing, wave8, 8).kind).toBe('none')
  expect(joinFor(manifestWith(wave8), { ...workbook, mapJoin: { ...workbook.mapJoin!, boundaryRelease: 'dashboard-2025-01-01' } }, wave8, 8).kind).toBe('none')
 })
 it('shows values on current polygons only where the crosswalk finds the same area', () => {
  const wave9 = { ...boundary, joinPolicy: 'edi_wave', sha256: 'publisher', regionIds: ['CHSA_1110', 'CHSA_2210', 'CHSA_2222'] } as Boundary
  const current = { id: 'current-2026-09-22-CHSA', family: 'CHSA', joinPolicy: 'reference_only', sha256: 'current' } as Boundary
  const manifest = { boundaries: [wave9, current], crosswalk: { families: { CHSA: { reference: current.id, referenceSha256: 'current', publisherSha256: 'publisher', counts: {} } } } } as unknown as Manifest
  const join = joinFor(manifest, dataset, current, 9)
  expect(join).toEqual({ kind: 'crosswalk', inferred: false, regionIds: wave9.regionIds })
  expect(joinFor(manifest, dataset, { ...current, sha256: 'other coordinates' }, 9).kind).toBe('none')
  expect(joinFor(manifest, dataset, current, 8).kind).toBe('none')
  const crosswalk: CrosswalkFamily = {
   regions: { CHSA_1110: { status: 'same_area', iou: 0.9997 }, CHSA_2210: { status: 'not_in_reference', overlaps: [{ id: 'CHSA_2211', shareOfThis: 0.397, shareOfOther: 0.98 }] }, CHSA_2222: { status: 'changed', iou: 0, overlaps: [{ id: 'CHSA_2224', shareOfThis: 0.55, shareOfOther: 1 }] } },
   referenceOnly: { CHSA_2211: { overlaps: [{ id: 'CHSA_2210', shareOfThis: 0.976, shareOfOther: 0.397 }] } },
  }
  const observations = (value: number) => [{ wave: 9, measure: 'pct_overall_vulnerable', value, status: 'reported' }]
  const results: Family = { regions: [{ id: 'CHSA_1110', name: 'Fernie', observations: observations(20) }, { id: 'CHSA_2210', name: 'New Westminster', observations: observations(30.6) }, { id: 'CHSA_2222', name: 'Burnaby', observations: observations(25) }] }
  const polygons: FeatureCollection = { type: 'FeatureCollection', features: ['CHSA_1110', 'CHSA_2211', 'CHSA_2222'].map(regionId => ({ type: 'Feature', properties: { regionId }, geometry: { type: 'Polygon', coordinates: [] } })) }
  const byId = Object.fromEntries(mapValues(polygons, results, 9, 'pct_overall_vulnerable', join, crosswalk).features.map(f => [f.properties?.regionId, f.properties]))
  expect(byId.CHSA_1110).toMatchObject({ value: 20, status: 'reported' })
  // New Westminster's value is never copied onto a subdivision, and a reused code does not inherit the old area's value.
  expect(byId.CHSA_2211).toMatchObject({ value: null, status: 'not_in_edi' })
  expect(byId.CHSA_2222).toMatchObject({ value: null, status: 'boundary_changed' })
  const names = { current: (id: string) => ({ CHSA_2224: 'Burnaby Southeast' })[id] ?? id, edi: (id: string) => ({ CHSA_2210: 'New Westminster' })[id] ?? id }
  expect(describeCrosswalk(crosswalk, 'CHSA_2211', names)).toContain('it was part of New Westminster (2210, 98%)')
  expect(describeCrosswalk(crosswalk, 'CHSA_2222', names)).toContain('now covered by Burnaby Southeast (2224, 55%)')
 })
 it('formats zero as data and missing as unavailable', () => {
  expect(formatObservation({wave:9,measure:'x',value:0,status:'reported'})).toBe('0.0%')
  expect(formatObservation({wave:9,measure:'x',value:-0.2,status:'reported'},'standardized_score')).toBe('-0.20')
  expect(formatObservation(undefined)).toBe('No value in this release')
  expect(formatObservation({wave:8,measure:'x',value:null,status:'not_collected_for_wave'})).toBe('Not collected for this wave')
  expect(formatObservation({wave:8,measure:'x',value:null,status:'not_reported_or_suppressed'})).toBe('Not reported / suppressed')
 })
})
