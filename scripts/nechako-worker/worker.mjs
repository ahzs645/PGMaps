/** Read-only source gateway. Cookie jars, capabilities and registry state are RAM only. */
export const SOURCE = 'https://nechakowatershed-portal.ca/'
export const BASE = '/api/nechako-portal'
export const TTL = 30 * 60 * 1000
// Each pending operation protects RAM for at most 15 minutes; renew before that
// window without extending the source session's independently tracked expiry.
export const MEMORY_TICK = 10 * 60 * 1000
function memoryTimer(env, callback, delay) {
  const timer = (env.TEST_SET_TIMEOUT ?? setTimeout)(callback, delay)
  timer?.unref?.() // Node tests only; Workers timers have no unref method.
  return timer
}
function cancelMemoryTimer(env, timer) {
  if (timer !== undefined) (env.TEST_CLEAR_TIMEOUT ?? clearTimeout)(timer)
}
const BODY_LIMIT = 1024 * 1024,
  JSON_LIMIT = 20 * 1024 * 1024,
  FILE_LIMIT = 32 * 1024 * 1024
const ORIGINS = new Set(['https://pgmaps.ahmadjalil.com', 'http://127.0.0.1:42173', 'http://localhost:42173'])
const encoder = new TextEncoder(),
  decoder = new TextDecoder()
const object = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const positive = (v) => typeof v === 'string' && /^[1-9]\d*$/.test(v) && Number(v) <= 2147483647
const READS = {
  'rest/portal/getSearchContext.php': [['types'], []],
  'rest/portal/getSearchResults.php': [
    ['area', 'fields', 'keys'],
    ['area', 'fields', 'keys'],
  ],
  'rest/openmap/getBaseLayers.php': [['mode'], ['mode']],
  'rest/openmap/getDefaultProject.php': [[], []],
  'rest/openmap/savedProjects.php': [['mode', 'projectId'], ['mode']],
  'rest/openmap/getProjectHistory.php': [['historyId', 'mode', 'projectId'], ['mode']],
  'rest/portal/getForms.php': [['limit', 'page', 'start'], []],
  'rest/portal/getForm.php': [['id'], ['id']],
  'rest/portal/getSubmissionForm.php': [['submissionId'], ['submissionId']],
  'rest/portal/getFieldValue.php': [
    ['fieldId', 'fieldIndex', 'submissionId'],
    ['fieldId', 'fieldIndex', 'submissionId'],
  ],
  'rest/portal/getSchemas.php': [['limit', 'page', 'start'], []],
  'rest/portal/getSchemas_TBD.php': [[], []],
  'rest/portal/getSubmissionLayersAddLayer.php': [[], []],
  'rest/portal/getLinkedLayers.php': [[], []],
  'rest/portal/getSchemaFields.php': [['schemaId'], ['schemaId']],
  // SchemaManager.js requests draft/disabled associations in its Monitors tab.
  // This administrative contract is gated even though the route has no /admin/.
  'rest/portal/getMonitorSchemaLayers.php': [
    ['schemaId', 'getDraftSubmissions', 'getDisabled'],
    ['schemaId', 'getDraftSubmissions', 'getDisabled'],
  ],
  'rest/portal/getStatusFlags.php': [[], []],
  'rest/portal/getSpatialFormats.php': [[], []],
  'rest/portal/getSubmissionMetadata.php': [['submissionId'], ['submissionId']],
  'rest/portal/getSubmissionLayers.php': [['submissionId'], ['submissionId']],
  'rest/portal/getSubmissionLinkedLayers.php': [['submissionId'], ['submissionId']],
  'rest/portal/getSubmissionAttachments.php': [['submissionId'], ['submissionId']],
  'rest/portal/getSubmissionPermissions.php': [['submissionId'], ['submissionId']],
  'rest/portal/getHistory.php': [['sub_id'], ['sub_id']],
  'rest/portal/getChildren.php': [['parentId'], ['parentId']],
  'rest/portal/getSubmissionMonitorSchemaLayers.php': [
    ['formId', 'submissionId'],
    ['formId', 'submissionId'],
  ],
  'rest/portal/getMonitorData.php': [
    ['getDraft', 'getSingleLayerInfo', 'layerId', 'pageNumber', 'pageSize', 'recId', 'schemaId', 'submissionId'],
    ['pageNumber', 'pageSize'],
  ],
  'rest/openmap/getPortalLayer.php': [
    ['layerId', 'type'],
    ['layerId', 'type'],
  ],
  'rest/portal/GetFormStatistics.php': [
    ['formId', 'mapping'],
    ['formId', 'mapping'],
  ],
  'rest/portal/getFormsLinkedSchemas.php': [['formId'], ['formId']],
  'rest/portal/getFormVisibleGroups.php': [['formId'], ['formId']],
  'rest/portal/getFormPermissions.php': [['formId', 'hideInactive'], ['formId']],
  'rest/portal/getMatchPresets.php': [['formId', 'mode', 'schemaId'], ['mode']],
  'rest/portal/saveLoadReportingToolPresets.php': [
    ['matchId', 'mode'],
    ['matchId', 'mode'],
  ],
  'rest/portal/saveLoadMonitoringNodePresets.php': [
    ['matchId', 'mode'],
    ['matchId', 'mode'],
  ],
  'rest/portal/getUsers.php': [['limit', 'page', 'start'], []],
  // Read contracts already verified by the local gateway. These routes also
  // require a successful source administrator sign-in in operation(), before
  // any upstream request. A read capability never enables source mutations.
  'rest/portal/admin/getGroups.php': [[], []],
  'rest/portal/admin/getGroupMembers.php': [['gid', 'includePrimaryGroupStatus'], ['gid']],
  'rest/portal/admin/getUserDetails.php': [['uid'], ['uid']],
  'rest/portal/admin/getUserPermissionsCheckbox.php': [
    ['uid', 'mode'],
    ['uid', 'mode'],
  ],
  'rest/portal/admin/getUserForms.php': [['form_id'], ['form_id']],
  'rest/portal/admin/getLinkableLayers.php': [['limit', 'page', 'start'], []],
  'rest/portal/admin/getLayerSharedLayersManager.php': [['layerId'], ['layerId']],
  'rest/portal/admin/getAllBaseLayers.php': [[], []],
  'rest/portal/admin/getContents.php': [[], []],
  'rest/portal/admin/getSubmissions.php': [['limit', 'page', 'start'], []],
  'rest/portal/getTaskStatuses.php': [[], []],
  'rest/portal/getPriorities.php': [[], []],
  'rest/portal/getHolidays.php': [[], []],
  'rest/portal/schedule.php': [
    ['date', 'mode'],
    ['date', 'mode'],
  ],
}
const administratorRead = (path) =>
  path.startsWith('rest/portal/admin/') ||
  path === 'rest/portal/getMonitorSchemaLayers.php' ||
  path === 'rest/portal/getUsers.php'

class Failure extends Error {
  constructor(status, message, extra = {}) {
    super(message)
    this.status = status
    this.extra = extra
  }
}
const fail = (status, message, extra) => {
  throw new Failure(status, message, extra)
}
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  })
const failure = (e) =>
  json(
    {
      error: e instanceof Failure ? e.message : 'The portal connection could not complete this request.',
      ...(e instanceof Failure ? e.extra : {}),
    },
    e instanceof Failure ? e.status : 502,
  )
function token() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}
async function digest(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
const validToken = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)
function status(loggedIn = false, remaining = TTL / 1000, extra = {}) {
  return {
    schema: 'nechako-hosted-connection-v1',
    available: true,
    loggedIn,
    readOnly: true,
    canWrite: false,
    isAdmin: false,
    expiresAfterIdleSeconds: Math.max(0, Math.ceil(remaining)),
    ...extra,
  }
}
async function bytes(response, maximum) {
  const size = Number(response.headers.get('Content-Length'))
  if (size > maximum) {
    await response.body?.cancel()
    fail(413, 'Source response exceeds the permitted size. Use the original portal.')
  }
  const chunks = []
  let length = 0
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > maximum) {
        await reader.cancel()
        fail(413, 'Source response exceeds the permitted size. Use the original portal.')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const result = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}
async function input(request) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json')
    fail(415, 'JSON requests are required.')
  const raw = await bytes(request, BODY_LIMIT)
  let value
  try {
    value = JSON.parse(decoder.decode(raw))
  } catch {
    fail(400, 'Invalid JSON request.')
  }
  if (!object(value)) fail(400, 'A JSON object is required.')
  return value
}
function exact(value, keys) {
  if (Object.keys(value).some((k) => !keys.includes(k)) || keys.some((k) => !(k in value)))
    fail(400, 'Unexpected or missing request fields.')
}
export function validateRead(payload) {
  exact(payload, ['path', 'params'])
  const { path, params } = payload,
    contract = Object.hasOwn(READS, path) ? READS[path] : undefined
  if (!contract || !object(params) || Object.values(params).some((v) => typeof v !== 'string'))
    fail(400, 'Unverified source read route or parameters.')
  const [allowed, required] = contract
  if (Object.keys(params).some((k) => !allowed.includes(k)) || required.some((k) => !(k in params)))
    fail(400, 'Unexpected or missing source read parameters.')
  for (const [key, value] of Object.entries(params)) {
    if (value.length > 250000) fail(400, 'Source read parameter is too large.')
    if (
      [
        'projectId',
        'historyId',
        'schemaId',
        'recId',
        'submissionId',
        'fieldId',
        'formId',
        'id',
        'sub_id',
        'parentId',
        'matchId',
        'layerId',
        'uid',
        'gid',
        'form_id',
      ].includes(key) &&
      !positive(value)
    )
      fail(400, 'Source IDs must be positive integers.')
    if (
      ['fieldIndex', 'page', 'start', 'limit', 'pageSize', 'pageNumber'].includes(key) &&
      (!/^\d+$/.test(value) || Number(value) > 1000000)
    )
      fail(400, 'Invalid source pagination.')
    if (['keys', 'fields', 'area', 'mapping', 'types'].includes(key)) {
      try {
        JSON.parse(value)
      } catch {
        fail(400, 'Invalid serialized source read parameter.')
      }
    }
  }
  const end = path.split('/').at(-1)
  if (administratorRead(path) && 'limit' in params && (Number(params.limit) < 1 || Number(params.limit) > 500))
    fail(400, 'Administrator lists use 1–500 row pages.')
  if (
    end === 'getUserPermissionsCheckbox.php' &&
    !['form', 'submission', 'match_preset', 'shared_style', 'shared_project'].includes(params.mode)
  )
    fail(400, 'Invalid resource-permission read mode.')
  if ('includePrimaryGroupStatus' in params && !['true', 'false'].includes(params.includePrimaryGroupStatus))
    fail(400, 'Invalid primary-group flag.')
  for (const key of ['getDraftSubmissions', 'getDisabled'])
    if (key in params && !['true', 'false'].includes(params[key])) fail(400, 'Invalid monitoring association flag.')
  if (
    end === 'savedProjects.php' &&
    (!['list', 'load', 'getDescription', 'getSharedGroups'].includes(params.mode) ||
      (params.mode === 'list' ? 'projectId' in params : !positive(params.projectId)))
  )
    fail(400, 'Only verified saved-project reads are enabled.')
  if (
    end === 'getProjectHistory.php' &&
    (params.mode !== 'loadRec' || !positive(params.historyId) || 'projectId' in params)
  )
    fail(400, 'Only verified project-history reads are enabled.')
  if (end === 'getBaseLayers.php' && !['notbase', 'default'].includes(params.mode))
    fail(400, 'Invalid source catalogue mode.')
  if (end === 'getPortalLayer.php' && params.type !== 'layer') fail(400, 'Invalid source descriptor mode.')
  if (end.startsWith('saveLoad') && params.mode !== 'load') fail(400, 'Preset writes are disabled.')
  if (end === 'getMatchPresets.php' && !['monitoringNode', 'reportingTool'].includes(params.mode))
    fail(400, 'Invalid source preset mode.')
  if (end === 'schedule.php' && !['notification', 'date', 'monthly'].includes(params.mode))
    fail(400, 'Schedule writes are disabled.')
  if ('getDraft' in params && !['true', 'false'].includes(params.getDraft)) fail(400, 'Invalid source draft-read flag.')
  if (end === 'getMonitorData.php') {
    const keys = Object.keys(params),
      subset = (list) => keys.every((k) => list.includes(k))
    const layer =
      subset(['layerId', 'recId', 'pageSize', 'pageNumber']) && positive(params.layerId) && positive(params.recId)
    const schema =
      subset(['schemaId', 'recId', 'getSingleLayerInfo', 'pageSize', 'pageNumber']) &&
      positive(params.schemaId) &&
      positive(params.recId) &&
      params.getSingleLayerInfo === 'true'
    const node =
      subset(['schemaId', 'recId', 'submissionId', 'getDraft', 'pageSize', 'pageNumber']) &&
      ['schemaId', 'recId', 'submissionId'].every((k) => positive(params[k]))
    if (!(layer || schema || node) || Number(params.pageSize) < 1 || Number(params.pageSize) > 500)
      fail(400, 'Monitoring needs a verified association and 1–500 row pages.')
  }
  return payload
}
function successful(value) {
  return object(value) && value.status === 'success' && value.success !== false && !value.error && 'attributes' in value
}
function cookies(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie()
  if (typeof headers.getAll === 'function') return headers.getAll('Set-Cookie')
  // Never split combined Expires values on commas. Native source uses PHPSESSID.
  const value = headers.get('Set-Cookie')
  return value && /^PHPSESSID=[^;,\s]+(?:;|$)/i.test(value) ? [value] : []
}

export class NechakoRegistry {
  constructor(_ctx, env) {
    this.env = env
    this.sessions = new Map()
    this.expiryTimer = undefined
  }
  pruneAndArm() {
    cancelMemoryTimer(this.env, this.expiryTimer)
    this.expiryTimer = undefined
    const now = this.env.TEST_NOW?.() ?? Date.now()
    for (const [hash, item] of this.sessions) if (item.expires <= now) this.sessions.delete(hash)
    if (!this.sessions.size) return
    const earliest = Math.min(...Array.from(this.sessions.values(), (item) => item.expires))
    this.expiryTimer = memoryTimer(this.env, () => this.pruneAndArm(), Math.min(MEMORY_TICK, earliest - now))
  }
  async fetch(request) {
    try {
      const body = await request.json(),
        now = this.env.TEST_NOW?.() ?? Date.now()
      for (const [hash, item] of this.sessions) if (item.expires <= now) this.sessions.delete(hash)
      if (!/^[a-f0-9]{64}$/.test(body.hash)) fail(400, 'Invalid internal session key.')
      if (body.action === 'create') {
        if (this.sessions.size >= 60) fail(503, 'The portal connection is busy. Retry later.')
        this.sessions.set(body.hash, { expires: now + TTL, epoch: undefined })
        return json({ expires: now + TTL })
      }
      const item = this.sessions.get(body.hash)
      if (body.action === 'remove') {
        this.sessions.delete(body.hash)
        return json({ found: !!item })
      }
      if (!item)
        fail(401, 'The portal session expired or reset. Reconnect to continue.', {
          sessionExpired: true,
          loggedIn: false,
        })
      if (body.action === 'touch') item.expires = now + TTL
      if (body.action === 'epoch') item.epoch = body.epoch
      return json(item)
    } catch (e) {
      return failure(e)
    } finally {
      this.pruneAndArm()
    }
  }
}

export class NechakoSession {
  constructor(_ctx, env) {
    this.env = env
    this.epoch = token()
    this.generation = 0
    this.revoked = false
    this.cookies = new Map()
    this.bootstrapped = false
    this.loggedIn = false
    this.admin = false
    this.queue = Promise.resolve()
    this.pending = 0
    this.calls = []
    this.logins = []
    this.controllers = new Set()
    this.expires = 0
    this.expiryTimer = undefined
  }
  now() {
    return this.env.TEST_NOW?.() ?? Date.now()
  }
  check(generation) {
    if (this.expires && this.expires <= this.now() && !this.revoked) this.revoke()
    if (this.revoked || generation !== this.generation)
      fail(401, 'The portal session was replaced or disconnected.', { sessionExpired: true, loggedIn: false })
  }
  revoke() {
    cancelMemoryTimer(this.env, this.expiryTimer)
    this.expiryTimer = undefined
    this.revoked = true
    this.generation++
    this.cookies.clear()
    this.loggedIn = false
    this.admin = false
    for (const c of this.controllers) c.abort()
    this.controllers.clear()
  }
  armExpiry(expires) {
    this.expires = expires
    cancelMemoryTimer(this.env, this.expiryTimer)
    this.expiryTimer = undefined
    if (this.expires <= this.now()) {
      this.revoke()
      return
    }
    this.expiryTimer = memoryTimer(
      this.env,
      () => {
        this.expiryTimer = undefined
        if (this.expires <= this.now()) this.revoke()
        else this.armExpiry(this.expires)
      },
      Math.min(MEMORY_TICK, this.expires - this.now()),
    )
  }
  async source(path, params, generation, deadline, maximum = JSON_LIMIT) {
    this.check(generation)
    const controller = new AbortController(),
      wait = deadline - this.now()
    if (wait <= 0) fail(504, 'The original portal read timed out.')
    this.controllers.add(controller)
    const timer = setTimeout(() => controller.abort(), wait)
    try {
      const headers = {
        Referer: SOURCE,
        Origin: SOURCE.slice(0, -1),
        'X-Requested-With': 'XMLHttpRequest',
        Accept: '*/*',
        'User-Agent': 'PGMaps-Nechako-HostedGateway/1.0',
      }
      if (params !== undefined) headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8'
      if (this.cookies.size)
        headers.Cookie = Array.from(this.cookies)
          .map(([k, v]) => `${k}=${v}`)
          .join('; ')
      const response = await (this.env.SOURCE_FETCH ?? fetch)(SOURCE + path, {
        method: params === undefined ? 'GET' : 'POST',
        headers,
        body: params === undefined ? undefined : new URLSearchParams(params),
        redirect: 'manual',
        signal: controller.signal,
      })
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel()
        fail(502, 'Source redirects are not permitted.')
      }
      if (!response.ok) {
        await response.body?.cancel()
        fail(502, 'The original portal returned an HTTP error.')
      }
      const raw = await bytes(response, maximum)
      this.check(generation)
      for (const value of cookies(response.headers)) {
        const pair = value.split(';')[0],
          split = pair.indexOf('=')
        if (split <= 0) continue
        const name = pair.slice(0, split),
          content = pair.slice(split + 1)
        if (!/^[a-zA-Z0-9_-]{1,100}$/.test(name) || !/^[^;\r\n]{0,4096}$/.test(content)) continue
        if (/max-age=0(?:;|$)/i.test(value) || !content) this.cookies.delete(name)
        else {
          if (!this.cookies.has(name) && this.cookies.size >= 32)
            fail(502, 'The source returned too many session cookies.')
          this.cookies.set(name, content)
        }
      }
      return { raw, headers: response.headers }
    } catch (e) {
      this.check(generation)
      if (controller.signal.aborted) fail(504, 'The original portal read timed out.')
      throw e
    } finally {
      clearTimeout(timer)
      this.controllers.delete(controller)
    }
  }
  async native(path, params, generation, deadline) {
    if (!this.bootstrapped) {
      await this.source('', undefined, generation, deadline)
      this.check(generation)
      this.bootstrapped = true
    }
    const { raw } = await this.source(path, params, generation, deadline)
    let value
    try {
      value = JSON.parse(decoder.decode(raw))
    } catch {
      fail(502, 'The original portal returned invalid JSON.')
    }
    if (!object(value)) fail(502, 'The original portal returned an invalid envelope.')
    if (typeof value.loggedIn === 'boolean') {
      this.loggedIn = value.loggedIn
      if (!this.loggedIn) this.admin = false
    }
    return value
  }
  async operation(action, payload, generation, deadline) {
    if (action === 'login') {
      exact(payload, ['username', 'password'])
      if (![payload.username, payload.password].every((v) => typeof v === 'string' && v.length > 0 && v.length <= 256))
        fail(400, 'Enter the source username and password.')
      const value = await this.native('rest/portal/login.php', payload, generation, deadline)
      if (!successful(value) || !this.loggedIn) {
        this.cookies.clear()
        this.bootstrapped = false
        this.loggedIn = false
        this.admin = false
        return json(
          {
            ...status(false),
            error:
              typeof value.error === 'string'
                ? value.error.slice(0, 500)
                : 'The original portal did not establish a signed-in session.',
          },
          401,
        )
      }
      this.admin = value.attributes?.isAdmin === true
      return json(status(true, TTL / 1000, { isAdmin: this.admin }))
    }
    if (action === 'read') {
      const { path, params } = validateRead(payload)
      if (administratorRead(path) && (!this.loggedIn || !this.admin))
        fail(403, 'This read requires a source administrator sign-in. Source changes remain disabled.')
      return json(await this.native(path, params, generation, deadline))
    }
    if (action === 'layer-attributes') {
      exact(payload, ['submissionId', 'layerId'])
      if (![payload.submissionId, payload.layerId].every(positive))
        fail(400, 'Enter valid source submission and layer IDs.')
      const layers = await this.native(
        'rest/portal/getSubmissionLayers.php',
        { submissionId: payload.submissionId },
        generation,
        deadline,
      )
      if (
        !successful(layers) ||
        !Array.isArray(layers.attributes) ||
        !layers.attributes.some((r) => object(r) && String(r.layer_id) === payload.layerId)
      )
        fail(403, 'The source layer is not in this permitted submission.')
      const descriptor = await this.native(
          'rest/openmap/getPortalLayer.php',
          { type: 'layer', layerId: payload.layerId },
          generation,
          deadline,
        ),
        d = descriptor.attributes
      if (
        !successful(descriptor) ||
        !object(d) ||
        !['mapfile', 'mapfileName'].every(
          (k) => typeof d[k] === 'string' && d[k].length > 0 && d[k].length <= 4096 && !d[k].includes('\0'),
        )
      )
        fail(502, 'The source did not provide a valid layer descriptor.')
      return json(
        await this.native(
          'rest/openmap/attributes.php',
          {
            data: JSON.stringify({ filename: d.mapfile, layername: d.mapfileName }),
            source: JSON.stringify({ isPortal: true, layer: Number(payload.layerId) }),
          },
          generation,
          deadline,
        ),
      )
    }
    exact(payload, ['submissionId', 'mode'])
    if (!positive(payload.submissionId) || !['pdf', 'html', 'csv', 'files'].includes(payload.mode))
      fail(400, 'Invalid source submission download.')
    const permission = await this.native(
      'rest/portal/getSubmissionMetadata.php',
      { submissionId: payload.submissionId },
      generation,
      deadline,
    )
    if (!successful(permission) || !object(permission.attributes))
      fail(403, 'The original portal denied this submission download.')
    const { raw, headers } = await this.source(
        'rest/portal/downloadSubmission.php',
        payload,
        generation,
        deadline,
        FILE_LIMIT,
      ),
      text = decoder.decode(raw.subarray(0, 1024)),
      mode = payload.mode
    if (!raw.length || !headers.get('Content-Disposition')?.toLowerCase().includes('attachment'))
      fail(502, 'The original portal did not return a downloadable file.')
    if (text.trimStart().startsWith('{')) {
      try {
        const error = JSON.parse(decoder.decode(raw))
        if (object(error) && (error.error || error.success === false || error.status === 'failure'))
          fail(403, 'The original portal denied this download.')
      } catch (e) {
        if (e instanceof Failure) throw e
      }
    }
    if (mode === 'pdf' && !text.startsWith('%PDF-')) fail(502, 'The original portal did not return a PDF signature.')
    if (
      mode === 'files' &&
      !(raw[0] === 80 && raw[1] === 75 && ((raw[2] === 3 && raw[3] === 4) || (raw[2] === 5 && raw[3] === 6)))
    )
      fail(502, 'The original portal did not return a ZIP signature.')
    if (mode === 'html' && !/^\s*<(?:!doctype|html|head|body|link|style|div|h[12]|p|table)\b/i.test(text))
      fail(502, 'The original portal did not return an HTML document.')
    if (mode === 'csv' && (text.trimStart().startsWith('<') || raw.includes(0)))
      fail(502, 'The original portal did not return CSV content.')
    const extension = mode === 'files' ? 'zip' : mode,
      mime = {
        pdf: 'application/pdf',
        html: 'text/html; charset=utf-8',
        csv: 'text/csv; charset=utf-8',
        files: 'application/zip',
      }[mode]
    return new Response(raw, {
      headers: {
        'Content-Type': mime,
        'Content-Disposition': `attachment; filename="nechako-original-submission-${payload.submissionId}.${extension}"`,
        'Content-Length': String(raw.length),
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "sandbox; default-src 'none'",
        'X-Content-Type-Options': 'nosniff',
      },
    })
  }
  async fetch(request) {
    try {
      const body = await request.json(),
        action = body.action
      if (action === 'revoke') {
        this.revoke()
        return json(status(false), 200, { 'X-Object-Epoch': this.epoch })
      }
      this.check(this.generation)
      // The dispatcher supplies the registry deadline. Peeks can restore a
      // timer after a genuine restart, but never move that deadline forward.
      if (action !== 'status' || this.expiryTimer === undefined) this.armExpiry(body.expires)
      this.check(this.generation)
      if (body.expectedEpoch && body.expectedEpoch !== this.epoch)
        return json(
          {
            ...status(false, Math.max(0, (body.expires - this.now()) / 1000)),
            sessionReset: true,
            error: action === 'status' ? undefined : 'The source session reset; refresh before reading again.',
          },
          action === 'status' ? 200 : 409,
          { 'X-Object-Epoch': this.epoch },
        )
      if (action === 'init' || action === 'status')
        return json(
          status(this.loggedIn, (body.expires - this.now()) / 1000, { isAdmin: this.loggedIn && this.admin }),
          200,
          { 'X-Object-Epoch': this.epoch },
        )
      const now = this.now()
      this.calls = this.calls.filter((n) => now - n < 60000)
      this.logins = this.logins.filter((n) => now - n < 60000)
      if (this.calls.length >= 60 || (action === 'login' && this.logins.length >= 5))
        fail(429, 'Source session request rate exceeded. Retry later.')
      this.calls.push(now)
      if (action === 'login') this.logins.push(now)
      if (this.pending >= 4) fail(429, 'The source session is busy. Retry later.')
      this.pending++
      const generation = this.generation,
        deadline = now + 60000
      const task = this.queue
        .catch(() => {})
        .then(() => {
          this.check(generation)
          return this.operation(action, body.payload, generation, deadline)
        })
      this.queue = task.then(
        () => {},
        () => {},
      )
      try {
        const response = await task
        this.check(generation)
        response.headers.set('X-Object-Epoch', this.epoch)
        return response
      } finally {
        this.pending--
      }
    } catch (e) {
      return failure(e)
    }
  }
}

async function registry(env, action, hash, extra = {}) {
  const stub = env.NECHAKO_REGISTRY.get(env.NECHAKO_REGISTRY.idFromName('registry-v1'))
  const response = await stub.fetch('https://internal/registry', {
    method: 'POST',
    body: JSON.stringify({ action, hash, ...extra }),
  })
  const value = await response.json()
  if (!response.ok)
    fail(response.status, value.error || 'Session unavailable.', {
      sessionExpired: value.sessionExpired === true,
      loggedIn: false,
    })
  return value
}
function sessionStub(env, hash) {
  return env.NECHAKO_SESSIONS.get(env.NECHAKO_SESSIONS.idFromName(hash))
}
async function revoke(env, capability) {
  if (!validToken(capability)) return
  const hash = await digest(capability)
  const removed = await registry(env, 'remove', hash)
  if (removed.found)
    await sessionStub(env, hash).fetch('https://internal/session', {
      method: 'POST',
      body: JSON.stringify({ action: 'revoke' }),
    })
}
async function create(env) {
  const capability = token(),
    hash = await digest(capability),
    entry = await registry(env, 'create', hash)
  const stub = sessionStub(env, hash),
    response = await stub.fetch('https://internal/session', {
      method: 'POST',
      body: JSON.stringify({ action: 'init', expires: entry.expires }),
    })
  const epoch = response.headers.get('X-Object-Epoch')
  await registry(env, 'epoch', hash, { epoch })
  return { capability, hash, entry: { ...entry, epoch }, stub }
}
function cors(response, origin) {
  const headers = new Headers(response.headers)
  headers.delete('X-Object-Epoch')
  headers.delete('Set-Cookie')
  headers.set('Access-Control-Allow-Origin', origin)
  headers.set('Vary', 'Origin')
  headers.set('Access-Control-Expose-Headers', 'Content-Type, Content-Disposition, Content-Length')
  headers.set('Cache-Control', 'no-store')
  headers.set('X-Content-Type-Options', 'nosniff')
  return new Response(response.body, { status: response.status, headers })
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin')
    if (!ORIGINS.has(origin)) return json({ error: 'This origin is not allowed to use the portal connection.' }, 403)
    try {
      const url = new URL(request.url),
        action = url.pathname.startsWith(BASE + '/') ? url.pathname.slice(BASE.length + 1) : ''
      if (url.search || !['status', 'read', 'login', 'disconnect', 'layer-attributes', 'download'].includes(action))
        fail(404, 'Unknown portal connection route. Source writes are disabled.')
      if (request.method === 'OPTIONS') {
        const method = request.headers.get('Access-Control-Request-Method'),
          headers = (request.headers.get('Access-Control-Request-Headers') || '')
            .toLowerCase()
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        if (
          !['GET', 'POST'].includes(method) ||
          headers.some((h) => !['content-type', 'x-nechako-session'].includes(h)) ||
          (method === 'GET' && action !== 'status')
        )
          fail(403, 'Unsupported preflight method or headers.')
        return cors(
          new Response(null, {
            status: 204,
            headers: {
              'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
              'Access-Control-Allow-Headers': 'Content-Type, X-Nechako-Session',
              'Access-Control-Max-Age': '600',
            },
          }),
          origin,
        )
      }
      if (request.method !== 'POST' && !(request.method === 'GET' && action === 'status'))
        fail(405, 'Unsupported portal connection method.')
      const capability = request.headers.get('X-Nechako-Session')
      if (capability && !validToken(capability))
        fail(401, 'Invalid portal session.', { sessionExpired: true, loggedIn: false })
      if (request.method === 'GET' && !capability) return cors(json(status(false, 0, { tokenRequired: true })), origin)
      const payload = request.method === 'POST' ? await input(request) : {}
      if (action === 'status' && request.method === 'POST') exact(payload, [])
      if (action === 'disconnect') {
        exact(payload, [])
        await revoke(env, capability)
        return cors(json(status(false, 0)), origin)
      }
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
      if (action === 'login' || (action === 'status' && request.method === 'POST')) {
        if (!(await env.SESSION_RATE_LIMIT.limit({ key: ip })).success)
          fail(429, 'Too many session requests. Retry later.')
      }
      if (action === 'login') {
        exact(payload, ['username', 'password'])
        if (
          ![payload.username, payload.password].every((v) => typeof v === 'string' && v.length > 0 && v.length <= 256)
        )
          fail(400, 'Enter the source username and password.')
        await revoke(env, capability)
        if (!(await env.LOGIN_RATE_LIMIT.limit({ key: ip })).success)
          fail(429, 'Too many sign-in attempts. Retry later.')
        const fresh = await create(env)
        const response = await fresh.stub.fetch('https://internal/session', {
          method: 'POST',
          body: JSON.stringify({
            action: 'login',
            payload,
            expectedEpoch: fresh.entry.epoch,
            expires: fresh.entry.expires,
          }),
        })
        const value = await response.json()
        return cors(json({ ...value, sessionToken: fresh.capability }, response.status), origin)
      }
      if (action === 'status' && request.method === 'POST') {
        await revoke(env, capability)
        const fresh = await create(env)
        return cors(json(status(false, TTL / 1000, { sessionToken: fresh.capability })), origin)
      }
      if (!capability) fail(401, 'Start a portal connection before reading.', { sessionExpired: true, loggedIn: false })
      const hash = await digest(capability),
        entry = await registry(env, action === 'status' ? 'get' : 'touch', hash)
      const response = await sessionStub(env, hash).fetch('https://internal/session', {
        method: 'POST',
        body: JSON.stringify({ action, payload, expectedEpoch: entry.epoch, expires: entry.expires }),
      })
      const epoch = response.headers.get('X-Object-Epoch')
      if (epoch && epoch !== entry.epoch) await registry(env, 'epoch', hash, { epoch })
      // Registry revocation wins even if an old source read resolved after disconnect.
      await registry(env, 'get', hash)
      return cors(response, origin)
    } catch (e) {
      return cors(failure(e), origin)
    }
  },
}
