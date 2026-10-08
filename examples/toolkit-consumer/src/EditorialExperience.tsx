import { Map, MapFillLayer } from '@pgmaps/geo-toolkit/map'
import {
  EditorialDocumentRenderer,
  type NativeEditorialDocument,
  type EditorialMapRenderProps,
} from '@pgmaps/geo-toolkit/stories'
import { WorkspaceProvider } from '@pgmaps/geo-toolkit/workspace'
import { initialProject } from './sceneProject'
import { habitatCategories, gridGeometry } from './data'
import { MapReadyState } from './MapReadyState'
import { styles } from './mapStyles'

const document: NativeEditorialDocument = {
  schema: 'pgmaps-editorial-v1',
  title: 'A chaptered habitat story',
  categories: habitatCategories,
  maps: {
    habitat: {
      layers: [{ ...initialProject.layers[1], data: '/example/habitat-grid.geojson' }],
      categoryProperty: 'value',
      attribution: 'Fictional source observations',
    },
  },
  views: {
    overview: { mapId: 'habitat', camera: { center: [-2.8, 50.7], zoom: 5.8 }, visibleLayerIds: ['habitats'] },
    detail: { mapId: 'habitat', camera: { center: [-4.2, 51.2], zoom: 7 }, visibleLayerIds: ['habitats'] },
  },
  diagrams: {},
  actions: {
    woodland: { type: 'select-category', categoryId: 'woodland' },
    clear: { type: 'select-category', categoryId: null },
    detail: { type: 'set-map-view', targetId: 'habitat-media', viewId: 'detail' },
    explanation: { type: 'go-to-chapter', chapterId: 'habitat-method' },
  },
  chapters: [
    {
      id: 'habitat-observations',
      title: 'Explore the observations',
      blocks: [
        {
          id: 'habitat-intro',
          type: 'paragraph',
          text: [
            'Categories describe habitat. ',
            { text: 'Highlight woodland', actionId: 'woodland' },
            ' or ',
            { text: 'show all habitats', actionId: 'clear' },
            '.',
          ],
        },
        {
          id: 'habitat-detail-action',
          type: 'paragraph',
          text: [{ text: 'Zoom to the woodland cells', actionId: 'detail' }],
        },
        { id: 'habitat-media', type: 'map', mapId: 'habitat', viewId: 'overview' },
        {
          id: 'habitat-read-on',
          type: 'paragraph',
          text: [{ text: 'Read how the observations were created', actionId: 'explanation' }],
        },
      ],
    },
    {
      id: 'habitat-method',
      title: 'Understand the source',
      blocks: [
        {
          id: 'source-explanation',
          type: 'paragraph',
          text: [
            'This story uses fictional data. The map shows a four-by-four source grid. Displaying larger cells does not create more detailed observations.',
          ],
        },
        {
          id: 'source-missing',
          type: 'paragraph',
          text: [
            'An absent observation and an uncertain classification have different meanings. Their source values remain separate throughout the map and exported project.',
          ],
        },
        {
          id: 'source-color',
          type: 'paragraph',
          text: [
            'Category colors describe classes rather than an ordered score. They are shared with the habitat mosaic above, while the outdoor index uses a separate numeric scale.',
          ],
        },
        {
          id: 'source-credit',
          type: 'credits',
          text: ['Willow Bay is fictional. All observations are generated locally for this example.'],
        },
      ],
    },
  ],
}

function HabitatStoryMap({ view, selectedCategory, onSelect, cameraMemory, memoryKey }: EditorialMapRenderProps) {
  const selectedCode = habitatCategories.findIndex((category) => category.id === selectedCategory)
  return (
    <div
      className="editorial-map-adapter"
      data-testid="editorial-map"
      data-view-zoom={view.camera?.zoom}
      data-category={selectedCategory ?? ''}
    >
      <Map
        theme="light"
        styles={styles}
        viewport={view.camera}
        onViewportChange={(camera) => {
          cameraMemory.set(memoryKey, camera)
        }}
        center={[-2.8, 50.7]}
        zoom={5.8}
        controls={null}
        loader="spinner"
        attributionControl={false}
      >
        <MapFillLayer
          data={gridGeometry}
          visible={view.visibleLayerIds.includes('habitats')}
          fillColor={['get', 'color']}
          fillOpacity={selectedCategory ? ['case', ['==', ['get', 'value'], selectedCode], 0.85, 0.15] : 0.65}
          lineColor="#ffffff"
          onFeatureClick={(_id, _event, properties) =>
            onSelect(habitatCategories[Number(properties.value)]?.id ?? null)
          }
        />
        <MapReadyState />
      </Map>
    </div>
  )
}

export function EditorialExperience() {
  return (
    <section className="example-section" aria-labelledby="editorial-heading">
      <h2 id="editorial-heading">Read a complete chaptered story</h2>
      <p>
        The chapters connect explanatory text with a map. Narrative actions can select categories, change the camera,
        and move between chapters.
      </p>
      <div className="editorial-frame" data-testid="editorial-workspace">
        <WorkspaceProvider theme="light">
          <EditorialDocumentRenderer document={document} renderMap={(props) => <HabitatStoryMap {...props} />} />
        </WorkspaceProvider>
      </div>
    </section>
  )
}
