import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert, SearchInput } from '@/components/ui/map-panels'
import { RecordDialog } from '@/components/ui/record-dialog'
import { ResultRow, ListHeader } from '@/components/ui/result-list'
import { ExternalLink } from '@/components/ui/text-button'
import { fetchJson } from '@/lib/fetchJson'
import { withBase } from '@/lib/dataUrl'
import { formatBytes } from '@/lib/format'
import { checkedPortalAttributes, errorText, NECHAKO_PORTAL } from '@/lib/nechakoPortal'
import { downloadText } from '@/lib/download'
import { importWorkspace, type Workspace } from './data/workspace'
import { collectionSourceUrl } from './data/portalCollections'
import { SHOWCASE_BASE } from './data/showcase'

export type PublicProjectIndex = {
  schema: 'nechako-public-projects-v1'
  capturedAt: string
  source: string
  access: 'anonymous'
  projects: { id: number; name: string; file: string; bytes: number; layerCount: number; savedAt: string }[]
}

/** Read stored anonymous project definitions; external GIS and imagery remain at their sources. */
export function PortalPublicProjects({
  onWorkspace,
  initialProjectId,
  detailsOnly = false,
  onCloseProject,
}: {
  onWorkspace: (workspace: Workspace) => void
  initialProjectId?: number
  detailsOnly?: boolean
  onCloseProject?: () => void
}) {
  const [index, setIndex] = useState<PublicProjectIndex>()
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [retry, setRetry] = useState(0)
  const [selected, setSelected] = useState<number | undefined>(initialProjectId)
  const [loaded, setLoaded] = useState<{
    data: unknown
    text: string
    workspace: Workspace
    description: string
    links: string[]
    images: { src: string; alt: string; embedded: boolean }[]
  }>()
  const [loading, setLoading] = useState(!!initialProjectId)
  useEffect(() => {
    const controller = new AbortController()
    fetchJson<PublicProjectIndex>(`${SHOWCASE_BASE}public-projects/index.json`, controller.signal)
      .then(setIndex)
      .catch((reason) => {
        if (!controller.signal.aborted) setError(errorText(reason))
      })
    return () => controller.abort()
  }, [retry])
  const project = index?.projects.find((item) => item.id === selected)
  useEffect(() => {
    if (!project) return
    const controller = new AbortController()
    fetch(withBase(`${SHOWCASE_BASE}${project.file}`), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Project snapshot HTTP ${response.status}`)
        const text = await response.text()
        if (new TextEncoder().encode(text).byteLength !== project.bytes)
          throw new Error('Project snapshot byte count does not match its source manifest.')
        const data: unknown = JSON.parse(text)
        const attributes = checkedPortalAttributes(data) as Record<string, unknown>
        if (
          !attributes ||
          String(attributes.projectId) !== String(project.id) ||
          (data as { loggedIn?: boolean }).loggedIn !== false
        )
          throw new Error('Project snapshot does not match its anonymous source record.')
        const workspace = importWorkspace(data)
        const markup = String(attributes.projectDescription || '')
        // Never insert source HTML. Extract text, safe links and raster images separately.
        const document = new DOMParser().parseFromString(markup, 'text/html')
        document.querySelectorAll('script,style,iframe').forEach((node) => node.remove())
        const links = Array.from(document.querySelectorAll('a[href]')).flatMap((anchor) => {
          const href = collectionSourceUrl(anchor.getAttribute('href'))
          return href ? [href] : []
        })
        const images = Array.from(document.querySelectorAll('img[src]')).flatMap((image) => {
          const raw = image.getAttribute('src') || ''
          const embedded = /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(raw)
          let src: string | undefined
          if (embedded && raw.length <= 20 * 1024 * 1024) src = raw
          else if (!raw.startsWith('data:')) {
            try {
              src = collectionSourceUrl(new URL(raw, NECHAKO_PORTAL).href)
            } catch {
              /* Invalid source URL. */
            }
          }
          return src ? [{ src, alt: image.getAttribute('alt') || 'Original project illustration', embedded }] : []
        })
        document.querySelectorAll('p,div,h1,h2,h3,h4,li,br').forEach((node) => node.append('\n'))
        if (!controller.signal.aborted)
          setLoaded({
            data,
            text,
            workspace,
            description: (document.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim(),
            links: [...new Set(links)],
            images,
          })
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(errorText(reason))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [project])
  const matching = useMemo(
    () =>
      index?.projects.filter((item) => `${item.id} ${item.name}`.toLowerCase().includes(query.trim().toLowerCase())) ||
      [],
    [index, query],
  )
  return (
    <div className="space-y-4" data-nechako-public-projects>
      {!detailsOnly && (
        <>
          <h2 className="text-xl font-semibold">Public projects people have made</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Open real saved map definitions captured from the original portal without login. Each retains its camera,
            layer choices and original metadata. Raster imagery, GIS data and linked files remain live at their sources.
          </p>
          {index && (
            <p className="text-xs text-muted-foreground">
              {index.projects.length} anonymous projects · captured {index.capturedAt.slice(0, 10)} ·{' '}
              {formatBytes(index.projects.reduce((sum, item) => sum + item.bytes, 0))} of decoded map-definition JSON.
              This is {index.projects.reduce((sum, item) => sum + item.bytes, 0).toLocaleString('en-CA')} bytes,
              excluding the catalogue. Underlying GIS storage is unmeasured.
            </p>
          )}
          {error && (
            <InlineAlert tone="error">
              {error}
              <Button
                className="ml-2"
                variant="outline"
                size="sm"
                onClick={() => {
                  setError('')
                  setRetry((value) => value + 1)
                }}
              >
                Retry project catalogue
              </Button>
            </InlineAlert>
          )}
          {!index && !error && <InlineAlert loading>Loading public project definitions…</InlineAlert>}
          <SearchInput
            aria-label="Search public saved projects"
            placeholder="Project title or original ID"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onClear={() => setQuery('')}
          />
          <ListHeader count={matching.length} noun={['public project', 'public projects']} sticky={false} />
          <div className="max-h-80 overflow-y-auto rounded-lg border">
            {matching.map((item) => (
              <ResultRow
                key={item.id}
                title={item.name}
                subtitle={`${item.layerCount} source layer references · ${formatBytes(item.bytes)} map definition`}
                meta={`Portal project ${item.id} · saved ${item.savedAt.slice(0, 10)}`}
                onClick={() => {
                  setLoaded(undefined)
                  setLoading(true)
                  setError('')
                  setSelected(item.id)
                }}
              />
            ))}
          </div>
        </>
      )}
      <RecordDialog
        open={!!project}
        onClose={() => {
          setSelected(undefined)
          setLoaded(undefined)
          setError('')
          setLoading(false)
          onCloseProject?.()
        }}
        title={project?.name || 'Saved project'}
        subtitle={project ? `Original public project ${project.id}` : undefined}
        source="Original portal · anonymous capture"
        sourceHref={NECHAKO_PORTAL}
      >
        {loading && <InlineAlert loading>Reading the original project definition…</InlineAlert>}
        {error && <InlineAlert tone="error">{error}</InlineAlert>}
        {loaded && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => onWorkspace(loaded.workspace)}>Load this public project on map</Button>
              <Button
                variant="outline"
                onClick={() =>
                  downloadText(loaded.text, `portal-project-${project!.id}-original.json`, 'application/json')
                }
              >
                Download original project JSON
              </Button>
            </div>
            <p className="text-sm">
              {loaded.workspace.layers.length} WMS layers · {loaded.workspace.vectors.length} vectors ·{' '}
              {loaded.workspace.tiles.length} HTTPS tile layers. {formatBytes(project!.bytes)} (
              {project!.bytes.toLocaleString('en-CA')} bytes) original JSON; underlying GIS file sizes are unknown.
            </p>
            {loaded.workspace.layers.length + loaded.workspace.tiles.length + loaded.workspace.vectors.length <
              project!.layerCount && (
              <InlineAlert tone="warning">
                {loaded.workspace.layers.length + loaded.workspace.tiles.length + loaded.workspace.vectors.length} of{' '}
                {project!.layerCount} source layer references can be loaded here. Some original layers use HTTP tile
                URLs, omit a WMS endpoint, or have no layer name. Review the conversion notes below; the complete source
                definition is retained in the JSON download.
              </InlineAlert>
            )}
            <p className="whitespace-pre-wrap text-sm leading-6">
              {loaded.description || 'The source supplies no description.'}
            </p>
            {loaded.links.map((url) => (
              <ExternalLink key={url} href={url} className="block break-all text-sm">
                {url}
              </ExternalLink>
            ))}
            {loaded.images.length > 0 && (
              <div className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  {loaded.images.length} original illustrations. Embedded images are included in the JSON byte count;
                  linked images load from the original portal and their file sizes are unknown.
                </p>
                {loaded.images.map((image, i) => (
                  <figure key={i} className="space-y-2 rounded-lg border p-3">
                    <img
                      src={image.src}
                      alt={image.alt}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="h-auto max-h-[32rem] max-w-full object-contain"
                      onError={(event) => {
                        event.currentTarget.hidden = true
                      }}
                    />
                    <figcaption className="text-xs text-muted-foreground">
                      {image.alt} ·{' '}
                      {image.embedded ? (
                        'Embedded in original project JSON'
                      ) : (
                        <ExternalLink href={image.src}>View linked source image</ExternalLink>
                      )}
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
            <details>
              <summary className="cursor-pointer font-medium">Source layers and conversion notes</summary>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-xs leading-5">
                {loaded.workspace.warnings.map((warning, i) => (
                  <li key={`warning-${i}`}>{warning}</li>
                ))}
                {loaded.workspace.layers.map((layer) => (
                  <li key={layer.id}>
                    {layer.layer.title} · {layer.visible === false ? 'off' : 'on'} ·{' '}
                    {layer.style || 'service default style'}
                  </li>
                ))}
                {loaded.workspace.tiles.map((tile) => (
                  <li key={tile.id}>
                    {tile.name} · {tile.visible ? 'on' : 'off'}
                  </li>
                ))}
                {loaded.workspace.vectors.map((vector) => (
                  <li key={vector.id}>
                    {vector.name} · {vector.data.features.length} features
                  </li>
                ))}
              </ul>
            </details>
          </div>
        )}
      </RecordDialog>
    </div>
  )
}
