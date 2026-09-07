#!/usr/bin/env node
/** App-owned narrative/configuration only. Climate data and processing stay in BCDataMapper/R2.
 * Run explicitly when authoring/updating this collection; not a network dependency of app builds.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
export const MANIFEST = 'https://data.map.ahmad.sh/climate/bc-climate-u6/releases/01b4b7e982f9b2e6d042/manifest.json'
const release = new URL('.', MANIFEST).href
const horizons = ['1971-2000', '2041-2070', '2071-2100']
const province = { center: [-126.4, 54.8], zoom: 4.05 }
const north = { center: [-126.6, 56.35], zoom: 4.45 }
const localSnow = { center: [-122.76, 53.91], zoom: 9.4 }
const heat = ['#edf8fb', '#b3cde3', '#8c96c6', '#8856a7', '#810f7c']
const water = ['#f1eef6', '#bdc9e1', '#74a9cf', '#2b8cbe', '#045a8d']
const cold = ['#f7fcf0', '#ccebc5', '#7bccc4', '#2b8cbe', '#084081']
// Fixed, explanatory value bins: narrower near zero where global maxima would
// otherwise flatten the historical pattern. These are NOT health-risk thresholds.
const breaks = {
  tg_mean: [-5, 0, 5, 10], ccdcold_18: [20, 100, 300, 600], hddheat_18: [2000, 4000, 6000, 8000],
  txgt_29: [1, 10, 30, 60], tx_max: [20, 30, 35, 40], tn_min: [-40, -30, -20, -10],
  tr_18: [1, 5, 15, 30], frost_days: [50, 100, 200, 300], ice_days: [20, 60, 120, 200],
  frost_free_season: [60, 120, 180, 240], prcptot: [500, 1000, 2000, 4000],
  rx1day: [25, 50, 100, 200], rx5day: [50, 100, 250, 500], txgt_32: [1, 5, 15, 30],
  tn_mean: [-10, -5, 0, 5], tx_mean: [0, 5, 10, 15], prcptot_seasonal: [100, 300, 600, 1200], PAS: [100, 300, 700, 1500],
}

// Interpretation is explanatory copy, not a derived impact or engineering standard.
const categories = [
  ['tg_mean', 'mean-temperature', 'Mean annual temperature', 'A changing thermal baseline', 'The 30-year mean of daily mean temperature describes the background climate. It is not the hottest day or a design temperature.', 'Compare the same colour bins through time. A mean can change without describing the timing or severity of any individual heat event.', heat],
  ['ccdcold_18', 'cooling-degree-days', 'Cooling degree days above 18°C', 'Heat accumulated above a reference', 'Cooling degree days accumulate temperature excess above an 18°C reference. Their unit is °C·days, not a count of days.', 'This is a climate indicator relevant to cooling discussions, not a calculation of building electricity demand; envelope, equipment and occupancy are not modelled.', heat],
  ['hddheat_18', 'heating-degree-days', 'Heating degree days below 18°C', 'A changing cold-season load', 'Heating degree days accumulate temperature shortfall below an 18°C reference. Their unit is °C·days.', 'A smaller value means less accumulated cold relative to that reference. It does not eliminate cold extremes or determine heating-system capacity.', cold],
  ['txgt_29', 'days-above-29c', 'Days above 29°C', 'More than a warmer average', 'This indicator counts days with a daily maximum strictly above 29°C, averaged over 30 years. The source is txgt_29; the older map label “>30°C” was not the source threshold.', 'A fractional value is expected for a 30-year climatology. This is not an annual forecast, heat-warning threshold, or count of people exposed.', heat],
  ['tx_max', 'hottest-day', 'Hottest day of the year', 'The warm end of the year', 'The map shows the 30-year mean of each year’s highest daily maximum temperature, in °C.', 'It is an annual-extreme climatology, not the single hottest possible future day and not a return-period engineering design value.', heat],
  ['tn_min', 'coldest-night', 'Coldest night of the year', 'Cold extremes in a warmer climate', 'The map shows the 30-year mean of each year’s lowest daily minimum temperature, in °C.', 'Do not confuse tn_min with tn_mean, the annual mean daily minimum. Some source report site tables use an ambiguous “minimum annual temperature” label.', cold],
  ['tr_18', 'nights-above-18c', 'Nights above 18°C', 'When nights remain warm', 'This indicator counts days whose daily minimum exceeds 18°C, averaged over 30 years. It is also called tropical nights in the supplied report.', 'Night-time temperature is a different part of the climate picture from daytime heat. The map does not estimate indoor temperatures or health outcomes.', heat],
  ['frost_days', 'frost-days', 'Annual frost days', 'Fewer freezing nights?', 'Frost days count days when daily minimum temperature is below 0°C. Values are 30-year annual averages.', 'A decrease in frost days does not measure freeze–thaw cycles. That would require information about temperature sequences and a separate calculation.', cold],
  ['ice_days', 'ice-days', 'Annual ice days', 'Days that stay below freezing', 'Ice days count days when daily maximum temperature is below 0°C. This is different from frost days, which use the daily minimum.', 'These are air-temperature conditions, not a map of road ice, lake ice, or the duration of snow cover.', cold],
  ['frost_free_season', 'frost-free-season', 'Frost-free season length', 'A longer interval between frosts', 'The frost-free season estimates the interval between the last spring frost and first autumn frost, in days.', 'It is a temperature-based season indicator, not a forecast of crop yield, pollen exposure, pest abundance, or suitable growing conditions at a specific site.', heat],
  ['prcptot', 'annual-precipitation', 'Annual total precipitation', 'Reading the annual water total', 'Total annual precipitation combines rain and the water equivalent of snow. Values are 30-year means of annual totals, displayed in mm.', 'Annual totals hide seasonal timing. More annual precipitation does not by itself quantify flood probability, summer drought, or available water supply.', water],
  ['rx1day', 'wettest-day', 'Annual maximum 1-day precipitation', 'The wettest 24 hours', 'The map shows the 30-year mean of the largest one-day precipitation total in each year, in mm.', 'This measures an amount, not the number of heavy-rain days. It is not a flood model or an intensity–duration–frequency design estimate.', water],
  ['rx5day', 'wettest-five-days', 'Annual maximum 5-day precipitation', 'When precipitation persists', 'The map shows the 30-year mean of the largest five-consecutive-day precipitation total in each year, in mm.', 'This is an accumulated amount, not a count of events. Runoff and flooding also depend on terrain, drainage, soils, snowmelt and other local conditions.', water],
  ['txgt_32', 'days-above-32c', 'Days above 32°C', 'A second daytime heat threshold', 'This supplementary indicator counts days with daily maximum temperature above 32°C, averaged over 30 years.', 'It complements the report’s >29°C category but is not the same threshold. Do not combine or interchange the two counts.', heat],
  ['tn_mean', 'mean-daily-minimum', 'Mean daily minimum temperature', 'The typical daily low', 'This supplementary indicator averages daily minimum temperatures over the year and then over the 30-year period.', 'This is tn_mean, not the coldest night (tn_min). Keeping them separate avoids the ambiguous minimum-temperature labels in some report tables.', cold],
  ['tx_mean', 'mean-daily-maximum', 'Mean daily maximum temperature', 'The typical daily high', 'This supplementary indicator averages daily maximum temperatures over the year and then over the 30-year period.', 'This is tx_mean, not the hottest day (tx_max). An average daily high cannot describe the full range of hot extremes.', heat],
  ['prcptot_seasonal', 'seasonal-precipitation', 'Seasonal total precipitation', 'Four seasons, different water stories', 'Seasonal precipitation combines rain and the water equivalent of snow. Winter is December–February; spring March–May; summer June–August; autumn September–November.', 'Compare a season through time before comparing seasons. These are precipitation totals, not runoff, soil moisture, or a drought index.', water],
  ['PAS', 'precipitation-as-snow', 'Annual precipitation as snow', 'A different form of stored water', 'PAS is annual precipitation falling as snow, expressed as water-equivalent mm. These archived ClimateBC rasters are a different, finer grid than the other indicators.', 'The future archive uses a 13-GCM ensemble and has no percentile dimension. PAS is not snow depth, peak snowpack, or a direct forecast of spring flow.', cold],
]

async function json(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${response.status}: ${url}`)
  return response.json()
}
const manifest = await json(MANIFEST)
if (manifest.format !== 'bcdatamapper-native-grid-v1' || manifest.scenario !== 'ssp585' || manifest.products.length !== categories.length) throw new Error('Review changed climate catalogue before generating stories')
const products = new Map(await Promise.all(manifest.products.map(async product => [product.id, await json(new URL(product.path, MANIFEST))])))
const specs = new Map(categories.map(row => [row[0], row]))
const slugFor = id => `bc-climate-${specs.get(id)[1]}`

function style(id) {
  const product = products.get(id)
  if (!product) throw new Error(`Missing product ${id}`)
  // One scale across ALL absolute periods, percentiles and seasons of this product.
  const bands = product.bands.filter(b => b.measure === 'absolute')
  const min = Math.min(...bands.map(b => b.min)), max = Math.max(...bands.map(b => b.max))
  const step = 10 ** Math.floor(Math.log10((max - min) / 5))
  return { domain: [Math.floor(min / step) * step, Math.ceil(max / step) * step], breaks: breaks[id], colors: specs.get(id)[6], units: product.units }
}
function climateLayer(id, horizon, percentile = 'p50', season = 'annual') {
  if (id === 'PAS') percentile = null
  const selection = { horizon, percentile, season, measure: 'absolute', baseline: null }
  const matches = products.get(id).bands.filter(b => Object.entries(selection).every(([key, value]) => b[key] === value))
  if (matches.length !== 1) throw new Error(`Ambiguous or missing band ${id} ${JSON.stringify(selection)}`)
  const layerId = `${id}-${horizon}-${percentile ?? 'ensemble'}-${season}`
  return { id: layerId, data: MANIFEST, format: 'climate-grid', climate: { product: id, ...selection, ...style(id), ...(id === 'PAS' ? { minZoom: 7 } : {}) },
    idProperty: 'cellId', labelProperty: 'value', fillColor: specs.get(id)[6][3], fillOpacity: 0.78, lineColor: '#ffffff', lineOpacity: 0, lineWidth: 0,
    attribution: id === 'PAS' ? 'Archived ClimateBC · BCDataMapper/R2' : 'ClimateData.ca / PCIC · PAVICS · BCDataMapper/R2' }
}
function labelFor(layer) {
  const c = layer.climate
  return `${specs.get(c.product)[2]} · ${c.season === 'annual' ? '' : `${c.season} · `}${c.horizon} · ${c.percentile?.toUpperCase() ?? 'archive'}`
}
const boundary = { id: 'health-authorities', data: '/data/boundaries/BCMoH/simplified/health_authorities.json',
  idProperty: 'HLTH_AUTHORITY_CODE', labelProperty: 'HLTH_AUTHORITY_NAME', fillColor: '#0f766e', fillOpacity: 0,
  lineColor: '#0f766e', lineOpacity: 0.85, lineWidth: 1.5, attribution: 'B.C. Ministry of Health' }
const sourceNote = 'PGMaps-authored interpretation, not an official Northern Health publication. Climate cells stream from a pinned BCDataMapper R2 release: CanDCS-U6 / ClimateData.ca via PAVICS, plus archived ClimateBC PAS. SSP5-8.5 is one high-emissions scenario, not an assigned probability. Native BC-intersecting cells retain their whole footprints; missing values are transparent, not zero. Grid values are not the report’s population-weighted health-region summaries. Display colours use fixed bins and do not classify health risk.'
const commonDetails = [
  'Periods are 30-year climatologies, not forecasts for individual years. P10/P50/P90 describe the supplied ensemble distribution, not a complete uncertainty range or three emissions scenarios.',
  'The report compares 1971–2000, 2041–2070 and 2071–2100. The pinned release retains additional periods and source-delta bands; the guided stories show absolute values. The full data preview remains available in the source links.',
  'Temperature conversion and precipitation metadata caveats are documented in the release. Accumulated precipitation is displayed in mm without multiplying source values by days. Snow provenance is archived ClimateBC; the report identifies v7.41 but the archive version was not independently established.',
]
function envelope(slug, title, summary, scenes, layers, extra = {}) {
  return { version: 1, slug, title, kind: 'map-story', theme: 'blue', owner: 'PGMaps', updated: '2026-09-06', region: 'British Columbia', status: 'Exploratory climate story', summary, sourceNote,
    details: commonDetails, links: [
      { label: 'Full R2 data preview: all indicators, bands and periods', href: `${release}preview.html` },
      { label: 'Pinned climate manifest and provenance', href: MANIFEST },
      { label: 'Climate source inventory', href: `${release}sources.json` },
      { label: 'Northern Health resilience narrative', href: '/dev/projects/northern-health-climate-resilience' },
    ], catalogMetrics: [{ label: 'Story scenes', value: String(scenes.length) }, { label: 'Scenario', value: 'SSP5-8.5' }],
    layers: layers.map(layer => ({ id: layer.id, label: layer.climate ? labelFor(layer) : layer.id === 'hospitals' ? 'Report hospital locations' : 'Health Authority boundaries', type: layer.geometry === 'point' ? 'point' : 'boundary', checked: scenes[0].visibleLayerIds.includes(layer.id) })),
    legend: [], scenes, files: [{ label: `${slug}.json`, detail: 'Narrative, band selections, colours and cameras only; no climate arrays embedded.' }, { label: 'R2 native-grid release', detail: 'Gzipped geometry indices and lossless Float64 values, fetched only for the active map view.' }],
    workspace: { type: 'story-map', schema: 'story-map-v1', accent: '#0369a1', options: { layout: 'slides', sceneTransition: 'ease', sceneTransitionMs: 650, legendCollapsed: 'auto', slidesSwipeHint: 'off' }, map: { ...scenes[0].camera, minZoom: 2.5, maxZoom: 12, basemap: 'light' }, places: [], layers }, ...extra }
}
async function save(project) {
  await writeFile(new URL(`public/data/projects/${project.slug}.json`, root), `${JSON.stringify(project, null, 2)}\n`)
  console.log(`${project.slug}: ${project.scenes.length} scenes`)
}

for (const [id, , title, opening, definition, interpretation] of categories) {
  const seasonal = id === 'prcptot_seasonal', snow = id === 'PAS'
  const selections = snow ? ['1971-2000', '2011-2040', '2041-2070', '2071-2100'].map(h => [h, null, 'annual']) :
    (seasonal ? ['winter', 'spring', 'summer', 'autumn'] : ['annual']).flatMap(season => [
      ...horizons.map(h => [h, 'p50', season]), ['2071-2100', 'p10', season], ['2071-2100', 'p90', season],
    ])
  const layers = selections.map(([h, p, s]) => climateLayer(id, h, p, s))
  const scenes = layers.map((layer, index) => {
    const c = layer.climate, first = c.horizon === '1971-2000'
    const period = first ? 'Historical baseline' : c.horizon === '2041-2070' ? 'Mid-century' : c.horizon === '2011-2040' ? 'Near-term archive' : 'Late-century'
    const range = c.percentile === 'p10' || c.percentile === 'p90'
    return { label: `${c.season === 'annual' ? '' : `${c.season} · `}${range ? c.percentile.toUpperCase() : period}`,
      kicker: `${String(index + 1).padStart(2, '0')} · ${title}`,
      title: index === 0 ? opening : `${c.season === 'annual' ? '' : `${c.season[0].toUpperCase()}${c.season.slice(1)} · `}${period}${range ? `, ${c.percentile.toUpperCase()}` : ''}`,
      text: `${first ? definition : range ? `This is the ${c.percentile === 'p10' ? '10th' : '90th'} percentile for 2071–2100 under the same scenario. Compare it with P50 and the other percentile using the unchanged colour scale; it is not a best/worst-case guarantee.` : interpretation} ${snow ? 'The view starts around Prince George to keep the fine native grid readable. Pan anywhere in BC; zoom below level 7 pauses cell loading rather than replacing it with invented coarse values.' : 'Pan and zoom across BC; click a coloured cell to inspect its stored value. The colour scale stays fixed between scenes.'}`,
      focus: `${c.horizon} · ${c.percentile?.toUpperCase() ?? 'Archive (no percentile)'} · ${c.units}`,
      visibleLayerIds: [layer.id], camera: snow ? localSnow : province,
      callout: { label: first ? 'Reference period' : range ? 'Ensemble percentile' : 'Projection period', value: `${c.horizon} · ${c.percentile?.toUpperCase() ?? 'No percentile dimension'}`, detail: snow ? 'ClimateBC PAS · water-equivalent mm · BC-wide archive' : `SSP5-8.5 · ${c.season} · ${c.units} · native cells, not regional means` } }
  })
  await save(envelope(slugFor(id), `B.C. Climate · ${title}`, `${definition} A guided comparison of the historical baseline, future periods${snow ? '' : ' and ensemble percentiles'}, with values streamed from R2.`, scenes, layers))
}

// Adapt the supplied report's message, not its erroneous copied site deltas/units.
const hospitals = JSON.parse(await readFile(new URL('public/data/health/echoscreen-northern-health-hospitals.geojson', root), 'utf8')).features
if (hospitals.length !== 18) throw new Error('Review hospital story against changed source inventory')
const hospitalLayer = { id: 'hospitals', data: '/data/health/echoscreen-northern-health-hospitals.geojson', geometry: 'point',
  idProperty: 'id', labelProperty: 'name', selectionDetailProperty: 'verificationStatus', fillColor: '#dc2626', fillOpacity: 1, circleRadius: 6,
  lineColor: '#ffffff', lineOpacity: 1, lineWidth: 2, attribution: 'Existing PGMaps HealthLinkBC hospital snapshot; names/coordinates are not a current facility inventory' }
const nhLayers = new Map()
const nhScenes = []
const nhHighlight = { layerId: boundary.id, property: boundary.labelProperty, values: ['Northern'], dimOpacity: 0, color: '#0f766e' }
function chapter(label, title, text, id, horizon = '2071-2100', season = 'annual', callout) {
  const layer = id ? climateLayer(id, horizon, 'p50', season) : null
  if (layer) nhLayers.set(layer.id, layer)
  nhScenes.push({ label, title, text, kicker: `${String(nhScenes.length + 1).padStart(2, '0')} · Northern Health`,
    focus: layer ? labelFor(layer) : 'Northern Health · report hospital communities',
    camera: id === 'PAS' ? localSnow : north, visibleLayerIds: [...(layer ? [layer.id] : []), boundary.id, 'hospitals'],
    highlights: [nhHighlight], ...(callout ? { callout } : {}) })
}
const reported = (value, detail) => ({ label: 'Supplied report · population-weighted HA summary', value, detail: `${detail} These figures are quoted from the report, not recalculated from the map cells.` })
chapter('Why this story', 'Plan for the climate a facility will operate in', 'The supplied Northern Health briefing argues that historical baselines alone are insufficient for long-lived facilities. Its central message is continuity of care: bring forward-looking climate information into planning, then assess local vulnerability and operational needs. This PGMaps adaptation is not an official Northern Health publication. The boundary is the existing BCMoH vector; red points locate the 18 report communities’ hospitals.')
chapter('Baseline', 'Start with a reference, not a prediction', 'The report uses 1971–2000 as its historical baseline. These cells show the corresponding mean annual temperature climatology. Its regional tables use Census 2021 population weights, while its site analysis samples locations. Neither is the same as the raw grid map shown here.', 'tg_mean', '1971-2000', 'annual', reported('3.9°C', 'Baseline mean annual temperature.'))
chapter('Mid-century', 'A warmer background for care delivery', 'Move to 2041–2070 under SSP5-8.5. The report links warmer conditions to the need to review facility resilience over its operating life. This scenario is one planning lens, not a probability assigned to the future. Colours use the same temperature scale as the baseline.', 'tg_mean', '2041-2070', 'annual', reported('6.9°C', '2041–2070 mean annual temperature; baseline 3.9°C.'))
chapter('Late-century', 'Look beyond the next capital cycle', 'The 2071–2100 view extends the same scenario farther into the future. The report’s long-term perspective matters for assets intended to provide care for decades. P50 is an ensemble median, not certainty; each indicator story also shows P10 and P90.', 'tg_mean', '2071-2100', 'annual', reported('8.9°C', '2071–2100 mean annual temperature; baseline 3.9°C.'))
chapter('Daytime heat', 'Heat is more than the annual average', 'Days above 29°C provide a different lens from mean temperature. The threshold is 29°C, not the older UI label of 30°C. The report connects hotter conditions to cooling and service-continuity concerns; this map does not model indoor overheating or health impacts.', 'txgt_29', '2071-2100', 'annual', reported('4 → 18 → 35 days', '1971–2000 → 2041–2070 → 2071–2100.'))
chapter('Cooling', 'Read the change in accumulated heat', 'Cooling degree days describe accumulated temperature excess above 18°C, in °C·days. The report uses this as a climate input to facility planning. Actual energy use and indoor conditions also require building, equipment, occupancy and operational information.', 'ccdcold_18', '2071-2100', 'annual', reported('23 → 137 → 319 °C·days', 'Historical → mid-century → late-century.'))
chapter('Warm nights', 'Keep the daily low in view', 'Nights above 18°C add information that daytime maxima cannot provide. In the report they sit alongside daytime heat and degree days, not in place of them. An outdoor grid-cell climatology cannot determine how a particular patient room will perform.', 'tr_18')
chapter('Annual water', 'More annual precipitation is not the whole water story', 'The report anticipates higher annual precipitation and asks planners to consider water-related resilience. Total precipitation includes rain and snow water equivalent. It does not directly tell us flood depth, stormwater capacity, or reliable summer water supply.', 'prcptot', '2071-2100', 'annual', reported('753 → 836 → 880 mm', 'Annual totals: historical → mid-century → late-century.'))
chapter('Heavy precipitation', 'Examine the wettest day separately', 'The largest one-day amount is a distinct indicator from the annual total. The source report sometimes describes this as more days of heavy precipitation; the actual rx1day variable is an amount in mm, not an event count. Local flood or drainage assessment needs additional evidence.', 'rx1day')
chapter('Winter', 'Separate the seasons', 'Winter precipitation is the December–February total, combining rain and snow water equivalent. The report’s winter and summer patterns differ, so an annual total should not stand in for both. The next scene keeps the scale fixed and switches to summer.', 'prcptot_seasonal', '2071-2100', 'winter', reported('216 → 237 → 247 mm', 'Winter totals: historical → mid-century → late-century.'))
chapter('Summer', 'Little change in a regional mean can hide local differences', 'The report’s population-weighted summer total changes little, even while it describes coastal and interior differences. Read each native cell on its own terms. Precipitation alone does not measure drought; temperature, evapotranspiration, storage and water demand also matter.', 'prcptot_seasonal', '2071-2100', 'summer', reported('187 → 187 → 189 mm', 'Summer totals: historical → mid-century → late-century.'))
chapter('Snow', 'A separate archive for precipitation as snow', 'This scene zooms to Prince George to show the finer ClimateBC PAS grid. The archive remains BC-wide: pan elsewhere to inspect it. PAS is water-equivalent precipitation falling as snow, not snow depth. Unlike U6, these archived future ensemble rasters do not provide P10/P50/P90 bands.', 'PAS', '2071-2100', 'annual', reported('204 → 162 → 113 mm', 'Annual PAS: historical → mid-century → late-century.'))
chapter('Changing seasons', 'A longer frost-free interval', 'The report uses frost-free season length to illustrate broader seasonal change. The indicator describes the interval between spring and autumn frosts; it does not itself predict pollen, food production, pests or disease. Those pathways require further assessment.', 'frost_free_season', '2071-2100', 'annual', reported('126 → 177 → 205 days', 'Frost-free season: historical → mid-century → late-century.'))
const heatLayer = climateLayer('txgt_29', '2071-2100')
for (const feature of [...hospitals].sort((a, b) => a.properties.locality.localeCompare(b.properties.locality))) {
  const p = feature.properties
  nhScenes.push({ label: p.locality, title: `${p.locality}: bring the regional story to a community`,
    kicker: `${String(nhScenes.length + 1).padStart(2, '0')} · Hospital communities`,
    text: `${p.name} is the facility name in the existing source snapshot. This chapter holds the same late-century >29°C indicator across all 18 communities so the mapped values remain comparable. Click a climate cell to inspect it; the point is a location reference, not a claim of building-scale accuracy. ${p.verificationStatus === 'geocoded_needs_review' ? 'This hospital point is marked geocoded_needs_review in the source and needs location review before site-specific use.' : 'Names and coordinates are retained from the existing snapshot, not reverified as a current facility inventory.'}`,
    focus: `${p.locality} · 2071–2100 · P50 · days >29°C`, visibleLayerIds: [heatLayer.id, boundary.id, 'hospitals'],
    camera: { center: feature.geometry.coordinates, zoom: 8 }, highlights: [nhHighlight, { layerId: 'hospitals', property: 'id', values: [p.id], dimOpacity: 0, color: '#dc2626', label: p.name }],
    callout: { label: 'Community screening, not site design', value: p.locality, detail: 'The report’s copied site-change columns are not reproduced: several contain inconsistent units or arithmetic. The map exposes the source cell instead.' } })
}
chapter('Putting it together', 'Use the climate evidence, then assess the facility', 'The report’s message is to preserve essential care as conditions change. Climate indicators inform that conversation; they do not replace a facility vulnerability assessment or engineering design. Explore the individual indicator stories for baseline, future and ensemble comparisons. This adaptation keeps report-reported regional statistics separate from native grid values, preserves the whole BC dataset, and does not reproduce inconsistent site-table deltas.')
const nh = envelope('northern-health-climate-resilience', 'Northern Health · Climate-resilient care', 'An independent map-story adaptation of the supplied Northern Health briefing: changing heat, precipitation and seasons, followed by all 18 hospital communities.', nhScenes, [...nhLayers.values(), boundary, hospitalLayer])
nh.details = [...commonDetails, 'Narrative source: the user-supplied Northern Health climate-resilient health facilities briefing (sections Context, Methodology, Regional Projections and Site Specific Projections; publication date not supplied). Regional callouts are explicitly report-reported population-weighted figures, not newly validated calculations.', 'Source corrections: txgt_29 is >29°C; rx1day/rx5day are amounts, not event counts; tn_min and tn_mean are distinct. Inconsistent copied changes, percentages and units in site tables are intentionally not reproduced. Hospital names and verification flags come from the existing snapshot.']
nh.links = [...nh.links.filter(link => !link.href.endsWith(nh.slug)), ...categories.map(([id, , title]) => ({ label: title, href: `/dev/projects/${slugFor(id)}` }))]
nh.catalogMetrics.push({ label: 'Hospital communities', value: String(hospitals.length) })
nh.layers.find(layer => layer.id === boundary.id).label = 'Northern Health boundary'
await save(nh)
console.log(`Wrote configuration only to ${fileURLToPath(new URL('public/data/projects/', root))}`)
