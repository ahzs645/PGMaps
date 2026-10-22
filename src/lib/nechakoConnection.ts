export type PortalConnectionMode = 'direct' | 'gateway'
export type PortalConnectionStatus = {
  available: boolean
  loggedIn: boolean
  readOnly: boolean
  canWrite?: boolean
  isAdmin?: boolean
  expiresAfterIdleSeconds?: number
}

const LOCAL_GATEWAY = '/api/nechako-portal'
export const PORTAL_GATEWAY = import.meta.env.VITE_NECHAKO_GATEWAY_URL?.trim() || LOCAL_GATEWAY
/** Reject insecure/credential-bearing hosted URLs before any network request. */
export function checkedPortalGatewayUrl(value: string) {
  if (value === LOCAL_GATEWAY) return value
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('The hosted portal connection requires an HTTPS URL without credentials, query or fragment.')
  return url.href.replace(/\/$/, '')
}
export function isHostedPortalGateway() {
  try {
    return checkedPortalGatewayUrl(PORTAL_GATEWAY) !== LOCAL_GATEWAY
  } catch {
    return false
  }
}
export const PORTAL_CONNECTION_EVENT = 'nechako-connection-change'
export const PORTAL_CONNECTION_SETTING = 'pgmaps-nechako-connection-mode'
export type PortalConnectionChangeReason =
  | 'mode'
  | 'signed-in'
  | 'disconnected'
  | 'external-session'
  | 'session-changing'
function storedMode(): PortalConnectionMode {
  try {
    const stored = typeof window !== 'undefined' ? window.localStorage?.getItem(PORTAL_CONNECTION_SETTING) : undefined
    if (stored === 'gateway' || stored === 'direct') return stored
  } catch {
    /* The session can run without browser storage. */
  }
  return isHostedPortalGateway() ? 'gateway' : 'direct'
}
let connectionMode: PortalConnectionMode = storedMode()
let csrfToken: string | undefined
let authenticated: boolean | undefined
// Hosted capabilities stay in this module's RAM. Never persist or share them.
let sessionToken: string | undefined
let identityGeneration = 0
let identityChanging = false
const requests = new Set<AbortController>()
let bootstrap: { generation: number; promise: Promise<void> } | undefined
const channel =
  typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel('nechako-session-revision')
    : undefined
const aborted = () => new DOMException('Portal connection changed; discard the previous response.', 'AbortError')
function invalidateIdentity(clearCapability: boolean) {
  identityGeneration++
  for (const controller of requests) controller.abort()
  requests.clear()
  csrfToken = undefined
  authenticated = undefined
  bootstrap = undefined
  if (clearCapability) sessionToken = undefined
  return identityGeneration
}
function notifyConnection(
  reason: PortalConnectionChangeReason,
  broadcast = true,
  sourceReason?: PortalConnectionChangeReason,
) {
  if (typeof window !== 'undefined')
    window.dispatchEvent(
      new CustomEvent(PORTAL_CONNECTION_EVENT, { detail: { reason, ...(sourceReason ? { sourceReason } : {}) } }),
    )
  if (broadcast) channel?.postMessage({ reason })
}
if (channel)
  channel.onmessage = (event) => {
    if (!['signed-in', 'disconnected', 'session-changing'].includes(event.data?.reason)) return
    // Local cookies are shared; hosted capabilities are per-tab and are never transferred.
    const hosted = isHostedPortalGateway()
    invalidateIdentity(hosted)
    // Hosted identities are independent: another tab may close mid-login.
    identityChanging = !hosted && event.data.reason === 'session-changing'
    notifyConnection('external-session', false, event.data.reason)
  }
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function')
  window.addEventListener('storage', (event) => {
    if (event.key !== PORTAL_CONNECTION_SETTING) return
    invalidateIdentity(false)
    connectionMode =
      event.newValue === 'gateway' || (event.newValue === null && isHostedPortalGateway()) ? 'gateway' : 'direct'
    notifyConnection('mode', false)
  })
export function getPortalConnectionMode(): PortalConnectionMode {
  return connectionMode
}
export function setPortalConnectionMode(mode: PortalConnectionMode) {
  invalidateIdentity(false)
  connectionMode = mode
  try {
    if (typeof window !== 'undefined') window.localStorage?.setItem(PORTAL_CONNECTION_SETTING, mode)
  } catch {
    /* Nonsecret preference only. */
  }
  notifyConnection('mode', false)
}

type Action = 'status' | 'read' | 'write' | 'login' | 'disconnect' | 'layer-attributes' | 'download'
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
function capability(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(value))
    throw new Error('The portal connection returned an invalid session capability.')
  return value
}
/** Bind requests to an identity revision, including transports that ignore AbortSignal. */
async function transport(
  action: Action,
  payload: unknown,
  signal: AbortSignal | undefined,
  generation: number,
  allocate = false,
) {
  const base = checkedPortalGatewayUrl(PORTAL_GATEWAY),
    hosted = base !== LOCAL_GATEWAY
  if (generation !== identityGeneration || signal?.aborted) throw aborted()
  const controller = new AbortController()
  const cancel = () => controller.abort()
  signal?.addEventListener('abort', cancel, { once: true })
  const timeout = setTimeout(cancel, hosted ? 75000 : 60000)
  requests.add(controller)
  const current = () => generation === identityGeneration && !controller.signal.aborted && !signal?.aborted
  try {
    let response: Response
    try {
      response = await fetch(`${base}/${action}`, {
        credentials: hosted ? 'omit' : 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(hosted && sessionToken && !(identityChanging && action === 'status' && !allocate)
            ? { 'X-Nechako-Session': sessionToken }
            : {}),
          ...(action === 'write' && csrfToken && !hosted ? { 'X-Nechako-CSRF': csrfToken } : {}),
        },
        ...(payload === undefined ? {} : { method: 'POST', body: JSON.stringify(payload) }),
      })
    } catch (error) {
      if (!current() || (error instanceof DOMException && error.name === 'AbortError')) throw aborted()
      throw new Error(
        hosted
          ? 'The portal connection is unavailable. Try again or use the original portal.'
          : 'The local portal gateway is unavailable. Start python3 scripts/nechako-server/portal_gateway.py for this development session.',
      )
    }
    if (!current()) throw aborted()
    if (action === 'download' && response.ok) {
      const length = Number(response.headers.get('content-length'))
      if (length > 32 * 1024 * 1024) throw new Error('Original download exceeds 32 MiB. Use the original portal.')
      const blob = await response.blob()
      if (!current()) throw aborted()
      return { blob, contentType: response.headers.get('content-type') }
    }
    let value: unknown
    try {
      value = await response.json()
    } catch {
      throw new Error('The portal connection did not return a valid response.')
    }
    if (!current()) throw aborted()
    if (hosted && object(value) && (value.sessionExpired === true || value.sessionReset === true)) {
      invalidateIdentity(true)
      identityChanging = false
      notifyConnection('disconnected')
      throw new Error(
        value.sessionExpired === true
          ? 'Your portal session expired. Connect again to continue.'
          : 'Your portal session ended. Connect again to continue.',
      )
    }
    // Only allocation/login may supply a capability. A late status can never replace it.
    if (hosted && object(value) && (allocate || action === 'login') && value.sessionToken !== undefined)
      sessionToken = capability(value.sessionToken)
    if (!response.ok) {
      if (action === 'login' || (action === 'write' && response.status === 403)) csrfToken = undefined
      throw new Error(
        object(value) && typeof value.error === 'string' ? value.error : `Portal connection HTTP ${response.status}`,
      )
    }
    if (action === 'disconnect') {
      csrfToken = undefined
      authenticated = false
      if (hosted) sessionToken = undefined
    }
    if (
      object(value) &&
      typeof value.loggedIn === 'boolean' &&
      !(identityChanging && action === 'status' && !allocate)
    ) {
      const changed = authenticated !== undefined && authenticated !== value.loggedIn
      authenticated = value.loggedIn
      if (changed && action !== 'login' && action !== 'disconnect') {
        const nowAuthenticated = authenticated
        invalidateIdentity(hosted && !nowAuthenticated)
        authenticated = nowAuthenticated
        notifyConnection(nowAuthenticated ? 'signed-in' : 'disconnected')
        if (action !== 'status') throw aborted()
      }
    }
    if (!hosted && object(value) && (action === 'status' || action === 'login') && typeof value.csrfToken === 'string')
      csrfToken = value.csrfToken
    return value
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', cancel)
    requests.delete(controller)
  }
}
async function ensureHostedSession(generation: number) {
  if (sessionToken) return
  if (!bootstrap || bootstrap.generation !== generation) {
    const promise = transport('status', {}, undefined, generation, true).then(() => {
      if (generation !== identityGeneration) throw aborted()
      if (!sessionToken) throw new Error('The portal connection did not establish a session.')
    })
    const pending = { generation, promise }
    bootstrap = pending
    void promise
      .finally(() => {
        if (bootstrap === pending) bootstrap = undefined
      })
      .catch(() => undefined)
  }
  await bootstrap.promise
}
export async function gatewayRequest(action: Exclude<Action, 'download'>, payload?: unknown, signal?: AbortSignal) {
  const generation = identityGeneration
  if (isHostedPortalGateway() && ['read', 'layer-attributes', 'write'].includes(action)) {
    if (identityChanging) throw new Error('The portal connection is changing. Wait for it to finish.')
    if (action === 'write') throw new Error('The hosted portal connection is read-only.')
    await ensureHostedSession(generation)
  }
  return transport(action, payload, signal, generation)
}
function checkedStatus(value: unknown): PortalConnectionStatus {
  if (
    !object(value) ||
    typeof value.available !== 'boolean' ||
    typeof value.loggedIn !== 'boolean' ||
    typeof value.readOnly !== 'boolean'
  )
    throw new Error('The portal connection returned an invalid connection status.')
  const hosted = isHostedPortalGateway()
  return {
    available: value.available,
    loggedIn: identityChanging ? false : value.loggedIn,
    readOnly: hosted || value.readOnly,
    canWrite: !hosted && !identityChanging && value.canWrite === true,
    // Inspection rights are separate from writes. A hosted role is usable only
    // with this tab's current capability and an authenticated source status.
    isAdmin:
      !identityChanging &&
      value.available &&
      value.loggedIn &&
      value.isAdmin === true &&
      (!hosted || sessionToken !== undefined),
    ...(typeof value.expiresAfterIdleSeconds === 'number'
      ? { expiresAfterIdleSeconds: value.expiresAfterIdleSeconds }
      : {}),
  }
}
/** Remote status is always a GET peek: no token allocation and no idle-clock extension. */
export async function getPortalConnectionStatus(signal?: AbortSignal) {
  return checkedStatus(await gatewayRequest('status', undefined, signal))
}
export async function connectPortalSession(username: string, password: string, signal?: AbortSignal) {
  const precedingCapability = sessionToken
  const generation = invalidateIdentity(false)
  identityChanging = true
  notifyConnection('session-changing')
  try {
    const status = await gatewayRequest('login', { username, password }, signal)
    if (generation !== identityGeneration) throw aborted()
    if (!object(status) || status.loggedIn !== true)
      throw new Error('The original portal did not establish an authenticated session.')
    if (isHostedPortalGateway() && (typeof status.sessionToken !== 'string' || sessionToken === precedingCapability))
      throw new Error('The portal connection did not issue a new session.')
    identityChanging = false
    // Cancel status/read requests started during the transition; keep only the new capability.
    invalidateIdentity(false)
    authenticated = true
    if (!isHostedPortalGateway() && object(status) && typeof status.csrfToken === 'string') csrfToken = status.csrfToken
    setPortalConnectionMode('gateway')
    authenticated = true
    if (!isHostedPortalGateway() && object(status) && typeof status.csrfToken === 'string') csrfToken = status.csrfToken
    notifyConnection('signed-in')
    return checkedStatus(status)
  } catch (reason) {
    if (generation === identityGeneration) {
      identityChanging = false
      invalidateIdentity(isHostedPortalGateway() && sessionToken === precedingCapability)
      authenticated = false
      notifyConnection('disconnected')
    }
    throw reason
  }
}
export async function disconnectPortalSession(signal?: AbortSignal) {
  const generation = invalidateIdentity(false)
  identityChanging = true
  notifyConnection('session-changing')
  try {
    const value = await gatewayRequest('disconnect', {}, signal)
    if (generation !== identityGeneration) throw aborted()
    identityChanging = false
    invalidateIdentity(isHostedPortalGateway())
    authenticated = false
    notifyConnection('disconnected')
    return checkedStatus(value)
  } catch (reason) {
    if (generation === identityGeneration) {
      identityChanging = false
      invalidateIdentity(isHostedPortalGateway())
      authenticated = false
      notifyConnection('disconnected')
    }
    throw reason
  }
}
export async function gatewayWrite(path: string, params: Record<string, string>, signal?: AbortSignal) {
  if (isHostedPortalGateway()) throw new Error('The hosted portal connection is read-only.')
  if (getPortalConnectionMode() !== 'gateway')
    throw new Error('Source changes require your signed-in local gateway connection.')
  const status = await getPortalConnectionStatus(signal)
  if (!status.loggedIn || !status.canWrite || !csrfToken)
    throw new Error('Sign in to your own portal session before making a source change.')
  return gatewayRequest('write', { path, params }, signal)
}
export type SubmissionDownloadMode = 'pdf' | 'html' | 'csv' | 'files'
/** Capability/cookie transport matches live reads; accepts no upstream paths or filenames. */
export async function portalDownloadSubmission(
  submissionId: string,
  mode: SubmissionDownloadMode,
  signal?: AbortSignal,
) {
  if (getPortalConnectionMode() !== 'gateway') throw new Error('Use the portal connection to download original files.')
  if (
    !/^[1-9]\d*$/.test(submissionId) ||
    Number(submissionId) > 2147483647 ||
    !['pdf', 'html', 'csv', 'files'].includes(mode)
  )
    throw new Error('Invalid submission download.')
  const generation = identityGeneration
  if (isHostedPortalGateway()) {
    if (identityChanging) throw new Error('The portal connection is changing. Wait for it to finish.')
    await ensureHostedSession(generation)
  }
  const response = (await transport('download', { submissionId, mode }, signal, generation)) as {
    blob: Blob
    contentType: string | null
  }
  const mime = { pdf: 'application/pdf', html: 'text/html', csv: 'text/csv', files: 'application/zip' }[mode]
  if (!response.contentType?.startsWith(mime))
    throw new Error('The portal connection did not return the requested file type.')
  const blob = response.blob
  if (!blob.size || blob.size > 32 * 1024 * 1024)
    throw new Error('Original download is empty or exceeds 32 MiB. Use the original portal.')
  if (signal?.aborted || generation !== identityGeneration) throw aborted()
  return { blob, filename: `nechako-original-submission-${submissionId}.${mode === 'files' ? 'zip' : mode}` }
}
