import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { StatGroup } from '@/components/ui/stat-group'
import { fetchJson } from '@/lib/fetchJson'
import { withBase } from '@/lib/dataUrl'
import { formatBytes } from '@/lib/format'
import { errorText } from '@/lib/nechakoPortal'
import { importWorkspace, type Workspace } from './data/workspace'
import { SHOWCASE_BASE, type ShowcaseAttachment, type ShowcaseManifest } from './data/showcase'

export function PortalShowcase({
  onView,
  onWorkspace,
}: {
  onView: (view: 'research' | 'research-map' | 'layers' | 'files') => void
  onWorkspace: (workspace: Workspace) => void
}) {
  const [data, setData] = useState<{ manifest: ShowcaseManifest; attachments: ShowcaseAttachment[] }>()
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [loadingWorkspace, setLoadingWorkspace] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      fetchJson<ShowcaseManifest>(`${SHOWCASE_BASE}manifest.json`, controller.signal),
      fetchJson<ShowcaseAttachment[]>(`${SHOWCASE_BASE}attachments.json`, controller.signal),
    ])
      .then(([manifest, attachments]) => setData({ manifest, attachments }))
      .catch((reason) => {
        if (!controller.signal.aborted) setError(errorText(reason))
      })
    return () => controller.abort()
  }, [retry])
  const loadWorkspace = async () => {
    setLoadingWorkspace(true)
    setError('')
    try {
      const workspace = importWorkspace(await fetchJson(`${SHOWCASE_BASE}research-workspace.json`))
      onWorkspace(workspace)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setLoadingWorkspace(false)
    }
  }
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Repository data showcase</h2>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          Test the public research collection and saved service definitions using data bundled with PGMaps. Research
          browsing and catalogue inspection use local files. Map imagery and external articles use their live sources.
        </p>
      </div>
      {error && (
        <InlineAlert tone="error">
          {error}
          <Button
            variant="outline"
            size="sm"
            className="ml-2"
            onClick={() => {
              setError('')
              setRetry((value) => value + 1)
            }}
          >
            Retry showcase
          </Button>
        </InlineAlert>
      )}
      {!data && !error && <InlineAlert loading>Loading the bundled showcase…</InlineAlert>}
      {data && (
        <>
          <StatGroup
            variant="tiles"
            columns={4}
            items={[
              { label: 'Research records', value: data.manifest.counts.research_records.toLocaleString() },
              { label: 'Location IDs', value: data.manifest.counts.location_ids },
              { label: 'WMS services', value: data.manifest.counts.wms_services },
              { label: 'Named layers / groups', value: data.manifest.counts.named_layers },
            ]}
          />
          <p className="text-sm text-muted-foreground">
            Captured {new Date(data.manifest.captured_at_utc).toLocaleDateString()} ·{' '}
            {formatBytes(data.manifest.snapshot_file_bytes)} of bundled data, excluding this manifest ·{' '}
            {data.manifest.counts.attachment_links} attachment links
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => onView('research')}>Browse bundled research</Button>
            <Button onClick={() => onView('research-map')}>Open research map and timeline</Button>
            <Button disabled={loadingWorkspace} onClick={() => void loadWorkspace()}>
              {loadingWorkspace ? 'Loading locations…' : 'Load research locations on map'}
            </Button>
            <Button variant="outline" onClick={() => onView('layers')}>
              Explore bundled WMS catalogue
            </Button>
            <Button variant="outline" onClick={() => onView('files')}>
              Test file imports and previews
            </Button>
          </div>
          <InlineAlert>
            The location workspace contains {data.manifest.counts.mapped_locations} source reference points; regional
            aggregate tags are excluded. {data.manifest.counts.unmapped_records} records have no location tags. This is
            a research showcase workspace, not an exported saved portal project.
          </InlineAlert>
          <div className="space-y-3 rounded-lg border p-4">
            <h3 className="font-semibold">Public attachment links ({data.attachments.length})</h3>
            <p className="text-sm text-muted-foreground">
              These Zotero entries link to HTML articles. PDFs, videos and private portal attachments have not been
              copied into this snapshot; their total storage is unknown. Research IDs and Zotero keys have no verified
              crosswalk.
            </p>
            {data.attachments.map((attachment) => (
              <div
                key={attachment.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
              >
                <div className="min-w-0 text-sm">
                  <p>
                    {attachment.title} · {attachment.id}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {attachment.content_type} · {formatBytes(attachment.size_bytes)}
                  </p>
                </div>
                <a href={attachment.url} target="_blank" rel="noreferrer" className="text-sm text-primary underline">
                  Open article
                </a>
              </div>
            ))}
          </div>
          <details className="rounded-lg border p-4">
            <summary className="cursor-pointer font-medium">
              Bundled files and source attribution ({data.manifest.files.length})
            </summary>
            <p className="my-3 text-sm text-muted-foreground">{data.manifest.attribution}</p>
            <a href={withBase(`${SHOWCASE_BASE}manifest.json`)} download className="text-sm text-primary underline">
              Download snapshot manifest
            </a>
            <ul className="mt-3 space-y-2">
              {data.manifest.files.map((file) => (
                <li key={file.path} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <a
                    href={withBase(`${SHOWCASE_BASE}${file.path}`)}
                    download
                    className="break-all text-primary underline"
                  >
                    {file.path}
                  </a>
                  <span className="text-xs text-muted-foreground">{formatBytes(file.bytes)}</span>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </div>
  )
}
