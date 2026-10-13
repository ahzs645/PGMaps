export type PermissionKind = 'form' | 'submission' | 'match_preset' | 'shared_style' | 'shared_project'
export const PERMISSION_KINDS: PermissionKind[] = [
  'form',
  'submission',
  'match_preset',
  'shared_style',
  'shared_project',
]
export type PermissionRow = { id: number; name: string; checked: boolean; editChecked: boolean }
const sourceBoolean = (value: unknown) => {
  if (value === true || value === 1 || value === 't' || value === 'true') return true
  if (value === false || value === 0 || value === 'f' || value === 'false' || value === null || value === undefined)
    return false
  throw new Error('Unrecognized source permission flag.')
}
export function checkedPermissionRows(raw: unknown): PermissionRow[] {
  if (!Array.isArray(raw) || raw.length > 10000) throw new Error('Invalid permission resource list.')
  return raw.map((row) => {
    const id = Number(row.id)
    if (!Number.isSafeInteger(id) || id <= 0 || typeof row.name !== 'string')
      throw new Error('Invalid permission resource.')
    return { id, name: row.name, checked: sourceBoolean(row.checked), editChecked: sourceBoolean(row.edit_checked) }
  })
}
export function permissionChanges(original: PermissionRow[], edited: PermissionRow[], withEdit: boolean) {
  const source = new Map(original.map((row) => [row.id, row]))
  if (edited.length !== original.length) throw new Error('Permission review must retain the original resource set.')
  const ids = new Set<number>()
  const changes = edited.flatMap((row) => {
    const before = source.get(row.id)
    if (!before || ids.has(row.id) || typeof row.checked !== 'boolean' || typeof row.editChecked !== 'boolean')
      throw new Error('Permission review has an unknown, duplicate or invalid resource.')
    ids.add(row.id)
    if (row.checked === before.checked && (!withEdit || row.editChecked === before.editChecked)) return []
    return [
      withEdit
        ? { id: row.id, checked: row.checked, editChecked: row.editChecked }
        : { id: row.id, checked: row.checked },
    ]
  })
  if (changes.length > 500) throw new Error('Review at most 500 permission changes at a time.')
  return changes
}
export function userPermissionUpdate(
  uid: string,
  details: Record<string, unknown>,
  original: Record<PermissionKind, PermissionRow[]>,
  edited: Record<PermissionKind, PermissionRow[]>,
) {
  if (!/^[1-9]\d*$/.test(uid)) throw new Error('Select an existing user ID.')
  const keys = [
    'uname',
    'fname',
    'lname',
    'email',
    'initial_notification',
    'initial_permission',
    'initial_group',
    'active',
    'can_be_assigned_subs',
    'can_assign_subs',
    'can_edit_subs',
    'boss_permission',
  ]
  const data: Record<string, unknown> = {}
  for (const key of keys) {
    if (!(key in details)) throw new Error(`Source user details omit ${key}; refusing a partial account update.`)
    data[key] = details[key]
  }
  const names = [
    'formPermissionChanges',
    'submissionPermissionChanges',
    'matchPresetPermissionChanges',
    'sharedStylePermissionChanges',
    'sharedProjectPermissionChanges',
  ]
  const params: Record<string, string> = { uid, newData: JSON.stringify(data), newPassword: '' }
  PERMISSION_KINDS.forEach((kind, i) => {
    params[names[i]] = JSON.stringify(permissionChanges(original[kind], edited[kind], i < 2))
  })
  return params
}
export function sourceContentText(content: string) {
  const doc = new DOMParser().parseFromString(content, 'text/html')
  doc.querySelectorAll('script,style,iframe').forEach((node) => node.remove())
  return doc.body.textContent || ''
}
