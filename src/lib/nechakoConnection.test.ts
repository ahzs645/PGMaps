import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
const status = { available: true, loggedIn: false, readOnly: true, canWrite: false, csrfToken: 'fixture-csrf' }

beforeEach(() => vi.resetModules())
afterEach(() => vi.unstubAllGlobals())

describe('isolated portal gateway transport', () => {
  it('defaults to direct anonymous reads and rejects foreign endpoint URLs', async () => {
    const portal = await import('./nechakoPortal')
    expect(portal.getPortalConnectionMode()).toBe('direct')
    const fetch = vi.fn().mockResolvedValue(response({ status: 'success', attributes: [] }))
    vi.stubGlobal('fetch', fetch)
    await expect(portal.portalRead('https://untrusted.example/resource')).rejects.toThrow('relative native REST')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('uses same-origin JSON gateway transport without browser identity-header spoofing', async () => {
    const portal = await import('./nechakoPortal')
    portal.setPortalConnectionMode('gateway')
    const fetch = vi
      .fn()
      .mockResolvedValue(response({ status: 'success', attributes: { results: [{ sub_id: 1477 }] } }))
    vi.stubGlobal('fetch', fetch)
    expect(
      await portal.portalRead('rest/portal/getSearchResults.php', { keys: '{}', fields: '[]', area: 'null' }),
    ).toEqual({ results: [{ sub_id: 1477 }] })
    const [url, options] = fetch.mock.calls[0]
    expect(url).toBe('/api/nechako-portal/read')
    expect(options.credentials).toBe('same-origin')
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(options.body)).toEqual({
      path: 'rest/portal/getSearchResults.php',
      params: { keys: '{}', fields: '[]', area: 'null' },
    })
  })

  it('does not fall back to anonymous transport when a selected gateway fails', async () => {
    const portal = await import('./nechakoPortal')
    portal.setPortalConnectionMode('gateway')
    const fetch = vi.fn().mockRejectedValue(new TypeError('Network failed'))
    vi.stubGlobal('fetch', fetch)
    await expect(portal.portalRead('rest/portal/getForms.php')).rejects.toThrow('gateway is unavailable')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('requests descriptor-bound layer attributes using only source IDs', async () => {
    const portal = await import('./nechakoPortal')
    const fetch = vi
      .fn()
      .mockResolvedValue(
        response({ status: 'success', attributes: { attributes: ['schema_rec_seq_id'], rows: [[1]], type: ['int'] } }),
      )
    vi.stubGlobal('fetch', fetch)
    await expect(portal.portalLayerAttributes(1477, 386)).rejects.toThrow('local gateway')
    portal.setPortalConnectionMode('gateway')
    await expect(portal.portalLayerAttributes(1477, -1)).rejects.toThrow('source submission and layer IDs')
    expect(fetch).not.toHaveBeenCalled()
    expect(await portal.portalLayerAttributes(1477, 386)).toEqual({
      attributes: ['schema_rec_seq_id'],
      rows: [[1]],
      type: ['int'],
    })
    expect(fetch.mock.calls[0][0]).toBe('/api/nechako-portal/layer-attributes')
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ submissionId: '1477', layerId: '386' })
  })

  it('persists only the selected nonsecret connection mode and restores it after reload', async () => {
    const setItem = vi.fn()
    vi.stubGlobal('window', { localStorage: { getItem: () => 'gateway', setItem }, dispatchEvent: vi.fn() })
    vi.stubGlobal(
      'CustomEvent',
      class extends Event {
        constructor(name: string) {
          super(name)
        }
      },
    )
    const portal = await import('./nechakoPortal')
    expect(portal.getPortalConnectionMode()).toBe('gateway')
    portal.setPortalConnectionMode('direct')
    expect(setItem).toHaveBeenCalledWith('pgmaps-nechako-connection-mode', 'direct')
  })

  it('retains native permission and registration errors from the gateway', async () => {
    const portal = await import('./nechakoPortal')
    portal.setPortalConnectionMode('gateway')
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(response({ success: true, status: 'failure', error: 'Permission denied', loggedIn: true })),
    )
    await expect(portal.portalRead('rest/portal/getSubmissionMetadata.php', { submissionId: '1477' })).rejects.toThrow(
      'Permission denied',
    )
  })

  it('requires a signed-in gateway and attaches its current per-session CSRF token to a confirmed write', async () => {
    const portal = await import('./nechakoPortal')
    vi.stubGlobal('fetch', vi.fn())
    await expect(portal.portalWrite('rest/openmap/setDefaultProject.php', { projectId: '4' })).rejects.toThrow(
      'signed-in local gateway',
    )
    portal.setPortalConnectionMode('gateway')
    const fetch = vi.fn().mockResolvedValueOnce(response(status))
    vi.stubGlobal('fetch', fetch)
    await expect(portal.portalWrite('rest/openmap/setDefaultProject.php', { projectId: '4' })).rejects.toThrow(
      'Sign in',
    )
    expect(fetch).toHaveBeenCalledTimes(1)
    fetch
      .mockResolvedValueOnce(
        response({ ...status, loggedIn: true, readOnly: false, canWrite: true, csrfToken: 'new-session-csrf' }),
      )
      .mockResolvedValueOnce(response({ status: 'success', attributes: { default_project_id: 4 } }))
    expect(await portal.portalWrite('rest/openmap/setDefaultProject.php', { projectId: '4' })).toEqual({
      default_project_id: 4,
    })
    expect(fetch.mock.calls[2][1].headers).toEqual({
      'Content-Type': 'application/json',
      'X-Nechako-CSRF': 'new-session-csrf',
    })
  })

  it('broadcasts identity revision metadata only and invalidates other-tab session tokens', async () => {
    const dispatchEvent = vi.fn()
    const postMessage = vi.fn()
    const channels: { onmessage?: (event: { data: unknown }) => void }[] = []
    vi.stubGlobal('window', { dispatchEvent })
    vi.stubGlobal(
      'CustomEvent',
      class extends Event {
        detail: unknown
        constructor(name: string, init: { detail: unknown }) {
          super(name)
          this.detail = init.detail
        }
      },
    )
    vi.stubGlobal(
      'BroadcastChannel',
      class {
        onmessage?: (event: { data: unknown }) => void
        postMessage = postMessage
        constructor() {
          channels.push(this)
        }
      },
    )
    const portal = await import('./nechakoPortal')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response({ ...status, loggedIn: true, readOnly: false, canWrite: true })),
    )
    await portal.connectPortalSession('fixture-user', 'fixture-password')
    expect(postMessage).toHaveBeenCalledWith({ reason: 'signed-in' })
    expect(JSON.stringify(postMessage.mock.calls)).not.toMatch(/fixture-user|fixture-password|fixture-csrf/)
    channels[0]?.onmessage?.({ data: { reason: 'disconnected' } })
    expect(dispatchEvent.mock.calls.at(-1)?.[0].detail).toEqual({
      reason: 'external-session',
      sourceReason: 'disconnected',
    })
  })
})

it('invalidates local and other-tab protected views before delayed logout and failed reauthentication', async () => {
  const dispatchEvent = vi.fn(),
    postMessage = vi.fn()
  vi.stubGlobal('window', { dispatchEvent })
  vi.stubGlobal(
    'CustomEvent',
    class extends Event {
      detail: unknown
      constructor(name: string, init: { detail: unknown }) {
        super(name)
        this.detail = init.detail
      }
    },
  )
  vi.stubGlobal(
    'BroadcastChannel',
    class {
      postMessage = postMessage
    },
  )
  const portal = await import('./nechakoPortal')
  let complete!: (value: Response) => void
  const fetch = vi.fn().mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        complete = resolve
      }),
  )
  vi.stubGlobal('fetch', fetch)
  const disconnect = portal.disconnectPortalSession()
  expect(dispatchEvent.mock.calls.at(-1)?.[0].detail).toEqual({ reason: 'session-changing' })
  expect(postMessage).toHaveBeenCalledWith({ reason: 'session-changing' })
  complete(response(status))
  await disconnect
  const attempt = portal.connectPortalSession('fixture-user', 'fixture-password')
  expect(dispatchEvent.mock.calls.at(-1)?.[0].detail).toEqual({ reason: 'session-changing' })
  complete(response({ error: 'Login rejected' }, 403))
  await expect(attempt).rejects.toThrow('Login rejected')
  expect(dispatchEvent.mock.calls.at(-1)?.[0].detail).toEqual({ reason: 'session-changing' })
  expect(JSON.stringify(postMessage.mock.calls)).not.toMatch(/fixture-user|fixture-password/)
})
