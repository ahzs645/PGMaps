import { NativeSelect } from '@/components/ui/form-field'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { portalRead, errorText } from '@/lib/nechakoPortal'
type Member = { uid: number; name: string; member: boolean; primary: boolean }
export function PortalAdminGroups({
  write,
  canWrite,
}: {
  write?: (path: string, params: Record<string, string>) => Promise<unknown>
  canWrite: boolean
}) {
  const [groups, setGroups] = useState<Record<string, unknown>[]>([]),
    [gid, setGid] = useState(''),
    [original, setOriginal] = useState<Member[]>([]),
    [edited, setEdited] = useState<Member[]>([]),
    [review, setReview] = useState<Record<string, string>>(),
    [ack, setAck] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const run = async (operation: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await operation()
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }
  const load = async () => {
    if (!/^[1-9]\d*$/.test(gid)) throw new Error('Choose an existing group.')
    const [members, users] = await Promise.all([
      portalRead('rest/portal/admin/getGroupMembers.php', { gid, includePrimaryGroupStatus: 'true' }),
      portalRead('rest/portal/getUsers.php'),
    ])
    if (!Array.isArray(members) || !Array.isArray(users)) throw new Error('Invalid source group roster.')
    const list: Member[] = users
      .map((user) => {
        const member = members.find((row) => String(row.uid) === String(user.uid))
        return {
          uid: Number(user.uid),
          name: String(user.uname || user.uid),
          member: !!member,
          primary: member?.primary_group === true || member?.primary_group === 't',
        }
      })
      .filter((user) => Number.isSafeInteger(user.uid) && user.uid > 0)
    setOriginal(list)
    setEdited(structuredClone(list))
    setReview(undefined)
    setAck(false)
  }
  return (
    <div className="space-y-3">
      <Button
        variant="outline"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const rows = await portalRead('rest/portal/admin/getGroups.php')
            if (!Array.isArray(rows)) throw new Error('Invalid group list.')
            setGroups(rows)
          })
        }
      >
        Load original groups
      </Button>
      <label className="grid gap-1 text-sm">
        Existing group
        <NativeSelect
          aria-label="Administration group"
          className="rounded border bg-background p-2 text-base"
          disabled={busy}
          value={gid}
          onChange={(e) => {
            setGid(e.target.value)
            setEdited([])
            setOriginal([])
            setReview(undefined)
          }}
        >
          <option value="">Choose a group</option>
          {groups.map((group) => (
            <option key={String(group.gid)} value={String(group.gid)}>
              {String(group.gname)} · {String(group.count)} members
            </option>
          ))}
        </NativeSelect>
      </label>
      <Button variant="outline" disabled={busy || !gid} onClick={() => void run(load)}>
        Load group membership
      </Button>
      {edited.length > 0 && (
        <>
          <div className="max-h-80 overflow-auto rounded border">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="p-2 text-left">User</th>
                  <th>Member</th>
                  <th>Primary group</th>
                </tr>
              </thead>
              <tbody>
                {edited.map((user) => (
                  <tr key={user.uid} className="border-t">
                    <td className="p-2">
                      {user.name} · {user.uid}
                    </td>
                    {(['member', 'primary'] as const).map((key) => (
                      <td key={key} className="p-2 text-center">
                        <input
                          type="checkbox"
                          disabled={!canWrite || busy || (key === 'primary' && !user.member)}
                          aria-label={`${key} user ${user.uid}`}
                          checked={user[key]}
                          onChange={(e) => {
                            setEdited(
                              edited.map((row) =>
                                row.uid === user.uid
                                  ? {
                                      ...row,
                                      [key]: e.target.checked,
                                      ...(key === 'member' && !e.target.checked ? { primary: false } : {}),
                                    }
                                  : row,
                              ),
                            )
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
              const added = edited
                  .filter((row) => row.member && !original.find((old) => old.uid === row.uid)?.member)
                  .map((row) => ({ uid: row.uid, primary_group: row.primary })),
                removed = edited
                  .filter((row) => !row.member && original.find((old) => old.uid === row.uid)?.member)
                  .map((row) => row.uid),
                toggled = edited
                  .filter(
                    (row) =>
                      row.member &&
                      original.find((old) => old.uid === row.uid)?.member &&
                      row.primary !== original.find((old) => old.uid === row.uid)?.primary,
                  )
                  .map((row) => ({ uid: row.uid, value: row.primary }))
              setReview({
                gid,
                addedUsers: JSON.stringify(added),
                removedUsers: JSON.stringify(removed),
                primaryToggledUsers: JSON.stringify(toggled),
              })
            }}
          >
            Review group membership changes
          </Button>
          {review && (
            <div className="space-y-3 rounded border p-3">
              <p className="text-sm">
                These changes affect original group {groups.find((group) => String(group.gid) === gid)?.gname as string}{' '}
                (ID {gid}). Access to group-shared resources can change.
              </p>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">
                {JSON.stringify(
                  Object.fromEntries(
                    Object.entries(review).map(([key, value]) => [key, key === 'gid' ? value : JSON.parse(value)]),
                  ),
                  null,
                  2,
                )}
              </pre>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />I reviewed membership
                and primary-group changes.
              </label>
              <Button
                disabled={!write || !canWrite || !ack || busy}
                onClick={() =>
                  void run(async () => {
                    await write!('rest/portal/admin/updateGroup.php', review)
                    setNotice('Source accepted the group update. Reload membership to verify.')
                    await load()
                  })
                }
              >
                Apply reviewed group update
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
