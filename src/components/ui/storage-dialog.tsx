import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { PanelDialog } from '@/components/ui/dialog-shell'
import { insetBox } from '@/components/ui/inset-box'
import { InlineAlert } from '@/components/ui/map-panels'
import { formatBytes } from '@/lib/format'
import { inventoryCopiesEnabled, setInventoryCopies } from '@/lib/offline/inventoryCopies'
import {
  forgetOfflineTool,
  keepToolOffline,
  OFFLINE_TOOLS,
  offlineToolStatus,
  offlineToolSummary,
  type OfflineStatus,
  type OfflineToolId,
} from '@/lib/offline/offlineTools'
import {
  clearEntry,
  deleteOtherCache,
  measureEntry,
  otherStores,
  presentStores,
  protectStorage,
  storageOverview,
  type StorageOverview,
  type StoreSize,
} from '@/lib/storage/browserStorage'
import { cataloguedNames, STORAGE_PRESSURE_SHARE, STORE_CATALOGUE, type StoreEntry } from '@/lib/storage/siteStorage'
import { cn } from '@/lib/utils'

/**
 * What PGMaps keeps in this browser, and the controls over it (docs/shared-ui.md, **Storage
 * dialog**): how much room the site uses, which tools are kept for offline use, what was
 * downloaded and can be cleared, and what is a person's own work. Work is listed and sized here
 * and removed only in the tool that made it.
 */
export interface StorageDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The button that opens it, so focus returns there on close. */
  trigger?: ReactNode
}

type Present = Awaited<ReturnType<typeof presentStores>>
type Other = Awaited<ReturnType<typeof otherStores>>

const DOWNLOADS = STORE_CATALOGUE.filter((entry) => entry.role === 'download')
const WORK = STORE_CATALOGUE.filter((entry) => entry.role === 'work')
const TOOL_IDS = OFFLINE_TOOLS.map((tool) => tool.id)

const sizeText = (size: StoreSize | undefined) =>
  size === undefined
    ? 'Measuring…'
    : size.bytes === null
      ? 'Size unknown'
      : size.bytes === 0 && size.items === 0
        ? 'Nothing kept'
        : formatBytes(size.bytes)

const filesText = (size: StoreSize | undefined) =>
  size === undefined || size.items === 0
    ? null
    : `${size.items.toLocaleString()} ${size.items === 1 ? 'file' : 'files'}`

function SectionHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children && <p className="text-xs text-muted-foreground">{children}</p>}
    </div>
  )
}

function Row({
  label,
  detail,
  value,
  sub,
  action,
  below,
}: {
  label: ReactNode
  detail: ReactNode
  value?: ReactNode
  sub?: ReactNode
  action?: ReactNode
  below?: ReactNode
}) {
  return (
    <li className="px-3 py-2.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">{detail}</p>
        </div>
        {(value || sub) && (
          <div className="shrink-0 text-right">
            <p className="text-sm tabular-nums">{value}</p>
            {sub && <p className="text-xs tabular-nums text-muted-foreground">{sub}</p>}
          </div>
        )}
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {below}
    </li>
  )
}

export function StorageDialog({ open, onOpenChange, trigger }: StorageDialogProps) {
  const [overview, setOverview] = useState<StorageOverview | null>(null)
  const [present, setPresent] = useState<Present | null>(null)
  const [sizes, setSizes] = useState<Record<string, StoreSize>>({})
  const [other, setOther] = useState<Other | null>(null)
  const [offline, setOffline] = useState<OfflineStatus | null | undefined>(undefined)
  // The row whose Clear was pressed once: it shows what clearing costs before it does it.
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  // Whether visual quality keeps dated copies of its inventory reads; null until read.
  const [copies, setCopies] = useState<boolean | null>(null)
  const run = useRef(0)

  const refresh = useCallback(async () => {
    const mine = ++run.current
    const current = () => run.current === mine
    const [nextOverview, nextPresent] = await Promise.all([storageOverview(), presentStores()])
    if (!current()) return
    setOverview(nextOverview)
    setPresent(nextPresent)
    setSizes({})
    void offlineToolStatus(TOOL_IDS, undefined, 4000).then((status) => current() && setOffline(status))
    void inventoryCopiesEnabled().then((on) => current() && setCopies(on))
    // One entry at a time: a road project's terrain is megabytes to walk, and the list fills as it goes.
    for (const entry of STORE_CATALOGUE) {
      const size = await measureEntry(entry, nextPresent)
      if (!current()) return
      setSizes((before) => ({ ...before, [entry.id]: size }))
    }
    const rest = await otherStores(nextPresent)
    if (current()) setOther(rest)
  }, [])

  useEffect(() => {
    if (!open) {
      run.current++
      return
    }
    // After this render, not during it: measuring sets state as each store is read.
    const timer = setTimeout(() => void refresh(), 0)
    return () => clearTimeout(timer)
  }, [open, refresh])

  const act = async (id: string, work: () => Promise<unknown>) => {
    setBusy(id)
    setConfirming(null)
    setError('')
    try {
      await work()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
    setBusy(null)
    await refresh()
  }

  const clear = (entry: StoreEntry) =>
    act(entry.id, () => clearEntry(entry, present ?? { caches: [], databases: null }))

  const setTool = (tool: OfflineToolId, keep: boolean) =>
    act(`tool:${tool}`, async () => {
      const status = keep ? await keepToolOffline(tool) : await forgetOfflineTool(tool)
      if (!status) throw new Error(keep ? 'The files could not be fetched. Check the connection.' : 'Nothing changed.')
    })

  const cleared = (entry: StoreEntry) => sizes[entry.id]?.items === 0
  const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine
  const pressured = overview?.share != null && overview.share >= STORAGE_PRESSURE_SHARE
  const noWorker = offline === null || (offline != null && !offline.build)

  return (
    <PanelDialog
      open={open}
      onOpenChange={onOpenChange}
      trigger={trigger}
      size="md"
      title="Offline and storage"
      subtitle="What PGMaps keeps in this browser."
      contentProps={{ 'data-testid': 'storage-dialog' }}
    >
      <div className="space-y-5">
        {error && <InlineAlert tone="error">{error}</InlineAlert>}

        <section aria-label="Storage in use">
          <div className={insetBox({ padding: 'lg' })}>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-medium" data-testid="storage-usage">
                {overview === null
                  ? 'Measuring…'
                  : overview.usage === null
                    ? 'This browser does not report how much is used.'
                    : `${formatBytes(overview.usage)} used${overview.quota ? ` of ${formatBytes(overview.quota)} allowed` : ''}`}
              </p>
              {overview?.share != null && (
                <p className="text-xs tabular-nums text-muted-foreground">
                  {overview.share < 0.001 ? 'under 0.1%' : `${(overview.share * 100).toFixed(1)}%`}
                </p>
              )}
            </div>
            {overview?.share != null && (
              <div
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
                role="meter"
                aria-label="Share of the browser's allowance in use"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(overview.share * 100)}
              >
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.max(1, overview.share * 100)}%` }}
                />
              </div>
            )}
            {overview && (
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground" data-testid="storage-protection">
                  {overview.persisted === true
                    ? 'Protected: the browser will not clear this site on its own.'
                    : overview.canPersist
                      ? 'Not protected: the browser may clear this site, your projects included, when the disk fills.'
                      : 'This browser cannot be asked to protect what is kept here.'}
                </p>
                {overview.persisted !== true && overview.canPersist && (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() =>
                      act('protect', async () => {
                        if (!(await protectStorage()))
                          throw new Error(
                            'The browser declined. It usually agrees once the site is installed or used often.',
                          )
                      })
                    }
                  >
                    Protect
                  </Button>
                )}
              </div>
            )}
          </div>
          {pressured && (
            <InlineAlert tone="warning" className="mt-2">
              Nearly full. Map tiles and data files are being given up to keep room for your work; clear what you do not
              need below.
            </InlineAlert>
          )}
        </section>

        <section aria-label="Offline tools">
          <SectionHeading title="Offline tools">
            Kept tools open with no network, and each new version is fetched for them.
          </SectionHeading>
          {noWorker ? (
            <InlineAlert>
              Not available here: this copy of the site runs without its offline worker (a development or restricted
              browser).
            </InlineAlert>
          ) : (
            <ul className={cn(insetBox({ padding: 'none' }), 'divide-y')}>
              {OFFLINE_TOOLS.map((tool) => {
                const group = offline?.groups[tool.id]
                const id = `tool:${tool.id}`
                return (
                  <Row
                    key={tool.id}
                    label={tool.label}
                    detail={tool.limits}
                    value={
                      <span data-testid={`offline-${tool.id}`}>
                        {offline === undefined ? 'Checking…' : offlineToolSummary(offline, tool.id)}
                      </span>
                    }
                    sub={group ? formatBytes(group.bytes) : null}
                    action={
                      group?.kept ? (
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={busy !== null}
                          onClick={() => void setTool(tool.id, false)}
                        >
                          {busy === id ? 'Removing…' : 'Remove'}
                        </Button>
                      ) : (
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={busy !== null || offline === undefined || !isOnline}
                          onClick={() => void setTool(tool.id, true)}
                        >
                          {busy === id ? 'Fetching…' : 'Keep offline'}
                        </Button>
                      )
                    }
                  />
                )
              })}
            </ul>
          )}
        </section>

        <section aria-label="Inventory copies">
          <SectionHeading title="Inventory copies">
            Visual quality reads the BC inventories live. This is the one way it may use a copy instead.
          </SectionHeading>
          <ul className={cn(insetBox({ padding: 'none' }), 'divide-y')}>
            <Row
              label="Keep inventory copies"
              detail={
                copies
                  ? 'Each read is kept with its date. When DataBC cannot be reached, the copy of the same read is used and the page says so, with that date. Turning this off deletes the copies.'
                  : 'Off: nothing is kept, and a read DataBC cannot answer is an error. On: each read is kept with its date and used only when DataBC cannot be reached.'
              }
              value={
                <span data-testid="inventory-copies-state">
                  {copies === null ? 'Checking…' : copies ? 'On' : 'Off'}
                </span>
              }
              action={
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy !== null || copies === null}
                  aria-pressed={copies === true}
                  onClick={() => void act('inventory-copies', () => setInventoryCopies(!copies))}
                >
                  {copies ? 'Turn off' : 'Turn on'}
                </Button>
              }
            />
          </ul>
        </section>

        <section aria-label="Downloaded and cached">
          <SectionHeading title="Downloaded and cached">
            Fetched or worked out for you. Clearing one loses nothing of yours.
          </SectionHeading>
          <ul className={cn(insetBox({ padding: 'none' }), 'divide-y')}>
            {DOWNLOADS.map((entry) => (
              <Row
                key={entry.id}
                label={entry.label}
                detail={entry.detail}
                value={<span data-testid={`size-${entry.id}`}>{sizeText(sizes[entry.id])}</span>}
                sub={filesText(sizes[entry.id])}
                action={
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy !== null || sizes[entry.id] === undefined || cleared(entry)}
                    onClick={() => setConfirming(confirming === entry.id ? null : entry.id)}
                    aria-expanded={confirming === entry.id}
                  >
                    {busy === entry.id ? 'Clearing…' : 'Clear'}
                  </Button>
                }
                below={
                  confirming === entry.id && (
                    <div className="mt-2 flex items-center justify-between gap-3 rounded-md border border-warning-border bg-warning-surface px-2.5 py-2 text-xs text-warning-foreground">
                      <p>
                        {entry.note}
                        {!isOnline && ' You are offline now, so it cannot be fetched again until you are back.'}
                      </p>
                      <div className="flex shrink-0 gap-1.5">
                        <Button size="xs" variant="ghost" onClick={() => setConfirming(null)}>
                          Keep
                        </Button>
                        <Button size="xs" variant="destructive" onClick={() => void clear(entry)}>
                          Clear {sizes[entry.id]?.bytes ? formatBytes(sizes[entry.id].bytes) : ''}
                        </Button>
                      </div>
                    </div>
                  )
                }
              />
            ))}
          </ul>
        </section>

        <section aria-label="Your work">
          <SectionHeading title="Your work">
            Kept only in this browser. Nothing here is removed from this panel; save a project file to keep a copy.
          </SectionHeading>
          <ul className={cn(insetBox({ padding: 'none' }), 'divide-y')}>
            {WORK.map((entry) => (
              <Row
                key={entry.id}
                label={
                  entry.href ? (
                    <a
                      href={`${import.meta.env.BASE_URL}${entry.href.replace(/^\//, '')}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {entry.label}
                    </a>
                  ) : (
                    entry.label
                  )
                }
                detail={`${entry.detail} ${entry.note}`}
                value={<span data-testid={`size-${entry.id}`}>{sizeText(sizes[entry.id])}</span>}
              />
            ))}
          </ul>
        </section>

        {other && (other.caches.length > 0 || other.databases.length > 0) && (
          <section aria-label="Other">
            <SectionHeading title="Other">
              Kept by a library or an earlier version of the site, and not on PGMaps’ own list.
            </SectionHeading>
            <ul className={cn(insetBox({ padding: 'none' }), 'divide-y')}>
              {other.caches.map((cache) => (
                <Row
                  key={`cache:${cache.name}`}
                  label={cache.name}
                  detail="A cache."
                  value={sizeText(cache)}
                  sub={filesText(cache)}
                  action={
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() =>
                        void act(`other:${cache.name}`, () => deleteOtherCache(cache.name, cataloguedNames().caches))
                      }
                    >
                      Clear
                    </Button>
                  }
                />
              ))}
              {other.databases.map((name) => (
                <Row
                  key={`db:${name}`}
                  label={name}
                  detail="A database. It may hold work, so it is not cleared here."
                />
              ))}
            </ul>
          </section>
        )}
      </div>
    </PanelDialog>
  )
}
