/** App-owned example packages; reuse scraper snapshots without copying them. */
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
const root = new URL('../', import.meta.url)
const base = JSON.parse(await readFile(new URL('public/data/projects/bc-connected-geographies.json', root)))
const clone = (value) => structuredClone(value)
const folder = new URL('public/data/projects/example/', root)
await mkdir(folder, { recursive: true })
const camera = { center: [-123, 53.3], zoom: 5.35 }
const er = 'economic-regions', cd = 'census-divisions', ha = 'health-authorities'
function scene(label, text, layers, highlights = [], view = camera) {
  return { label, title: label, text, focus: label, visibleLayerIds: layers, camera: clone(view), highlights }
}
function highlight(layerId, property, value, label) {
  return { layerId, property, values: [value], label, color: '#e76f00', dimOpacity: 0.025 }
}
const cariboo = highlight(er, 'ERUID', '5950', 'Cariboo economic region')
async function save(name, title, layout, summary, scenes, extraLayers = []) {
  const pkg = clone(base)
  Object.assign(pkg, { slug: `example-${name}`, title, summary, status: 'Interaction example', updated: '2026-09-27', scenes,
    catalogMetrics: [{ label: 'Scenes', value: String(scenes.length) }, { label: 'Layout', value: layout }],
    details: [summary, ...base.details], links: [{ label: 'All interaction examples', href: '/dev/projects?collection=example' }, ...base.links] })
  pkg.workspace.options = { layout, sceneTransition: 'ease', sceneTransitionMs: 500, legendCollapsed: 'auto', cameraFit: 'auto', mobileSheet: 'collapsed', mobilePeekSceneText: true, slidesSwipeHint: 'pane' }
  if (name === 'hierarchy' || name === 'relationships' || name === 'comparison') pkg.workspace.options.slidesSwipeHint = 'off'
  pkg.workspace.layers.push(...extraLayers)
  const used = new Set(scenes.flatMap((s) => s.visibleLayerIds))
  pkg.workspace.layers = pkg.workspace.layers.filter((l) => used.has(l.id))
  pkg.layers = pkg.workspace.layers.map((l) => ({ id: l.id, label: base.layers.find((b) => b.id === l.id)?.label ?? 'Census subdivisions', type: 'boundary', checked: scenes[0].visibleLayerIds.includes(l.id) }))
  await writeFile(new URL(`${name}.json`, folder), `${JSON.stringify(pkg, null, 2)}\n`)
}
const intro = [
  scene('One place, several maps', 'Follow Prince George through economic, census and health boundaries. Each map answers a different question.', [er], [], { center: [-125.6, 54.5], zoom: 4.35 }),
  scene('The economic region', 'Cariboo economic region includes Prince George and Williams Lake. Select a polygon to inspect its existing health-link profile.', [er], [cariboo]),
  scene('The census path', 'Fraser-Fort George is a census division within Cariboo economic region. Names and codes preserve the membership relationship.', [er, cd], [cariboo, highlight(cd, 'boundaryCode', '5953', 'Fraser-Fort George')]),
  scene('A separate health system', 'Northern Health overlaps Cariboo. It is not a parent of that economic region. The block crosswalk connects these systems; health polygon vintage is not established as 2021.', [er, ha], [cariboo, highlight(ha, 'HLTH_AUTHORITY_CODE', '5', 'Northern Health')]),
]
intro.forEach((s) => { s.placeIds = ['prince-george', 'williams-lake'] })
await save('docked', '01 · Docked narrative', 'panel', 'Read beside the map on desktop. On a phone, use Previous/Next in the map-first peek or expand the sheet to read all chapters.', intro)
await save('slides', '02 · Guided slides', 'slides', 'A deliberate four-step tour: use arrows or chapter dots, or swipe the narrative on a phone. The map remains available above the story.', intro)
await save('scrolly', '03 · Scroll-driven story', 'scrolly', 'Scroll to reveal each boundary system. On a phone, Explore map pauses reading and Read story returns to your place.', intro)
const compare = [
  scene('Economic', 'Cariboo describes a regional economy. Switch views to compare boundaries at the same authored extent.', [er], [cariboo]),
  scene('Census', 'Census divisions partition the same territory differently. Fraser-Fort George and Cariboo divisions belong to Cariboo economic region.', [cd], [highlight(cd, 'boundaryCode', '5953', 'Fraser-Fort George'), highlight(cd, 'boundaryCode', '5941', 'Cariboo division')]),
  scene('Health', 'Health authorities organize service geography. Their boundaries cross the economic and census systems. Polygon vintage is not established as 2021.', [ha]),
  scene('Overlap', 'The economic outline and health areas share one map. This comparison shows shapes; the ID-based crosswalk supplies population relationships.', [er, ha], [cariboo]),
]
for (const s of compare) { s.interaction = { type: 'choices', title: 'Compare boundary systems', items: compare.map((c) => ({ label: c.label, sceneLabel: c.label })) }; if (s.visibleLayerIds.includes(er)) s.layerOverrides = { [er]: { fillOpacity: 0.06 } } }
await save('comparison', '04 · Boundary comparison', 'slides', 'Switch Economic, Census, Health and Overlap at a common extent. Named buttons work on desktop and touch screens without a drag gesture.', compare)
const records = JSON.parse(gunzipSync(await readFile(new URL('public/data/boundaries/GeographyBridge/relationships.json.gz', root)))).records
const rows = records.filter((r) => r.censusLevel === 'economicRegionCode' && r.censusCode === '5950' && r.healthLevel === 'healthAuthorityCode').sort((a,b) => b.population - a.population)
const names = { 1: 'Interior', 3: 'Vancouver Coastal', 5: 'Northern' }
const bars = rows.map((r) => scene(`${names[r.healthCode]} Health`, `${r.population.toLocaleString('en-CA')} covered Cariboo residents link to ${names[r.healthCode]} Health. The map highlights the whole authority for context, not a clipped intersection.`, [er, ha], [cariboo, highlight(ha, 'HLTH_AUTHORITY_CODE', r.healthCode, names[r.healthCode])]))
for (const s of bars) { s.layerOverrides = { [er]: { fillOpacity: 0.04 } }; s.interaction = { type: 'bars', title: 'Cariboo → health authorities', description: 'Share of 159,910 covered 2021 Cariboo residents. Select a row to highlight its authority. Cariboo has 0 unresolved residents; other regions can have gaps. These are not job-allocation weights.', items: rows.map((r) => ({ label: names[r.healthCode], sceneLabel: `${names[r.healthCode]} Health`, share: r.populationShareOfCensus, detail: `${r.population.toLocaleString('en-CA')} residents · ${r.dbCount.toLocaleString('en-CA')} blocks` })) } }
await save('relationships', '05 · Map + relationship bars', 'slides', 'Select a population-share row to update the map. Exact counts remain beside the bars, with an explicit denominator and coverage note.', bars)
const csd = { ...clone(base.workspace.layers.find((l) => l.id === cd)), id: 'census-subdivisions', data: '/data/census/bc-da-simplified/parents/csd.geojson' }
const nodes = [
  ['Cariboo', 'Economic / census', er, 'ERUID', '5950', camera, 'Economic region → census division → census subdivision.'],
  ['Fraser-Fort George', 'Economic / census', cd, 'boundaryCode', '5953', { center: [-122.4, 54], zoom: 6 }, 'Fraser-Fort George is the census division containing Prince George.'],
  ['Prince George (city)', 'Economic / census', csd.id, 'boundaryCode', '5953023', { center: [-122.75, 53.94], zoom: 9 }, 'The city is a census subdivision. Its health relationships use a separate classification.'],
  ['Northern Health', 'Health services', ha, 'HLTH_AUTHORITY_CODE', '5', { center: [-126, 56], zoom: 4.5 }, 'Health authority → service delivery area → local health area. Health polygon vintage is not established as 2021.'],
  ['Northern Interior', 'Health services', 'health-service-delivery-areas', 'HLTH_SERVICE_DLVR_AREA_CODE', '52', { center: [-124, 54.5], zoom: 5.5 }, 'Northern Interior is a service delivery area within Northern Health.'],
  ['Prince George (LHA)', 'Health services', 'local-health-areas', 'LOCAL_HLTH_AREA_CODE', '524', { center: [-122.75, 53.94], zoom: 7 }, 'Prince George LHA contains community health service areas. The census city and LHA are distinct geographies.'],
]
const hierarchy = nodes.map(([label, group, layer, prop, code, view, text]) => ({ ...scene(label, text, [layer], [highlight(layer, prop, code, label)], view), interaction: { type: 'hierarchy', title: 'Two separate paths', description: 'Select a node. Arrows show membership within each path; a crosswalk connects the separate systems.', items: nodes.map(([name, branch]) => ({ label: name, sceneLabel: name, group: branch })) } }))
await save('hierarchy', '06 · Linked hierarchy', 'slides', 'Tap the economic/census and health paths to highlight each geography. Two separate columns preserve the distinction between membership and a crosswalk.', hierarchy, [csd])
console.log('Wrote six story examples in public/data/projects/example.')
