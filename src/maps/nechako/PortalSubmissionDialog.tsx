import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { InlineAlert } from '@/components/ui/map-panels'
import { RecordDialog } from '@/components/ui/record-dialog'
import { TabBar } from '@/components/ui/tab-bar'
import { ExternalLink } from '@/components/ui/text-button'
import { downloadBlob, downloadText } from '@/lib/download'
import {
  errorText,
  getPortalConnectionMode,
  getPortalConnectionStatus,
  setPortalConnectionMode,
  portalDownloadSubmission,
  PORTAL_CONNECTION_EVENT,
} from '@/lib/nechakoPortal'
import { SourceFieldValue } from './PortalSubmissionReader'
import { PortalSubmissionLivePanel } from './PortalSubmissionLive'
import { LocalPortalConnection } from './LocalPortalConnection'
import {
  loadSubmissionFormDefinitions,
  publicSubmissionChildren,
  submissionFormLayout,
  submissionRecordCsv,
  submissionRecordHtml,
  type SubmissionFormDefinition,
  type SubmissionFormDefinitions,
  type SubmissionLayoutSection,
} from './data/submissionFormLayout'
import { reviewText } from './data/submissionReview'
import { snapshotSourceUrl, type SubmissionRecord } from './data/submissionSnapshot'
import { exportSubmissionPdf } from './data/submissionDownload'

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
const ORIGINAL_EXPORTS = [
  { mode: 'pdf', label: 'PDF' },
  { mode: 'html', label: 'HTML' },
  { mode: 'csv', label: 'CSV' },
  { mode: 'files', label: 'ZIP' },
] as const
type OriginalExport = (typeof ORIGINAL_EXPORTS)[number]['mode']

function MediaReferences({ record, fieldId }: { record: SubmissionRecord; fieldId: string }) {
  return record.media
    .filter((media) => media.fieldId === fieldId)
    .map((media) => {
      const imageUrl =
        media.kind === 'remote' && media.mime.startsWith('image/') ? snapshotSourceUrl(media.url) : undefined
      const label = record.fields.find((field) => field.id === fieldId)?.label ?? `Field ${fieldId}`
      return (
        <div key={`${media.kind}-${media.ordinal}`} className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Field ID {fieldId} · original media {media.ordinal} · {media.mime}
          </p>
          {imageUrl ? (
            <a href={imageUrl} target="_blank" rel="noreferrer">
              <img
                src={imageUrl}
                alt={`${label} · original media ${media.ordinal}`}
                loading="lazy"
                referrerPolicy="no-referrer"
                className="max-h-96 max-w-full rounded border object-contain"
              />
            </a>
          ) : (
            <p className="text-sm text-muted-foreground">
              {media.kind === 'embedded'
                ? 'Embedded media remains in the original submission.'
                : 'This media is available at its source.'}{' '}
              <ExternalLink href={snapshotSourceUrl(media.url, true) ?? media.sourceUrl}>
                {media.kind === 'remote' && snapshotSourceUrl(media.url, true)
                  ? 'Open source media'
                  : `Open original portal · ID ${record.id}`}
              </ExternalLink>
            </p>
          )}
        </div>
      )
    })
}

const resourceTab = (semantic: string): Tab | undefined => {
  const key = semantic.toLowerCase()
  if (/attach/.test(key)) return 'attachments'
  if (/shapefile|spatial|monitor|layer|linked/.test(key)) return 'spatial'
  if (/permission/.test(key)) return 'permissions'
  if (/parent|name/.test(key)) return 'general'
  return undefined
}
function FormSection({
  section,
  record,
  onTab,
}: {
  section: SubmissionLayoutSection
  record: SubmissionRecord
  onTab: (tab: Tab) => void
}) {
  const target = resourceTab(section.resource ?? '')
  return (
    <section className="overflow-hidden rounded border" data-source-form-section={section.key}>
      <h2 className="border-b bg-muted/50 px-3 py-2 text-sm font-semibold">
        {section.pageLabel ? `${section.pageLabel} · ` : ''}
        {section.label}
        {section.page && !section.pageLabel ? (
          <span className="ml-2 font-normal text-muted-foreground">Page {section.page}</span>
        ) : null}
      </h2>
      <div className="divide-y">
        {section.fields.map(({ field, definition }) => (
          <div
            key={field.id}
            className={`gap-4 p-3 ${['htmleditor', 'textarea', 'label'].includes(definition?.type ?? field.type) || record.media.some((media) => media.fieldId === field.id) ? 'space-y-2' : 'sm:grid sm:grid-cols-[minmax(130px,30%)_minmax(0,1fr)]'}`}
          >
            <div className="mb-1 min-w-0">
              <h3 className="text-sm font-medium">{definition?.label ?? field.label}</h3>
              <p className="text-[11px] text-muted-foreground">
                Field ID {field.id} · {definition?.type ?? field.type}
              </p>
            </div>
            <div className="min-w-0 space-y-2">
              {(definition?.type ?? field.type) === 'label' ? (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">Captured source value</summary>
                  <p>{reviewText(field.value)}</p>
                </details>
              ) : field.value === '' ? (
                <p className="text-sm italic text-muted-foreground">Empty value</p>
              ) : Array.isArray(field.value) && !field.value.length ? (
                <div className="space-y-1">
                  <p className="text-sm italic text-muted-foreground">Empty value</p>
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer">View source value</summary>
                    <p>[]</p>
                  </details>
                </div>
              ) : (
                <SourceFieldValue
                  label={definition?.label ?? field.label}
                  type={definition?.type ?? field.type}
                  value={field.value}
                  showImages={false}
                  allowHttpLinks
                />
              )}
              <MediaReferences record={record} fieldId={field.id} />
            </div>
          </div>
        ))}
        {section.resource && (
          <div className="space-y-2 p-3 text-sm">
            {section.content && (
              <SourceFieldValue
                label={section.label}
                type="htmleditor"
                value={section.content}
                showImages={false}
                allowHttpLinks
              />
            )}
            {target ? (
              <Button size="sm" variant="outline" onClick={() => onTab(target)}>
                View {TABS.find((item) => item.value === target)?.label}
              </Button>
            ) : (
              <p className="text-muted-foreground">Manage this section in the original portal.</p>
            )}
            {section.fieldId && <p className="text-xs text-muted-foreground">Source node ID {section.fieldId}</p>}
          </div>
        )}
      </div>
    </section>
  )
}

function ResourceInventory({
  record,
  kind,
  linked,
  unknown,
}: {
  record: SubmissionRecord
  kind: 'attachments' | 'layers'
  linked?: boolean
  unknown?: boolean
}) {
  const items = record[kind].filter(
    (item) =>
      kind !== 'layers' ||
      (unknown
        ? !['linked', 'direct'].includes(String(item.kind))
        : linked
          ? item.kind === 'linked'
          : item.kind === 'direct'),
  )
  return (
    <div className="space-y-3">
      <h3 className="font-medium">
        {kind === 'attachments'
          ? 'Attachments'
          : unknown
            ? 'Other layer references'
            : linked
              ? 'Linked layers'
              : 'Owned layers'}{' '}
        ({items.length})
      </h3>
      {items.length ? (
        <ul className="divide-y rounded border">
          {items.map((item, index) => {
            const href = snapshotSourceUrl(item.url, true) ?? snapshotSourceUrl(item.sourceUrl) ?? record.sourceUrl
            const name = String(item.name ?? item.layer_name ?? item.attachment_name ?? `Source reference ${index + 1}`)
            return (
              <li key={index} className="space-y-1 p-3 text-sm">
                <p className="font-medium">{name}</p>
                <p className="text-xs text-muted-foreground">
                  Source ID {reviewText(item.id)}
                  {item.schemaId !== undefined ? ` · Schema ID ${reviewText(item.schemaId)}` : ''}
                </p>
                <ExternalLink href={href}>
                  {snapshotSourceUrl(item.url, true)
                    ? 'Open source reference'
                    : `Open original portal · submission ${record.id}`}
                </ExternalLink>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          No {kind === 'attachments' ? 'attachment' : linked ? 'linked layer' : 'owned layer'} references were returned
          in the anonymous capture.
        </p>
      )}
    </div>
  )
}

export function PortalSubmissionDialog({
  record,
  records,
  capturedAt,
  onClose,
  onOpenSubmission,
  onConnect,
  loadForms = loadSubmissionFormDefinitions,
}: {
  record: SubmissionRecord
  records: SubmissionRecord[]
  capturedAt: string
  onClose: () => void
  onOpenSubmission: (id: string) => void
  onConnect?: () => void
  loadForms?: (signal?: AbortSignal) => Promise<SubmissionFormDefinitions>
}) {
  const [tab, setTab] = useState<Tab>('preview'),
    [retry, setRetry] = useState(0),
    [connectionOpen, setConnectionOpen] = useState(false),
    [navigationError, setNavigationError] = useState(''),
    [pdfBusy, setPdfBusy] = useState(false),
    [exportError, setExportError] = useState(''),
    [originalBusy, setOriginalBusy] = useState<OriginalExport>(),
    [originalError, setOriginalError] = useState(''),
    [originalConnection, setOriginalConnection] = useState({ available: false, mode: getPortalConnectionMode() })
  const originalRequest = useRef<AbortController | undefined>(undefined)
  const [formResult, setFormResult] = useState<{
    formId: string
    loader: typeof loadForms
    retry: number
    form?: SubmissionFormDefinition
    error?: string
  }>()
  // Associate the response with its request inputs. A new form/loader/retry
  // immediately displays loading and never renders the preceding form.
  const currentFormResult =
    formResult?.formId === record.formId && formResult.loader === loadForms && formResult.retry === retry
      ? formResult
      : undefined
  const form = currentFormResult?.form,
    formsError = currentFormResult?.error,
    loading = !currentFormResult
  const openPublicSubmission = (id: string) => {
    if (records.some((item) => item.id === id)) onOpenSubmission(id)
    else
      setNavigationError(
        `Submission ${id} is not included in the anonymous capture. Open the original portal and find it by its source ID.`,
      )
  }
  const connect = () => {
    if (onConnect) onConnect()
    else setConnectionOpen(true)
  }
  useEffect(() => {
    let disposed = false,
      statusRequest: AbortController | undefined
    const cancelDownload = () => {
      originalRequest.current?.abort()
      originalRequest.current = undefined
      setOriginalBusy(undefined)
      setOriginalError('')
    }
    const probe = () => {
      statusRequest?.abort()
      const controller = new AbortController()
      statusRequest = controller
      void getPortalConnectionStatus(controller.signal)
        .then((status) => {
          if (!disposed && !controller.signal.aborted && statusRequest === controller)
            setOriginalConnection({ available: status.available, mode: getPortalConnectionMode() })
        })
        .catch(() => {
          if (!disposed && !controller.signal.aborted && statusRequest === controller)
            setOriginalConnection({ available: false, mode: getPortalConnectionMode() })
        })
    }
    const changed = (event: Event) => {
      cancelDownload()
      statusRequest?.abort()
      setOriginalConnection({ available: false, mode: getPortalConnectionMode() })
      if (tab === 'export' && (event as CustomEvent<{ reason?: string }>).detail?.reason !== 'session-changing') probe()
    }
    window.addEventListener(PORTAL_CONNECTION_EVENT, changed)
    if (tab === 'export') probe()
    return () => {
      disposed = true
      statusRequest?.abort()
      cancelDownload()
      window.removeEventListener(PORTAL_CONNECTION_EVENT, changed)
    }
  }, [tab, record.id])
  const downloadOriginal = async (mode: OriginalExport) => {
    if (!originalConnection.available || getPortalConnectionMode() !== 'gateway' || originalBusy) return
    const controller = new AbortController()
    originalRequest.current = controller
    setOriginalBusy(mode)
    setOriginalError('')
    try {
      const result = await portalDownloadSubmission(record.id, mode, controller.signal)
      if (!controller.signal.aborted && originalRequest.current === controller)
        downloadBlob(result.blob, result.filename)
    } catch (reason) {
      if (!controller.signal.aborted && originalRequest.current === controller) setOriginalError(errorText(reason))
    } finally {
      if (originalRequest.current === controller) {
        originalRequest.current = undefined
        setOriginalBusy(undefined)
      }
    }
  }
  useEffect(() => {
    const controller = new AbortController()
    const ownership = { formId: record.formId, loader: loadForms, retry }
    void loadForms(controller.signal)
      .then((definitions) => {
        if (controller.signal.aborted) return
        const definition = definitions.forms.find((item) => item.id === record.formId)
        if (!definition) throw new Error('The captured form definition is unavailable for this submission.')
        setFormResult({ ...ownership, form: definition })
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setFormResult({ ...ownership, error: errorText(reason) })
      })
    return () => controller.abort()
  }, [loadForms, record.formId, retry])
  const sections = submissionFormLayout(record, form),
    children = publicSubmissionChildren(records, record.id)
  const hasCapturedFiles = record.attachments.length > 0 || record.layers.some((layer) => layer.kind === 'direct')
  const parent =
    record.parentId !== null && record.parentId !== undefined && record.parentId > 0
      ? records.find((item) => item.id === String(record.parentId))
      : undefined
  const idPrefix = `submission-${record.id}`
  return (
    <>
      <RecordDialog
        open
        title={record.title || `Submission ${record.id}`}
        eyebrow="Submission Details"
        subtitle={`Submission ID ${record.id} · ${record.formName}`}
        onClose={onClose}
        size="xl"
        className="h-[min(800px,90dvh)] !max-h-[90dvh] sm:!max-w-[1000px]"
        bodyClassName="!p-0 flex min-h-0 flex-1 flex-col overflow-hidden"
        source="Nechako Watershed Portal · anonymous capture"
        sourceHref={record.sourceUrl}
        sourceLinkLabel="Open original portal"
        contentProps={{ 'data-nechako-submission-dialog': true }}
      >
        <TabBar
          value={tab}
          options={TABS}
          onChange={setTab}
          label="Submission details sections"
          idPrefix={idPrefix}
          variant="underline"
          className="shrink-0 px-2"
        />
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4" data-nechako-submission-detail>
          {TABS.map((item) => (
            <div
              key={item.value}
              role="tabpanel"
              id={`${idPrefix}-panel-${item.value}`}
              aria-labelledby={`${idPrefix}-tab-${item.value}`}
              hidden={tab !== item.value}
              className="space-y-4"
            >
              {item.value === 'preview' && (
                <>
                  <div className="rounded border p-3">
                    <h2 className="text-sm font-semibold">Submission Name</h2>
                    <p className="whitespace-pre-wrap break-words text-sm">
                      {record.name === '' ? (
                        <span className="italic text-muted-foreground">Empty value</span>
                      ) : (
                        record.name
                      )}
                    </p>
                  </div>
                  {loading && <p className="text-xs text-muted-foreground">Loading the captured form layout…</p>}
                  {formsError && (
                    <InlineAlert title="Original form layout unavailable; captured fields are shown below">
                      {formsError}
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2"
                        onClick={() => {
                          setRetry((value) => value + 1)
                        }}
                      >
                        Retry form layout
                      </Button>
                    </InlineAlert>
                  )}
                  {sections.map((section) => (
                    <FormSection key={section.key} section={section} record={record} onTab={setTab} />
                  ))}
                  {!sections.length && (
                    <p className="text-sm text-muted-foreground">No dynamic field content was included.</p>
                  )}
                </>
              )}
              {item.value === 'general' && (
                <>
                  <h2 className="font-semibold">General</h2>
                  <dl className="grid grid-cols-[minmax(120px,30%)_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
                    {[
                      ['Submission ID', record.id],
                      ['Submission Title', record.title],
                      ['Submission Name', record.name],
                      ['Form ID', record.formId],
                      ['Form Name', record.formName],
                      ['Submission Date', record.date],
                      ['Submitted By', record.submittedBy],
                      ['Parent Submission ID', record.parentId],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="contents">
                        <dt className="font-medium">{label}</dt>
                        <dd className="whitespace-pre-wrap break-words">
                          {value === '' ? 'Empty value' : reviewText(value)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {parent && (
                    <Button size="sm" variant="outline" onClick={() => onOpenSubmission(parent.id)}>
                      Open parent submission {parent.id}
                    </Button>
                  )}
                  {record.parentId !== null && record.parentId !== undefined && record.parentId > 0 && !parent && (
                    <p className="text-sm text-muted-foreground">
                      Parent {record.parentId} is not included in the anonymous capture. Find it in the original portal
                      using its ID.
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Title and Name are separate native metadata values. Status, assignee and other uncaptured metadata
                    are not inferred.
                  </p>
                </>
              )}
              {item.value === 'permissions' && (
                <PortalSubmissionLivePanel
                  submissionId={record.id}
                  kind="permissions"
                  active={tab === 'permissions'}
                  onConnect={connect}
                />
              )}
              {item.value === 'spatial' && (
                <>
                  <h2 className="font-semibold">Spatial Data</h2>
                  <ResourceInventory record={record} kind="layers" />
                  <ResourceInventory record={record} kind="layers" linked />
                  {record.layers.some((layer) => !['linked', 'direct'].includes(String(layer.kind))) && (
                    <ResourceInventory record={record} kind="layers" unknown />
                  )}
                  <p className="text-xs text-muted-foreground">
                    Layer references from the public capture. Open the original portal to use their spatial files and
                    monitoring data.
                  </p>
                </>
              )}
              {item.value === 'attachments' && (
                <>
                  <h2 className="font-semibold">Attachments</h2>
                  <ResourceInventory record={record} kind="attachments" />
                  <p className="text-xs text-muted-foreground">
                    Files are listed from the public capture. Download them through the original portal.
                  </p>
                </>
              )}
              {item.value === 'children' && (
                <>
                  <h2 className="font-semibold">Captured child submissions ({children.length})</h2>
                  <p className="text-xs text-muted-foreground">
                    These children are available in the public capture. Check the original portal below for its current
                    list.
                  </p>
                  {children.length ? (
                    <ul className="space-y-2">
                      {children.map((child) => (
                        <li key={child.id}>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onOpenSubmission(child.id)}
                            className="h-auto max-w-full whitespace-normal text-left"
                          >
                            {child.title || `Submission ${child.id}`} · ID {child.id}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">No children were included in the public capture.</p>
                  )}
                  {navigationError && (
                    <InlineAlert title="Source child unavailable in this capture">
                      {navigationError}
                      <ExternalLink href={record.sourceUrl} className="mt-2 block">
                        Open original portal
                      </ExternalLink>
                    </InlineAlert>
                  )}
                  <h3 className="font-medium">Current child submissions</h3>
                  <PortalSubmissionLivePanel
                    submissionId={record.id}
                    kind="children"
                    active={tab === 'children'}
                    onOpenSubmission={openPublicSubmission}
                    onConnect={connect}
                  />
                </>
              )}
              {item.value === 'history' && (
                <PortalSubmissionLivePanel
                  submissionId={record.id}
                  kind="history"
                  active={tab === 'history'}
                  onConnect={connect}
                />
              )}
              {item.value === 'export' && (
                <>
                  <h2 className="font-semibold">Export captured content</h2>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pdfBusy}
                      onClick={async () => {
                        setExportError('')
                        setPdfBusy(true)
                        try {
                          await exportSubmissionPdf(record, capturedAt, form)
                        } catch (reason) {
                          setExportError(errorText(reason))
                        } finally {
                          setPdfBusy(false)
                        }
                      }}
                    >
                      {pdfBusy ? 'Preparing public PDF…' : 'Export public PDF'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        downloadText(
                          JSON.stringify(
                            {
                              schema: 'nechako-public-submission-export-v1',
                              source: record.sourceUrl,
                              capturedAt,
                              record,
                              ...(form ? { form } : {}),
                            },
                            null,
                            2,
                          ),
                          `nechako-submission-${record.id}.json`,
                          'application/json',
                        )
                      }
                    >
                      Export submission JSON
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        downloadText(
                          submissionRecordHtml(record, capturedAt, form),
                          `nechako-submission-${record.id}.html`,
                          'text/html',
                        )
                      }
                    >
                      Export readable HTML
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        downloadText(
                          submissionRecordCsv(record),
                          `nechako-submission-${record.id}-fields.csv`,
                          'text/csv',
                        )
                      }
                    >
                      Export field CSV
                    </Button>
                  </div>
                  {exportError && <InlineAlert tone="error">{exportError}</InlineAlert>}
                  <p className="text-sm">
                    These downloads contain public captured content, source IDs and the capture date. Current
                    permissions and history are excluded.
                  </p>
                  <h3 className="font-semibold">Original portal downloads</h3>
                  <p className="text-sm text-muted-foreground">
                    Download the original portal’s current submission report or attached files. Access follows your
                    portal connection.
                  </p>
                  {originalConnection.available && originalConnection.mode === 'gateway' ? (
                    <div className="flex flex-wrap gap-2">
                      {ORIGINAL_EXPORTS.map(({ mode, label }) => (
                        <Button
                          key={mode}
                          size="sm"
                          variant="outline"
                          disabled={!!originalBusy || (mode === 'files' && !hasCapturedFiles)}
                          title={
                            mode === 'files' && !hasCapturedFiles
                              ? 'No captured attachment or owned spatial-file references'
                              : undefined
                          }
                          onClick={() => void downloadOriginal(mode)}
                        >
                          {originalBusy === mode ? `Downloading original ${label}…` : `Download original ${label}`}
                        </Button>
                      ))}
                    </div>
                  ) : originalConnection.available ? (
                    <Button size="sm" variant="outline" onClick={() => setPortalConnectionMode('gateway')}>
                      Use portal connection
                    </Button>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Original downloads need a portal connection. You can also download them in the original portal
                      using submission ID {record.id}.
                    </p>
                  )}
                  {!hasCapturedFiles && (
                    <p className="text-xs text-muted-foreground">
                      No captured attachment or owned spatial-file references. Linked layers are not included in ZIP
                      files.
                    </p>
                  )}
                  {originalError && (
                    <InlineAlert tone="error" title="Original download unavailable">
                      {originalError}
                      <Button size="sm" variant="outline" className="mt-2" onClick={connect}>
                        Connection settings
                      </Button>
                    </InlineAlert>
                  )}
                  <ExternalLink href={record.sourceUrl}>Open original portal · submission {record.id}</ExternalLink>
                </>
              )}
            </div>
          ))}
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
