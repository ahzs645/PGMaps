import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { InlineAlert } from '@/components/ui/map-panels'
import { RecordDialog } from '@/components/ui/record-dialog'
import { TabBar } from '@/components/ui/tab-bar'
import { downloadBlob } from '@/lib/download'
import {
  NECHAKO_PORTAL,
  PORTAL_CONNECTION_EVENT,
  errorText,
  getPortalConnectionMode,
  getPortalConnectionStatus,
  portalDownloadSubmission,
  portalRead,
  setPortalConnectionMode,
  type SubmissionDownloadMode,
} from '@/lib/nechakoPortal'
import { LocalPortalConnection } from './LocalPortalConnection'
import { PortalSubmissionLivePanel, refreshSubmissionLiveAfterConnection } from './PortalSubmissionLive'
import { PortalSubmissionReader } from './PortalSubmissionReader'
import { parseReviewForm, reviewObject, reviewText } from './data/submissionReview'
import type { SubmissionLiveRead } from './data/submissionLive'

const TABS = [
  { value: 'preview', label: 'Preview' },
  { value: 'general', label: 'General' },
  { value: 'permissions', label: 'Allowed Users' },
  { value: 'spatial', label: 'Spatial Data' },
  { value: 'attachments', label: 'Attachments' },
  { value: 'children', label: 'Child Submissions' },
  { value: 'history', label: 'History' },
  { value: 'export', label: 'Export' },
] as const
type Tab = (typeof TABS)[number]['value']
type Resource = 'preview' | 'spatial' | 'attachments'
type ResourceState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'loaded'; value: unknown }
export type SourceSubmissionState =
  | { status: 'idle'; message?: string }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; metadata: Record<string, unknown>; resources: Partial<Record<Resource, ResourceState>> }
const sourceId = (value: unknown) => /^[1-9]\d*$/.test(String(value)) && Number(value) <= 2147483647
export function checkedSourceSubmissionMetadata(value: unknown, id: string) {
  if (
    !sourceId(id) ||
    !reviewObject(value) ||
    value.sourceDenied === true ||
    value.success === false ||
    value.error ||
    (value.status !== undefined && value.status !== 'success') ||
    String(value.submission_id) !== id ||
    !sourceId(value.form_id)
  )
    throw new Error('The portal did not confirm access to the requested submission.')
  return value
}
/** Native DynamicNode indices restart after each static node, not at a global field ordinal. */
export function sourceSubmissionFields(original: unknown) {
  const parsed = parseReviewForm(original)
  if (!reviewObject(original) || !Array.isArray(original.nodes))
    throw new Error('The source form has no ordered node definition.')
  let index = 0
  const indices = new Map<string, number>()
  for (const node of original.nodes) {
    if (!reviewObject(node) || !reviewObject(node.nodeInfo)) throw new Error('The source form node is invalid.')
    if ([true, 1, '1', 'true', 't'].includes(node.nodeInfo.node_is_dynamic as string)) {
      if (!sourceId(node.field_id)) throw new Error('The source form field ID is invalid.')
      indices.set(String(node.field_id), index++)
    } else index = 0
  }
  return {
    parsed,
    fields: parsed.fields.map((field) => {
      if (!indices.has(field.id)) throw new Error('The source form omits a dynamic field definition.')
      return { ...field, index: indices.get(field.id)! }
    }),
  }
}

/** One source-only cohort. Metadata authorization precedes every resource read; no persistence or capture mutation. */
export class SourceSubmissionLoader {
  private generation = 0
  private requests = new Set<AbortController>()
  private resourceRequests = new Map<Resource, AbortController>()
  private id = ''
  private state: SourceSubmissionState = { status: 'idle' }
  constructor(
    private readonly read: SubmissionLiveRead,
    private readonly update: (state: SourceSubmissionState) => void,
  ) {}
  private emit(state: SourceSubmissionState) {
    this.state = state
    this.update(state)
  }
  cancel(message?: string, emit = true) {
    this.generation++
    for (const controller of this.requests) controller.abort()
    this.requests.clear()
    this.resourceRequests.clear()
    this.id = ''
    this.state = { status: 'idle', message }
    if (emit) this.update(this.state)
  }
  async open(id: string) {
    this.cancel(undefined, false)
    this.id = id
    const generation = this.generation,
      controller = new AbortController()
    this.requests.add(controller)
    this.emit({ status: 'loading' })
    try {
      if (!sourceId(id)) throw new Error('Enter a positive source submission ID.')
      const value = await this.read('rest/portal/getSubmissionMetadata.php', { submissionId: id }, controller.signal)
      if (generation !== this.generation || controller.signal.aborted) return
      const metadata = checkedSourceSubmissionMetadata(value, id)
      this.emit({ status: 'ready', metadata, resources: {} })
    } catch (reason) {
      if (generation === this.generation && !controller.signal.aborted)
        this.emit({ status: 'error', message: errorText(reason) })
    } finally {
      this.requests.delete(controller)
    }
  }
  /** Gate reusable live panels against this freshly authorized identity and source ID. */
  async authorizedRead(path: string, params: Record<string, string>, signal?: AbortSignal) {
    if (this.state.status !== 'ready' || !this.id) throw new Error('Check submission access before loading this tab.')
    const expectedKey = path.endsWith('/getHistory.php')
      ? 'sub_id'
      : path.endsWith('/getChildren.php')
        ? 'parentId'
        : 'submissionId'
    if (params[expectedKey] !== this.id) throw new Error('The requested resource does not belong to this submission.')
    if (signal?.aborted) throw new DOMException('Source access changed.', 'AbortError')
    const generation = this.generation,
      controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) controller.abort()
    this.requests.add(controller)
    try {
      const value = await this.read(path, params, controller.signal)
      if (generation !== this.generation || controller.signal.aborted || this.state.status !== 'ready')
        throw new DOMException('Source access changed.', 'AbortError')
      return value
    } finally {
      signal?.removeEventListener('abort', abort)
      this.requests.delete(controller)
    }
  }
  async loadResource(kind: Resource) {
    if (this.state.status !== 'ready') return
    this.resourceRequests.get(kind)?.abort()
    const controller = new AbortController(),
      generation = this.generation,
      id = this.id,
      metadata = this.state.metadata
    this.resourceRequests.set(kind, controller)
    this.requests.add(controller)
    const current = () =>
      generation === this.generation &&
      !controller.signal.aborted &&
      this.resourceRequests.get(kind) === controller &&
      this.state.status === 'ready'
    const write = (resource: ResourceState) => {
      if (current() && this.state.status === 'ready')
        this.emit({ ...this.state, resources: { ...this.state.resources, [kind]: resource } })
    }
    write({ status: 'loading' })
    try {
      let value: unknown
      if (kind === 'preview') {
        const formId = await this.read('rest/portal/getSubmissionForm.php', { submissionId: id }, controller.signal)
        if (!current()) return
        if (!sourceId(formId) || String(formId) !== String(metadata.form_id))
          throw new Error('The source form does not match the permitted submission.')
        const original = await this.read('rest/portal/getForm.php', { id: String(formId) }, controller.signal)
        if (!current()) return
        const { fields } = sourceSubmissionFields(original)
        const values: Record<string, { value?: unknown; error?: string }> = {}
        for (let start = 0; start < fields.length; start += 4) {
          if (!current()) return
          await Promise.all(
            fields.slice(start, start + 4).map(async (field) => {
              try {
                const returned = await this.read(
                  'rest/portal/getFieldValue.php',
                  { submissionId: id, fieldId: field.id, fieldIndex: String(field.index) },
                  controller.signal,
                )
                if (current()) values[field.id] = { value: returned }
              } catch (reason) {
                if (current()) values[field.id] = { error: errorText(reason) }
              }
            }),
          )
        }
        value = { schema: 'nechako-submission-read-v1', submissionId: id, form: original, values }
      } else if (kind === 'spatial') {
        const [owned, linked] = await Promise.all([
          this.read('rest/portal/getSubmissionLayers.php', { submissionId: id }, controller.signal),
          this.read('rest/portal/getSubmissionLinkedLayers.php', { submissionId: id }, controller.signal),
        ])
        value = { owned, linked }
      } else
        value = await this.read('rest/portal/getSubmissionAttachments.php', { submissionId: id }, controller.signal)
      write({ status: 'loaded', value })
    } catch (reason) {
      write({ status: 'error', message: errorText(reason) })
    } finally {
      this.requests.delete(controller)
      if (this.resourceRequests.get(kind) === controller) this.resourceRequests.delete(kind)
    }
  }
}

function ResourceView({
  state,
  retry,
  children,
}: {
  state?: ResourceState
  retry: () => void
  children: (value: unknown) => ReactNode
}) {
  if (!state || state.status === 'loading')
    return <InlineAlert loading>Loading original submission content…</InlineAlert>
  if (state.status === 'error')
    return (
      <InlineAlert tone="error">
        {state.message}
        <Button size="sm" variant="outline" className="mt-2" onClick={retry}>
          Retry this tab
        </Button>
      </InlineAlert>
    )
  return <>{children(state.value)}</>
}

export function PortalSourceSubmissionDialog(props: {
  submissionId: string
  onClose: () => void
  onOpenSubmission: (id: string) => void
  onConnect?: () => void
  read?: SubmissionLiveRead
}) {
  return <SourceDialog key={props.submissionId} {...props} />
}
function SourceDialog({
  submissionId,
  onClose,
  onOpenSubmission,
  onConnect,
  read = portalRead,
}: {
  submissionId: string
  onClose: () => void
  onOpenSubmission: (id: string) => void
  onConnect?: () => void
  read?: SubmissionLiveRead
}) {
  const [returned, setReturned] = useState<{ owner: SourceSubmissionLoader; state: SourceSubmissionState }>()
  const [tab, setTab] = useState<Tab>('preview'),
    [connectionOpen, setConnectionOpen] = useState(false)
  const [available, setAvailable] = useState(false),
    [downloadMode, setDownloadMode] = useState<SubmissionDownloadMode>(),
    [downloadError, setDownloadError] = useState('')
  const downloadRequest = useRef<AbortController | undefined>(undefined)
  const loader = useMemo(() => {
    const owner = new SourceSubmissionLoader(read, (state) => setReturned({ owner, state }))
    return owner
  }, [read])
  const guardedRead = useCallback<SubmissionLiveRead>(
    (path, params, signal) => loader.authorizedRead(path, params, signal),
    [loader],
  )
  const state = returned?.owner === loader ? returned.state : undefined
  const metadata = state?.status === 'ready' ? state.metadata : undefined
  const resources = state?.status === 'ready' ? state.resources : undefined
  const connect = () => (onConnect ? onConnect() : setConnectionOpen(true))
  const checkAccess = () => {
    downloadRequest.current?.abort()
    downloadRequest.current = undefined
    setDownloadMode(undefined)
    setDownloadError('')
    void loader.open(submissionId)
  }
  useEffect(() => {
    let disposed = false,
      request: AbortController | undefined
    const probe = () => {
      request?.abort()
      const controller = new AbortController()
      request = controller
      void getPortalConnectionStatus(controller.signal)
        .then((status) => {
          if (!disposed && !controller.signal.aborted && request === controller) setAvailable(status.available)
        })
        .catch(() => {
          if (!disposed && !controller.signal.aborted) setAvailable(false)
        })
    }
    const changed = (event: Event) => {
      loader.cancel('The connection changed. Check access again to reopen this source submission.')
      downloadRequest.current?.abort()
      downloadRequest.current = undefined
      setDownloadMode(undefined)
      setDownloadError('')
      request?.abort()
      const reason = (event as CustomEvent<{ reason?: string }>).detail?.reason
      if (refreshSubmissionLiveAfterConnection(reason)) void loader.open(submissionId)
      if (reason !== 'session-changing') probe()
    }
    window.addEventListener(PORTAL_CONNECTION_EVENT, changed)
    probe()
    void Promise.resolve().then(() => {
      if (!disposed) void loader.open(submissionId)
    })
    return () => {
      disposed = true
      request?.abort()
      downloadRequest.current?.abort()
      downloadRequest.current = undefined
      loader.cancel(undefined, false)
      window.removeEventListener(PORTAL_CONNECTION_EVENT, changed)
    }
  }, [loader, submissionId])
  useEffect(() => {
    if (!metadata) return
    if (tab === 'preview' || tab === 'spatial' || tab === 'attachments') void loader.loadResource(tab)
    if (tab === 'export') {
      void loader.loadResource('spatial')
      void loader.loadResource('attachments')
    }
  }, [metadata, tab, loader])
  const download = async (mode: SubmissionDownloadMode) => {
    if (!metadata || downloadMode) return
    // Recheck source authorization before using the download transport; its server checks it again.
    const controller = new AbortController()
    downloadRequest.current?.abort()
    downloadRequest.current = controller
    setDownloadMode(mode)
    setDownloadError('')
    try {
      checkedSourceSubmissionMetadata(
        await guardedRead('rest/portal/getSubmissionMetadata.php', { submissionId }, controller.signal),
        submissionId,
      )
      if (controller.signal.aborted) return
      const result = await portalDownloadSubmission(submissionId, mode, controller.signal)
      if (!controller.signal.aborted && downloadRequest.current === controller)
        downloadBlob(result.blob, result.filename)
    } catch (reason) {
      if (!controller.signal.aborted && downloadRequest.current === controller) setDownloadError(errorText(reason))
    } finally {
      if (!controller.signal.aborted && downloadRequest.current === controller) {
        downloadRequest.current = undefined
        setDownloadMode(undefined)
      }
    }
  }
  const attachments = resources?.attachments?.status === 'loaded' ? resources.attachments.value : undefined
  const spatial =
    resources?.spatial?.status === 'loaded' && reviewObject(resources.spatial.value)
      ? resources.spatial.value
      : undefined
  const filesKnown = Array.isArray(attachments) && Array.isArray(spatial?.owned)
  const hasFiles = filesKnown && (attachments.length > 0 || (spatial!.owned as unknown[]).length > 0)
  const prefix = `source-submission-${submissionId}`
  return (
    <>
      <RecordDialog
        open
        eyebrow="Original portal submission"
        title={
          metadata && typeof metadata.submission_title === 'string'
            ? metadata.submission_title
            : `Submission ${submissionId}`
        }
        subtitle={`Source submission ID ${submissionId}`}
        onClose={onClose}
        size="xl"
        className="h-[min(800px,90dvh)] !max-h-[90dvh] sm:!max-w-[1000px]"
        bodyClassName="!p-0 flex min-h-0 flex-1 flex-col overflow-hidden"
        source="Original portal · current permitted connection"
        sourceHref={NECHAKO_PORTAL}
        contentProps={{ 'data-nechako-source-submission-dialog': true }}
      >
        <TabBar
          value={tab}
          options={TABS}
          onChange={setTab}
          label="Original submission sections"
          idPrefix={prefix}
          variant="underline"
          className="shrink-0 px-2"
        />
        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
          {!metadata ? (
            <div className="space-y-3">
              {!state || state.status === 'loading' ? (
                <InlineAlert loading>Checking access to submission {submissionId}…</InlineAlert>
              ) : (
                <InlineAlert tone={state.status === 'error' ? 'error' : 'info'} title="Source submission access">
                  {state.status === 'error' ? state.message : state.status === 'idle' ? state.message : ''}
                </InlineAlert>
              )}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={checkAccess}>
                  Check submission access
                </Button>
                <Button size="sm" variant="outline" onClick={connect}>
                  Connection settings
                </Button>
                {available && getPortalConnectionMode() === 'direct' && (
                  <Button size="sm" variant="outline" onClick={() => setPortalConnectionMode('gateway')}>
                    Use portal connection
                  </Button>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                This submission is not in the public capture. Its fields and files load only if the original portal
                grants access.
              </p>
            </div>
          ) : (
            TABS.map((item) => (
              <div
                key={item.value}
                role="tabpanel"
                id={`${prefix}-panel-${item.value}`}
                aria-labelledby={`${prefix}-tab-${item.value}`}
                hidden={tab !== item.value}
                className="space-y-3"
              >
                {item.value === 'preview' && (
                  <>
                    <p className="text-sm">
                      Submission Name:{' '}
                      {metadata.submission_name === '' ? 'Empty value' : reviewText(metadata.submission_name)}
                    </p>
                    <ResourceView state={resources?.preview} retry={() => void loader.loadResource('preview')}>
                      {(value) => <PortalSubmissionReader allowHttpLinks data={value} />}
                    </ResourceView>
                  </>
                )}
                {item.value === 'general' && (
                  <>
                    <PortalSubmissionReader allowHttpLinks data={metadata} />
                    {sourceId(metadata.parent_id) && (
                      <Button size="sm" variant="outline" onClick={() => onOpenSubmission(String(metadata.parent_id))}>
                        Open parent submission {String(metadata.parent_id)}
                      </Button>
                    )}
                  </>
                )}
                {item.value === 'permissions' && (
                  <PortalSubmissionLivePanel
                    submissionId={submissionId}
                    kind="permissions"
                    active={tab === 'permissions'}
                    read={guardedRead}
                    onConnect={connect}
                  />
                )}
                {item.value === 'history' && (
                  <PortalSubmissionLivePanel
                    submissionId={submissionId}
                    kind="history"
                    active={tab === 'history'}
                    read={guardedRead}
                    onConnect={connect}
                  />
                )}
                {item.value === 'children' && (
                  <PortalSubmissionLivePanel
                    submissionId={submissionId}
                    kind="children"
                    active={tab === 'children'}
                    read={guardedRead}
                    onOpenSubmission={onOpenSubmission}
                    onConnect={connect}
                  />
                )}
                {item.value === 'spatial' && (
                  <ResourceView state={resources?.spatial} retry={() => void loader.loadResource('spatial')}>
                    {(value) =>
                      reviewObject(value) ? (
                        <>
                          <h3 className="font-medium">Owned layers</h3>
                          <PortalSubmissionReader allowHttpLinks data={value.owned} />
                          <h3 className="font-medium">Linked layers</h3>
                          <PortalSubmissionReader allowHttpLinks data={value.linked} />
                        </>
                      ) : null
                    }
                  </ResourceView>
                )}
                {item.value === 'attachments' && (
                  <ResourceView state={resources?.attachments} retry={() => void loader.loadResource('attachments')}>
                    {(value) => <PortalSubmissionReader allowHttpLinks data={value} />}
                  </ResourceView>
                )}
                {item.value === 'export' && (
                  <>
                    <h2 className="font-semibold">Original portal downloads</h2>
                    <p className="text-sm">
                      These downloads use your current portal access. This source-only submission is not added to the
                      public dataset or its archive.
                    </p>
                    {available && getPortalConnectionMode() === 'gateway' ? (
                      <div className="flex flex-wrap gap-2">
                        {(['pdf', 'html', 'csv', 'files'] as const).map((mode) => (
                          <Button
                            key={mode}
                            size="sm"
                            variant="outline"
                            disabled={!!downloadMode || (mode === 'files' && !hasFiles)}
                            onClick={() => void download(mode)}
                          >
                            {downloadMode === mode
                              ? 'Downloading…'
                              : `Download original ${mode === 'files' ? 'ZIP' : mode.toUpperCase()}`}
                          </Button>
                        ))}
                      </div>
                    ) : (
                      <Button size="sm" variant="outline" onClick={connect}>
                        Connection settings
                      </Button>
                    )}
                    {!filesKnown && (
                      <p className="text-xs text-muted-foreground">
                        ZIP availability requires the current attachment and owned-layer inventories.
                      </p>
                    )}
                    {filesKnown && !hasFiles && (
                      <p className="text-xs text-muted-foreground">
                        No attachment or owned spatial-file references were returned. Linked layers are not ZIP files.
                      </p>
                    )}
                    {downloadError && <InlineAlert tone="error">{downloadError}</InlineAlert>}
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </RecordDialog>
      {connectionOpen && (
        <DialogShell title="Original portal connection" onClose={() => setConnectionOpen(false)} size="md">
          <LocalPortalConnection />
        </DialogShell>
      )}
    </>
  )
}
