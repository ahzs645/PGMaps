import { WorkspaceProvider, useWorkspace } from '../workspace/workspace-context.js'
import { createContext, useContext, useEffect, useMemo, useRef, useState, type RefObject, type ReactNode } from 'react'
import { RadialHierarchy } from './diagrams/RadialHierarchy.js'
import { CategoryDotDiagram } from './diagrams/CategoryDotDiagram.js'
import {
  StoryCover,
  StorySidecar,
  StoryTour,
  StoryCarousel,
  ExpandableMedia,
  StoryImage,
  StoryChapterNavigation,
  useSectionUrl,
} from './components/index.js'
import { parseEditorialDocument } from './model/validate.mjs'
import type {
  NativeEditorialDocument,
  NativeMapDefinition,
  NativeView,
  Category,
  Block,
  CopyBlock,
  Media,
  Inline,
  ComparisonMedia,
} from './model/types.js'
import type { StoryCamera } from './storyScene.js'

export interface EditorialMapRenderProps {
  definition: NativeMapDefinition
  view: NativeView
  categories: Category[]
  selectedCategory: string | null
  onSelect: (id: string | null) => void
  cameraMemory: Map<string, StoryCamera>
  memoryKey: string
  stops?: { id: string; label: string; coordinates: [number, number] }[]
  activeStop?: string
  onStop?: (index: number) => void
}
export interface EditorialComparisonRenderProps {
  document: NativeEditorialDocument
  media: ComparisonMedia
  selectedCategory: string | null
  onSelect: (id: string | null) => void
}
export interface EditorialShellRenderProps {
  scrollRoot: RefObject<HTMLDivElement>
  chapters: { id: string; label: string }[]
  cover?: ReactNode
  children: ReactNode
}
interface Runtime {
  doc: NativeEditorialDocument
  renderMap: (props: EditorialMapRenderProps) => ReactNode
  renderComparison?: (props: EditorialComparisonRenderProps) => ReactNode
  selected: string | null
  select: (id: string | null) => void
  overrides: Record<string, string>
  action: (id: string) => void
  root: RefObject<HTMLDivElement>
  cameras: Map<string, { center: [number, number]; zoom: number; bearing: number; pitch: number }>
}
const Context = createContext<Runtime | null>(null)
function useRuntime() {
  const value = useContext(Context)
  if (!value) throw new Error('Missing story runtime')
  return value
}
function Rich({ text }: { text: Inline[] }) {
  const { action } = useRuntime()
  return (
    <>
      {text.map((part, i) => {
        if (typeof part === 'string') return <span key={i}>{part}</span>
        let child: ReactNode = part.text
        if (part.strong) child = <strong>{child}</strong>
        if (part.emphasis) child = <em>{child}</em>
        return part.actionId ? (
          <button className="editorial-map-action" key={i} onClick={() => action(part.actionId!)}>
            {child}
          </button>
        ) : part.href ? (
          <a key={i} href={part.href} target="_blank" rel="noopener noreferrer">
            {child}
          </a>
        ) : (
          <span key={i}>{child}</span>
        )
      })}
    </>
  )
}
function Copy({ block }: { block: CopyBlock }) {
  if (block.type === 'separator') return <hr id={block.id} className="editorial-separator" />
  if (block.type === 'list')
    return (
      <ul id={block.id} className="editorial-text">
        {block.items.map((item, i) => (
          <li key={i}>
            <Rich text={item} />
          </li>
        ))}
      </ul>
    )
  const Tag = block.type === 'heading' ? 'h3' : block.type === 'quote' ? 'blockquote' : 'p'
  return (
    <Tag id={block.id} className={`editorial-text editorial-${block.type}`}>
      <Rich text={block.text} />
    </Tag>
  )
}
function CopyList({ blocks }: { blocks: CopyBlock[] }) {
  return (
    <>
      {blocks.map((b) => (
        <Copy key={b.id} block={b} />
      ))}
    </>
  )
}
/** Mount only nearby map regions. The parent retains narrative/selection state. */
function MapRegion({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    if (!ref.current) return
    const observer = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { rootMargin: '600px' })
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  return (
    <div ref={ref} className="native-media-region">
      {near ? (
        children
      ) : (
        <div className="native-map-placeholder" role="status">
          Map activates as you approach
        </div>
      )}
    </div>
  )
}
function MapView({ mapId, viewId, targetId }: { mapId: string; viewId: string; targetId: string }) {
  const { doc, selected, select, overrides, cameras, renderMap } = useRuntime()
  return renderMap({
    cameraMemory: cameras,
    memoryKey: targetId,
    definition: doc.maps[mapId],
    view: doc.views[overrides[targetId] ?? viewId],
    categories: doc.categories,
    selectedCategory: selected,
    onSelect: select,
  })
}
function Comparison({ media }: { media: ComparisonMedia }) {
  const { doc, selected, select, renderComparison } = useRuntime()
  return renderComparison ? (
    renderComparison({ document: doc, media, selectedCategory: selected, onSelect: select })
  ) : (
    <div role="alert">This story requires a comparison renderer.</div>
  )
}
function MediaContent({ media, targetId }: { media: Media; targetId: string }) {
  const { doc, selected, select } = useRuntime()
  if (media.type === 'image') {
    const img = <StoryImage src={media.src} alt={media.alt} />
    return (
      <figure className="editorial-image">
        {media.expandable ? <ExpandableMedia>{img}</ExpandableMedia> : img}
        {(media.caption || media.credit) && (
          <figcaption>
            {media.caption}
            {media.credit && <span className="editorial-attribution">{media.credit}</span>}
          </figcaption>
        )}
      </figure>
    )
  }
  if (media.type === 'diagram') {
    const d = doc.diagrams[media.diagramId]
    return d.type === 'radial-hierarchy' ? (
      <RadialHierarchy {...d} categories={doc.categories} selectedCategory={selected} onSelect={select} />
    ) : (
      <CategoryDotDiagram
        diagram={d}
        stepId={media.stepId}
        categories={doc.categories}
        selectedCategory={selected}
        onSelect={select}
      />
    )
  }
  if (media.type === 'comparison') return <Comparison media={media} />
  return <MapView mapId={media.mapId} viewId={media.viewId} targetId={targetId} />
}
function MediaSlot({ media, targetId }: { media: Media; targetId: string }) {
  const content = <MediaContent media={media} targetId={targetId} />
  return media.type === 'map' || media.type === 'comparison' ? <MapRegion>{content}</MapRegion> : content
}
function TourBlock({ block }: { block: Extract<Block, { type: 'tour' }> }) {
  const { doc, root, selected, select, overrides, cameras, renderMap } = useRuntime()
  return (
    <StoryTour
      id={block.id}
      scrollRoot={root}
      stops={block.stops.map((s) => ({
        id: s.id,
        media: <MediaContent media={s.media} targetId={s.id} />,
        content: (
          <>
            <h3>{s.label}</h3>
            <CopyList blocks={s.content} />
          </>
        ),
      }))}
      renderMap={(active, choose) => (
        <MapRegion>
          {renderMap({
            cameraMemory: cameras,
            memoryKey: block.id,
            definition: doc.maps[block.mapId],
            view: doc.views[overrides[block.id] ?? block.stops[active].viewId],
            categories: doc.categories,
            selectedCategory: selected,
            onSelect: select,
            stops: block.stops,
            activeStop: block.stops[active].id,
            onStop: choose,
          })}
        </MapRegion>
      )}
    />
  )
}
function ContentBlock({ block }: { block: Block }) {
  const { root } = useRuntime()
  if (['paragraph', 'heading', 'quote', 'list', 'separator'].includes(block.type))
    return <Copy block={block as CopyBlock} />
  if (block.type === 'sidecar')
    return (
      <StorySidecar
        id={block.id}
        scrollRoot={root}
        variant={block.presentation}
        side={block.side}
        width={block.width}
        slides={block.steps.map((s) => ({
          id: s.id,
          imageUrl: s.media.type === 'image' ? s.media.src : undefined,
          content: <CopyList blocks={s.content} />,
          media: <MediaSlot media={s.media} targetId={block.id} />,
        }))}
      />
    )
  if (block.type === 'tour') return <TourBlock block={block} />
  if (block.type === 'carousel')
    return (
      <div id={block.id}>
        <StoryCarousel
          items={block.items.map((m, i) => (
            <MediaContent key={i} media={m} targetId={block.id} />
          ))}
        />
      </div>
    )
  if (block.type === 'credits')
    return (
      <footer id={block.id} className="editorial-credits">
        <Rich text={block.text} />
      </footer>
    )
  return (
    <div id={block.id} className={`native-block native-block-${block.type}`}>
      <MediaSlot media={block as Media} targetId={block.id} />
    </div>
  )
}

/** Complete validated native document rendering. Map transports are host adapters. */
export function EditorialDocumentRenderer({
  document: input,
  renderMap,
  renderComparison,
  renderShell,
  sectionUrl = false,
}: {
  document: NativeEditorialDocument
  renderMap: (props: EditorialMapRenderProps) => ReactNode
  renderComparison?: (props: EditorialComparisonRenderProps) => ReactNode
  renderShell?: (props: EditorialShellRenderProps) => ReactNode
  sectionUrl?: boolean
}) {
  const doc = useMemo(() => parseEditorialDocument(input), [input])
  const workspace = useWorkspace()
  const runtime = (
    <EditorialRuntime
      key={JSON.stringify(doc)}
      document={doc}
      renderMap={renderMap}
      renderComparison={renderComparison}
      renderShell={renderShell}
      sectionUrl={sectionUrl}
    />
  )
  return workspace ? runtime : <WorkspaceProvider>{runtime}</WorkspaceProvider>
}
function EditorialRuntime({
  document: doc,
  renderMap,
  renderComparison,
  renderShell,
  sectionUrl,
}: {
  document: NativeEditorialDocument
  renderMap: (props: EditorialMapRenderProps) => ReactNode
  renderComparison?: (props: EditorialComparisonRenderProps) => ReactNode
  renderShell?: (props: EditorialShellRenderProps) => ReactNode
  sectionUrl: boolean
}) {
  const [selected, select] = useState<string | null>(null)
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const root = useRef<HTMLDivElement>(null)
  const [cameras] = useState(() => new Map<string, StoryCamera>())
  const chapters = useMemo(() => doc.chapters.map((chapter) => ({ id: chapter.id, label: chapter.title })), [doc])
  const action = (id: string) => {
    const value = doc.actions[id]
    if (!value) return
    if (value.type === 'select-category') select(value.categoryId)
    else if (value.type === 'set-map-view')
      setOverrides((previous) => ({ ...previous, [value.targetId]: value.viewId }))
    else
      root.current?.querySelector(`#${value.chapterId}`)?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start',
      })
  }
  const content = (
    <div className="native-editorial" data-testid="native-editorial" data-selected-category={selected ?? ''}>
      {doc.chapters.map((chapter) => (
        <section key={chapter.id} className="native-chapter">
          <h2 id={chapter.id} className="editorial-text editorial-h2" data-story-section>
            {chapter.title}
          </h2>
          {chapter.blocks.map((block) => (
            <ContentBlock key={block.id} block={block} />
          ))}
        </section>
      ))}
    </div>
  )
  const shellProps = {
    scrollRoot: root,
    chapters,
    cover: doc.cover && <StoryCover {...doc.cover} />,
    children: content,
  }
  return (
    <Context.Provider value={{ doc, selected, select, overrides, action, root, cameras, renderMap, renderComparison }}>
      {/* The host receives a ref to attach; shell rendering does not read current. */}
      {/* eslint-disable-next-line react-hooks/refs */}
      {renderShell ? renderShell(shellProps) : <DefaultEditorialShell {...shellProps} sectionUrl={sectionUrl} />}
    </Context.Provider>
  )
}
function DefaultEditorialShell({
  scrollRoot,
  chapters,
  cover,
  children,
  sectionUrl,
}: EditorialShellRenderProps & { sectionUrl: boolean }) {
  const workspace = useWorkspace()
  const [activeChapter, setActiveChapter] = useState('')
  useSectionUrl(
    scrollRoot,
    sectionUrl,
    chapters.map((chapter) => chapter.id),
  )
  useEffect(() => {
    const root = scrollRoot.current
    if (!root) return
    const measure = () => root.style.setProperty('--editorial-viewport', `${root.clientHeight}px`)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    const chaptersObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setActiveChapter(entry.target.id)
      },
      { root, rootMargin: '-100px 0px -60% 0px', threshold: 0 },
    )
    for (const chapter of chapters) {
      const element = root.querySelector(`#${chapter.id}`)
      if (element) chaptersObserver.observe(element)
    }
    return () => {
      observer.disconnect()
      chaptersObserver.disconnect()
    }
  }, [scrollRoot, chapters])
  return (
    <div
      ref={scrollRoot}
      className="editorial-story editorial-document-root"
      data-theme={workspace?.theme}
      aria-label="Story"
    >
      {cover}
      <StoryChapterNavigation
        chapters={chapters}
        active={activeChapter}
        onSelect={(id) =>
          scrollRoot.current?.querySelector(`#${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
        }
      />
      {children}
    </div>
  )
}
