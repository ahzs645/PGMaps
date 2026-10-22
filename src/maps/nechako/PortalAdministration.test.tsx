import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PortalAdministration, parsePortalAdministrationView } from './PortalAdministration'
import { PORTAL_CONNECTION_EVENT } from '@/lib/nechakoPortal'

const fixtures = vi.hoisted(() => ({ read: vi.fn(), status: vi.fn() }))
vi.mock('@/lib/nechakoPortal', async (original) => ({
  ...(await original<typeof import('@/lib/nechakoPortal')>()),
  portalRead: fixtures.read,
  getPortalConnectionStatus: fixtures.status,
  getPortalConnectionMode: () => 'gateway',
}))
vi.mock('@/lib/nechakoConnection', async (original) => ({
  ...(await original<typeof import('@/lib/nechakoConnection')>()),
  isHostedPortalGateway: () => false,
}))

const user = {
  uname: 'private-fixture-user',
  fname: 'Fixture',
  lname: 'User',
  email: 'fixture@example.invalid',
  initial_notification: false,
  initial_permission: 'DEFAULT',
  initial_group: 'DEFAULT',
  active: true,
  can_be_assigned_subs: false,
  can_assign_subs: false,
  can_edit_subs: false,
  boss_permission: false,
}
function text(node: ReactTestInstance | string): string {
  return typeof node === 'string' ? node : node.children.map(text).join('')
}
function button(tree: ReactTestRenderer, label: string): ReactTestInstance {
  const match = tree.root.findAllByType('button').find((node) => text(node) === label)
  if (!match) throw new Error(`Missing button ${label}`)
  return match
}
const tick = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}
let tree: ReactTestRenderer | undefined
beforeEach(() => {
  fixtures.read.mockReset()
  fixtures.status.mockReset()
  fixtures.status.mockResolvedValue({ available: true, loggedIn: true, isAdmin: true, canWrite: false, readOnly: true })
  fixtures.read.mockImplementation(async (path: string) => {
    if (path.endsWith('getUsers.php')) return [{ uid: 7, uname: user.uname, fname: user.fname, lname: user.lname }]
    if (path.endsWith('getUserDetails.php')) return user
    if (path.endsWith('getUserPermissionsCheckbox.php'))
      return [{ id: 39, name: 'Fixture form', checked: false, edit_checked: false }]
    return []
  })
  vi.stubGlobal('window', new EventTarget())
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }))
})
afterEach(() => {
  if (tree) act(() => tree!.unmount())
  tree = undefined
  vi.unstubAllGlobals()
})

describe('administration role and source-read lifecycle', () => {
  it('lets a read-only administrator browse real user IDs without enabling permission mutations', async () => {
    const write = vi.fn()
    await act(async () => {
      tree = create(<PortalAdministration initialView="permissions" write={write} />)
      await tick()
    })
    await act(async () => {
      button(tree!, 'Load users').props.onClick()
      await tick()
    })
    act(() => button(tree!, 'Select user 7').props.onClick())
    expect(tree!.root.findByProps({ 'aria-label': 'Permission user ID' }).props.value).toBe('7')
    await act(async () => {
      button(tree!, 'Load user resource permissions').props.onClick()
      await tick()
    })
    expect(text(tree!.root)).toContain('Source user private-fixture-user')
    expect(tree!.root.findByProps({ 'aria-label': 'Read form 39' }).props.disabled).toBe(true)
    expect(button(tree!, 'Review permission changes').props.disabled).toBe(true)
    expect(write).not.toHaveBeenCalled()
  })

  it('retains reviewed updates for a write-capable admin while never granting them to a non-admin', async () => {
    fixtures.status.mockResolvedValue({ available: true, loggedIn: true, isAdmin: true, canWrite: true })
    await act(async () => {
      tree = create(<PortalAdministration initialView="permissions" write={vi.fn()} />)
      await tick()
    })
    act(() => tree!.root.findByProps({ 'aria-label': 'Permission user ID' }).props.onChange({ target: { value: '7' } }))
    await act(async () => {
      button(tree!, 'Load user resource permissions').props.onClick()
      await tick()
    })
    expect(tree!.root.findByProps({ 'aria-label': 'Read form 39' }).props.disabled).toBe(false)
    expect(button(tree!, 'Review permission changes').props.disabled).toBe(false)
    fixtures.status.mockResolvedValue({ available: true, loggedIn: true, isAdmin: false, canWrite: true })
    await act(async () => {
      window.dispatchEvent(new Event(PORTAL_CONNECTION_EVENT))
      await tick()
    })
    expect(text(tree!.root)).toContain('Administrator access required')
    expect(text(tree!.root)).not.toContain('private-fixture-user')
    expect(tree!.root.findAllByProps({ 'aria-label': 'Read form 39' })).toHaveLength(0)
  })

  it('clears private state immediately on session transition and ignores an in-flight former-identity reply', async () => {
    await act(async () => {
      tree = create(<PortalAdministration initialView="submissions" />)
      await tick()
    })
    let finish!: (value: unknown) => void
    let requestSignal: AbortSignal | undefined
    fixtures.read.mockImplementation((_path, _params, signal) => {
      requestSignal = signal
      return new Promise((resolve) => {
        finish = resolve
      })
    })
    await act(async () => {
      button(tree!, 'Load submission catalogue').props.onClick()
      await tick()
    })
    expect(requestSignal?.aborted).toBe(false)
    act(() => {
      window.dispatchEvent(new CustomEvent(PORTAL_CONNECTION_EVENT, { detail: { reason: 'session-changing' } }))
    })
    expect(requestSignal?.aborted).toBe(true)
    expect(text(tree!.root)).toContain('Administrator access required')
    await act(async () => {
      finish([{ sub_id: 20, sub_title: 'Former private record', sub_state: 'DRAFT' }])
      await tick()
    })
    expect(text(tree!.root)).not.toContain('Former private record')
  })

  it('holds the user selection during a detail read and aborts all permission requests on session change', async () => {
    await act(async () => {
      tree = create(<PortalAdministration initialView="permissions" />)
      await tick()
    })
    await act(async () => {
      button(tree!, 'Load users').props.onClick()
      await tick()
    })
    act(() => button(tree!, 'Select user 7').props.onClick())
    let finish!: (value: unknown) => void
    const signals: AbortSignal[] = []
    fixtures.read.mockImplementation((path: string, _params, signal: AbortSignal) => {
      signals.push(signal)
      return path.endsWith('getUserDetails.php')
        ? new Promise((resolve) => {
            finish = resolve
          })
        : Promise.resolve([])
    })
    await act(async () => {
      button(tree!, 'Load user resource permissions').props.onClick()
      await tick()
    })
    expect(button(tree!, 'Select user 7').props.disabled).toBe(true)
    expect(signals).toHaveLength(6)
    act(() => {
      window.dispatchEvent(new CustomEvent(PORTAL_CONNECTION_EVENT, { detail: { reason: 'session-changing' } }))
    })
    expect(signals.every((signal) => signal.aborted)).toBe(true)
    await act(async () => {
      finish(user)
      await tick()
    })
    expect(text(tree!.root)).not.toContain('private-fixture-user')
    expect(text(tree!.root)).toContain('Administrator access required')
  })

  it('presents a source denial as an error, and an anonymous administrator tab makes no catalogue request', async () => {
    fixtures.read.mockRejectedValue(new Error('Fixture source denied'))
    await act(async () => {
      tree = create(<PortalAdministration initialView="submissions" />)
      await tick()
    })
    await act(async () => {
      button(tree!, 'Load submission catalogue').props.onClick()
      await tick()
    })
    expect(text(tree!.root)).toContain('Fixture source denied')
    expect(text(tree!.root)).not.toContain('0 distinct submission IDs')
    act(() => tree!.unmount())
    tree = undefined
    fixtures.read.mockClear()
    fixtures.status.mockResolvedValue({ available: true, loggedIn: false, isAdmin: false, canWrite: false })
    await act(async () => {
      tree = create(<PortalAdministration initialView="system" />)
      await tick()
    })
    expect(text(tree!.root)).toContain('Administrator access required')
    expect(fixtures.read).not.toHaveBeenCalled()
  })

  it('validates URL section selectors and falls back to the workflow dashboard', () => {
    for (const value of ['submissions', 'schemas', 'system', 'permissions'])
      expect(parsePortalAdministrationView(value)).toBe(value)
    for (const value of ['', 'unknown', '__proto__', null, {}, 7])
      expect(parsePortalAdministrationView(value)).toBe('dashboard')
  })
})
