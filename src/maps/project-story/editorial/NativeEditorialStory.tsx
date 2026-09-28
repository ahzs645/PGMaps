import { createContext, useContext, useEffect, useMemo, useRef, useState, type RefObject, type ReactNode } from 'react'
import type MapLibre from 'maplibre-gl'
import type { ProjectPackage } from '@/lib/projectPackages'
import { useStorySources } from '../useStorySources'
import { MapSwipe } from '@/components/ui/map-swipe'
import { RadialHierarchy } from '@/components/ui/diagrams/RadialHierarchy'
import { CategoryDotDiagram } from '@/components/ui/diagrams/CategoryDotDiagram'
import { EditorialShell } from './EditorialShell'
import { StoryCover, StorySidecar, StoryTour, StoryCarousel, ExpandableMedia } from './components'
import { NativeStoryMap } from './NativeStoryMap'
import { parseEditorialDocument } from './model/validate.mjs'
import type { NativeEditorialDocument, Block, CopyBlock, Media, Inline, ComparisonMedia } from './model/types'
import './NativeEditorialStory.css'
interface Runtime {
  doc: NativeEditorialDocument
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
  const { doc, selected, select, overrides, cameras } = useRuntime()
  return (
    <NativeStoryMap
      cameraMemory={cameras}
      memoryKey={targetId}
      definition={doc.maps[mapId]}
      view={doc.views[overrides[targetId] ?? viewId]}
      categories={doc.categories}
      selectedCategory={selected}
      onSelect={select}
    />
  )
}
function Comparison({ media }: { media: ComparisonMedia }) {
  const { doc, selected, select } = useRuntime()
  const [left, setLeft] = useState<MapLibre.Map | null>(null),
    [right, setRight] = useState<MapLibre.Map | null>(null)
  const position = useRef(50)
  useEffect(() => {
    if (!left || !right) return
    const mirror = () =>
      right.jumpTo({
        center: left.getCenter(),
        zoom: left.getZoom(),
        bearing: left.getBearing(),
        pitch: left.getPitch(),
        roll: 0,
      })
    const pick = (event: MapLibre.MapMouseEvent) => {
      const source = (event.point.x / left.getCanvas().clientWidth) * 100 < position.current ? left : right
      const property = doc.maps[media.mapId].categoryProperty
      if (!property) return
      const found = source
        .queryRenderedFeatures(event.point)
        .find((f) => doc.categories.some((c) => c.id === String(f.properties?.[property])))
      if (found) select(String(found.properties[property]))
    }
    mirror()
    left.on('click', pick)
    left.on('move', mirror)
    left.on('resize', mirror)
    return () => {
      left.off('click', pick)
      left.off('move', mirror)
      left.off('resize', mirror)
    }
  }, [left, right, doc, media.mapId, select])
  const layerIds = [
    ...doc.views[media.leftViewId].visibleLayerIds,
    ...doc.views[media.rightViewId].visibleLayerIds,
  ].join(',')
  const queryLayers = useMemo(
    () => doc.maps[media.mapId].layers.filter((l) => l.format !== 'pmtiles' && layerIds.split(',').includes(l.id)),
    [doc, media.mapId, layerIds],
  )
  const shared = useStorySources(queryLayers)
  const common = {
    sharedSources: shared.sources,
    retrySources: shared.retry,
    definition: doc.maps[media.mapId],
    categories: doc.categories,
    selectedCategory: selected,
    onSelect: () => {},
  }
  return (
    <MapSwipe
      leftLabel={media.leftLabel}
      rightLabel={media.rightLabel}
      onPositionChange={(p) => {
        position.current = p
      }}
      left={<NativeStoryMap {...common} view={doc.views[media.leftViewId]} onReady={setLeft} />}
      right={<NativeStoryMap {...common} view={doc.views[media.rightViewId]} onReady={setRight} passive />}
    />
  )
}
function MediaContent({ media, targetId }: { media: Media; targetId: string }) {
  const { doc, selected, select } = useRuntime()
  if (media.type === 'image') {
    const img = <img src={media.src} alt={media.alt} loading="lazy" />
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
  const { doc, root, selected, select, overrides, cameras } = useRuntime()
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
          <NativeStoryMap
            cameraMemory={cameras}
            memoryKey={block.id}
            definition={doc.maps[block.mapId]}
            view={doc.views[overrides[block.id] ?? block.stops[active].viewId]}
            categories={doc.categories}
            selectedCategory={selected}
            onSelect={select}
            stops={block.stops}
            activeStop={block.stops[active].id}
            onStop={choose}
          />
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
export default function NativeEditorialStory({
  project,
  onBack,
  documentUrl,
}: {
  project: ProjectPackage
  onBack: () => void
  documentUrl: string
}) {
  const [doc, setDoc] = useState<NativeEditorialDocument | null>(null),
    [error, setError] = useState('')
  const [selected, select] = useState<string | null>(null)
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const root = useRef<HTMLDivElement>(null)
  const [cameras] = useState(
    () => new Map<string, { center: [number, number]; zoom: number; bearing: number; pitch: number }>(),
  )
  useEffect(() => {
    const controller = new AbortController()
    fetch(documentUrl, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`Story returned HTTP ${r.status}`)
        return r.json()
      })
      .then(parseEditorialDocument)
      .then(setDoc)
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message)
      })
    return () => controller.abort()
  }, [documentUrl])
  const chapters = useMemo(() => doc?.chapters.map((c) => ({ id: c.id, label: c.title })) ?? [], [doc])
  if (!doc)
    return (
      <div className="p-6" role={error ? 'alert' : 'status'}>
        {error || 'Loading story…'}
      </div>
    )
  const action = (id: string) => {
    const a = doc.actions[id]
    if (!a) return
    if (a.type === 'select-category') select(a.categoryId)
    else if (a.type === 'set-map-view') setOverrides((prev) => ({ ...prev, [a.targetId]: a.viewId }))
    else
      root.current?.querySelector(`#${a.chapterId}`)?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start',
      })
  }
  return (
    <Context.Provider value={{ doc, selected, select, overrides, action, root, cameras }}>
      <EditorialShell
        title={project.title}
        onBack={onBack}
        scrollRoot={root}
        chapters={chapters}
        cover={doc.cover && <StoryCover {...doc.cover} />}
      >
        <div className="native-editorial" data-testid="native-editorial" data-selected-category={selected ?? ''}>
          {doc.chapters.map((c) => (
            <section key={c.id} className="native-chapter">
              <h2 id={c.id} className="editorial-text editorial-h2">
                {c.title}
              </h2>
              {c.blocks.map((b) => (
                <ContentBlock key={b.id} block={b} />
              ))}
            </section>
          ))}
        </div>
      </EditorialShell>
    </Context.Provider>
  )
}
