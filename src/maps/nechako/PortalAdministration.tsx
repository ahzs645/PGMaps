import { NativeSelect } from '@/components/ui/form-field'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { TabBar } from '@/components/ui/tab-bar'
import { portalRead, errorText, NECHAKO_PORTAL } from '@/lib/nechakoPortal'
import { useReadCheck } from './PortalChecks'
import {
  checkedPermissionRows,
  userPermissionUpdate,
  sourceContentText,
  PERMISSION_KINDS,
  type PermissionKind,
  type PermissionRow,
} from './data/adminWorkflow'
import { PortalAdminGroups } from './PortalAdminGroups'
import { PortalModeration } from './PortalModeration'
import { AdminReadResource } from './PortalAdminResource'
import { PortalAdminForms, PortalAdminSchemas } from './PortalAdminDefinitions'
import { PortalAdminSubmissions } from './PortalAdminSubmissions'
import { PortalAdminSystem } from './PortalAdminSystem'
import { PortalAdminDashboard } from './PortalAdminDashboard'
import { adminId } from './data/adminInspection'
import { usePortalSession } from './data/usePortalSession'

type Write = (path: string, params: Record<string, string>) => Promise<unknown>
function HelpEditor({ write, canWrite }: { write?: Write; canWrite: boolean }) {
  const check = useReadCheck()
  const [selected, setSelected] = useState<Record<string, unknown>>(),
    [content, setContent] = useState(''),
    [link, setLink] = useState(false),
    [review, setReview] = useState(false),
    [ack, setAck] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false)
  const rows = Array.isArray(check.data) ? check.data.filter((value) => value && typeof value === 'object') : []
  return (
    <div className="space-y-3">
      <Button
        variant="outline"
        disabled={check.loading}
        onClick={() => void check.run('rest/portal/admin/getContents.php')}
      >
        Load help content
      </Button>
      {check.error && <InlineAlert tone="error">{check.error}</InlineAlert>}
      <label className="grid gap-1 text-sm">
        Source content
        <NativeSelect
          aria-label="Source help content"
          disabled={busy}
          className="rounded border bg-background p-2 text-base"
          value={String(selected?.content_id || '')}
          onChange={(e) => {
            const row = rows.find((item) => String(item.content_id) === e.target.value)
            setSelected(row)
            setContent(String(row?.content || ''))
            setLink(row?.content_onmenu === true || row?.content_onmenu === 't')
            setReview(false)
            setAck(false)
            setNotice('')
          }}
        >
          <option value="">Select an existing help document</option>
          {rows.map((row) => (
            <option key={String(row.content_id)} value={String(row.content_id)}>
              {String(row.content_name)} · {String(row.content_id)}
            </option>
          ))}
        </NativeSelect>
      </label>
      {selected && (
        <>
          <label className="grid gap-1 text-sm">
            Help HTML source
            <textarea
              aria-label="Help content source"
              disabled={busy}
              readOnly={!canWrite}
              className="min-h-48 w-full rounded border bg-background p-2 font-mono text-sm"
              maxLength={1000000}
              value={content}
              onChange={(e) => {
                setContent(e.target.value)
                setReview(false)
                setAck(false)
              }}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              disabled={!canWrite || busy}
              checked={link}
              onChange={(e) => {
                setLink(e.target.checked)
                setReview(false)
                setAck(false)
              }}
            />
            Show in original portal Links menu
          </label>
          <Button
            variant="outline"
            disabled={!canWrite || busy}
            onClick={() => {
              setReview(true)
              setAck(false)
            }}
          >
            Review help update
          </Button>
          {review && (
            <div className="space-y-3 rounded border p-3">
              <p className="text-sm">
                Existing source document {String(selected.content_id)} · {String(selected.content_name)}. This updates
                the original portal for its readers.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <section>
                  <h4 className="font-medium">Current text</h4>
                  <p className="whitespace-pre-wrap break-words text-sm">
                    {sourceContentText(String(selected.content))}
                  </p>
                </section>
                <section>
                  <h4 className="font-medium">Proposed text</h4>
                  <p className="whitespace-pre-wrap break-words text-sm">{sourceContentText(content)}</p>
                </section>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />I reviewed the
                document ID, content and menu visibility.
              </label>
              <Button
                disabled={!write || !canWrite || !ack || busy}
                onClick={async () => {
                  setBusy(true)
                  setError('')
                  try {
                    await write!('rest/portal/admin/setContent.php', {
                      id: String(selected.content_id),
                      data: content,
                      link: String(link),
                    })
                    setNotice('The source accepted the help update. Reload to verify current content.')
                    setReview(false)
                    void check.run('rest/portal/admin/getContents.php')
                  } catch (reason) {
                    setError(errorText(reason))
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                Apply reviewed help update
              </Button>
            </div>
          )}
        </>
      )}
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {notice && <InlineAlert>{notice}</InlineAlert>}
    </div>
  )
}
function Permissions({ write, canWrite }: { write?: Write; canWrite: boolean }) {
  const request = useRef<AbortController | undefined>(undefined)
  useEffect(
    () => () => {
      request.current?.abort()
      request.current = undefined
    },
    [],
  )
  const [uid, setUid] = useState(''),
    [details, setDetails] = useState<Record<string, unknown>>(),
    [original, setOriginal] = useState<Record<PermissionKind, PermissionRow[]>>(),
    [edited, setEdited] = useState<Record<PermissionKind, PermissionRow[]>>(),
    [kind, setKind] = useState<PermissionKind>('form'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [review, setReview] = useState<Record<string, string>>(),
    [ack, setAck] = useState(false),
    [notice, setNotice] = useState('')
  const load = async () => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setDetails(undefined)
    setOriginal(undefined)
    setEdited(undefined)
    setReview(undefined)
    setError('')
    try {
      const userId = adminId(uid)
      if (!userId) throw new Error('Enter an existing positive numeric user ID.')
      const results = await Promise.all([
        portalRead('rest/portal/admin/getUserDetails.php', { uid: userId }, controller.signal),
        ...PERMISSION_KINDS.map((mode) =>
          portalRead('rest/portal/admin/getUserPermissionsCheckbox.php', { uid: userId, mode }, controller.signal),
        ),
      ])
      if (request.current !== controller || controller.signal.aborted) return
      if (!results[0] || typeof results[0] !== 'object') throw new Error('Invalid source user details.')
      const lists = Object.fromEntries(
        PERMISSION_KINDS.map((key, i) => [key, checkedPermissionRows(results[i + 1])]),
      ) as Record<PermissionKind, PermissionRow[]>
      setDetails(results[0] as Record<string, unknown>)
      setOriginal(lists)
      setEdited(structuredClone(lists))
    } catch (reason) {
      if (request.current !== controller || controller.signal.aborted) return
      setError(errorText(reason))
    } finally {
      if (request.current === controller) setBusy(false)
    }
  }
  return (
    <div className="space-y-3">
      <AdminReadResource
        title="Users"
        path="rest/portal/getUsers.php"
        columns={[
          { key: 'uid', label: 'User ID' },
          { key: 'uname', label: 'Username' },
          { key: 'fname', label: 'First name' },
          { key: 'lname', label: 'Last name' },
        ]}
        selectionDisabled={busy}
        onSelect={(row) => {
          if (busy) return
          const id = adminId(row.uid)
          if (id) {
            setUid(id)
            setDetails(undefined)
            setOriginal(undefined)
            setEdited(undefined)
            setReview(undefined)
            setAck(false)
            setError('')
            setNotice('')
          }
        }}
        selectLabel={(row) => `Select user ${row.uid}`}
      />
      <label className="grid gap-1 text-sm">
        Existing user ID
        <input
          aria-label="Permission user ID"
          disabled={busy}
          className="rounded border bg-background p-2 text-base"
          inputMode="numeric"
          value={uid}
          onChange={(e) => {
            setUid(e.target.value)
            setDetails(undefined)
            setReview(undefined)
          }}
        />
      </label>
      <Button variant="outline" disabled={busy} onClick={() => void load()}>
        Load user resource permissions
      </Button>
      {details && original && edited && (
        <>
          <p className="text-sm">
            Source user {String(details.uname)} · ID {uid}. Account identity, activation, task flags and password are
            retained.
          </p>
          <TabBar
            label="User permission resource"
            value={kind}
            onChange={setKind}
            options={PERMISSION_KINDS.map((value) => ({ value, label: value.replace(/_/g, ' ') }))}
          />
          <div className="max-h-80 overflow-auto rounded border">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="p-2 text-left">Resource</th>
                  <th>Read / use</th>
                  {['form', 'submission'].includes(kind) && <th>Edit</th>}
                </tr>
              </thead>
              <tbody>
                {edited[kind].map((row) => (
                  <tr key={row.id} className="border-t">
                    <td className="p-2">
                      {row.name} · {row.id}
                    </td>
                    {(['form', 'submission'].includes(kind) ? ['checked', 'editChecked'] : ['checked']).map((key) => (
                      <td key={key} className="p-2 text-center">
                        <input
                          type="checkbox"
                          disabled={busy || !canWrite}
                          aria-label={`${key === 'checked' ? 'Read' : 'Edit'} ${kind} ${row.id}`}
                          checked={row[key as 'checked' | 'editChecked']}
                          onChange={(e) => {
                            setEdited({
                              ...edited,
                              [kind]: edited[kind].map((item) =>
                                item.id === row.id ? { ...item, [key]: e.target.checked } : item,
                              ),
                            })
                            setReview(undefined)
                            setAck(false)
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button
            variant="outline"
            disabled={!canWrite || busy}
            onClick={() => {
              try {
                setReview(userPermissionUpdate(uid, details, original, edited))
                setAck(false)
              } catch (reason) {
                setError(errorText(reason))
              }
            }}
          >
            Review permission changes
          </Button>
          {review && (
            <div className="space-y-3 rounded border p-3">
              <p className="text-sm">
                Apply only the following resource-permission changes for {String(details.uname)} (ID {uid}). The
                original server decides whether this account may apply them.
              </p>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">
                {JSON.stringify(
                  Object.fromEntries(
                    Object.entries(review)
                      .filter(([key]) => key.endsWith('Changes'))
                      .map(([key, value]) => [key, JSON.parse(value)]),
                  ),
                  null,
                  2,
                )}
              </pre>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />I reviewed the target
                user and every access change.
              </label>
              <Button
                disabled={!canWrite || !write || !ack || busy}
                onClick={async () => {
                  setBusy(true)
                  setError('')
                  try {
                    await write!('rest/portal/admin/updateUser.php', review)
                    setNotice('The original server accepted the permission update. Reload to verify.')
                    setReview(undefined)
                    await load()
                  } catch (reason) {
                    setError(errorText(reason))
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                Apply reviewed permission changes
              </Button>
            </div>
          )}
        </>
      )}
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {notice && <InlineAlert>{notice}</InlineAlert>}
    </div>
  )
}
export type PortalAdministrationView =
  | 'dashboard'
  | 'permissions'
  | 'groups'
  | 'forms'
  | 'schemas'
  | 'submissions'
  | 'moderation'
  | 'help'
  | 'system'
export function parsePortalAdministrationView(value: unknown): PortalAdministrationView {
  return typeof value === 'string' &&
    ['dashboard', 'permissions', 'groups', 'forms', 'schemas', 'submissions', 'moderation', 'help', 'system'].includes(
      value,
    )
    ? (value as PortalAdministrationView)
    : 'dashboard'
}
export function PortalAdministration({
  write,
  initialView = 'dashboard',
}: {
  write?: Write
  initialView?: PortalAdministrationView
}) {
  const [view, setView] = useState<PortalAdministrationView>(() => parsePortalAdministrationView(initialView))
  const session = usePortalSession()
  const canWrite = session.isAdmin && session.canWrite
  const protectedView = !['dashboard', 'forms', 'schemas'].includes(view)
  useEffect(() => {
    setView(parsePortalAdministrationView(initialView))
  }, [initialView])
  return (
    <div className="space-y-4" data-nechako-administration>
      <h2 className="text-xl font-semibold">Administration and workflow</h2>
      <p className="text-sm">
        Read source records using your connected account. Reviewed updates use the same source resource IDs and are
        subject to original server permissions. Source HTML is shown as text and is never executed here.
      </p>
      {!canWrite && (
        <InlineAlert>
          {session.isAdmin
            ? 'Your administrator session can inspect source records. This connection is read-only; use the original portal for changes.'
            : 'Connect an authorized account in Account / Connection to inspect administrator records. Source permissions determine which forms, schedules and resources are available.'}{' '}
          Failed or denied reads remain visible; they do not establish empty collections.
        </InlineAlert>
      )}
      <TabBar
        label="Administration area"
        value={view}
        onChange={setView}
        options={[
          { value: 'dashboard', label: 'Dashboard' },
          { value: 'permissions', label: 'Permissions' },
          { value: 'groups', label: 'Groups' },
          { value: 'submissions', label: 'Submissions' },
          { value: 'forms', label: 'Forms' },
          { value: 'schemas', label: 'Schemas' },
          { value: 'moderation', label: 'Layer moderation' },
          { value: 'help', label: 'Help content' },
          { value: 'system', label: 'System' },
        ]}
      />
      <div key={`${session.revision}:${session.isAdmin}`} className="min-w-0">
        {protectedView && !session.isAdmin ? (
          <InlineAlert title="Administrator access required">
            Sign in to an account that the source identifies as an administrator, then reopen this section.
          </InlineAlert>
        ) : (
          <div className="space-y-3">
            {view === 'permissions' && <Permissions write={write} canWrite={canWrite} />}
            {view === 'groups' && <PortalAdminGroups write={write} canWrite={canWrite} />}
            {view === 'forms' && <PortalAdminForms isAdmin={session.isAdmin} />}
            {view === 'schemas' && <PortalAdminSchemas isAdmin={session.isAdmin} />}
            {view === 'submissions' && <PortalAdminSubmissions />}
            {view === 'moderation' && <PortalModeration write={write} canWrite={canWrite} />}
            {view === 'help' && <HelpEditor write={write} canWrite={canWrite} />}
            {view === 'dashboard' && <PortalAdminDashboard />}
            {view === 'system' && <PortalAdminSystem />}
          </div>
        )}
      </div>
      <a href={NECHAKO_PORTAL} target="_blank" rel="noreferrer" className="text-sm text-primary underline">
        Open original administration for other source workflows
      </a>
    </div>
  )
}
