import fs from 'node:fs'
const folder = 'public/data/story-documents/native-example'
fs.mkdirSync(folder, { recursive: true })
const categories = [
  ['5910', 'Island & Coast', '#0f766e'],
  ['5920', 'Lower Mainland', '#2563eb'],
  ['5930', 'Thompson–Okanagan', '#7c3aed'],
  ['5940', 'Kootenay', '#be123c'],
  ['5950', 'Cariboo', '#d97706'],
  ['5960', 'North Coast', '#0891b2'],
  ['5970', 'Nechako', '#65a30d'],
  ['5980', 'Northeast', '#c026d3'],
].map(([id, label, color]) => ({ id, label, color }))
for (const [index, name] of ['overview', 'detail', 'connections'].entries()) {
  const circles = Array.from(
    { length: 32 },
    (_, i) =>
      `<circle cx="${50 + (i % 8) * 95}" cy="${80 + Math.floor(i / 8) * 110}" r="${15 + ((i + index) % 4) * 7}" fill="${categories[(i + index) % 8].color}" opacity=".85"/>`,
  ).join('')
  fs.writeFileSync(
    `${folder}/${name}.svg`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500"><rect width="800" height="500" fill="#0d2025"/>${circles}<text x="32" y="478" fill="white" font-family="sans-serif" font-size="20">${['Patterns across a province', 'Different views, shared data', 'Connections through categories'][index]}</text></svg>`,
  )
}
const image = (name, caption) => ({
  type: 'image',
  src: `/data/story-documents/native-example/${name}.svg`,
  alt: caption,
  caption,
  credit: 'PGMaps · illustrative graphic',
  expandable: true,
})
const para = (id, ...text) => ({ id, type: 'paragraph', text })
const map = (viewId) => ({ type: 'map', mapId: 'regions', viewId })
const layer = JSON.parse(fs.readFileSync('public/data/projects/example/docked.json')).workspace.layers[0]
delete layer.attributes
layer.category = {
  property: 'ERUID',
  colors: Object.fromEntries(categories.map((c) => [c.id, c.color])),
  fallback: '#64748b',
}
layer.fillOpacity = 0.55
const view = (center, zoom, extra = {}) => ({
  mapId: 'regions',
  camera: { center, zoom },
  visibleLayerIds: [layer.id],
  ...extra,
})
const doc = {
  schema: 'pgmaps-editorial-v1',
  title: 'One story, reusable pieces',
  cover: {
    title: 'One story, reusable pieces',
    summary:
      'A native PGMaps story assembled from JSON. Follow the maps, explore the categories, and reuse the same building blocks.',
    byline: 'PGMaps · component demonstration',
    poster: `/data/story-documents/native-example/overview.svg`,
  },
  categories,
  maps: {
    regions: {
      layers: [layer],
      categoryProperty: 'ERUID',
      attribution: 'Statistics Canada, 2021 economic region boundaries',
    },
  },
  views: {
    province: view([-125, 54], 4.8),
    cariboo: view([-122.7, 53.9], 6.2),
    coast: view([-128.4, 54.0], 6),
    outline: view([-125, 54], 4.8, { layerOverrides: { [layer.id]: { fillOpacity: 0.05, lineWidth: 3 } } }),
  },
  diagrams: {
    taxonomy: {
      type: 'radial-hierarchy',
      title: 'A province and its economic regions',
      description: 'Membership in one classification. Branch lengths do not encode population or similarity.',
      nodes: [
        { id: 'bc', label: 'British Columbia' },
        ...categories.map((c) => ({ id: 'region-' + c.id, parentId: 'bc', label: c.label, categoryId: c.id })),
      ],
    },
    dots: {
      type: 'category-dots',
      title: 'Patterns in a sample',
      description:
        'An illustrative arrangement using the same category colors. Dot positions and counts do not represent measured geography or population.',
      mode: 'illustrative',
      unit: 'One dot is one teaching item',
      points: Array.from({ length: 80 }, (_, i) => ({
        id: 'point-' + i,
        x: ((i % 10) + 0.5) / 10,
        y: (Math.floor(i / 10) + 0.5) / 8,
        categoryId: categories[i % 8].id,
      })),
      steps: [
        { id: 'all', label: 'All teaching items' },
        { id: 'sample', label: 'A circular sample', region: { x: 0.5, y: 0.5, radius: 0.28 } },
        { id: 'cariboo', label: 'One category', categoryIds: ['5950'] },
      ],
    },
  },
  actions: {
    'select-cariboo': { type: 'select-category', categoryId: '5950' },
    clear: { type: 'select-category', categoryId: null },
    'zoom-cariboo': { type: 'set-map-view', targetId: 'region-sidecar', viewId: 'cariboo' },
    'jump-diagrams': { type: 'go-to-chapter', chapterId: 'diagrams-chapter' },
  },
  chapters: [
    {
      id: 'start-chapter',
      title: 'A story built from blocks',
      blocks: [
        para(
          'intro',
          'The presentation comes from reusable blocks. The boundaries are real 2021 economic regions; the illustrations and dot arrangement are teaching examples.',
        ),
        { id: 'opening-quote', type: 'quote', text: ['Content, geography and presentation can change independently.'] },
        {
          id: 'outline-list',
          type: 'list',
          items: [
            ['Scroll through map views.'],
            ['Choose a category in a map or diagram.'],
            ['Reuse the same JSON contract in another project.'],
          ],
        },
        { id: 'opening-image', ...image('connections', 'Connections through categories') },
        { id: 'first-break', type: 'separator' },
      ],
    },
    {
      id: 'map-chapter',
      title: 'One map, several views',
      blocks: [
        {
          id: 'region-sidecar',
          type: 'sidecar',
          presentation: 'docked',
          side: 'left',
          steps: [
            {
              id: 'province-step',
              content: [
                para(
                  'province-copy',
                  'These eight regions cover British Columbia. ',
                  { text: 'Select Cariboo', actionId: 'select-cariboo' },
                  ' or ',
                  { text: 'zoom closer', actionId: 'zoom-cariboo' },
                  '.',
                ),
              ],
              media: map('province'),
            },
            {
              id: 'cariboo-step',
              content: [
                para(
                  'cariboo-copy',
                  'The map keeps its canvas as this chapter changes views. ',
                  { text: 'Clear selection', actionId: 'clear' },
                  '.',
                ),
              ],
              media: map('cariboo'),
            },
            {
              id: 'coast-step',
              content: [
                para(
                  'coast-copy',
                  'The same source supports another view along the coast. ',
                  { text: 'Continue to diagrams', actionId: 'jump-diagrams' },
                  '.',
                ),
              ],
              media: map('coast'),
            },
          ],
        },
        {
          id: 'map-reveal',
          type: 'comparison',
          mapId: 'regions',
          leftViewId: 'province',
          rightViewId: 'outline',
          leftLabel: 'Filled regions',
          rightLabel: 'Boundary outlines',
        },
      ],
    },
    {
      id: 'diagrams-chapter',
      title: 'Categories that connect',
      blocks: [
        para(
          'diagram-intro',
          'Select a category using the hierarchy list. That selection is shared by every map and diagram in this story.',
        ),
        { id: 'hierarchy-block', type: 'diagram', diagramId: 'taxonomy' },
        { id: 'linked-map', ...map('province') },
        {
          id: 'dot-sidecar',
          type: 'sidecar',
          presentation: 'floating',
          side: 'center',
          width: 'large',
          steps: ['all', 'sample', 'cariboo'].map((step, i) => ({
            id: 'dot-step-' + step,
            content: [
              para(
                'dot-copy-' + step,
                [
                  'All points keep stable positions as you scroll.',
                  'This circle selects a sample without moving any dots.',
                  'This step isolates one category. Counts describe this illustration only.',
                ][i],
              ),
            ],
            media: { type: 'diagram', diagramId: 'dots', stepId: step },
          })),
        },
      ],
    },
    {
      id: 'tour-chapter',
      title: 'A guided journey',
      blocks: [
        {
          id: 'regional-tour',
          type: 'tour',
          mapId: 'regions',
          stops: [
            {
              id: 'tour-cariboo',
              label: 'Cariboo',
              coordinates: [-122.7, 53.9],
              viewId: 'cariboo',
              media: image('detail', 'An illustrated close look'),
              content: [
                para('tour-cariboo-copy', 'Select a numbered stop or scroll. This tour uses the same region dataset.'),
              ],
            },
            {
              id: 'tour-coast',
              label: 'North Coast',
              coordinates: [-128.4, 54],
              viewId: 'coast',
              media: image('connections', 'An illustrated network of categories'),
              content: [para('tour-coast-copy', 'A tour can pair any credited image with a map view.')],
            },
          ],
        },
      ],
    },
    {
      id: 'media-chapter',
      title: 'Media and credits',
      blocks: [
        { id: 'gallery-heading', type: 'heading', text: ['A reusable gallery'] },
        {
          id: 'gallery',
          type: 'carousel',
          items: [image('overview', 'Patterns across a province'), image('detail', 'Different views, shared data')],
        },
        {
          id: 'credits',
          type: 'credits',
          text: [
            'Boundary source: Statistics Canada, 2021. Illustrations and illustrative dot data: PGMaps. Category colors identify economic regions and do not measure their performance.',
          ],
        },
      ],
    },
  ],
}
fs.writeFileSync(`${folder}/story.json`, JSON.stringify(doc, null, 2) + '\n')
const p = JSON.parse(fs.readFileSync('public/data/projects/example/prague.json'))
Object.assign(p, {
  slug: 'example-native-editorial',
  title: '12 · Native editorial toolkit',
  owner: 'PGMaps',
  updated: 'Component example authored 2026-09-27',
  region: 'British Columbia',
  status: 'Component demonstration',
  summary: doc.cover.summary,
  sourceNote:
    'Statistics Canada 2021 economic region boundaries; original PGMaps illustrative media and dot data. Dot counts are teaching data, not population estimates.',
  details: [
    'Native JSON composition with shared map, sidecar, tour, carousel, hierarchy and dot-diagram components.',
    'The hierarchy shows BC economic-region membership only, not health-authority crosswalks.',
  ],
  links: [],
  catalogMetrics: [{ label: 'Chapters', value: String(doc.chapters.length) }],
  scenes: doc.chapters.map((c) => ({
    label: c.title,
    title: c.title,
    text: 'Native editorial component demonstration.',
    focus: 'British Columbia',
    visibleLayerIds: [],
  })),
  files: [{ label: 'Native editorial JSON', detail: 'Reusable content and presentation blocks' }],
})
p.workspace.document = { schema: 'pgmaps-editorial-v1', data: `/data/story-documents/native-example/story.json` }
p.workspace.map = { center: [-125, 54], zoom: 5, minZoom: 0, maxZoom: 22, basemap: 'auto' }
fs.writeFileSync('public/data/projects/example/native-editorial.json', JSON.stringify(p, null, 2) + '\n')
