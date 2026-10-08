import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from 'react'
import { ArrowDown, ArrowRight, Maximize2, Minimize2 } from 'lucide-react'
import { Button } from '../../ui/button.js'
import type { ProjectSceneDef, ProjectStoryOptionsDef } from '../../projects/storyTypes.js'
import { cn } from '../../utils.js'
import { SceneInteraction } from './SceneInteraction.js'
import { SceneStepButton } from './SceneStepper.js'

export type SidecarMapAction = NonNullable<ProjectSceneDef['mapActions']>[number]

export interface SidecarStoryProps {
  project: { title: string; summary: string; sourceNote?: string }
  scenes: ProjectSceneDef[]
  activeSceneIndex: number
  accent: string
  options: ProjectStoryOptionsDef
  back?: ReactNode
  onSelectScene: (index: number) => void
  onStepScene: (direction: number) => void
  scrollRef: RefObject<HTMLDivElement>
  cardRefs: MutableRefObject<Array<HTMLElement | null>>
  exploringMap: boolean
  onExploreMap: (exploring: boolean) => void
  onMapAction: (action: SidecarMapAction) => void
  chrome: ReactNode
  children: ReactNode
}

/** An editorial shell around the same persistent map and declarative scene engine. */
export function SidecarStory({
  project,
  scenes,
  activeSceneIndex,
  accent,
  options,
  back,
  onSelectScene,
  onStepScene,
  scrollRef,
  cardRefs,
  exploringMap,
  onExploreMap,
  onMapAction,
  chrome,
  children,
}: SidecarStoryProps) {
  const [coverOpen, setCoverOpen] = useState(options.storyCover)
  const touchStart = useRef<number | null>(null)
  const mapPane = useRef<HTMLDivElement>(null)
  const chapterButtons = useRef<Array<HTMLButtonElement | null>>([])
  const current = scenes[activeSceneIndex]
  const variant = current?.presentation ?? options.sidecarVariant
  // A mixed story remains a continuous document, including its slideshow-like
  // sections. Only a wholly authored slideshow switches narrative discretely.
  const slideshow = options.sidecarVariant === 'slideshow' && !scenes.some((scene) => scene.presentation)
  const mixed = scenes.some((scene) => scene.presentation)
  const ink = options.storyTheme === 'ink'
  const labels = scenes.map((scene) => scene.label)

  useEffect(() => {
    const narrative = scrollRef.current
    if (!narrative) return
    // React 18's attribute types predate inert; native inert also excludes
    // descendant controls from keyboard focus while the cover/map owns input.
    narrative.inert = exploringMap || coverOpen
    return () => {
      narrative.inert = false
    }
  }, [coverOpen, exploringMap, scrollRef])

  useEffect(() => {
    const pane = mapPane.current
    if (!pane) return
    const forwardWheel = (event: WheelEvent) => {
      if (exploringMap || coverOpen || !scrollRef.current) return
      event.preventDefault()
      const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scrollRef.current.clientHeight : 1
      scrollRef.current.scrollTop += event.deltaY * multiplier
    }
    pane.addEventListener('wheel', forwardWheel, { passive: false })
    return () => pane.removeEventListener('wheel', forwardWheel)
  }, [coverOpen, exploringMap, scrollRef])

  const begin = () => {
    setCoverOpen(false)
    requestAnimationFrame(() => chapterButtons.current[activeSceneIndex]?.focus({ preventScroll: true }))
  }
  const selectChapter = (index: number) => {
    setCoverOpen(false)
    onExploreMap(false)
    onSelectScene(index)
  }

  useEffect(() => {
    // Keep the selected named chapter within the horizontal rail without moving
    // the page/narrative scroller (scrollIntoView would move every ancestor).
    const button = chapterButtons.current[activeSceneIndex]
    const rail = button?.parentElement
    if (!button || !rail) return
    const left = button.offsetLeft - rail.offsetLeft
    if (left < rail.scrollLeft) rail.scrollLeft = left
    else if (left + button.offsetWidth > rail.scrollLeft + rail.clientWidth) {
      rail.scrollLeft = left + button.offsetWidth - rail.clientWidth
    }
    if (slideshow && scrollRef.current) scrollRef.current.scrollTop = 0
  }, [activeSceneIndex, slideshow, scrollRef])

  const theme = {
    '--sidecar-accent': accent,
    '--sidecar-bg': ink ? '#101719' : '#faf9f5',
    '--sidecar-fg': ink ? '#f4f4ee' : '#152f35',
    '--sidecar-muted': ink ? '#bfcacb' : '#50656a',
    '--sidecar-border': ink ? '#354347' : '#d5dedc',
    '--sidecar-width': options.narrativeWidth === 'large' ? '47%' : '39%',
    // Scope shared controls to the story's chosen theme, independently of the app.
    '--background': ink ? '193 22% 8%' : '48 33% 97%',
    '--foreground': ink ? '60 21% 95%' : '192 43% 15%',
    '--muted': ink ? '193 17% 18%' : '160 12% 91%',
    '--muted-foreground': ink ? '185 10% 77%' : '191 14% 36%',
    '--border': ink ? '193 15% 24%' : '167 12% 85%',
    '--primary': ink ? '165 53% 68%' : '170 76% 26%',
    '--primary-foreground': ink ? '192 43% 15%' : '0 0% 100%',
  } as CSSProperties

  return (
    <div
      className={cn('sidecar-story', ink && 'dark')}
      data-testid="sidecar-story"
      data-variant={variant}
      data-side={options.narrativeSide}
      data-exploring={exploringMap}
      data-cover={coverOpen}
      data-mixed={mixed}
      style={theme}
    >
      <header className="sidecar-masthead">
        {back}
        <button
          type="button"
          className="sidecar-story-title"
          onClick={() => {
            onExploreMap(false)
            if (options.storyCover) setCoverOpen(true)
            else selectChapter(0)
          }}
          aria-label={`${project.title}: return to beginning`}
        >
          {project.title}
        </button>
        <span className="sidecar-position" aria-label={`Chapter ${activeSceneIndex + 1} of ${scenes.length}`}>
          {String(activeSceneIndex + 1).padStart(2, '0')} / {String(scenes.length).padStart(2, '0')}
        </span>
      </header>
      {options.chapterNavigation && (
        <nav className="sidecar-chapters" aria-label="Story chapters" data-testid="sidecar-chapters">
          {scenes.map((scene, index) => (
            <button
              key={scene.label}
              ref={(node) => {
                chapterButtons.current[index] = node
              }}
              type="button"
              aria-current={index === activeSceneIndex ? 'step' : undefined}
              onClick={() => selectChapter(index)}
            >
              <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              {scene.label}
            </button>
          ))}
        </nav>
      )}
      <div className="sidecar-stage">
        {/* This map container never changes its place in the tree: layout,
            cover and exploration change only its CSS bounds. */}
        <div ref={mapPane} className="sidecar-map" data-testid="sidecar-map">
          {children}
          <div className="sidecar-chrome">{chrome}</div>
        </div>
        <div
          ref={scrollRef}
          className="sidecar-narrative"
          data-testid="sidecar-narrative"
          aria-label="Story narrative"
          aria-hidden={exploringMap || coverOpen || undefined}
          tabIndex={exploringMap || coverOpen ? -1 : 0}
        >
          {scenes.map((scene, index) => {
            const active = index === activeSceneIndex
            const shown = !slideshow || active
            return (
              <section
                key={scene.label}
                className="sidecar-section"
                data-presentation={scene.presentation ?? options.sidecarVariant}
                hidden={!shown}
              >
                <article
                  ref={(node) => {
                    cardRefs.current[index] = shown ? node : null
                  }}
                  data-scene-index={index}
                  data-active-scene={active}
                  data-testid={`sidecar-chapter-${index}`}
                  className="sidecar-prose"
                >
                  <div>
                    <div className="sidecar-kicker">
                      {scene.kicker ?? `Chapter ${String(index + 1).padStart(2, '0')}`}
                    </div>
                    <h2>{scene.title}</h2>
                  </div>
                  <p>{scene.text}</p>
                  {scene.paragraphs?.map((paragraph, paragraphIndex) => (
                    <p key={paragraphIndex}>{paragraph}</p>
                  ))}
                  {!!scene.mapActions?.length && (
                    <div className="sidecar-map-actions" aria-label="Views for this chapter">
                      <span className="sidecar-action-label">Look closer</span>
                      {scene.mapActions.map((action) => (
                        <button
                          type="button"
                          key={action.label}
                          onClick={() => {
                            if (active) onMapAction(action)
                            else {
                              onSelectScene(index)
                              // Let the chapter's state settle before applying
                              // its optional view; chapter changes reset views.
                              requestAnimationFrame(() => onMapAction(action))
                            }
                          }}
                        >
                          {action.label}
                          <ArrowRight aria-hidden="true" size={15} />
                        </button>
                      ))}
                    </div>
                  )}
                  {scene.callout && (
                    <aside className="sidecar-callout">
                      <div>{scene.callout.label}</div>
                      <strong>{scene.callout.value}</strong>
                      {scene.callout.detail && <p>{scene.callout.detail}</p>}
                    </aside>
                  )}
                  {scene.interaction && (
                    <SceneInteraction
                      block={scene.interaction}
                      sceneLabels={labels}
                      activeLabel={current?.label ?? scene.label}
                      onNavigate={selectChapter}
                    />
                  )}
                  {scene.focus && <div className="sidecar-focus">On the map · {scene.focus}</div>}
                  <div className="sidecar-section-steps">
                    <SceneStepButton
                      direction={-1}
                      disabled={index === 0}
                      onClick={() => selectChapter(index - 1)}
                      className="size-11 rounded-none border"
                    />
                    <span>
                      {String(index + 1).padStart(2, '0')} / {String(scenes.length).padStart(2, '0')}
                    </span>
                    <SceneStepButton
                      direction={1}
                      disabled={index === scenes.length - 1}
                      onClick={() => selectChapter(index + 1)}
                      className="size-11 rounded-none border"
                    />
                  </div>
                </article>
              </section>
            )
          })}
          {!slideshow && (
            <footer className="sidecar-endnote">
              <span>Sources &amp; context</span>
              <p>{project.sourceNote}</p>
              <Button variant="outline" onClick={() => selectChapter(0)}>
                Return to first chapter
              </Button>
            </footer>
          )}
        </div>
        {!coverOpen && (
          <div className="sidecar-map-tools">
            <button
              type="button"
              className="sidecar-explore"
              aria-pressed={exploringMap}
              onClick={() => onExploreMap(!exploringMap)}
            >
              {exploringMap ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
              {exploringMap ? 'Read story' : 'Expand map'}
            </button>
            {exploringMap && (
              <div className="sidecar-explore-steps">
                <SceneStepButton
                  direction={-1}
                  disabled={activeSceneIndex === 0}
                  onClick={() => onStepScene(-1)}
                  className="size-11"
                />
                <span>
                  {activeSceneIndex + 1}/{scenes.length}
                </span>
                <SceneStepButton
                  direction={1}
                  disabled={activeSceneIndex >= scenes.length - 1}
                  onClick={() => onStepScene(1)}
                  className="size-11"
                />
              </div>
            )}
          </div>
        )}
        {coverOpen && (
          <div
            className="sidecar-cover"
            data-testid="sidecar-cover"
            onWheel={(event) => {
              if (event.deltaY > 20) begin()
            }}
            onTouchStart={(event) => {
              touchStart.current = event.touches[0]?.clientY ?? null
            }}
            onTouchEnd={(event) => {
              if (
                touchStart.current !== null &&
                touchStart.current - (event.changedTouches[0]?.clientY ?? touchStart.current) > 50
              )
                begin()
              touchStart.current = null
            }}
          >
            <div className="sidecar-cover-copy">
              <div className="sidecar-kicker">A map story</div>
              <h1>{project.title}</h1>
              <p>{project.summary}</p>
              <button type="button" className="sidecar-start" onClick={begin}>
                Start reading <ArrowDown size={18} aria-hidden="true" />
              </button>
              <span className="sidecar-cover-hint">{scenes.length} chapters · Scroll to begin</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
