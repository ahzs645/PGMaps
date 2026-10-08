import { WorkspaceProvider, useWorkspace } from '../workspace/workspace-context.js'
import { SidecarStory } from './scenes/SidecarStory.js'
import { DEFAULT_STORY_OPTIONS } from './storyOptions.js'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type {
  ProjectSceneDef,
  ProjectStoryLayerDef,
  ProjectStoryOptionsDef,
  ProjectStoryPlaceDef,
} from '../projects/storyTypes.js'
import { MapSectionLayout } from '../workspace/MapSectionLayout.js'
import { SceneCard } from './scenes/SceneCard.js'
import { SceneStepper } from './scenes/SceneStepper.js'
import { useSceneStoryController, type SceneStoryRenderState } from './useSceneStoryController.js'

export interface SceneStoryRendererProps {
  title: string
  summary?: string
  scenes: ProjectSceneDef[]
  layers: ProjectStoryLayerDef[]
  places?: ProjectStoryPlaceDef[]
  labels?: Record<string, string>
  accent?: string
  options?: Partial<ProjectStoryOptionsDef>
  /** The host owns loading, map transport, selection details and optional comparisons. */
  renderMap: (state: SceneStoryRenderState) => ReactNode
  renderChrome?: (state: SceneStoryRenderState) => ReactNode
  onSceneChange?: (scene: ProjectSceneDef | undefined, index: number) => void
}
/** A complete scene-driven reading UI around a stable, host-supplied map surface. */
export function SceneStoryRenderer(props: SceneStoryRendererProps) {
  const workspace = useWorkspace()
  const runtime = <SceneStoryRuntime key={JSON.stringify(props.scenes)} {...props} />
  return workspace ? runtime : <WorkspaceProvider>{runtime}</WorkspaceProvider>
}
function SceneStoryRuntime({
  title,
  summary,
  scenes,
  layers,
  places,
  labels,
  accent = '#047857',
  options = {},
  renderMap,
  renderChrome,
  onSceneChange,
}: SceneStoryRendererProps) {
  const controller = useSceneStoryController(scenes, layers, { accent, places, labels })
  const { activeSceneIndex, activeScene, selectScene } = controller
  const layout = options.layout ?? 'panel'
  const [exploring, setExploring] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const cards = useRef<Array<HTMLElement | null>>([])
  const touchStart = useRef<number | null>(null)
  const pending = useRef<number | null>(null)
  const mapPane = useRef<HTMLDivElement>(null)
  const goToScene = useCallback(
    (index: number) => {
      if (!scenes[index]) return
      selectScene(index)
      if (layout !== 'slides' && options.sidecarVariant !== 'slideshow') {
        const card = cards.current[index]
        const root = scroller.current
        if (card && root) {
          pending.current = index
          const top = card.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop - 16
          root.scrollTo({ top, behavior: 'instant' })
        }
      }
    },
    [selectScene, layout, options.sidecarVariant, scenes],
  )
  useEffect(() => {
    onSceneChange?.(activeScene, activeSceneIndex)
  }, [activeScene, activeSceneIndex, onSceneChange])
  useEffect(() => {
    const pane = mapPane.current
    if (!pane || layout !== 'scrolly') return
    const wheel = (event: WheelEvent) => {
      if (!scroller.current || exploring) return
      event.preventDefault()
      scroller.current.scrollTop += event.deltaY * (event.deltaMode === 1 ? 16 : 1)
    }
    pane.addEventListener('wheel', wheel, { passive: false })
    return () => pane.removeEventListener('wheel', wheel)
  }, [layout, exploring])
  const readScroll = () => {
    const root = scroller.current
    if (!root || layout === 'slides' || options.sidecarVariant === 'slideshow') return
    if (pending.current !== null) {
      pending.current = null
      return
    }
    const line = root.getBoundingClientRect().top + root.clientHeight * 0.35
    const nearest = cards.current.reduce(
      (best, card, index) => {
        if (!card) return best
        const bounds = card.getBoundingClientRect()
        const distance = Math.abs(bounds.top + bounds.height / 2 - line)
        return distance < best.distance ? { index, distance } : best
      },
      { index: 0, distance: Infinity },
    )
    controller.selectScene(nearest.index)
  }
  const state = { ...controller, goToScene }
  const map = (
    <div ref={mapPane} className="scene-story-map">
      {/* Navigation callbacks read scroll refs only when invoked by a host event. */}
      {/* eslint-disable-next-line react-hooks/refs */}
      {renderMap(state)}
    </div>
  )
  const chrome = (
    <div className="scene-story-chrome">
      {/* eslint-disable-next-line react-hooks/refs */}
      {renderChrome?.(state)}
      {controller.overridden && (
        <button type="button" onClick={controller.resetScene}>
          Reset scene
        </button>
      )}
    </div>
  )
  const stepper = (
    <SceneStepper
      activeIndex={activeSceneIndex}
      count={scenes.length}
      onStep={(direction) => goToScene(activeSceneIndex + direction)}
      accent={accent}
      variant="progress"
    />
  )
  const chapters = (
    <nav className="scene-story-chapters" aria-label="Story scenes">
      {scenes.map((scene, index) => (
        <button
          type="button"
          key={index}
          aria-current={index === activeSceneIndex ? 'step' : undefined}
          onClick={() => goToScene(index)}
        >
          {scene.label}
        </button>
      ))}
    </nav>
  )
  const narrative = (
    <div
      className={`scene-story-narrative scene-story-${layout === 'slides' ? 'slides' : 'reading'}`}
      ref={scroller}
      onScroll={readScroll}
    >
      {scenes.map((scene, index) => (
        <article
          key={index}
          ref={(element) => {
            cards.current[index] = element
          }}
          className={layout === 'slides' ? 'scene-story-slide' : 'scene-story-card'}
          aria-hidden={layout === 'slides' ? index !== activeSceneIndex : undefined}
          style={
            layout === 'slides' && index !== activeSceneIndex
              ? { visibility: 'hidden', pointerEvents: 'none' }
              : undefined
          }
        >
          <SceneCard
            scene={scene}
            index={index}
            active={index === activeSceneIndex}
            accent={accent}
            variant={layout === 'slides' ? 'slide' : layout === 'scrolly' ? 'overlay' : 'panel'}
            onSelect={() => goToScene(index)}
            onNavigate={goToScene}
            sceneLabels={scenes.map((item) => item.label)}
            activeLabel={activeScene?.label}
          />
          {layout === 'sidecar' && (
            <>
              {scene.paragraphs?.map((text, paragraph) => (
                <p key={paragraph}>{text}</p>
              ))}
              {scene.mapActions?.map((action, actionIndex) => (
                <button key={actionIndex} onClick={() => controller.applyMapAction(action)}>
                  {action.label}
                </button>
              ))}
            </>
          )}
        </article>
      ))}
    </div>
  )
  if (!scenes.length) return <div role="status">This story has no scenes.</div>
  if (layout === 'sidecar')
    return (
      <div className="scene-story">
        <SidecarStory
          project={{ title, summary: summary ?? '' }}
          scenes={scenes}
          activeSceneIndex={activeSceneIndex}
          accent={accent}
          options={{ ...DEFAULT_STORY_OPTIONS, ...options }}
          onSelectScene={goToScene}
          onStepScene={(direction) => goToScene(activeSceneIndex + direction)}
          scrollRef={scroller}
          cardRefs={cards}
          exploringMap={exploring}
          onExploreMap={setExploring}
          onMapAction={controller.applyMapAction}
          chrome={chrome}
        >
          {map}
        </SidecarStory>
      </div>
    )

  const header = (
    <header className="scene-story-header">
      <h1>{title}</h1>
      {summary && <p>{summary}</p>}
      {chapters}
      {stepper}
    </header>
  )
  return (
    <section
      className={`scene-story scene-story-layout-${layout}${exploring ? ' is-exploring' : ''}`}
      aria-label={title}
      data-active-scene-index={activeSceneIndex}
      tabIndex={layout === 'slides' ? 0 : undefined}
      onKeyDown={(event) => {
        if (
          layout !== 'slides' ||
          event.defaultPrevented ||
          (event.target as HTMLElement).closest(
            'input, textarea, select, button, a, [contenteditable], [role=dialog], .maplibregl-map',
          )
        )
          return
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          event.preventDefault()
          goToScene(activeSceneIndex + (event.key === 'ArrowRight' ? 1 : -1))
        }
      }}
      onTouchStart={(event) => {
        const target = event.target as HTMLElement
        touchStart.current =
          target.closest('.scene-story-slides') &&
          !target.closest('button, a, input, select, textarea, [data-story-interaction]')
            ? event.touches[0].clientX
            : null
      }}
      onTouchEnd={(event) => {
        if (layout !== 'slides' || touchStart.current === null) return
        const delta = event.changedTouches[0].clientX - touchStart.current
        touchStart.current = null
        if (Math.abs(delta) > 60) goToScene(activeSceneIndex + (delta < 0 ? 1 : -1))
      }}
    >
      {layout === 'scrolly' && (
        <button className="scene-story-explore" onClick={() => setExploring(!exploring)}>
          {exploring ? 'Read story' : 'Explore map'}
        </button>
      )}
      {layout === 'panel' ? (
        <MapSectionLayout
          sidebar={
            <div className="scene-story-sidebar">
              {header}
              {narrative}
            </div>
          }
          mobileInitialSheetState={options.mobileSheet ?? 'half'}
          mobilePeekTitle={activeScene?.title}
          mobilePeekSubtitle={activeScene?.focus}
        >
          {map}
          {chrome}
        </MapSectionLayout>
      ) : (
        <>
          {header}
          <div className="scene-story-body">
            {map}
            {narrative}
            {chrome}
          </div>
        </>
      )}
    </section>
  )
}
