#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'

const root = fileURLToPath(new URL('..', import.meta.url))
const dataDir = path.join(root, 'public/data/bec-representation')
const study = JSON.parse(await readFile(path.join(dataDir, 'representation.json'), 'utf8'))
const geography = JSON.parse(gunzipSync(await readFile(path.join(dataDir, 'bec-units.geojson.gz'))).toString('utf8'))
const checkOnly = process.argv.includes('--check')
const source = study.source
const summary = study.summary
const studyCodes = new Set(study.units.map((unit) => unit.code))
const geometryCodes = new Set(geography.features.map((feature) => feature.properties.code))
const missingStudyCodes = [...studyCodes].filter((code) => !geometryCodes.has(code)).sort()
const currentCodesWithoutStudy = [...geometryCodes].filter((code) => !studyCodes.has(code)).sort()
const matchedStudyCodes = [...studyCodes].filter((code) => geometryCodes.has(code))
const finiteClasses = study.classes.filter((entry) => entry.minInclusive !== null)
const unitByCode = new Map(study.units.map((unit) => [unit.code, unit]))
const classById = new Map(study.classes.map((entry) => [entry.id, entry]))
const layerId = 'bec-representation'
const provinceCamera = { center: [-126.2, 54.6], zoom: 4.15 }
const boundaryNote = '2023 study results · BEC v13.1 context boundaries (2026)'
const boundaryCaveat =
  'The polygons use the Province’s newer BEC v13.1 mapping, generalized for this story. Matching a code locates a study unit; it does not prove its boundary is unchanged since the study’s v12 input. The 2023 percentages have not been recalculated on these polygons.'
const number = (value, digits = 0) =>
  value.toLocaleString('en-CA', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
const percent = (unit) => (unit.protectedPercent === null ? 'unavailable' : `${number(unit.protectedPercent, 2)}%`)

const records = study.units.map((unit) => {
  const quality = []
  if (unit.qualityFlags.includes('zero-denominator')) {
    quality.push(
      'Percentage unavailable: the published denominator is zero and the source ratio is Inf. This is not a high-protection result.',
    )
  }
  if (unit.qualityFlags.includes('missing-intersection')) {
    quality.push(
      'No protected-area intersection recorded in the 2023 outputs; the source study labels this unit "0: No PA". The blank protected area and percentage are kept as published rather than converted to zero, and say nothing about protection today.',
    )
  }
  if (unit.qualityFlags.includes('rounding-over-100')) {
    quality.push(
      'The source ratio is slightly above 100% after its area rounding. The raw value is retained in the downloadable data; this is not additional protected land.',
    )
  }
  const contributions = unit.contributors
    .slice(0, 3)
    .map((entry) => `${entry.parkName} (${number(entry.intersectionAreaKm2, 3)} km²)`)
  const details = [
    unit.protectedPercent === null
      ? '2023 protected share: unavailable.'
      : `2023 protected share of this mapped BGC unit: ${percent(unit)}.`,
    `Source unit area: ${number(unit.totalAreaKm2, 3)} km². Summed protected-area intersections: ${unit.protectedAreaKm2 === null ? 'unavailable' : `${number(unit.protectedAreaKm2, 3)} km²`}.`,
    ...quality,
    ...(contributions.length
      ? [`Largest recorded contributions: ${contributions.join('; ')}. These are source park-name groups.`]
      : []),
    '2023 values on newer BEC v13.1 boundaries. These polygons are location context, not a recalculation or proof that the historical boundary is unchanged. The original summed intersections were not audited for overlapping protected-area groups.',
  ].join('\n\n')
  return {
    code: unit.code,
    zone: unit.zone,
    representationClass: unit.representationClass,
    representationLabel: classById.get(unit.representationClass).label,
    protectedPercent: unit.protectedPercent,
    totalAreaKm2: unit.totalAreaKm2,
    protectedAreaKm2: unit.protectedAreaKm2,
    display: `${unit.code} · ${unit.protectedPercent === null ? 'percentage unavailable' : percent(unit)} (2023)`,
    title: `${unit.code} · 2023 study`,
    details,
  }
})

const classScenes = [
  {
    id: 'below-1',
    label: 'Under 1%',
    title: 'Fourteen units have less than 1% recorded representation',
    text: 'The smallest recorded shares are easy to miss in a province-wide protected-area total. These 14 BEC units each have less than one hundredth of their mapped area inside the protected-area intersections recorded by the study.',
    paragraphs: [
      'A low share identifies a question for conservation planning: which ecological settings are poorly represented in this particular network? It does not measure habitat condition, legal vulnerability, or the feasibility of a new protected area.',
      `One northern-interior example is SBSmw, at ${percent(unitByCode.get('SBSmw'))}. Select a polygon to see its source areas and the largest recorded park contributions.`,
      `The largest unit in this class, CWHvh2 (${percent(unitByCode.get('CWHvh2'))}), lies along the central and north coast, where conservancies cover much of the protected land. The study did not include conservancies, and this mapped unit also extends across open water, so its low share should not be read as a measure of current coastal protection.`,
    ],
  },
  {
    id: '1-to-5',
    label: '1–5%',
    title: 'Seventy finite results are below 5%',
    text: 'Another 56 units fall from 1% to below 5%. Together with the 14 units below 1%, they account for 70 of the 208 finite percentages in the study. Each unit counts once in that comparison, regardless of its size.',
    paragraphs: [
      `SBSmh has ${percent(unitByCode.get('SBSmh'))} recorded representation and SBSmk1 has ${percent(unitByCode.get('SBSmk1'))}. These are results for the full mapped BEC units, not percentages of the City of Prince George or its surrounding regional district.`,
      'The original finite-percentage thresholds are retained: 1%, 5%, 15%, and 30% are the breakpoints. They are descriptive bins, not an assessment that a unit has met a conservation objective.',
    ],
  },
  {
    id: '5-to-15',
    label: '5–15%',
    title: 'The largest group sits between 5% and 15%',
    text: 'Sixty-five units fall from 5% to below 15% representation, making this the most common class among the finite study results. The map shows the geographic spread of those matching unit codes on the newer context boundaries.',
    paragraphs: [
      'Counting units and measuring land area answer different questions. The overview bars count BEC units; they do not describe a share of British Columbia’s land area.',
      'Within a single class, units can differ in size, fragmentation, environmental conditions, and the distribution of protected land. Open individual polygons to compare the recorded numerator and denominator.',
    ],
  },
  {
    id: '15-to-30',
    label: '15–30%',
    title: 'Forty-one units sit between 15% and 30%',
    text: 'These units have a larger recorded share of their mapped area inside the study’s protected-area intersections. Forty-one finite results fall from 15% to below 30%.',
    paragraphs: [
      'Representation describes how much of an ecological unit appears in the selected network. It does not establish whether the protected portions capture that unit’s full ecological variation or are connected to one another.',
      'The boundary lines and percentage values come from different vintages. Read the polygons as location context, and use the archived tables when comparing the original 2023 results.',
    ],
  },
  {
    id: '30-plus',
    label: '30% and above',
    title: 'Thirty-two units have at least 30% recorded representation',
    text: 'Thirty-two of the 208 finite percentages are at least 30%. The top class includes values equal to 30%.',
    paragraphs: [
      'A high share in one unit cannot stand in for representation of another unit. This is why the story keeps the ecological mosaic visible instead of reporting a single province-wide protection figure.',
      'Three source ratios are slightly above 100% after the upstream area rounding. They are flagged in the data and polygon details. CDFmm’s infinite ratio is excluded from this class because its denominator is zero.',
    ],
  },
]

const sceneLabelByClass = new Map(classScenes.map((entry) => [entry.id, entry.label]))
const classColors = Object.fromEntries(study.classes.map((entry) => [entry.id, entry.color]))
classColors['not-in-study'] = '#d4d4d8'
const classLegend = study.classes.map((entry) => ({ label: entry.label, color: entry.color }))
if (currentCodesWithoutStudy.length)
  classLegend.push({ label: 'Current code absent from 2023 study', color: '#d4d4d8' })

const scenes = [
  {
    label: 'Overview',
    kicker: '01 · The question',
    title: 'How evenly are ecosystems represented?',
    text: 'Protected-area totals tell us how much area is included. This study asks a different question: how much of each biogeoclimatic ecosystem unit is represented? Will MacKenzie’s November 2023 analysis provides results for 213 BGC map units across 16 zone groups in the source.',
    paragraphs: [
      'BEC groups landscapes by climate, vegetation, and soils. Reading protection by BEC unit helps reveal ecological differences that a single total can hide.',
      `${summary.finiteRatioCount} units have finite percentages. ${summary.missingIntersectionCount} have no recorded intersection in the published output, and CDFmm has an invalid denominator. These five are shown separately.`,
      `${boundaryCaveat} ${matchedStudyCodes.length} of the ${summary.unitCount} study codes match the displayed geography.`,
    ],
    focus: boundaryNote,
    visibleLayerIds: [layerId],
    camera: provinceCamera,
    callout: {
      label: 'Published study',
      value: `${summary.unitCount} BEC units`,
      detail: `${summary.finiteRatioCount} finite percentages · November 2023 snapshot`,
    },
    interaction: {
      type: 'bars',
      title: 'Where the finite results fall',
      description: `Each bar counts BEC units out of ${summary.finiteRatioCount} with a finite percentage in the 2023 study. It is not a share of land area. Select a class to visit its chapter.`,
      items: finiteClasses.map((entry) => ({
        label: entry.label,
        sceneLabel: sceneLabelByClass.get(entry.id),
        share: entry.count / summary.finiteRatioCount,
        detail: `${entry.count} of ${summary.finiteRatioCount} units`,
      })),
    },
  },
  ...classScenes.map((entry, index) => {
    const definition = classById.get(entry.id)
    const mappedCount = study.units.filter(
      (unit) => unit.representationClass === entry.id && geometryCodes.has(unit.code),
    ).length
    return {
      label: entry.label,
      kicker: `${String(index + 2).padStart(2, '0')} · Representation`,
      title: entry.title,
      text: entry.text,
      paragraphs: entry.paragraphs,
      focus: boundaryNote,
      visibleLayerIds: [layerId],
      camera: provinceCamera,
      highlights: [
        {
          layerId,
          property: 'representationClass',
          values: [entry.id],
          color: '#334155',
          dimOpacity: 0.06,
          label: definition.label,
        },
      ],
      callout: {
        label: definition.label,
        value: `${definition.count} units`,
        detail: `${mappedCount} have an exact code match on the context map. Percentages describe the 2023 study’s mapped units.`,
      },
      legend: [
        { label: definition.label, color: definition.color },
        { label: 'Other units (dimmed)', color: '#e5e7eb' },
      ],
    }
  }),
  {
    label: 'Northern interior',
    kicker: '07 · Close to Prince George',
    title: 'Even within the Sub-Boreal Spruce zone, representation varies',
    text: `The study contains ${study.units.filter((unit) => unit.zone === 'SBS').length} SBS units. SBSmw has ${percent(unitByCode.get('SBSmw'))} recorded representation, SBSmh ${percent(unitByCode.get('SBSmh'))}, and SBSmk1 ${percent(unitByCode.get('SBSmk1'))}. SBSdh2 has ${percent(unitByCode.get('SBSdh2'))}.`,
    paragraphs: [
      'The map highlights the SBS family across the northern interior. These percentages apply to whole mapped BEC units; zooming into Prince George does not turn them into a local municipal or watershed assessment.',
      'All of the SBSmw intersection area in the source table is assigned to the Bobtail Mountain Park name group. The much higher SBSdh2 share comes chiefly from Mount Robson Park and Mount Robson Corridor Protected Area. Click a unit to see its largest recorded contributions.',
      'SBSmc1 has no recorded intersection in the published output and remains unavailable. The contrast is a starting point for examining ecological coverage, not a ranking of individual parks.',
    ],
    focus: boundaryNote,
    visibleLayerIds: [layerId],
    highlights: [
      {
        layerId,
        property: 'zone',
        values: ['SBS'],
        color: '#0f766e',
        dimOpacity: 0.04,
        label: 'Sub-Boreal Spruce units',
      },
    ],
    camera: { center: [-124.1, 54.1], zoom: 5.55 },
    callout: {
      label: 'SBSmh · 2023 study',
      value: percent(unitByCode.get('SBSmh')),
      detail: `${number(unitByCode.get('SBSmh').protectedAreaKm2, 3)} km² recorded protected / ${number(unitByCode.get('SBSmh').totalAreaKm2, 3)} km² mapped unit`,
    },
  },
  {
    label: 'Missing values',
    kicker: '08 · Read the gaps',
    title: 'Unavailable percentages stay visible',
    text: 'CDFmm has a published mapped area of zero but 187.006 km² of recorded protected area. Dividing those values produces an infinite ratio. This story marks its percentage unavailable instead of treating it as a highly represented unit.',
    paragraphs: [
      'CWHms2, ICHmc1a, SBPSmk, and SBSmc1 have blank protected-area and ratio fields, with no corresponding intersection records. The source study classifies these four as "0: No PA" (no protected-area overlap recorded). This story keeps their blank values and leaves them out of the finite-percentage counts; counted as the source does, 74 of 212 units would be below 5%. They say nothing about protection today.',
      `The join to the downloaded v13.1 context snapshot matches ${matchedStudyCodes.length} of ${summary.unitCount} study codes. ${missingStudyCodes.length ? `Study codes without a current polygon match: ${missingStudyCodes.join(', ')}. Their results remain in the downloads.` : 'Every study code has a current polygon match.'}`,
      `${currentCodesWithoutStudy.length} current map codes have no exact result in the 2023 table and appear in grey. No percentage is inferred from a similar code, renamed unit, or neighbouring polygon.`,
    ],
    focus: boundaryNote,
    visibleLayerIds: [layerId],
    camera: provinceCamera,
    highlights: [
      {
        layerId,
        property: 'representationClass',
        values: [
          'no-recorded-intersection',
          'invalid-denominator',
          ...(currentCodesWithoutStudy.length ? ['not-in-study'] : []),
        ],
        color: '#475569',
        dimOpacity: 0.04,
        label: 'Unavailable study percentages or unmatched current codes',
      },
    ],
    callout: {
      label: 'Study data quality',
      value: '5 unavailable percentages',
      detail: 'Four units the source labels "No PA" (no intersection recorded) and one zero denominator; none silently becomes zero.',
    },
    legend: [
      { label: 'No PA overlap recorded in 2023 (source: "No PA")', color: classColors['no-recorded-intersection'] },
      { label: 'Invalid denominator', color: classColors['invalid-denominator'] },
      ...(currentCodesWithoutStudy.length
        ? [{ label: 'Current code absent from study', color: classColors['not-in-study'] }]
        : []),
    ],
  },
  {
    label: 'How to read this',
    kicker: '09 · Method and source',
    title: 'A reproducible study snapshot, with a separate context map',
    text: 'The study intersects BEC polygons with national and provincial protected-area inputs. It rounds each park–BEC intersection to 0.001 km², sums those contributions by BEC unit, and divides by that unit’s mapped area.',
    paragraphs: [
      'Those inputs are the BC Data Catalogue layer BC Parks, Ecological Reserves, and Protected Areas (TA_PARK_ECORES_PA_SVW) and national parks. Conservancies are a separate provincial designation (TANTALIS Conservancy Areas) and were not included, so units where conservancies hold much of the protected land, especially on the central and north coast, show lower percentages than a network including them would.',
      'The map colours show those published percentages. The original CSVs, R Markdown methods, licence, normalized results, and provenance are available through Sources and downloads. The application does not run R or recalculate the historical intersections in your browser.',
      'Mapped BEC units extend across water and other cover types. The study does not apply a terrestrial-land mask to its denominators, so these percentages should not be presented as a land-only estimate of how much of British Columbia is protected.',
      'The source groups provincial park names before the first hyphen and does not union overlaps between different park groups before summing their intersections. Overlapping protection may therefore be counted more than once. Its 882 name groups are not a verified count of distinct legal parks. Protected representation also says nothing by itself about ecological condition or management effectiveness.',
      boundaryCaveat,
    ],
    focus: boundaryNote,
    visibleLayerIds: [layerId],
    camera: provinceCamera,
    callout: {
      label: 'How the percentage is calculated',
      value: '100 × protected / mapped',
      detail: 'Use the archived study areas, not areas measured from the generalized context polygons.',
    },
    interaction: {
      type: 'choices',
      title: 'Return to the map',
      items: [
        { label: 'All study classes', sceneLabel: 'Overview' },
        { label: 'Northern interior', sceneLabel: 'Northern interior' },
        { label: 'Data gaps', sceneLabel: 'Missing values' },
      ],
    },
  },
]

const project = {
  version: 1,
  slug: 'bec-protected-areas',
  title: 'Ecosystems in B.C.’s Protected Areas',
  kind: 'map-story',
  theme: 'emerald',
  owner: 'PGMaps · study by Will MacKenzie',
  updated: 'Study: 28 November 2023',
  region: 'British Columbia',
  status: 'Historical study · context map',
  summary:
    'How evenly are B.C.’s ecosystems represented in protected areas? Explore 213 BEC study units, the gaps in the published results, and a northern-interior example on a clearly labelled context map.',
  sourceNote: `Adapted from Will MacKenzie’s Representation of BEC units in Protected Areas of BC (28 November 2023), pinned at ${source.commit}. The study provides 213 unit results and 2,145 park–unit intersection records. ${boundaryCaveat}`,
  details: [
    '208 percentages are usable. Four units have no recorded intersection in the source outputs, and CDFmm has a zero denominator. Missing and invalid results remain unavailable.',
    `${matchedStudyCodes.length} study codes match the context polygons; ${missingStudyCodes.length} study codes have no current polygon match; ${currentCodesWithoutStudy.length} current map codes have no study result. Matching codes do not establish unchanged boundaries.`,
    'The percentages use mapped BEC area, including non-terrestrial cover where the source polygons extend across it. They are not an estimate of the terrestrial share of B.C. that is protected.',
    'Study data and code: Apache-2.0, with original licence retained. Province of British Columbia map data: Open Government Licence – British Columbia. The story is a PGMaps adaptation, not an official update of the source analysis.',
    'All study values and context polygons load from the same application origin. External basemap availability is separate from the study data.',
  ],
  links: [
    { label: 'Original study and analysis code', href: `${source.repository}/tree/${source.commit}` },
    {
      label: 'Download original BEC representation CSV',
      href: '/data/bec-representation/source/outputs/PAS_representation_by_BGC.csv',
    },
    {
      label: 'Download original park–BEC intersections CSV',
      href: '/data/bec-representation/source/outputs/BGC_area_by_park.csv',
    },
    { label: 'Download original BEC areas CSV', href: '/data/bec-representation/source/outputs/BGC_area.csv' },
    { label: 'Normalized results and park contributions (JSON)', href: '/data/bec-representation/representation.json' },
    { label: 'Study provenance and checksums', href: '/data/bec-representation/manifest.json' },
    { label: 'Context-map provenance and code coverage', href: '/data/bec-representation/geometry-provenance.json' },
    { label: 'Download context polygons (GeoJSON gzip)', href: '/data/bec-representation/bec-units.geojson.gz' },
    { label: 'Official BEC map catalogue', href: 'https://catalogue.data.gov.bc.ca/dataset/bec-map' },
    { label: 'Original study licence', href: '/data/bec-representation/source/LICENSE' },
    { label: 'Map data licence', href: 'https://www2.gov.bc.ca/gov/content/data/open-data/open-government-licence-bc' },
  ],
  catalogMetrics: [
    { label: 'Study units', value: String(summary.unitCount) },
    { label: 'Finite percentages', value: String(summary.finiteRatioCount) },
    { label: 'Below 5%', value: `${summary.belowFivePercentCount} units` },
  ],
  layers: [
    { id: layerId, label: '2023 BEC representation · 2026 context boundaries', type: 'boundary', checked: true },
  ],
  legend: classLegend,
  scenes,
  files: [
    { label: 'Original study tables', detail: 'Three byte-exact CSVs from the pinned 2023 source commit' },
    {
      label: 'Normalized study results',
      detail: 'All 213 units, original values, data-quality flags, and park-name contributions',
    },
    {
      label: 'Context-map polygons',
      detail: `Generalized BEC v13.1 geography; ${matchedStudyCodes.length} exact study-code matches`,
    },
    {
      label: 'Methods and attribution',
      detail: 'Original R Markdown notebooks, source hashes, Apache-2.0 licence, and geometry provenance',
    },
  ],
  workspace: {
    type: 'story-map',
    schema: 'story-map-v1',
    accent: '#0f766e',
    map: { ...provinceCamera, minZoom: 2.5, maxZoom: 9, basemap: 'auto' },
    options: {
      layout: 'sidecar',
      sidecarVariant: 'docked',
      storyTheme: 'paper',
      storyCover: true,
      chapterNavigation: true,
      narrativeWidth: 'medium',
      sceneTransition: 'ease',
      sceneTransitionMs: 800,
      legendCollapsed: 'auto',
    },
    layers: [
      {
        id: layerId,
        data: '/data/bec-representation/bec-units.geojson.gz',
        attributes: {
          data: '/data/bec-representation/map-attributes.json',
          boundaryProperty: 'code',
          attributeProperty: 'code',
          recordsProperty: 'records',
        },
        idProperty: 'code',
        labelProperty: 'display',
        selectionTitleProperty: 'title',
        selectionDetailProperty: 'details',
        fillColor: '#d4d4d8',
        fillOpacity: 0.8,
        lineColor: '#475569',
        lineOpacity: 0.32,
        lineWidth: 0.22,
        category: {
          property: 'representationLabel',
          colors: Object.fromEntries([
            ...study.classes.map((entry) => [entry.label, entry.color]),
            ['Current code absent from 2023 study', '#d4d4d8'],
          ]),
          fallback: '#d4d4d8',
        },
        attribution:
          'Will MacKenzie, 2023 (Apache-2.0); BEC v13.1 context mapping © Province of British Columbia (OGL-BC)',
      },
    ],
    places: [],
  },
}

const outputs = [
  [
    path.join(dataDir, 'map-attributes.json'),
    {
      schemaVersion: 1,
      sourceCommit: source.commit,
      boundaryInterpretation: boundaryCaveat,
      coverage: { matchedStudyCodeCount: matchedStudyCodes.length, missingStudyCodes, currentCodesWithoutStudy },
      records,
    },
  ],
  [path.join(root, 'public/data/projects/bec-protected-areas.json'), project],
]
for (const [target, data] of outputs) {
  const output = `${JSON.stringify(data, null, 2)}\n`
  if (checkOnly) {
    if ((await readFile(target, 'utf8')) !== output)
      throw new Error(`${path.relative(root, target)} is stale; run node scripts/generate-bec-story.mjs`)
  } else {
    await writeFile(target, output)
  }
}
console.log(
  `BEC story ${checkOnly ? 'verified' : 'generated'}: ${scenes.length} chapters, ${records.length} study records, ${matchedStudyCodes.length} mapped study codes.`,
)
