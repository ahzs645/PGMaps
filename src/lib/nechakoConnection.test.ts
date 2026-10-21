import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
const status = { available: true, loggedIn: false, readOnly: true, canWrite: false, csrfToken: 'fixture-csrf' }

beforeEach(() => vi.resetModules())
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

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
  expect(dispatchEvent.mock.calls.at(-1)?.[0].detail).toEqual({ reason: 'disconnected' })
  expect(JSON.stringify(postMessage.mock.calls)).not.toMatch(/fixture-user|fixture-password/)
})

const HOSTED = 'https://fixture-gateway.example/api/nechako-portal'
const ANON = 'A'.repeat(64),
  SIGNED = 'B'.repeat(64),
  FRESH = 'C'.repeat(64)
const hostedStatus = { available: true, loggedIn: false, readOnly: true, canWrite: false, isAdmin: false }
const tick = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('hosted portal capabilities', () => {
  beforeEach(() => vi.stubEnv('VITE_NECHAKO_GATEWAY_URL', HOSTED))
  it('preserves source-verified administrator inspection while rejecting both hosted write paths', async () => {
    const connection = await import('./nechakoConnection')
    const fetch = vi.fn().mockImplementation((url) =>
      Promise.resolve(
        response({
          ...hostedStatus,
          loggedIn: true,
          isAdmin: true,
          readOnly: false,
          canWrite: true,
          ...(url.endsWith('/login') ? { sessionToken: SIGNED } : {}),
        }),
      ),
    )
    vi.stubGlobal('fetch', fetch)
    // A status without a capability cannot establish a hosted administrator.
    expect(await connection.getPortalConnectionStatus()).toMatchObject({ isAdmin: false, canWrite: false })
    expect(await connection.connectPortalSession('fixture-user', 'fixture-password')).toMatchObject({
      loggedIn: true,
      isAdmin: true,
      canWrite: false,
      readOnly: true,
    })
    expect(await connection.getPortalConnectionStatus()).toMatchObject({ isAdmin: true, canWrite: false })
    expect(fetch.mock.calls.at(-1)?.[1].headers['X-Nechako-Session']).toBe(SIGNED)
    const before = fetch.mock.calls.length
    await expect(connection.gatewayWrite('rest/portal/admin/setContent.php', {})).rejects.toThrow('read-only')
    await expect(connection.gatewayRequest('write', {})).rejects.toThrow('read-only')
    expect(fetch).toHaveBeenCalledTimes(before)
  })
  it.each([undefined, false, 'true', 1, null])(
    'does not infer an administrator from username or a nonboolean role (%s)',
    async (isAdmin) => {
      const connection = await import('./nechakoConnection')
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(response({ ...hostedStatus, loggedIn: true, isAdmin, sessionToken: SIGNED })),
      )
      expect(await connection.connectPortalSession('admin', 'fixture-password')).toMatchObject({
        loggedIn: true,
        isAdmin: false,
        readOnly: true,
        canWrite: false,
      })
    },
  )
  it('suppresses administrator status during logout and after a contradictory anonymous status', async () => {
    const connection = await import('./nechakoConnection')
    let finishLogout!: (value: Response) => void
    let loggedIn = true
    const fetch = vi.fn().mockImplementation((url) => {
      if (url.endsWith('/login'))
        return Promise.resolve(response({ ...hostedStatus, loggedIn: true, isAdmin: true, sessionToken: SIGNED }))
      if (url.endsWith('/disconnect'))
        return new Promise((resolve) => {
          finishLogout = resolve
        })
      return Promise.resolve(response({ ...hostedStatus, loggedIn, isAdmin: true }))
    })
    vi.stubGlobal('fetch', fetch)
    await connection.connectPortalSession('fixture-user', 'fixture-password')
    const disconnect = connection.disconnectPortalSession()
    expect(await connection.getPortalConnectionStatus()).toMatchObject({ loggedIn: false, isAdmin: false })
    expect(fetch.mock.calls.at(-1)?.[1].headers['X-Nechako-Session']).toBeUndefined()
    finishLogout(response({ ...hostedStatus, isAdmin: true }))
    expect(await disconnect).toMatchObject({ loggedIn: false, isAdmin: false, canWrite: false })
    loggedIn = false
    expect(await connection.getPortalConnectionStatus()).toMatchObject({ loggedIn: false, isAdmin: false })
  })
  it('defaults hosted access to the connection, respects explicit public mode, and rejects insecure bases', async () => {
    const connection = await import('./nechakoConnection')
    expect(connection.getPortalConnectionMode()).toBe('gateway')
    expect(connection.isHostedPortalGateway()).toBe(true)
    for (const url of [
      'http://fixture.example/api',
      'https://user:password@fixture.example/api',
      'https://fixture.example/api?token=x',
      'https://fixture.example/api#token',
    ])
      expect(() => connection.checkedPortalGatewayUrl(url)).toThrow()
    vi.resetModules()
    vi.stubGlobal('window', { localStorage: { getItem: () => 'direct' } })
    expect((await import('./nechakoConnection')).getPortalConnectionMode()).toBe('direct')
    vi.resetModules()
    vi.stubEnv('VITE_NECHAKO_GATEWAY_URL', 'http://fixture.example/api')
    const invalid = await import('./nechakoConnection')
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(invalid.getPortalConnectionStatus()).rejects.toThrow('HTTPS')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('peeks status without allocating and singleflights anonymous bootstrap for parallel native reads', async () => {
    const connection = await import('./nechakoConnection')
    let allocate!: (value: Response) => void
    const fetch = vi.fn().mockImplementation((url, options) => {
      if (url.endsWith('/status') && options.method === 'POST')
        return new Promise((resolve) => {
          allocate = resolve
        })
      if (url.endsWith('/status')) return Promise.resolve(response(hostedStatus))
      return Promise.resolve(response({ status: 'success', loggedIn: false, attributes: [] }))
    })
    vi.stubGlobal('fetch', fetch)
    await connection.getPortalConnectionStatus()
    await connection.getPortalConnectionStatus()
    expect(fetch.mock.calls.every(([, options]) => options.method === undefined)).toBe(true)
    const a = connection.gatewayRequest('read', { path: 'rest/portal/getChildren.php', params: { parentId: '9' } })
    const b = connection.gatewayRequest('read', { path: 'rest/portal/getHistory.php', params: { sub_id: '9' } })
    expect(fetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1)
    allocate(response({ ...hostedStatus, sessionToken: ANON }))
    await Promise.all([a, b])
    await connection.getPortalConnectionStatus()
    expect(
      fetch.mock.calls.filter(([url, options]) => url.endsWith('/status') && options.method === 'POST'),
    ).toHaveLength(1)
    for (const [url, options] of fetch.mock.calls) {
      expect(options.credentials).toBe('omit')
      if (url.endsWith('/read')) expect(options.headers['X-Nechako-Session']).toBe(ANON)
      expect(options.headers['X-Nechako-CSRF']).toBeUndefined()
    }
  })
  it('rotates login capabilities and discards old status/read responses even when their transport ignores abort', async () => {
    const connection = await import('./nechakoConnection')
    let lateStatus!: (value: Response) => void, lateRead!: (value: Response) => void
    let hold = false
    const fetch = vi.fn().mockImplementation((url, options) => {
      if (url.endsWith('/login'))
        return Promise.resolve(
          response({ ...hostedStatus, loggedIn: true, canWrite: true, isAdmin: true, sessionToken: SIGNED }),
        )
      if (url.endsWith('/status') && options.method === 'POST')
        return Promise.resolve(response({ ...hostedStatus, sessionToken: ANON }))
      if (url.endsWith('/status') && hold) {
        hold = false
        return new Promise((resolve) => {
          lateStatus = resolve
        })
      }
      if (url.endsWith('/read') && hold) {
        hold = false
        return new Promise((resolve) => {
          lateRead = resolve
        })
      }
      return Promise.resolve(
        response(url.endsWith('/status') ? { ...hostedStatus, loggedIn: true } : { status: 'success', attributes: [] }),
      )
    })
    vi.stubGlobal('fetch', fetch)
    await connection.gatewayRequest('read', {})
    hold = true
    const oldStatus = connection.getPortalConnectionStatus()
    const statusFailure = expect(oldStatus).rejects.toMatchObject({ name: 'AbortError' })
    hold = true
    const oldRead = connection.gatewayRequest('read', {})
    const readFailure = expect(oldRead).rejects.toMatchObject({ name: 'AbortError' })
    await tick()
    const next = await connection.connectPortalSession('fixture-user', 'fixture-password')
    expect(next).toMatchObject({ loggedIn: true, readOnly: true, canWrite: false, isAdmin: true })
    lateStatus(response({ ...hostedStatus, loggedIn: true, isAdmin: true, sessionToken: ANON }))
    lateRead(response({ status: 'success', loggedIn: true, attributes: [{ secret: 'previous identity' }] }))
    await Promise.all([statusFailure, readFailure])
    await connection.getPortalConnectionStatus()
    expect(fetch.mock.calls.at(-1)?.[1].headers['X-Nechako-Session']).toBe(SIGNED)
    const before = fetch.mock.calls.length
    await expect(connection.gatewayWrite('rest/portal/setContent.php', {})).rejects.toThrow('read-only')
    expect(fetch).toHaveBeenCalledTimes(before)
  })
  it('retains only the new anonymous capability after failed login and never restores the revoked identity', async () => {
    const connection = await import('./nechakoConnection')
    let attempt = 0
    const fetch = vi.fn().mockImplementation((url) => {
      if (url.endsWith('/login'))
        return Promise.resolve(
          ++attempt === 1
            ? response({ ...hostedStatus, loggedIn: true, sessionToken: SIGNED })
            : response({ error: 'Source login rejected', loggedIn: false, sessionToken: FRESH }, 401),
        )
      return Promise.resolve(response(hostedStatus))
    })
    vi.stubGlobal('fetch', fetch)
    await connection.connectPortalSession('fixture-user', 'fixture-password')
    await expect(connection.connectPortalSession('fixture-user', 'incorrect-fixture-password')).rejects.toThrow(
      'Source login rejected',
    )
    await connection.getPortalConnectionStatus()
    expect(fetch.mock.calls.at(-1)?.[1].headers['X-Nechako-Session']).toBe(FRESH)
  })
  it('rejects a late anonymous bootstrap after a newer login establishes its capability', async () => {
    const connection = await import('./nechakoConnection')
    let finishBootstrap!: (value: Response) => void
    const fetch = vi.fn().mockImplementation((url, options) => {
      if (url.endsWith('/status') && options.method === 'POST')
        return new Promise((resolve) => {
          finishBootstrap = resolve
        })
      if (url.endsWith('/login'))
        return Promise.resolve(response({ ...hostedStatus, loggedIn: true, sessionToken: SIGNED }))
      return Promise.resolve(response({ ...hostedStatus, loggedIn: true }))
    })
    vi.stubGlobal('fetch', fetch)
    const oldRead = connection.gatewayRequest('read', {}),
      rejected = expect(oldRead).rejects.toMatchObject({ name: 'AbortError' })
    await connection.connectPortalSession('fixture-user', 'fixture-password')
    finishBootstrap(response({ ...hostedStatus, sessionToken: ANON }))
    await rejected
    await connection.getPortalConnectionStatus()
    expect(fetch.mock.calls.at(-1)?.[1].headers['X-Nechako-Session']).toBe(SIGNED)
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/read'))).toHaveLength(0)
  })
  it('clears expired/reset capabilities, never allocates during polls, and lazily establishes fresh anonymous access', async () => {
    const connection = await import('./nechakoConnection')
    let expired = false,
      reset = false
    const fetch = vi.fn().mockImplementation((url, options) => {
      if (url.endsWith('/login'))
        return Promise.resolve(response({ ...hostedStatus, loggedIn: true, sessionToken: SIGNED }))
      if (url.endsWith('/status') && expired) {
        expired = false
        return Promise.resolve(response({ error: 'Expired fixture', sessionExpired: true, loggedIn: false }, 401))
      }
      if (url.endsWith('/status') && reset) {
        reset = false
        return Promise.resolve(response({ ...hostedStatus, sessionReset: true }))
      }
      if (url.endsWith('/status') && options.method === 'POST')
        return Promise.resolve(response({ ...hostedStatus, sessionToken: FRESH }))
      return Promise.resolve(
        response(url.endsWith('/status') ? hostedStatus : { status: 'success', loggedIn: false, attributes: [] }),
      )
    })
    vi.stubGlobal('fetch', fetch)
    await connection.connectPortalSession('fixture-user', 'fixture-password')
    expired = true
    await expect(connection.getPortalConnectionStatus()).rejects.toThrow('expired')
    await connection.getPortalConnectionStatus()
    expect(fetch.mock.calls.at(-1)?.[1].headers['X-Nechako-Session']).toBeUndefined()
    expect(
      fetch.mock.calls.filter(([url, options]) => url.endsWith('/status') && options.method === 'POST'),
    ).toHaveLength(0)
    await connection.gatewayRequest('read', {})
    expect(fetch.mock.calls.at(-1)?.[1].headers['X-Nechako-Session']).toBe(FRESH)
    reset = true
    await expect(connection.getPortalConnectionStatus()).rejects.toThrow('session ended')
    await connection.getPortalConnectionStatus()
    expect(fetch.mock.calls.at(-1)?.[1].headers['X-Nechako-Session']).toBeUndefined()
  })
  it('binds binary downloads to the current capability and rejects a completed body from an older identity', async () => {
    const connection = await import('./nechakoConnection')
    let finishBlob!: (value: Blob) => void
    const pdf = new Response('%PDF-fixture', { headers: { 'Content-Type': 'application/pdf' } })
    vi.spyOn(pdf, 'blob').mockImplementation(
      () =>
        new Promise((resolve) => {
          finishBlob = resolve
        }),
    )
    const fetch = vi
      .fn()
      .mockImplementation((url) =>
        url.endsWith('/login')
          ? Promise.resolve(response({ ...hostedStatus, loggedIn: true, sessionToken: SIGNED }))
          : url.endsWith('/download')
            ? Promise.resolve(pdf)
            : Promise.resolve(response({ ...hostedStatus, sessionToken: ANON })),
      )
    vi.stubGlobal('fetch', fetch)
    const pending = connection.portalDownloadSubmission('9', 'pdf')
    const denied = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await tick()
    await tick()
    const call = fetch.mock.calls.find(([url]) => url.endsWith('/download'))!
    expect(call[1].credentials).toBe('omit')
    expect(call[1].headers['X-Nechako-Session']).toBe(ANON)
    expect(JSON.parse(call[1].body)).toEqual({ submissionId: '9', mode: 'pdf' })
    await connection.connectPortalSession('fixture-user', 'fixture-password')
    finishBlob(new Blob(['%PDF-fixture']))
    await denied
  })
  it('invalidates another hosted tab without broadcasting or persisting its capability', async () => {
    const storage = vi.fn(),
      postMessage = vi.fn(),
      channels: { onmessage?: (event: { data: unknown }) => void }[] = []
    vi.stubGlobal('window', { localStorage: { getItem: () => null, setItem: storage }, dispatchEvent: vi.fn() })
    vi.stubGlobal(
      'CustomEvent',
      class extends Event {
        constructor(name: string) {
          super(name)
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
    const connection = await import('./nechakoConnection')
    const fetch = vi
      .fn()
      .mockImplementation((url, options) =>
        Promise.resolve(
          response(
            url.endsWith('/login')
              ? { ...hostedStatus, loggedIn: true, sessionToken: SIGNED }
              : url.endsWith('/status') && options.method === 'POST'
                ? { ...hostedStatus, sessionToken: FRESH }
                : url.endsWith('/read')
                  ? { status: 'success', loggedIn: false, attributes: [] }
                  : hostedStatus,
          ),
        ),
      )
    vi.stubGlobal('fetch', fetch)
    await connection.connectPortalSession('fixture-user', 'fixture-password')
    channels[0].onmessage?.({ data: { reason: 'signed-in' } })
    await connection.getPortalConnectionStatus()
    expect(fetch.mock.calls.at(-1)?.[1].headers['X-Nechako-Session']).toBeUndefined()
    channels[0].onmessage?.({ data: { reason: 'session-changing' } })
    await connection.gatewayRequest('read', {})
    expect(fetch.mock.calls.at(-1)?.[1].headers['X-Nechako-Session']).toBe(FRESH)
    expect(JSON.stringify(postMessage.mock.calls)).not.toContain(SIGNED)
    expect(storage.mock.calls).toEqual([['pgmaps-nechako-connection-mode', 'gateway']])
  })
})
