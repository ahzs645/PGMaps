export type PortalConnectionMode = 'direct' | 'gateway'
export type PortalConnectionStatus = {
  available: boolean
  loggedIn: boolean
  readOnly: boolean
  canWrite?: boolean
  isAdmin?: boolean
  expiresAfterIdleSeconds?: number
}

export const PORTAL_GATEWAY = '/api/nechako-portal'
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
    return typeof window !== 'undefined' && window.localStorage?.getItem(PORTAL_CONNECTION_SETTING) === 'gateway'
      ? 'gateway'
      : 'direct'
  } catch {
    return 'direct'
  }
}
let connectionMode: PortalConnectionMode = storedMode()
let csrfToken: string | undefined
let authenticated: boolean | undefined
const channel =
  typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel('nechako-session-revision')
    : undefined

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
    // Browser tabs share the local HttpOnly cookie. Never retain the previous identity's token or cached payloads.
    csrfToken = undefined
    authenticated = undefined
    notifyConnection('external-session', false, event.data.reason)
  }

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function')
  window.addEventListener('storage', (event) => {
    if (event.key !== PORTAL_CONNECTION_SETTING) return
    connectionMode = event.newValue === 'gateway' ? 'gateway' : 'direct'
    notifyConnection('mode', false)
  })

export function getPortalConnectionMode(): PortalConnectionMode {
  return connectionMode
}

export function setPortalConnectionMode(mode: PortalConnectionMode) {
  connectionMode = mode
  try {
    if (typeof window !== 'undefined') window.localStorage?.setItem(PORTAL_CONNECTION_SETTING, mode)
  } catch {
    /* Private-mode storage can be unavailable; the in-memory setting still works. */
  }
  notifyConnection('mode', false)
}

export async function gatewayRequest(
  action: 'status' | 'read' | 'write' | 'login' | 'disconnect' | 'layer-attributes',
  payload?: unknown,
  signal?: AbortSignal,
) {
  let response: Response
  try {
    response = await fetch(`${PORTAL_GATEWAY}/${action}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...(payload === undefined
        ? {}
        : {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(action === 'write' && csrfToken ? { 'X-Nechako-CSRF': csrfToken } : {}),
            },
            body: JSON.stringify(payload),
          }),
      signal: signal ?? AbortSignal.timeout(60000),
    })
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error
    throw new Error(
      'The local portal gateway is unavailable. Start python3 scripts/nechako-server/portal_gateway.py for this development session.',
    )
  }
  let value: unknown
  try {
    value = await response.json()
  } catch {
    throw new Error('The local portal gateway did not return JSON. Check the gateway service and same-origin proxy.')
  }
  if (!response.ok) {
    if (action === 'login' || (action === 'write' && response.status === 403)) csrfToken = undefined
    const error =
      value && typeof value === 'object' && 'error' in value
        ? String(value.error)
        : `Local gateway HTTP ${response.status}`
    throw new Error(error)
  }
  if (action === 'disconnect') {
    csrfToken = undefined
    authenticated = false
  }
  if (value && typeof value === 'object' && 'loggedIn' in value && typeof value.loggedIn === 'boolean') {
    const changed = authenticated !== undefined && authenticated !== value.loggedIn
    authenticated = value.loggedIn
    if (changed && action !== 'login' && action !== 'disconnect') {
      csrfToken = undefined
      notifyConnection(authenticated ? 'signed-in' : 'disconnected')
    }
  }
  if (
    (action === 'status' || action === 'login') &&
    value &&
    typeof value === 'object' &&
    'csrfToken' in value &&
    typeof value.csrfToken === 'string'
  )
    csrfToken = value.csrfToken
  return value
}

function checkedStatus(value: unknown): PortalConnectionStatus {
  if (
    !value ||
    typeof value !== 'object' ||
    !('available' in value) ||
    typeof value.available !== 'boolean' ||
    !('loggedIn' in value) ||
    typeof value.loggedIn !== 'boolean' ||
    !('readOnly' in value) ||
    typeof value.readOnly !== 'boolean'
  ) {
    throw new Error('The local portal gateway returned an invalid connection status.')
  }
  const status = value as PortalConnectionStatus
  return {
    available: status.available,
    loggedIn: status.loggedIn,
    readOnly: status.readOnly,
    canWrite: status.canWrite === true,
    isAdmin: status.isAdmin === true,
    expiresAfterIdleSeconds: status.expiresAfterIdleSeconds,
  }
}

export async function getPortalConnectionStatus(signal?: AbortSignal) {
  return checkedStatus(await gatewayRequest('status', undefined, signal))
}

export async function connectPortalSession(username: string, password: string, signal?: AbortSignal) {
  csrfToken = undefined
  authenticated = undefined
  notifyConnection('session-changing')
  const status = checkedStatus(await gatewayRequest('login', { username, password }, signal))
  if (!status.loggedIn) throw new Error('The original portal did not establish an authenticated session.')
  setPortalConnectionMode('gateway')
  notifyConnection('signed-in')
  return status
}

export async function disconnectPortalSession(signal?: AbortSignal) {
  csrfToken = undefined
  authenticated = undefined
  notifyConnection('session-changing')
  const status = checkedStatus(await gatewayRequest('disconnect', {}, signal))
  notifyConnection('disconnected')
  return status
}

export async function gatewayWrite(path: string, params: Record<string, string>, signal?: AbortSignal) {
  if (getPortalConnectionMode() !== 'gateway')
    throw new Error('Source changes require your signed-in local gateway connection.')
  const status = await getPortalConnectionStatus(signal)
  if (!status.loggedIn || !status.canWrite || !csrfToken)
    throw new Error('Sign in to your own portal session before making a source change.')
  return gatewayRequest('write', { path, params }, signal)
}

export type SubmissionDownloadMode = 'pdf' | 'html' | 'csv' | 'files'
/** Same per-browser session as live reads; accepts no upstream URLs, paths or filenames. */
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
  const response = await fetch(`${PORTAL_GATEWAY}/download`, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    signal: signal ?? AbortSignal.timeout(60000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ submissionId, mode }),
  })
  if (!response.ok) {
    const value = await response.json().catch(() => undefined)
    throw new Error(value?.error || `Original download HTTP ${response.status}`)
  }
  const mime = { pdf: 'application/pdf', html: 'text/html', csv: 'text/csv', files: 'application/zip' }[mode]
  if (!response.headers.get('content-type')?.startsWith(mime))
    throw new Error('The portal connection did not return the requested file type.')
  const blob = await response.blob()
  if (!blob.size || blob.size > 32 * 1024 * 1024)
    throw new Error('Original download is empty or exceeds 32 MiB. Use the original portal.')
  if (signal?.aborted) throw new DOMException('Download cancelled.', 'AbortError')
  return { blob, filename: `nechako-original-submission-${submissionId}.${mode === 'files' ? 'zip' : mode}` }
}
