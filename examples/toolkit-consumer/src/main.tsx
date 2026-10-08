import { StrictMode, useCallback, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Map, MapFillLayer, MapPieClusterLayer } from '@pgmaps/geo-toolkit/map'
import { WorkspaceProvider, MapSectionLayout, MAP_SIDEBAR_CLASS } from '@pgmaps/geo-toolkit/workspace'
import { MapSidebarShell, MapLegendSection, MapLegendItem } from '@pgmaps/geo-toolkit/ui/map-panels'
import { MobileFeatureCard, ResponsiveFeatureDetail } from '@pgmaps/geo-toolkit/ui/mobile-feature-card'
import { renderDonutSvg } from '@pgmaps/geo-toolkit/visualizations'
import { StoryCarousel } from '@pgmaps/geo-toolkit/stories/components/StoryCarousel'
import { CategoryDotDiagram } from '@pgmaps/geo-toolkit/stories/diagrams/CategoryDotDiagram'
import type { Diagram } from '@pgmaps/geo-toolkit/stories/model/types'
import { styles } from './mapStyles'
import { ProjectExperience } from './ProjectWorkshop'
import { EditorialExperience } from './EditorialExperience'
import { MapReadyState } from './MapReadyState'
import { useIndexLabController, IndexLabControls, IndexLabResults } from '@pgmaps/geo-toolkit/index-lab/react'
import { computeIndexLabResults } from '@pgmaps/geo-toolkit/index-lab/state'
import type { IndexLabMetric, IndexLabSettings, IndexLabState } from '@pgmaps/geo-toolkit/index-lab/types'
import {
  districts,
  districtGeometry,
  habitatCategories,
  habitatCounts,
  habitatGrid,
  habitatPoints,
  gridGeometry,
  scoreLegend,
} from './data'
import '@pgmaps/geo-toolkit/styles.css'
import '@pgmaps/geo-toolkit/stories/styles.css'
import './styles.css'

function ScoreLegend() {
  return (
    <MapLegendSection title={scoreLegend.title} description="The same class breaks color the map and this legend.">
      {scoreLegend.bins.map((bin, index) => (
        <MapLegendItem
          key={index}
          color={bin.color}
          label={`${bin.min.toFixed(2)}–${bin.max.toFixed(2)}${bin.includesMax ? ' (inclusive)' : ''}`}
          disabled
        />
      ))}
      <MapLegendItem color={scoreLegend.missing.color} label={scoreLegend.missing.label} disabled />
    </MapLegendSection>
  )
}

type AtlasMetric = 'parkAccess' | 'shade'
const labMetrics: IndexLabMetric<AtlasMetric>[] = [
  {
    key: 'parkAccess',
    label: 'Park access',
    shortLabel: 'Park access',
    description: 'Residents near a public park.',
    category: 'outdoors',
    format: 'percent',
  },
  {
    key: 'shade',
    label: 'Tree shade',
    shortLabel: 'Tree shade',
    description: 'Outdoor routes with tree shade.',
    category: 'outdoors',
    format: 'percent',
  },
]
const labSettings: IndexLabSettings = { normalization: 'minMax', aggregation: 'additive', missingData: 'neutral' }

function IndexWorkspace() {
  const [compact, setCompact] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const compute = useCallback(
    (state: IndexLabState<AtlasMetric>) => computeIndexLabResults(districts, labMetrics, state),
    [],
  )
  const controller = useIndexLabController({
    metrics: labMetrics,
    initialWeights: { parkAccess: 60, shade: 40 },
    initialSettings: labSettings,
    compute,
  })
  const selected = controller.state.selectedResultId
  const setSelected = controller.selectResult
  const results = controller.results
  const geometry = useMemo(
    () =>
      districtGeometry(
        results.map((result) => ({
          record: districts.find((district) => district.id === result.id)!,
          score: result.score / 100,
        })),
      ),
    [results],
  )
  const current = results.find((result) => result.id === selected)
  const currentRecord = districts.find((district) => district.id === selected)
  const details = current && (
    <div className="detail-copy">
      <p>
        Score <strong>{current.score.toFixed(1)} / 100</strong> · Rank {current.rank}
      </p>
      <p>
        Park access: {currentRecord?.values.parkAccess}% · Tree shade: {currentRecord?.values.shade}%
      </p>
      <p>Available metric coverage: {Math.round(current.dataCoverageScore * 100)}%</p>
    </div>
  )
  const sidebar = (
    <MapSidebarShell
      className={MAP_SIDEBAR_CLASS}
      title="Outdoor access"
      subtitle="An adjustable two-metric index"
      metadata={<span>Fictional observations · Example data</span>}
    >
      <div className="sidebar-copy">
        <div className="index-controls">
          <IndexLabControls
            metrics={labMetrics}
            weights={controller.state.weights}
            totalAbsoluteWeight={controller.totalAbsoluteWeight}
            onWeightChange={controller.setWeight}
            settings={controller.state.settings}
            onSettingsChange={controller.setSettings}
            categoryLabels={{ outdoors: 'Outdoor space' }}
          />
        </div>
        <p>
          The Index Lab compares all three districts. Scores are reported out of 100 and normalized to 0–1 for the map
          scale.
        </p>
        <IndexLabResults
          results={results}
          selectedId={selected}
          onSelect={setSelected}
          query={controller.state.query}
          onQueryChange={controller.setQuery}
        />
        <ResponsiveFeatureDetail popup={details} />
        <ScoreLegend />
      </div>
    </MapSidebarShell>
  )
  return (
    <section className="example-section" aria-labelledby="index-heading" data-testid="index-section">
      <h2 id="index-heading">Explore access to outdoor space</h2>
      <p>Adjust the recipe or select a district. The score, map colors, and ranking update together.</p>
      <div className="example-actions">
        <button className="inspect-button" onClick={() => setSelected('riverside')}>
          Inspect Riverside
        </button>
        <button className="inspect-button" aria-pressed={compact} onClick={() => setCompact(!compact)}>
          {compact ? 'Use wide map' : 'Use compact map'}
        </button>
        <button className="inspect-button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
          {theme === 'light' ? 'Use dark theme' : 'Use light theme'}
        </button>
      </div>
      <div className={`workspace-frame ${compact ? 'is-compact' : ''}`} data-testid="index-workspace">
        <WorkspaceProvider theme={theme}>
          <MapSectionLayout
            sidebar={sidebar}
            desktopSidebarWidth={280}
            mobilePeekTitle="Outdoor access"
            mobilePeekSubtitle="Adjust the index and explore districts"
          >
            <Map
              styles={styles}
              theme={theme}
              center={[-2.75, 50.95]}
              zoom={6.2}
              controls={null}
              loader="spinner"
              attributionControl={false}
            >
              <MapFillLayer
                data={geometry}
                fillColor={['get', 'color']}
                fillOpacity={0.8}
                lineColor="#153445"
                selectedId={selected}
                onFeatureClick={(id) => setSelected(id)}
              />
              <MapReadyState />
            </Map>
            {current && (
              <ResponsiveFeatureDetail
                card={
                  <MobileFeatureCard
                    title={current.label}
                    subtitle="Outdoor access index"
                    cardKey={selected ?? undefined}
                    height={380}
                    initialVisibleHeight={220}
                    onClose={() => setSelected(null)}
                  >
                    {details}
                  </MobileFeatureCard>
                }
              />
            )}
          </MapSectionLayout>
        </WorkspaceProvider>
      </div>
    </section>
  )
}

function HabitatWorkspace() {
  const [selected, setSelected] = useState<string | null>(null)
  const donut = useMemo(
    () =>
      renderDonutSvg({
        counts: habitatCounts,
        colors: habitatCategories.map((category) => category.color),
        showCount: true,
      }),
    [],
  )
  const selectedCell = gridGeometry.features.find((feature) => feature.properties?.id === selected)
  const detailTitle =
    selected === 'all-habitats' ? 'Habitat observations' : String(selectedCell?.properties?.label ?? 'Source cell')
  const details = (
    <div className="detail-copy">
      {selected === 'all-habitats' ? (
        <p>14 classified observations: 7 woodland, 5 meadow, and 2 wetland.</p>
      ) : (
        <p>
          Source cell {selected}. Classification agreement:{' '}
          {Math.round(Number(selectedCell?.properties?.agreement ?? 0) * 100)}%.
        </p>
      )}
      <p>Colors represent categories; they do not imply a numeric score.</p>
    </div>
  )
  const sidebar = (
    <MapSidebarShell
      className={MAP_SIDEBAR_CLASS}
      title="Habitat mosaic"
      subtitle="A separate workspace with its own theme"
    >
      <div className="sidebar-copy">
        <div
          className="donut-preview"
          role="img"
          aria-label="14 habitat observations: 7 woodland, 5 meadow, 2 wetland"
          dangerouslySetInnerHTML={{ __html: donut.svg }}
        />
        <MapLegendSection title="Habitat classes">
          {habitatCategories.map((category) => (
            <MapLegendItem key={category.id} color={category.color} label={category.label} disabled />
          ))}
          <MapLegendItem color="#df91b9" label="Uncertain observation" disabled />
          <MapLegendItem color="#667085" label="No observation" disabled />
        </MapLegendSection>
        <p>
          {habitatGrid.width} × {habitatGrid.height} original source cells. The grid preserves missing and uncertain
          observations.
        </p>
        <ResponsiveFeatureDetail popup={selected ? details : undefined} />
      </div>
    </MapSidebarShell>
  )
  return (
    <section className="example-section" aria-labelledby="habitat-heading" data-testid="habitat-section">
      <h2 id="habitat-heading">Read the habitat mosaic</h2>
      <p>A classified source grid and an aggregated donut use the same category palette.</p>
      <button className="inspect-button" onClick={() => setSelected('all-habitats')}>
        Inspect habitats
      </button>
      <div className="workspace-frame habitat-theme" data-testid="habitat-workspace">
        <WorkspaceProvider theme="dark">
          <MapSectionLayout
            sidebar={sidebar}
            desktopSidebarWidth={280}
            mobilePeekTitle="Habitat mosaic"
            mobilePeekSubtitle="Explore source cells and their categories"
          >
            <Map
              styles={styles}
              theme="dark"
              center={[-2.8, 50.7]}
              zoom={5.8}
              controls={null}
              loader="spinner"
              attributionControl={false}
            >
              <MapFillLayer
                data={gridGeometry}
                fillColor={['get', 'color']}
                fillOpacity={0.65}
                lineColor="#ffffff"
                lineWidth={1}
                selectedId={selected}
                onFeatureClick={(id) => setSelected(id)}
              />
              <MapPieClusterLayer
                data={habitatPoints}
                bandColors={habitatCategories.map((category) => category.color)}
                preAggregated
                showCount
                onPointClick={() => setSelected('all-habitats')}
              />
              <MapReadyState />
            </Map>
            {selected && (
              <ResponsiveFeatureDetail
                card={
                  <MobileFeatureCard
                    title={detailTitle}
                    subtitle="Habitat mosaic"
                    cardKey={selected}
                    height={380}
                    initialVisibleHeight={220}
                    onClose={() => setSelected(null)}
                  >
                    {details}
                  </MobileFeatureCard>
                }
              />
            )}
          </MapSectionLayout>
        </WorkspaceProvider>
      </div>
    </section>
  )
}

const diagram: Extract<Diagram, { type: 'category-dots' }> = {
  type: 'category-dots',
  title: 'Every observation has a category',
  description: 'An illustrative view of the same habitat totals.',
  mode: 'illustrative',
  unit: 'observations',
  points: habitatCounts.flatMap((count, categoryIndex) =>
    Array.from({ length: count }, (_, index) => ({
      id: `${categoryIndex}-${index}`,
      x: 0.1 + index * 0.12,
      y: 0.2 + categoryIndex * 0.25,
      categoryId: habitatCategories[categoryIndex].id,
    })),
  ),
  steps: [],
}

function AtlasStory() {
  const [category, setCategory] = useState<string | null>(null)
  return (
    <section className="example-section editorial-story" aria-labelledby="story-heading">
      <h2 id="story-heading">Tell the story behind the atlas</h2>
      <p>The same categories can support an editorial story. Select a category to highlight its observations.</p>
      <StoryCarousel
        items={[
          <CategoryDotDiagram
            key="habitat-dots"
            diagram={diagram}
            categories={habitatCategories}
            selectedCategory={category}
            onSelect={setCategory}
          />,
          <article key="method" className="story-method">
            <h3>How to read this example</h3>
            <p>
              The outdoor access index blends park access and tree shade. Habitat categories describe a different
              observation and use their own palette.
            </p>
            <p>
              All places and values are fictional. The empty basemap keeps this example independent of external
              services.
            </p>
          </article>,
        ]}
      />
    </section>
  )
}

function App() {
  return (
    <main>
      <header className="page-intro">
        <span className="eyebrow">Willow Bay · Community Atlas</span>
        <h1>Outdoor space, shared stories</h1>
        <p>
          A fictional community atlas that brings together an adjustable index, a habitat grid, and an illustrated
          story.
        </p>
      </header>
      <IndexWorkspace />
      <HabitatWorkspace />
      <ProjectExperience />
      <EditorialExperience />
      <AtlasStory />
      <footer>Willow Bay is fictional. Data and geometries are created locally for this example.</footer>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
