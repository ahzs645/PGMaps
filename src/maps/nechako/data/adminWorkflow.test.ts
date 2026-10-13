import { describe, it, expect } from 'vitest'
import {
  checkedPermissionRows,
  permissionChanges,
  userPermissionUpdate,
  PERMISSION_KINDS,
  type PermissionKind,
  type PermissionRow,
} from './adminWorkflow'
const details = {
  uname: 'reviewer',
  fname: 'Existing',
  lname: 'User',
  email: 'fixture@example.invalid',
  initial_notification: null,
  initial_permission: 'DEFAULT',
  initial_group: 'DEFAULT',
  active: true,
  can_be_assigned_subs: false,
  can_assign_subs: false,
  can_edit_subs: false,
  boss_permission: false,
}
const original = Object.fromEntries(
  PERMISSION_KINDS.map((kind) => [kind, [{ id: 4, name: 'Resource', checked: false, editChecked: false }]]),
) as Record<PermissionKind, PermissionRow[]>
describe('source administration permission review', () => {
  it('retains identity/flags and sends only reviewed resource deltas without password/email/group changes', () => {
    const edited = structuredClone(original)
    edited.form[0].checked = true
    edited.form[0].editChecked = true
    const params = userPermissionUpdate('77', details, original, edited)
    expect(JSON.parse(params.newData)).toEqual(details)
    expect(params.newPassword).toBe('')
    expect(JSON.parse(params.formPermissionChanges)).toEqual([{ id: 4, checked: true, editChecked: true }])
    expect(JSON.parse(params.sharedProjectPermissionChanges)).toEqual([])
    expect(params).not.toHaveProperty('primary_group')
    expect(params).not.toHaveProperty('email')
  })
  it('rejects partial identity payloads, unknown or duplicated permission IDs and invalid flags', () => {
    expect(() => userPermissionUpdate('77', { uname: 'reviewer' }, original, original)).toThrow('partial account')
    expect(() => permissionChanges(original.form, [{ ...original.form[0], id: 5 }], true)).toThrow('unknown')
    expect(() => checkedPermissionRows([{ id: 4, name: 'Resource', checked: 'uncertain' }])).toThrow('Unrecognized')
    expect(() =>
      permissionChanges(original.form, [{ ...original.form[0], checked: 1 as unknown as boolean }], true),
    ).toThrow()
  })
  it('matches native Postgres boolean flags without string-false becoming a grant', () => {
    expect(checkedPermissionRows([{ id: '4', name: 'Resource', checked: 'f', edit_checked: 't' }])).toEqual([
      { id: 4, name: 'Resource', checked: false, editChecked: true },
    ])
  })
})
