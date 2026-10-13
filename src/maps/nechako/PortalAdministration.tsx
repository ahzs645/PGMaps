import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { TabBar } from '@/components/ui/tab-bar'
import { portalRead, errorText, getPortalConnectionStatus, getPortalConnectionMode, NECHAKO_PORTAL } from '@/lib/nechakoPortal'
import { CheckState, useReadCheck } from './PortalChecks'
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

type Write = (path: string, params: Record<string, string>) => Promise<unknown>
function Resource({ title, path, params }: { title: string; path: string; params?: Record<string, string> }) {
  const state = useReadCheck()
  return (
    <section className="space-y-3 rounded-lg border p-3">
      <h3 className="font-medium">{title}</h3>
      <Button size="sm" variant="outline" onClick={() => void state.run(path, params)} disabled={state.loading}>
        Load {title.toLowerCase()}
      </Button>
      <CheckState {...state} />
    </section>
  )
}
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
        Load editable help content
      </Button>
      {check.error && <InlineAlert tone="error">{check.error}</InlineAlert>}
      <label className="grid gap-1 text-sm">
        Source content
        <select
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
        </select>
      </label>
      {selected && (
        <>
          <label className="grid gap-1 text-sm">
            Help HTML source
            <textarea
              aria-label="Help content source"
              disabled={busy}
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
    setBusy(true)
    setDetails(undefined)
    setOriginal(undefined)
    setEdited(undefined)
    setReview(undefined)
    setError('')
    try {
      if (!/^[1-9]\d*$/.test(uid)) throw new Error('Enter an existing positive numeric user ID.')
      const results = await Promise.all([
        portalRead('rest/portal/admin/getUserDetails.php', { uid }),
        ...PERMISSION_KINDS.map((mode) =>
          portalRead('rest/portal/admin/getUserPermissionsCheckbox.php', { uid, mode }),
        ),
      ])
      if (!results[0] || typeof results[0] !== 'object') throw new Error('Invalid source user details.')
      const lists = Object.fromEntries(
        PERMISSION_KINDS.map((key, i) => [key, checkedPermissionRows(results[i + 1])]),
      ) as Record<PermissionKind, PermissionRow[]>
      setDetails(results[0] as Record<string, unknown>)
      setOriginal(lists)
      setEdited(structuredClone(lists))
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-3">
      <Resource title="Users" path="rest/portal/getUsers.php" />
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
                          disabled={busy}
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
export function PortalAdministration({ write }: { write?: Write }) {
  const [view, setView] = useState<'permissions' | 'groups' | 'forms' | 'moderation' | 'help' | 'dashboard'>(
      'dashboard',
    ),
    [canWrite, setCanWrite] = useState(false),
    [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  useEffect(() => {
    const controller = new AbortController()
    void getPortalConnectionStatus(controller.signal)
      .then((status) => setCanWrite(getPortalConnectionMode()==='gateway' && !!status.loggedIn && status.canWrite === true && status.isAdmin === true))
      .catch(() => {})
    return () => controller.abort()
  }, [])
  return (
    <div className="space-y-4" data-nechako-administration>
      <h2 className="text-xl font-semibold">Administration and workflow</h2>
      <p className="text-sm">
        Read source records using your connected account. Reviewed updates use the same source resource IDs and are
        subject to original server permissions. Source HTML is shown as text and is never executed here.
      </p>
      {!canWrite && (
        <InlineAlert>
          Connect an authorized account in Account / Connection to enable supported source updates. Failed or denied
          reads remain visible; they do not establish empty collections.
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
          { value: 'forms', label: 'Forms and schemas' },
          { value: 'moderation', label: 'Layer moderation' },
          { value: 'help', label: 'Help content' },
        ]}
      />
      {view === 'permissions' && <Permissions write={write} canWrite={canWrite} />}
      {view === 'groups' && <PortalAdminGroups write={write} canWrite={canWrite} />}
      {view === 'forms' && (
        <div className="space-y-3">
          <Resource title="Forms" path="rest/portal/getForms.php" params={{ page: '1', start: '0', limit: '100' }} />
          <Resource title="Schemas" path="rest/portal/getSchemas.php" />
        </div>
      )}
      {view === 'moderation' && <PortalModeration write={write} canWrite={canWrite} />}
      {view === 'help' && <HelpEditor write={write} canWrite={canWrite} />}
      {view === 'dashboard' && (
        <div className="space-y-3">
          <label className="grid gap-1 text-sm">
            Workflow date
            <input aria-label="Workflow date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          {date && (
            <Resource
              key={date}
              title="Tasks for selected day"
              path="rest/portal/schedule.php"
              params={{ mode: 'date', date: new Date(`${date}T00:00:00`).toISOString() }}
            />
          )}
          <Resource title="Task statuses" path="rest/portal/getTaskStatuses.php" />
          <Resource title="Priorities" path="rest/portal/getPriorities.php" />
          <Resource title="Source layer defaults" path="rest/portal/admin/getAllBaseLayers.php" />
        </div>
      )}
      <a href={NECHAKO_PORTAL} target="_blank" rel="noreferrer" className="text-sm text-primary underline">
        Open original administration for other source workflows
      </a>
    </div>
  )
}
