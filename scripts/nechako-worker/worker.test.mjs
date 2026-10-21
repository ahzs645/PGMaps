import { test } from 'node:test'
import assert from 'node:assert/strict'
import worker, { NechakoRegistry, NechakoSession, SOURCE, BASE, TTL, MEMORY_TICK, validateRead } from './worker.mjs'

const origin = 'https://pgmaps.ahmadjalil.com'
function setup({ sourceAdmin = true } = {}) {
  let now = 1000,
    sourceCalls = [],
    delayed
  const timers = new Map()
  let timerId = 0
  const env = {
    TEST_NOW: () => now,
    TEST_SET_TIMEOUT: (callback, delay) => {
      const id = ++timerId
      timers.set(id, { callback, at: now + delay, delay })
      return id
    },
    TEST_CLEAR_TIMEOUT: (id) => timers.delete(id),
    SESSION_RATE_LIMIT: { limit: async () => ({ success: true }) },
    LOGIN_RATE_LIMIT: { limit: async () => ({ success: true }) },
    SOURCE_FETCH: async (url, options) => {
      sourceCalls.push({ url, options })
      assert.ok(url.startsWith(SOURCE))
      assert.equal(options.redirect, 'manual')
      if (url === SOURCE)
        return new Response('<html>source bootstrap</html>', {
          headers: { 'Set-Cookie': 'PHPSESSID=fixture-cookie; Path=/; HttpOnly' },
        })
      if (delayed) return delayed(url, options)
      const path = url.slice(SOURCE.length),
        signed = options.headers.Cookie?.includes('fixture-signed')
      if (path.endsWith('login.php')) {
        const good = options.body.get('password') === 'fixture-only'
        return Response.json(
          {
            success: good,
            status: good ? 'success' : 'failure',
            loggedIn: good,
            error: good ? undefined : 'Fixture sign-in denied',
            attributes: { isAdmin: sourceAdmin, secret_contact: 'NOT EXPOSED' },
          },
          {
            headers: {
              'Set-Cookie': good ? 'PHPSESSID=fixture-signed; Path=/; HttpOnly' : 'PHPSESSID=fixture-cookie; Path=/',
            },
          },
        )
      }
      if (path.endsWith('getSubmissionMetadata.php'))
        return Response.json({ success: true, status: 'success', loggedIn: !!signed, attributes: { submission_id: 9 } })
      if (path.endsWith('getSubmissionLayers.php'))
        return Response.json({ status: 'success', loggedIn: !!signed, attributes: [{ layer_id: 386 }] })
      if (path.endsWith('getPortalLayer.php'))
        return Response.json({
          status: 'success',
          loggedIn: !!signed,
          attributes: { mapfile: '/verified/source.map', mapfileName: 'verified_layer' },
        })
      if (path.endsWith('attributes.php'))
        return Response.json({ status: 'success', loggedIn: !!signed, attributes: [{ source_value: 1 }] })
      if (path.endsWith('downloadSubmission.php')) {
        const mode = options.body.get('mode'),
          body = {
            pdf: '%PDF-fixture',
            html: '<link rel="stylesheet"><p>Fixture</p>',
            csv: 'field,value\nA,1',
            files: new Uint8Array([80, 75, 5, 6]),
          }[mode]
        return new Response(body, { headers: { 'Content-Disposition': 'attachment; filename="source-name"' } })
      }
      return Response.json({ success: true, status: 'success', loggedIn: !!signed, attributes: [] })
    },
  }
  function namespace(Class) {
    const objects = new Map()
    return {
      objects,
      idFromName: (id) => id,
      get(id) {
        if (!objects.has(id)) objects.set(id, new Class({}, env))
        const value = objects.get(id)
        return { fetch: (url, options) => value.fetch(new Request(url, options)) }
      },
    }
  }
  env.NECHAKO_REGISTRY = namespace(NechakoRegistry)
  env.NECHAKO_SESSIONS = namespace(NechakoSession)
  const call = (action, body, capability, method = body === undefined ? 'GET' : 'POST', extra = {}) =>
    worker.fetch(
      new Request('https://gateway.example' + BASE + '/' + action, {
        method,
        headers: {
          Origin: origin,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(capability ? { 'X-Nechako-Session': capability } : {}),
          ...extra,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env,
    )
  return {
    env,
    call,
    sourceCalls,
    timers,
    runTimers: () => {
      for (const [id, timer] of timers) {
        if (timer.at > now) continue
        timers.delete(id)
        timer.callback()
      }
    },
    advance: (ms) => {
      now += ms
    },
    delay: (fn) => {
      delayed = fn
    },
  }
}
async function allocate(ctx) {
  const response = await ctx.call('status', {})
  assert.equal(response.status, 200)
  const value = await response.json()
  assert.match(value.sessionToken, /^[A-Za-z0-9_-]{43}$/)
  return value.sessionToken
}
const read = { path: 'rest/portal/getChildren.php', params: { parentId: '9' } }

test('status peek does not allocate, performs no upstream fetch and exact CORS rejects foreign callers', async () => {
  const ctx = setup(),
    response = await ctx.call('status')
  assert.equal(response.status, 200)
  assert.equal((await response.json()).tokenRequired, true)
  assert.equal(ctx.env.NECHAKO_REGISTRY.objects.size, 0)
  assert.equal(ctx.sourceCalls.length, 0)
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin)
  assert.equal(response.headers.get('Access-Control-Allow-Credentials'), null)
  const denied = await ctx.call('status', undefined, undefined, 'GET', { Origin: 'https://untrusted.example' })
  assert.equal(denied.status, 403)
  assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null)
  const preflight = await ctx.call('read', undefined, undefined, 'OPTIONS', {
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'Content-Type, X-Nechako-Session',
  })
  assert.equal(preflight.status, 204)
  assert.equal(
    (
      await ctx.call('read', undefined, undefined, 'OPTIONS', {
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'X-Unapproved',
      })
    ).status,
    403,
  )
})

test('only minted capabilities work; isolated jars bootstrap source root and keep source cookies off responses', async () => {
  const ctx = setup(),
    capability = await allocate(ctx),
    other = await allocate(ctx)
  assert.notEqual(capability, other)
  assert.equal((await ctx.call('read', read, 'A'.repeat(43))).status, 401)
  const response = await ctx.call('read', read, capability)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Set-Cookie'), null)
  assert.equal(ctx.sourceCalls[0].url, SOURCE)
  assert.equal(ctx.sourceCalls[1].options.headers.Referer, SOURCE)
  assert.equal(ctx.sourceCalls[1].options.headers.Cookie, 'PHPSESSID=fixture-cookie')
  assert.equal(ctx.sourceCalls[1].options.body.get('parentId'), '9')
})

test('login rotates/revokes old capability and reports verified admin reads without write access or native identity', async () => {
  const ctx = setup(),
    old = await allocate(ctx)
  const response = await ctx.call('login', { username: 'fixture-user', password: 'fixture-only' }, old),
    value = await response.json()
  assert.equal(response.status, 200)
  assert.notEqual(value.sessionToken, old)
  assert.equal(value.loggedIn, true)
  assert.equal(value.canWrite, false)
  assert.equal(value.readOnly, true)
  assert.equal(value.isAdmin, true)
  assert.equal(JSON.stringify(value).includes('NOT EXPOSED'), false)
  assert.equal(value.attributes, undefined)
  assert.equal((await ctx.call('read', read, old)).status, 401)
  const second = await ctx.call('login', { username: 'fixture-user', password: 'bad-fixture' }, value.sessionToken),
    failed = await second.json()
  assert.equal(second.status, 401)
  assert.notEqual(failed.sessionToken, value.sessionToken)
  assert.equal(failed.loggedIn, false)
  assert.equal(failed.isAdmin, false)
  assert.equal((await ctx.call('read', read, value.sessionToken)).status, 401)
  assert.equal((await ctx.call('read', read, failed.sessionToken)).status, 200)
})

test('peek never extends idle timeout, expiry rejects reads, reset clears identity before resource response', async () => {
  const ctx = setup(),
    response = await ctx.call('login', { username: 'fixture-user', password: 'fixture-only' }),
    value = await response.json()
  ctx.advance(TTL - 1000)
  const peek = await ctx.call('status', undefined, value.sessionToken)
  assert.equal((await peek.json()).expiresAfterIdleSeconds, 1)
  ctx.advance(1001)
  const expired = await ctx.call('read', read, value.sessionToken)
  assert.equal(expired.status, 401)
  assert.equal((await expired.json()).sessionExpired, true)
  const fresh = await allocate(ctx)
  ctx.env.NECHAKO_SESSIONS.objects.clear()
  const reset = await ctx.call('read', read, fresh)
  const resetting = await reset.json()
  assert.equal(reset.status, 409)
  assert.equal(resetting.sessionReset, true)
  assert.equal(resetting.loggedIn, false)
  assert.equal((await ctx.call('read', read, fresh)).status, 200)
})

test('disconnect revokes in-flight reads even when upstream ignores abort', async () => {
  const ctx = setup(),
    capability = await allocate(ctx)
  // Establish source bootstrap first.
  await ctx.call('read', read, capability)
  let resolve, began
  const started = new Promise((done) => {
    began = done
  })
  ctx.delay(async () => {
    began()
    return new Promise((done) => {
      resolve = done
    })
  })
  const pending = ctx.call('read', read, capability)
  await started
  assert.equal((await ctx.call('disconnect', {}, capability)).status, 200)
  resolve(
    Response.json({ status: 'success', loggedIn: true, attributes: [{ private_history: 'OLD PRIVATE FIXTURE' }] }),
  )
  const response = await pending
  assert.equal(response.status, 401)
  assert.equal((await response.text()).includes('OLD PRIVATE FIXTURE'), false)
})

test('all mutations/unverified admin paths/unsafe associations are rejected; monitoring is bounded', async () => {
  const ctx = setup(),
    capability = await allocate(ctx)
  assert.equal((await ctx.call('write', {}, capability)).status, 404)
  for (const payload of [
    { path: 'rest/portal/admin/getUsers.php', params: {} },
    { path: 'rest/openmap/savedProjects.php', params: { mode: 'saveNew', projectName: 'Not allowed' } },
    { path: 'rest/portal/saveLoadMonitoringNodePresets.php', params: { mode: 'save', matchId: '1' } },
    { path: 'https://untrusted.example/file', params: {} },
  ])
    assert.equal((await ctx.call('read', payload, capability)).status, 400)
  assert.throws(() =>
    validateRead({
      path: 'rest/portal/getMonitorData.php',
      params: { layerId: '386', recId: '1', pageSize: '501', pageNumber: '0' },
    }),
  )
  assert.equal((await ctx.call('layer-attributes', { submissionId: '1477', layerId: '999' }, capability)).status, 403)
  assert.equal(
    (await ctx.call('layer-attributes', { submissionId: '1477', layerId: '386', filename: '/untrusted' }, capability))
      .status,
    400,
  )
  assert.equal((await ctx.call('layer-attributes', { submissionId: '1477', layerId: '386' }, capability)).status, 200)
  const last = ctx.sourceCalls.at(-1)
  assert.deepEqual(JSON.parse(last.options.body.get('data')), {
    filename: '/verified/source.map',
    layername: 'verified_layer',
  })
})

const administratorReads = [
  { path: 'rest/portal/getUsers.php', params: { page: '1', start: '0', limit: '100' } },
  { path: 'rest/portal/admin/getGroups.php', params: {} },
  { path: 'rest/portal/admin/getGroupMembers.php', params: { gid: '1', includePrimaryGroupStatus: 'true' } },
  { path: 'rest/portal/admin/getUserDetails.php', params: { uid: '7' } },
  { path: 'rest/portal/admin/getUserPermissionsCheckbox.php', params: { uid: '7', mode: 'form' } },
  { path: 'rest/portal/admin/getUserForms.php', params: { form_id: '39' } },
  { path: 'rest/portal/admin/getLinkableLayers.php', params: { page: '1', start: '0', limit: '100' } },
  { path: 'rest/portal/admin/getLayerSharedLayersManager.php', params: { layerId: '386' } },
  { path: 'rest/portal/admin/getAllBaseLayers.php', params: {} },
  { path: 'rest/portal/admin/getContents.php', params: {} },
  { path: 'rest/portal/admin/getSubmissions.php', params: { page: '1', start: '0', limit: '100' } },
  {
    path: 'rest/portal/getMonitorSchemaLayers.php',
    params: { schemaId: '13', getDraftSubmissions: 'true', getDisabled: 'true' },
  },
]

test('anonymous and nonadmin sessions cannot forward administrator reads, including an admin username', async () => {
  const ctx = setup({ sourceAdmin: false }),
    anonymous = await allocate(ctx)
  for (const payload of administratorReads) assert.equal((await ctx.call('read', payload, anonymous)).status, 403)
  assert.equal(ctx.sourceCalls.length, 0)
  const login = await ctx.call('login', { username: 'admin', password: 'fixture-only' }, anonymous),
    user = await login.json(),
    before = ctx.sourceCalls.length
  assert.equal(user.loggedIn, true)
  assert.equal(user.isAdmin, false)
  assert.equal(user.canWrite, false)
  for (const payload of administratorReads)
    assert.equal((await ctx.call('read', payload, user.sessionToken)).status, 403)
  assert.equal(ctx.sourceCalls.length, before)
})

test('verified administrators can inspect every allowed resource while writes and unknown routes stay blocked', async () => {
  const ctx = setup(),
    login = await ctx.call('login', { username: 'fixture', password: 'fixture-only' }),
    user = await login.json(),
    peek = await (await ctx.call('status', undefined, user.sessionToken)).json()
  assert.equal(peek.isAdmin, true)
  assert.equal(peek.canWrite, false)
  assert.equal(peek.readOnly, true)
  assert.equal(peek.attributes, undefined)
  for (const payload of administratorReads) {
    const response = await ctx.call('read', payload, user.sessionToken)
    assert.equal(response.status, 200)
    assert.equal((await response.json()).loggedIn, true)
    const forwarded = ctx.sourceCalls.at(-1)
    assert.equal(forwarded.url, SOURCE + payload.path)
    assert.deepEqual(Object.fromEntries(forwarded.options.body), payload.params)
    assert.equal(response.headers.get('Set-Cookie'), null)
    assert.equal(response.headers.get('Cache-Control'), 'no-store')
  }
  const before = ctx.sourceCalls.length
  assert.equal(
    (await ctx.call('write', { path: 'rest/portal/admin/updateUser.php', params: {} }, user.sessionToken)).status,
    404,
  )
  for (const path of [
    'rest/portal/admin/updateUser.php',
    'rest/portal/admin/setContent.php',
    'rest/portal/admin/getServerVariables.php',
    'rest/portal/admin/getUsers.php',
    'rest/portal/startSubmission.php',
  ])
    assert.equal((await ctx.call('read', { path, params: {} }, user.sessionToken)).status, 400)
  assert.equal(ctx.sourceCalls.length, before)
})

test('admin identity requires a strict boolean from source login, not truthy strings or client parameters', async () => {
  for (const sourceAdmin of ['true', 1, null]) {
    const ctx = setup({ sourceAdmin }),
      login = await ctx.call('login', { username: 'admin', password: 'fixture-only' }),
      user = await login.json()
    assert.equal(user.isAdmin, false)
    assert.equal((await ctx.call('read', administratorReads[0], user.sessionToken)).status, 403)
    assert.equal((await ctx.call('read', { ...administratorReads[0], isAdmin: true }, user.sessionToken)).status, 400)
  }
})

test('a contradictory failed source login cannot grant administrator access', async () => {
  const ctx = setup()
  ctx.delay(async () =>
    Response.json({ success: false, status: 'success', loggedIn: true, attributes: { isAdmin: true } }),
  )
  const response = await ctx.call('login', { username: 'admin', password: 'fixture-only' })
  assert.equal(response.status, 401)
  const denied = await response.json()
  assert.equal(denied.loggedIn, false)
  assert.equal(denied.isAdmin, false)
  assert.equal(denied.canWrite, false)
  const before = ctx.sourceCalls.length
  assert.equal((await ctx.call('read', administratorReads[0], denied.sessionToken)).status, 403)
  assert.equal(ctx.sourceCalls.length, before)
  for (const session of ctx.env.NECHAKO_SESSIONS.objects.values()) {
    assert.equal(session.admin, false)
    assert.equal(session.loggedIn, false)
    assert.equal(session.cookies.size, 0)
  }
})

test('administrator IDs, permission modes, membership flags and page sizes are bounded', () => {
  for (const payload of administratorReads) assert.deepEqual(validateRead(payload), payload)
  for (const params of [
    { gid: '0' },
    { gid: '-1' },
    { gid: '2147483648' },
    { gid: '1; DROP' },
    { gid: '1', includePrimaryGroupStatus: '1' },
  ])
    assert.throws(() => validateRead({ path: 'rest/portal/admin/getGroupMembers.php', params }))
  for (const uid of ['0', 'NaN', '7.5', '2147483648'])
    assert.throws(() => validateRead({ path: 'rest/portal/admin/getUserDetails.php', params: { uid } }))
  for (const mode of ['form', 'submission', 'match_preset', 'shared_style', 'shared_project'])
    assert.doesNotThrow(() =>
      validateRead({ path: 'rest/portal/admin/getUserPermissionsCheckbox.php', params: { uid: '7', mode } }),
    )
  assert.throws(() =>
    validateRead({ path: 'rest/portal/admin/getUserPermissionsCheckbox.php', params: { uid: '7', mode: 'all' } }),
  )
  for (const limit of ['0', '501', '1000000', '-1', 'all'])
    assert.throws(() => validateRead({ path: 'rest/portal/admin/getSubmissions.php', params: { limit } }))
  assert.doesNotThrow(() =>
    validateRead({ path: 'rest/portal/admin/getSubmissions.php', params: { limit: '500', page: '1', start: '0' } }),
  )
  assert.throws(() => validateRead({ path: 'rest/portal/admin/getContents.php', params: { mode: 'save' } }))
  assert.throws(() => validateRead({ path: 'rest/portal/getUsers.php', params: { limit: '501' } }))
  assert.throws(() => validateRead({ path: 'rest/portal/admin/getUserForms.php', params: { form_id: '2147483648' } }))
  const monitor = administratorReads.at(-1)
  assert.throws(() => validateRead({ ...monitor, params: { ...monitor.params, getDisabled: 'all' } }))
  assert.throws(() => validateRead({ ...monitor, params: { schemaId: '13' } }))
})

test('a source sign-out removes admin access and the next protected read never reaches upstream', async () => {
  const ctx = setup(),
    login = await ctx.call('login', { username: 'fixture', password: 'fixture-only' }),
    user = await login.json()
  ctx.delay(async () =>
    Response.json({
      success: false,
      status: 'failure',
      loggedIn: false,
      error: 'Fixture session ended',
      attributes: [],
    }),
  )
  const lost = await ctx.call('read', administratorReads[0], user.sessionToken)
  assert.equal((await lost.json()).loggedIn, false)
  const peek = await (await ctx.call('status', undefined, user.sessionToken)).json(),
    before = ctx.sourceCalls.length
  assert.equal(peek.loggedIn, false)
  assert.equal(peek.isAdmin, false)
  assert.equal(peek.canWrite, false)
  assert.equal((await ctx.call('read', administratorReads[0], user.sessionToken)).status, 403)
  assert.equal(ctx.sourceCalls.length, before)
})

test('disconnect clears administrator rights and suppresses an in-flight private administrator response', async () => {
  const ctx = setup(),
    login = await ctx.call('login', { username: 'fixture', password: 'fixture-only' }),
    user = await login.json()
  let release, started
  const begin = new Promise((resolve) => {
    started = resolve
  })
  ctx.delay(async () => {
    started()
    return new Promise((resolve) => {
      release = resolve
    })
  })
  const pending = ctx.call('read', administratorReads[2], user.sessionToken)
  await begin
  const disconnected = await (await ctx.call('disconnect', {}, user.sessionToken)).json()
  assert.equal(disconnected.isAdmin, false)
  assert.equal(disconnected.loggedIn, false)
  release(Response.json({ status: 'success', loggedIn: true, attributes: { private_user: 'ADMIN PRIVATE FIXTURE' } }))
  const stale = await pending
  assert.equal(stale.status, 401)
  assert.equal((await stale.text()).includes('ADMIN PRIVATE FIXTURE'), false)
  assert.equal((await ctx.call('read', administratorReads[2], user.sessionToken)).status, 401)
  for (const session of ctx.env.NECHAKO_SESSIONS.objects.values()) {
    assert.equal(session.admin, false)
    assert.equal(session.cookies.size, 0)
  }
})

test('native PDF/HTML fragment/CSV/ZIP use signature checks, controlled names, no-store and HTML sandbox', async () => {
  const ctx = setup(),
    capability = await allocate(ctx)
  for (const mode of ['pdf', 'html', 'csv', 'files']) {
    const response = await ctx.call('download', { submissionId: '9', mode }, capability)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('Content-Disposition'), /^attachment; filename="nechako-original-submission-9\./)
    assert.equal(response.headers.get('Cache-Control'), 'no-store')
    assert.equal(response.headers.get('Content-Security-Policy'), "sandbox; default-src 'none'")
  }
  ctx.delay(async (url) =>
    url.endsWith('getSubmissionMetadata.php')
      ? Response.json({ status: 'success', loggedIn: false, attributes: {} })
      : new Response('<b>Warning</b>: source failure'),
  )
  assert.equal((await ctx.call('download', { submissionId: '9', mode: 'files' }, capability)).status, 502)
})

test('rate limits and global memory session cap bound allocation and source requests', async () => {
  const ctx = setup()
  ctx.env.SESSION_RATE_LIMIT.limit = async () => ({ success: false })
  assert.equal((await ctx.call('status', {})).status, 429)
  ctx.env.SESSION_RATE_LIMIT.limit = async () => ({ success: true })
  const capability = await allocate(ctx)
  for (let i = 0; i < 60; i++) assert.equal((await ctx.call('read', read, capability)).status, 200)
  assert.equal((await ctx.call('read', read, capability)).status, 429)
  const capped = setup()
  for (let i = 0; i < 60; i++) await allocate(capped)
  assert.equal((await capped.call('status', {})).status, 503)
})

test('request and source response byte caps fail closed, redirects are never followed', async () => {
  const ctx = setup(),
    capability = await allocate(ctx)
  assert.equal((await ctx.call('read', { ...read, extra: 'x'.repeat(1024 * 1024) }, capability)).status, 413)
  ctx.delay(async () => new Response(null, { status: 302, headers: { Location: 'https://untrusted.example' } }))
  assert.equal((await ctx.call('read', read, capability)).status, 502)
  ctx.delay(async () => new Response('x', { headers: { 'Content-Length': String(20 * 1024 * 1024 + 1) } }))
  assert.equal((await ctx.call('read', read, capability)).status, 413)
})

test('sign-in replacement revokes a pending old identity read and old-cookie completion', async () => {
  const ctx = setup(),
    old = await allocate(ctx)
  await ctx.call('read', read, old)
  let release, began
  const started = new Promise((done) => {
    began = done
  })
  ctx.delay(async (url) => {
    if (url.endsWith('getChildren.php')) {
      began()
      return new Promise((done) => {
        release = done
      })
    }
    if (url.endsWith('login.php'))
      return Response.json({ status: 'success', loggedIn: true, attributes: { isAdmin: true } })
    return new Response('<html>bootstrap</html>')
  })
  const pending = ctx.call('read', read, old)
  await started
  const login = await ctx.call('login', { username: 'fixture-user', password: 'fixture-only' }, old),
    fresh = await login.json()
  assert.equal(login.status, 200)
  assert.notEqual(fresh.sessionToken, old)
  release(
    Response.json(
      { status: 'success', loggedIn: true, attributes: [{ private_value: 'REPLACED IDENTITY' }] },
      { headers: { 'Set-Cookie': 'PHPSESSID=OLD-COOKIE; Path=/' } },
    ),
  )
  const stale = await pending
  assert.equal(stale.status, 401)
  assert.equal((await stale.text()).includes('REPLACED IDENTITY'), false)
  const objects = [...ctx.env.NECHAKO_SESSIONS.objects.values()]
  assert.ok(objects.some((object) => object.revoked && object.cookies.size === 0))
})

test('registry memory loss rejects old capability; source DO reset peeks anonymous without allocating', async () => {
  const ctx = setup(),
    login = await ctx.call('login', { username: 'fixture-user', password: 'fixture-only' }),
    value = await login.json()
  ctx.env.NECHAKO_SESSIONS.objects.clear()
  const reset = await ctx.call('status', undefined, value.sessionToken),
    data = await reset.json()
  assert.equal(reset.status, 200)
  assert.equal(data.sessionReset, true)
  assert.equal(data.loggedIn, false)
  assert.equal(data.sessionToken, undefined)
  ctx.env.NECHAKO_REGISTRY.objects.clear()
  const forgotten = await ctx.call('status', undefined, value.sessionToken)
  assert.equal(forgotten.status, 401)
  assert.equal((await forgotten.json()).sessionExpired, true)
})

test('native access errors, contradictory envelopes and oversized files cannot become binary downloads', async () => {
  const ctx = setup(),
    capability = await allocate(ctx)
  await ctx.call('read', read, capability)
  ctx.delay(async () => Response.json({ success: false, status: 'success', loggedIn: false, attributes: {} }))
  assert.equal((await ctx.call('download', { submissionId: '9', mode: 'pdf' }, capability)).status, 403)
  ctx.delay(async (url) =>
    url.endsWith('getSubmissionMetadata.php')
      ? Response.json({ status: 'success', loggedIn: false, attributes: {} })
      : new Response('%PDF-oversized', {
          headers: { 'Content-Disposition': 'attachment', 'Content-Length': String(32 * 1024 * 1024 + 1) },
        }),
  )
  assert.equal((await ctx.call('download', { submissionId: '9', mode: 'pdf' }, capability)).status, 413)
  ctx.delay(async (url) =>
    url.endsWith('getSubmissionMetadata.php')
      ? Response.json({ status: 'success', loggedIn: false, attributes: {} })
      : new Response(JSON.stringify({ status: 'failure', error: 'Fixture denial' }), {
          headers: { 'Content-Disposition': 'attachment' },
        }),
  )
  assert.equal((await ctx.call('download', { submissionId: '9', mode: 'csv' }, capability)).status, 403)
  ctx.delay(async (url) =>
    url.endsWith('getSubmissionMetadata.php')
      ? Response.json({ status: 'success', loggedIn: false, attributes: {} })
      : new Response('not a zip', { headers: { 'Content-Disposition': 'attachment' } }),
  )
  assert.equal((await ctx.call('download', { submissionId: '9', mode: 'files' }, capability)).status, 502)
})

test('all read signatures retain canonical Origin and never forward caller browser cookies', async () => {
  const ctx = setup(),
    capability = await allocate(ctx)
  await ctx.call('read', read, capability, 'POST', { Cookie: 'PRIVATE-CALLER=must-not-forward' })
  for (const call of ctx.sourceCalls) {
    assert.equal(call.options.headers.Origin, SOURCE.slice(0, -1))
    assert.equal(call.options.headers.Referer, SOURCE)
    assert.equal(Boolean(call.options.headers.Cookie?.includes('PRIVATE-CALLER')), false)
  }
})

test('bounded memory timers retain independent idle jars without extending expiry; final expiry clears everything', async () => {
  const ctx = setup(),
    anonymous = await allocate(ctx),
    login = await ctx.call('login', { username: 'fixture', password: 'fixture-only' }),
    signed = (await login.json()).sessionToken
  await ctx.call('read', read, anonymous)
  const registry = ctx.env.NECHAKO_REGISTRY.objects.get('registry-v1'),
    deadlines = Array.from(registry.sessions.values(), (item) => item.expires)
  assert.equal(ctx.timers.size, 3) // One registry and two independent source objects.
  for (let tick = 0; tick < 2; tick++) {
    ctx.advance(MEMORY_TICK)
    ctx.runTimers()
    assert.equal(ctx.timers.size, 3)
    assert.ok(Array.from(ctx.timers.values()).every((timer) => timer.delay <= MEMORY_TICK))
    const a = await (await ctx.call('status', undefined, signed)).json(),
      b = await (await ctx.call('status', undefined, anonymous)).json()
    assert.equal(a.loggedIn, true)
    assert.equal(b.loggedIn, false)
    assert.equal(a.sessionReset, undefined)
    assert.equal(b.sessionReset, undefined)
    assert.deepEqual(
      Array.from(registry.sessions.values(), (item) => item.expires),
      deadlines,
    )
  }
  const controllers = []
  for (const session of ctx.env.NECHAKO_SESSIONS.objects.values()) {
    const controller = new AbortController()
    session.controllers.add(controller)
    controllers.push(controller)
  }
  ctx.advance(MEMORY_TICK)
  ctx.runTimers()
  assert.equal(ctx.timers.size, 0)
  assert.equal(registry.sessions.size, 0)
  for (const session of ctx.env.NECHAKO_SESSIONS.objects.values()) {
    assert.equal(session.revoked, true)
    assert.equal(session.cookies.size, 0)
    assert.equal(session.loggedIn, false)
    assert.equal(session.controllers.size, 0)
  }
  assert.ok(controllers.every((controller) => controller.signal.aborted))
  assert.equal((await ctx.call('status', undefined, signed)).status, 401)
})

test('read updates only its registry deadline; disconnect cancels source timer and empty registry timer', async () => {
  const ctx = setup(),
    first = await allocate(ctx),
    second = await allocate(ctx)
  ctx.advance(TTL - 1000)
  ctx.runTimers()
  await ctx.call('read', read, first)
  ctx.advance(1000)
  ctx.runTimers()
  assert.equal((await ctx.call('status', undefined, second)).status, 401)
  assert.equal((await ctx.call('status', undefined, first)).status, 200)
  assert.equal(ctx.timers.size, 2)
  await ctx.call('disconnect', {}, first)
  assert.equal(ctx.timers.size, 0)
})
