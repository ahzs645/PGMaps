/* global URL, structuredClone, console */
/** Reuse one complete story across editorial presentations; no source data copies. */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
const root = new URL('../', import.meta.url)
const base = JSON.parse(await readFile(new URL('public/data/projects/bc-connected-geographies.json', root)))
const scenes = structuredClone(base.scenes)
const paragraphs = [
  'Start with the question you want to answer. Economic reporting, population statistics and health-service planning use different geographic units. The crosswalk lets us connect their identifiers while retaining those distinctions.',
  'Read this as an official membership path. A shared place name does not make an economic region, census division and municipality interchangeable. Select a map action to inspect the same path at a different scale.',
  'The health hierarchy is a second classification of the same province. Use the actions below to reveal one level at a time. These display polygons provide context; the bridge itself follows the source block IDs.',
  'Move the divider, use its arrow keys, or choose either map. The comparison shows entire boundary systems at one camera position. Population shares come from the ID bridge, not from the apparent size of an overlap on screen.',
  'An unresolved relationship is part of the result. Keeping these residents in the denominator makes missing links visible. The current New Westminster outlines shown here are context, not a reconstruction of the older CHSA assignment.',
  'A geography match is only the first step. Before combining indicators, retain each measure’s reference period, units and native reporting area. The source guide explains the reviewed datasets and the remaining joining work.',
]
scenes.forEach((scene, i) => {
  scene.paragraphs = [paragraphs[i]]
})
scenes[0].mapActions = [
  { label: 'Show economic regions', visibleLayerIds: ['economic-regions'] },
  { label: 'Show census divisions', visibleLayerIds: ['census-divisions'] },
  { label: 'Show health authorities', visibleLayerIds: ['health-authorities'] },
]
scenes[1].mapActions = [
  {
    label: 'Visit Prince George',
    visibleLayerIds: scenes[1].visibleLayerIds,
    camera: { center: [-122.75, 53.94], zoom: 9 },
  },
  { label: 'See the full membership path', visibleLayerIds: scenes[1].visibleLayerIds, camera: scenes[1].camera },
]
scenes[2].mapActions = [
  { label: 'Health authorities', visibleLayerIds: ['health-authorities'] },
  { label: 'Service delivery areas', visibleLayerIds: ['health-service-delivery-areas'] },
  { label: 'Local health areas', visibleLayerIds: ['local-health-areas'] },
  { label: 'Community health service areas', visibleLayerIds: ['community-health-service-areas'] },
]
scenes[3].comparison = {
  leftLayerIds: ['economic-regions'],
  rightLayerIds: ['health-authorities'],
  leftLabel: 'Economic regions',
  rightLabel: 'Health authorities',
}
scenes[3].layerOverrides['economic-regions'].fillOpacity = 0.28
scenes[3].placeIds = []
scenes[4].mapActions = [
  { label: 'Current community health areas', visibleLayerIds: ['community-health-service-areas'] },
  { label: 'Local health-area context', visibleLayerIds: ['local-health-areas'] },
]
const folder = new URL('public/data/projects/example/', root)
await mkdir(folder, { recursive: true })
const variants = [
  ['docked', '07 · StoryMaps — docked', 'docked', 'ink', 'left', 'medium'],
  ['floating', '08 · StoryMaps — floating', 'floating', 'paper', 'left', 'medium'],
  ['slideshow', '09 · StoryMaps — guided', 'slideshow', 'ink', 'right', 'large'],
  ['mixed', '10 · StoryMaps — mixed', 'docked', 'ink', 'left', 'medium'],
]
for (const [name, title, variant, theme, side, width] of variants) {
  const pkg = structuredClone(base)
  Object.assign(pkg, {
    slug: `example-sidecar-${name}`,
    title,
    scenes: structuredClone(scenes),
    status: 'Editorial interaction example',
    catalogMetrics: [
      { label: 'Scenes', value: String(scenes.length) },
      { label: 'Presentation', value: name },
    ],
    details: [
      `The same connected-geographies story presented with the ${name} editorial layout. This is a PGMaps implementation inspired by the supplied StoryMaps reference, using our own boundary sources and narrative.`,
      ...base.details,
    ],
    links: [{ label: 'All interaction examples', href: '/dev/projects?collection=example' }, ...base.links],
  })
  pkg.workspace.options = {
    ...pkg.workspace.options,
    layout: 'sidecar',
    sidecarVariant: variant,
    storyTheme: theme,
    storyCover: true,
    chapterNavigation: true,
    narrativeSide: side,
    narrativeWidth: width,
    legendCollapsed: 'always',
    sceneTransitionMs: 650,
  }
  if (name === 'mixed')
    pkg.scenes.forEach((scene, index) => {
      scene.presentation = ['docked', 'docked', 'floating', 'docked', 'floating', 'slideshow'][index]
    })
  await writeFile(new URL(`sidecar-${name}.json`, folder), `${JSON.stringify(pkg, null, 2)}\n`)
}
console.log('Wrote four editorial examples using identical geography content.')
