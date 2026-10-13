import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { ExternalLink } from '@/components/ui/text-button'
import {
  NECHAKO_PORTAL,
  PORTAL_CONNECTION_EVENT,
  getPortalConnectionMode,
  getPortalConnectionStatus,
  setPortalConnectionMode,
  portalRead,
} from '@/lib/nechakoPortal'
import { LocalPortalConnection } from './LocalPortalConnection'
import { reviewText } from './data/submissionReview'
import {
  SubmissionLiveLoader,
  childSubmissionId,
  nativeBoolean,
  type NativeRecord,
  type SubmissionLiveData,
  type SubmissionLiveKind,
  type SubmissionLiveRead,
  type SubmissionLiveState,
} from './data/submissionLive'

const TITLES = { permissions: 'Allowed users', history: 'History', children: 'Child submissions' }
/** Only completed local connection changes may start a new read automatically. */
export function refreshSubmissionLiveAfterConnection(reason: unknown) {
  return reason === 'signed-in' || reason === 'mode'
}
function Flag({ value }: { value: unknown }) {
  const flag = nativeBoolean(value)
  return (
    <span>
      {flag === true ? 'Yes' : flag === false ? 'No' : value === undefined ? 'Not supplied' : reviewText(value)}
    </span>
  )
}
function Details({ value, omit = [] }: { value: NativeRecord; omit?: string[] }) {
  const entries = Object.entries(value).filter(([key]) => !omit.includes(key))
  return entries.length ? (
    <details>
      <summary className="cursor-pointer text-xs text-muted-foreground">Other source fields</summary>
      <dl className="mt-2 space-y-2 text-xs">
        {entries.map(([key, item]) => (
          <div key={key}>
            <dt className="font-medium">{key}</dt>
            <dd className="max-h-64 overflow-auto whitespace-pre-wrap break-words">{reviewText(item)}</dd>
          </div>
        ))}
      </dl>
    </details>
  ) : null
}
function LiveRows({ data, onOpenSubmission }: { data: SubmissionLiveData; onOpenSubmission?: (id: string) => void }) {
  const [page, setPage] = useState(0)
  const [allUsers, setAllUsers] = useState(false)
  const rows =
    data.kind === 'permissions'
      ? data.entries.filter((entry) => allUsers || nativeBoolean(entry.source.checked) === true)
      : data.rows
  const pageCount = Math.max(1, Math.ceil(rows.length / 25)),
    currentPage = Math.min(page, pageCount - 1)
  return (
    <div className="space-y-3">
      {data.kind === 'permissions' && (
        <>
          <p className="text-xs text-muted-foreground">
            {data.groups.length} groups · {data.entries.length} users returned by the original portal. Assigned users
            are shown first. The portal controls their effective access.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={allUsers}
              onChange={(event) => {
                setAllUsers(event.target.checked)
                setPage(0)
              }}
            />
            Show all returned users and access details
          </label>
          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground">Group access details</summary>
            <div className="mt-2 space-y-3">
              {data.groups.map((group, index) => (
                <section key={index} className="rounded border p-2 text-xs">
                  <p className="font-medium">{reviewText(group.text ?? `Source group ${index + 1}`)}</p>
                  <p>
                    Access assigned: <Flag value={group.checked} /> · Edit assigned: <Flag value={group.editChecked} />{' '}
                    · Editing enabled: <Flag value={group.editEnabled} />
                  </p>
                  <Details value={group} omit={['text', 'checked', 'editChecked', 'editEnabled', 'attributes']} />
                </section>
              ))}
            </div>
          </details>
        </>
      )}
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {rows.length} {data.kind === 'permissions' ? 'users shown' : 'records returned'} · Page {currentPage + 1} of{' '}
        {pageCount}
      </p>
      {!rows.length && (
        <InlineAlert>
          {data.kind === 'permissions' && !allUsers
            ? 'No assigned users were returned. Show all returned users to inspect their access details.'
            : 'The original portal returned no records for this submission and connection.'}
        </InlineAlert>
      )}
      {rows.slice(currentPage * 25, (currentPage + 1) * 25).map((row, index) => {
        if (data.kind === 'permissions') {
          const entry = row as { group: NativeRecord; source: NativeRecord }
          return (
            <section key={index} className="space-y-2 rounded border p-3 text-sm">
              <p className="font-medium">
                {reviewText(entry.source.text ?? `Source user entry ${currentPage * 25 + index + 1}`)}
              </p>
              <p className="text-xs text-muted-foreground">
                Group: {reviewText(entry.group.text ?? entry.group.gid ?? 'Not supplied')} · User ID:{' '}
                {reviewText(entry.source.uid ?? 'Not supplied')}
              </p>
              <p className="text-xs">
                Access assigned: <Flag value={entry.source.checked} /> · Edit assigned:{' '}
                <Flag value={entry.source.editChecked} /> · Editing enabled: <Flag value={entry.source.editEnabled} />
              </p>
              <Details value={entry.source} omit={['text', 'uid', 'checked', 'editChecked', 'editEnabled']} />
            </section>
          )
        }
        const source = row as NativeRecord
        const columns =
          data.kind === 'history'
            ? [
                ['history_timestamp', 'Time changed'],
                ['uname', 'Changed by'],
                ['changed_field_name', 'Changed field'],
                ['changed_field_old_value', 'Old value'],
                ['changed_field_new_value', 'New value'],
                ['reason', 'Reason'],
              ]
            : [
                ['submission_title', 'Submission'],
                ['form_submission_id', 'Source submission ID'],
              ]
        const id = data.kind === 'children' ? childSubmissionId(source) : undefined
        return (
          <section key={index} className="space-y-3 rounded border p-3">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              {columns.map(([key, label]) => (
                <div key={key}>
                  <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
                  <dd className="max-h-64 overflow-auto whitespace-pre-wrap break-words">
                    {key in source ? reviewText(source[key]) : 'Not supplied'}
                  </dd>
                </div>
              ))}
            </dl>
            <Details value={source} omit={columns.map(([key]) => key)} />
            {id && onOpenSubmission && (
              <Button size="sm" variant="outline" onClick={() => onOpenSubmission(id)}>
                Open child submission {id}
              </Button>
            )}
          </section>
        )
      })}
      {pageCount > 1 && (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>
            Previous source records
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={currentPage + 1 >= pageCount}
            onClick={() => setPage(currentPage + 1)}
          >
            Next source records
          </Button>
        </div>
      )}
    </div>
  )
}

export type PortalSubmissionLiveProps = {
  submissionId: string
  kind: SubmissionLiveKind
  active?: boolean
  onOpenSubmission?: (id: string) => void
  onConnect?: () => void
  read?: SubmissionLiveRead
}
/** Source-only resource reader. Protected payloads remain in this mounted panel's RAM. */
export function PortalSubmissionLivePanel(props: PortalSubmissionLiveProps) {
  return <LivePanel key={`${props.submissionId}:${props.kind}:${props.active !== false}`} {...props} />
}
function LivePanel({
  submissionId,
  kind,
  active = true,
  onOpenSubmission,
  onConnect,
  read = portalRead,
}: PortalSubmissionLiveProps) {
  const [returned, setReturned] = useState<{ owner: SubmissionLiveLoader; state: SubmissionLiveState }>()
  const [showConnection, setShowConnection] = useState(false)
  const [connectionAvailable, setConnectionAvailable] = useState(false)
  const loader = useMemo(() => {
    const owner = new SubmissionLiveLoader(read, (state) => setReturned({ owner, state }))
    return owner
  }, [read])
  useEffect(() => {
    let disposed = false
    let statusRequest: AbortController | undefined
    const probe = () => {
      statusRequest?.abort()
      const controller = new AbortController()
      statusRequest = controller
      void getPortalConnectionStatus(controller.signal)
        .then((status) => {
          if (!disposed && !controller.signal.aborted && statusRequest === controller)
            setConnectionAvailable(status.available)
        })
        .catch(() => {
          if (!disposed && !controller.signal.aborted && statusRequest === controller) setConnectionAvailable(false)
        })
    }
    const clear = (event: Event) => {
      loader.cancel('Connection changed. Refresh to read this tab with your current access.')
      statusRequest?.abort()
      const reason = (event as CustomEvent<{ reason?: string }>).detail?.reason
      if (active && refreshSubmissionLiveAfterConnection(reason)) void loader.load(kind, submissionId)
      if (active && reason !== 'session-changing') probe()
    }
    window.addEventListener(PORTAL_CONNECTION_EVENT, clear)
    if (active) {
      probe()
      void Promise.resolve().then(() => {
        if (!disposed) void loader.load(kind, submissionId)
      })
    }
    return () => {
      disposed = true
      statusRequest?.abort()
      loader.cancel(undefined, false)
      window.removeEventListener(PORTAL_CONNECTION_EVENT, clear)
    }
  }, [active, kind, submissionId, loader])
  const state = returned?.owner === loader ? returned.state : undefined
  if (!active) return null
  return (
    <div className="space-y-3" data-nechako-live-resource={kind}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-muted-foreground">
          Original portal · submission {submissionId} ·{' '}
          {getPortalConnectionMode() === 'gateway' ? 'Connected access' : 'Public access'}
        </span>
        <Button size="sm" variant="outline" onClick={() => void loader.load(kind, submissionId)}>
          Refresh {TITLES[kind].toLowerCase()}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => (onConnect ? onConnect() : setShowConnection((value) => !value))}
        >
          Connection settings
        </Button>
        <ExternalLink href={NECHAKO_PORTAL}>Original portal</ExternalLink>
        {connectionAvailable && getPortalConnectionMode() === 'direct' && (
          <Button size="sm" variant="outline" onClick={() => setPortalConnectionMode('gateway')}>
            Use portal connection
          </Button>
        )}
      </div>
      {showConnection && <LocalPortalConnection />}
      <p className="text-xs text-muted-foreground">
        This tab reads the original portal using your current access. Its results clear when the connection changes.
      </p>
      {(!state || state.status === 'loading') && (
        <InlineAlert loading>Loading source {TITLES[kind].toLowerCase()}…</InlineAlert>
      )}
      {state?.status === 'idle' && (
        <InlineAlert>{state.message || 'Refresh to read this source resource.'}</InlineAlert>
      )}
      {state?.status === 'error' && (
        <InlineAlert tone="error" title={`Source ${TITLES[kind].toLowerCase()} unavailable`}>
          {state.message}
          <p className="mt-2">
            Sign in with a portal account that has access, or open this submission in the original portal.
          </p>
          {(!connectionAvailable || getPortalConnectionMode() === 'gateway') && (
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => (onConnect ? onConnect() : setShowConnection(true))}
            >
              Connect to original portal
            </Button>
          )}
        </InlineAlert>
      )}
      {state?.status === 'loaded' && <LiveRows data={state.data} onOpenSubmission={onOpenSubmission} />}
    </div>
  )
}
