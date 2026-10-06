import { validateImportedStory } from './model/validateImport.mjs'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type RefObject } from 'react'
import type { ProjectPackage } from '@/lib/projectPackages'
import { EditorialBasemapContext } from './editorialBasemap'
import { EditorialMap, EditorialSwipe, warmEditorialMap } from './EditorialMap'
import { SafeRichText, safeLink } from './SafeRichText'
import { EditorialShell } from './EditorialShell'
import { StoryCover } from './components/StoryCover'
import { StoryImage as DecodedStoryImage } from './components/StoryImage'
import { StoryCarousel } from './components/StoryCarousel'
import { StorySidecar } from './components/StorySidecar'
import { StoryTour } from './components/StoryTour'
import { ExpandableMedia } from './components/StoryMedia'
import { useStoryFonts, type StoryFontFace } from './components/useStoryFonts'
import './EditorialStory.css'

type Data = Record<string, unknown>
interface StoryNode {
  type: string
  data?: Data
  config?: Data
  children?: string[]
}
interface StoryDocument {
  root: string
  nodes: Record<string, StoryNode>
  resources: Record<string, { type: string; data: Data }>
  actions?: Array<{ target: string; data: { actionId: string; mapData: Data } }>
}
interface ContextValue {
  document: StoryDocument
  scrollRoot: RefObject<HTMLDivElement>
  onAction: (id: string) => void
  actions: Record<string, Data>
}
function readDocument(value: unknown): StoryDocument {
  const capabilityErrors = validateImportedStory(value)
  if (capabilityErrors.length) throw new Error(capabilityErrors.join('; '))
  const graph = record(value)
  const nodes = record(graph.nodes),
    resources = record(graph.resources)
  if (typeof graph.root !== 'string' || !nodes[graph.root] || !Object.keys(resources).length)
    throw new Error('This story document is missing its root, nodes, or resources.')
  for (const entry of Object.values(nodes)) {
    const node = record(entry)
    if (
      typeof node.type !== 'string' ||
      (node.children !== undefined &&
        (!Array.isArray(node.children) || node.children.some((child) => typeof child !== 'string' || !nodes[child])))
    )
      throw new Error('This story document contains an invalid content block.')
    if (node.data !== undefined && (!node.data || typeof node.data !== 'object' || Array.isArray(node.data)))
      throw new Error('This story document contains invalid block data.')
  }
  for (const entry of Object.values(resources))
    if (typeof record(entry).type !== 'string' || !record(entry).data || typeof record(entry).data !== 'object')
      throw new Error('This story document contains an invalid resource.')
  if (
    graph.actions !== undefined &&
    (!Array.isArray(graph.actions) ||
      graph.actions.some(
        (action) =>
          typeof record(action).target !== 'string' ||
          typeof record(record(action).data).actionId !== 'string' ||
          !record(record(action).data).mapData,
      ))
  )
    throw new Error('This story document contains an invalid map action.')
  return graph as unknown as StoryDocument
}
const StoryContext = createContext<ContextValue | null>(null)
const text = (value: unknown) => (typeof value === 'string' ? value : '')
const record = (value: unknown): Data =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Data) : {}
const array = (value: unknown): Data[] => (Array.isArray(value) ? value.map(record) : [])
const useStory = () => {
  const context = useContext(StoryContext)
  if (!context) throw new Error('Missing editorial story context')
  return context
}
const plain = (value: unknown) => new DOMParser().parseFromString(text(value), 'text/html').body.textContent ?? ''
function resource(document: StoryDocument, id: unknown): Data {
  return document.resources[text(id)]?.data ?? {}
}
function node(document: StoryDocument, id: unknown): StoryNode {
  return document.nodes[text(id)] ?? { type: 'missing' }
}
function resourceUrl(document: StoryDocument, id: unknown): string | undefined {
  const data = resource(document, id)
  return safeLink(data.deliveryUrl) ?? safeLink(data.url)
}

function StoryImage({ storyNode }: { storyNode: StoryNode }) {
  const { document, onAction } = useStory()
  const data = storyNode.data ?? {}
  const src = resourceUrl(document, data.image)
  const metadata = resource(document, data.image)
  const content = (
    <DecodedStoryImage
      src={src}
      loading="lazy"
      width={typeof metadata.width === 'number' ? metadata.width : undefined}
      height={typeof metadata.height === 'number' ? metadata.height : undefined}
      alt={text(data.alt) || text(resource(document, data.image).alt) || plain(data.caption)}
    />
  )
  return (
    <figure className={`editorial-image ${storyNode.config?.size === 'wide' ? 'is-wide' : ''}`}>
      {data.isExpandable ? <ExpandableMedia>{content}</ExpandableMedia> : content}
      {data.caption || data.attribution ? (
        <figcaption>
          {data.caption ? <SafeRichText html={text(data.caption)} onAction={onAction} /> : null}
          {data.attribution ? (
            <span className="editorial-attribution">
              <SafeRichText html={text(data.attribution)} />
            </span>
          ) : null}
        </figcaption>
      ) : null}
    </figure>
  )
}

function Carousel({ storyNode }: { storyNode: StoryNode }) {
  return (
    <StoryCarousel
      items={(storyNode.children ?? []).map((id) => (
        <StoryBlock key={id} id={id} />
      ))}
    />
  )
}

function MapBlock({ id }: { id: string }) {
  const { document, actions } = useStory()
  const data = node(document, id).data ?? {}
  return <EditorialMap resource={resource(document, data.map)} override={{ ...data, ...actions[id] }} />
}
function SwipeBlock({ id }: { id: string }) {
  const { document } = useStory()
  const contents = record(node(document, id).data?.contents)
  const left = node(document, contents['0']).data ?? {},
    right = node(document, contents['1']).data ?? {}
  return (
    <EditorialSwipe
      left={resource(document, left.map)}
      right={resource(document, right.map)}
      leftOverride={left}
      rightOverride={right}
      leftLabel={plain(left.caption) || 'Earlier map'}
      rightLabel={plain(right.caption) || 'Current map'}
    />
  )
}

function Immersive({ id, storyNode }: { id: string; storyNode: StoryNode }) {
  const { document, scrollRoot } = useStory()
  const basemap = useContext(EditorialBasemapContext)
  const slides = (storyNode.children ?? []).map((id) => {
    const slide = node(document, id)
    const panel = slide.children?.find((id) => node(document, id).type === 'immersive-narrative-panel')
    const media = slide.children?.find((id) => node(document, id).type !== 'immersive-narrative-panel')
    return {
      id,
      content: panel && <StoryBlock id={panel} />,
      media: media && <StoryBlock id={media} />,
      preload:
        media && node(document, media).type === 'webmap'
          ? () => warmEditorialMap(resource(document, node(document, media).data?.map), basemap)
          : undefined,
      imageUrl:
        media && node(document, media).type === 'image'
          ? resourceUrl(document, node(document, media).data?.image)
          : undefined,
    }
  })
  return (
    <StorySidecar
      id={id}
      slides={slides}
      scrollRoot={scrollRoot}
      variant={storyNode.data?.subtype === 'floating-panel' ? 'floating' : 'docked'}
      side={
        storyNode.data?.narrativePanelPosition === 'center'
          ? 'center'
          : storyNode.data?.narrativePanelPosition === 'end'
            ? 'right'
            : 'left'
      }
      width={storyNode.data?.narrativePanelSize === 'large' ? 'large' : 'medium'}
    />
  )
}

function Tour({ id, storyNode }: { id: string; storyNode: StoryNode }) {
  const { document, scrollRoot } = useStory()
  const data = storyNode.data ?? {},
    places = array(data.places)
  const mapData = node(document, data.map).data ?? {}
  const geometries = record(mapData.geometries)
  const points = places.flatMap((place, index) => {
    const point = array(record(geometries[text(place.featureId)]).nodes)[0]
    return point && typeof point.long === 'number' && typeof point.lat === 'number'
      ? [
          {
            id: text(place.featureId),
            coordinates: [point.long, point.lat] as [number, number],
            label: `${index + 1}`,
            scale: Number(record(geometries[text(place.featureId)]).scale ?? mapData.defaultScale) || undefined,
          },
        ]
      : []
  })
  const stops = places.map((place) => ({
    id: text(place.id),
    media: <StoryBlock id={text(place.media)} />,
    content: (
      <>
        <StoryBlock id={text(place.title)} />
        {(Array.isArray(place.contents) ? place.contents : []).map((id) => (
          <StoryBlock key={text(id)} id={text(id)} />
        ))}
      </>
    ),
  }))
  return (
    <StoryTour
      id={id}
      stops={stops}
      scrollRoot={scrollRoot}
      renderMap={(active, select) => (
        <EditorialMap
          resource={resource(document, record(mapData.basemap).value)}
          override={mapData}
          tourPoints={points}
          activeTourPoint={text(places[active]?.featureId)}
          onSelectTourPoint={(id) => select(places.findIndex((place) => place.featureId === id))}
        />
      )}
    />
  )
}

function Cover({ storyNode }: { storyNode: StoryNode }) {
  const { document } = useStory()
  const data = storyNode.data ?? {},
    video = node(document, storyNode.children?.[0]).data ?? {}
  return (
    <StoryCover
      title={text(data.title)}
      summary={text(data.summary)}
      byline={text(data.byline)}
      video={resourceUrl(document, video.video)}
      poster={resourceUrl(document, video.thumbnail)}
    />
  )
}

function PublisherCredit() {
  const { document } = useStory()
  const root = node(document, document.root)
  const theme = record(resource(document, root.data?.storyTheme).theme)
  const logo = record(theme.logo)
  const data = record(record(record(theme.resources)[text(logo.resource)]).data)
  const src = safeLink(data.url)
  if (!src) return null
  return (
    <div className="editorial-publisher-credit">
      <a href={safeLink(logo.link)} target="_blank" rel="noopener noreferrer">
        <img src={src} alt={text(logo.alt) || 'Story publisher'} />
      </a>
    </div>
  )
}

function StoryBlock({ id }: { id: string }) {
  const { document, onAction } = useStory()
  const storyNode = node(document, id),
    data = storyNode.data ?? {}
  switch (storyNode.type) {
    case 'text': {
      const rich = <SafeRichText html={text(data.text)} onAction={onAction} />
      const props = { id, className: `editorial-text editorial-${text(data.type)}` }
      if (data.type === 'h2')
        return (
          <h2 {...props} data-story-section>
            {rich}
          </h2>
        )
      if (data.type === 'h3') return <h3 {...props}>{rich}</h3>
      if (data.type === 'h4') return <h4 {...props}>{rich}</h4>
      if (data.type === 'quote') return <blockquote {...props}>{rich}</blockquote>
      if (data.type === 'bullet-list') return <ul {...props}>{rich}</ul>
      return <p {...props}>{rich}</p>
    }
    case 'image':
      return <StoryImage storyNode={storyNode} />
    case 'carousel':
      return <Carousel storyNode={storyNode} />
    case 'storycover':
      return <Cover storyNode={storyNode} />
    case 'separator':
      return <div className="editorial-separator" role="separator" />
    case 'immersive':
      return <Immersive id={id} storyNode={storyNode} />
    case 'tour':
      return <Tour id={id} storyNode={storyNode} />
    case 'webmap':
      return <MapBlock id={id} />
    case 'swipe':
      return <SwipeBlock id={id} />
    case 'button':
      return (
        <div className="editorial-button-row">
          <a className="editorial-button" href={safeLink(data.link)} target="_blank" rel="noopener noreferrer">
            {text(data.text)}
          </a>
        </div>
      )
    case 'attribution':
      return (
        <div className="editorial-credit">
          <SafeRichText html={text(data.content)} />
          <SafeRichText html={text(data.attribution)} />
        </div>
      )
    case 'credits':
      return (
        <footer className="editorial-credits">
          <PublisherCredit />
          {storyNode.children?.map((id) => (
            <StoryBlock key={id} id={id} />
          ))}
        </footer>
      )
    case 'immersive-narrative-panel':
      return (
        <>
          {storyNode.children?.map((id) => (
            <StoryBlock key={id} id={id} />
          ))}
        </>
      )
    default:
      return null
  }
}

export default function EditorialStory({
  project,
  onBack,
  documentUrl,
}: {
  project: ProjectPackage
  onBack: () => void
  documentUrl: string
}) {
  const [document, setDocument] = useState<StoryDocument | null>(null)
  const [error, setError] = useState('')
  const [actions, setActions] = useState<Record<string, Data>>({})
  const scrollRoot = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const controller = new AbortController()
    fetch(documentUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Story document could not be loaded.')
        return response.json()
      })
      .then(readDocument)
      .then(setDocument)
      .catch((error) => {
        if (error.name !== 'AbortError') setError(error.message)
      })
    return () => controller.abort()
  }, [documentUrl])
  const onAction = useCallback(
    (id: string) => {
      const action = document?.actions?.find((action) => action.data.actionId === id)
      if (action) setActions((previous) => ({ ...previous, [action.target]: action.data.mapData }))
    },
    [document],
  )
  const value = document ? { document, scrollRoot, onAction, actions } : null
  const root = document ? node(document, document.root) : undefined
  const navigation = document
    ? (root?.children ?? []).map((id) => node(document, id)).find((node) => node.type === 'navigation')
    : undefined
  const links = array(navigation?.data?.links)
  const theme = document ? record(resource(document, root?.data?.storyTheme).theme) : {}
  useStoryFonts(array(theme.localFonts).filter((font) => typeof font.url === 'string') as unknown as StoryFontFace[])
  if (!value || !document)
    return (
      <div className="editorial-loading" role="status">
        {error || 'Loading story…'}
      </div>
    )
  return (
    <EditorialBasemapContext.Provider
      value={project.workspace?.type === 'story-map' ? (project.workspace.document?.basemap ?? 'source') : 'source'}
    >
      <StoryContext.Provider value={value}>
        <EditorialShell
          title={project.title}
          onBack={onBack}
          scrollRoot={scrollRoot}
          sectionUrl={project.workspace?.type === 'story-map' && project.workspace.options.sectionUrl}
          chapters={links.map((link) => ({
            id: text(link.nodeId),
            label: plain(node(document, link.nodeId).data?.text),
          }))}
          cover={(root?.children ?? [])
            .filter((id) => node(document, id).type === 'storycover')
            .map((id) => (
              <StoryBlock key={id} id={id} />
            ))}
        >
          {(root?.children ?? [])
            .filter((id) => !['navigation', 'storycover'].includes(node(document, id).type))
            .map((id) => (
              <StoryBlock key={id} id={id} />
            ))}
        </EditorialShell>
      </StoryContext.Provider>
    </EditorialBasemapContext.Provider>
  )
}
