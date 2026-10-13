import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { ExternalLink } from '@/components/ui/text-button'
import {
  connectPortalSession,
  disconnectPortalSession,
  errorText,
  getPortalConnectionMode,
  getPortalConnectionStatus,
  PORTAL_CONNECTION_EVENT,
  NECHAKO_PORTAL,
  setPortalConnectionMode,
  type PortalConnectionStatus,
} from '@/lib/nechakoPortal'

export function LocalPortalConnection({ onChange }: { onChange?: () => void }) {
  const [mode, setMode] = useState(getPortalConnectionMode)
  const [status, setStatus] = useState<PortalConnectionStatus>()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const statusRequest = useRef<AbortController | undefined>(undefined)
  const mounted = useRef(true)
  const refreshStatus = useCallback(async (reportError = false) => {
    statusRequest.current?.abort()
    const controller = new AbortController()
    statusRequest.current = controller
    try {
      const next = await getPortalConnectionStatus(controller.signal)
      if (mounted.current && !controller.signal.aborted && statusRequest.current === controller) setStatus(next)
    } catch (reason) {
      if (mounted.current && !controller.signal.aborted && statusRequest.current === controller) {
        setStatus(undefined)
        if (reportError) setError(errorText(reason))
      }
    }
  }, [])
  useEffect(() => {
    mounted.current = true
    const refresh = (event?: Event) => {
      setMode(getPortalConnectionMode())
      const detail = (event as CustomEvent<{ reason?: string; sourceReason?: string }> | undefined)?.detail
      if (detail?.reason === 'session-changing' || detail?.sourceReason === 'session-changing') {
        statusRequest.current?.abort()
        statusRequest.current = undefined
        setStatus((current) => (current ? { ...current, loggedIn: false, canWrite: false, isAdmin: false } : undefined))
      } else void refreshStatus()
    }
    refresh()
    window.addEventListener(PORTAL_CONNECTION_EVENT, refresh)
    return () => {
      mounted.current = false
      statusRequest.current?.abort()
      window.removeEventListener(PORTAL_CONNECTION_EVENT, refresh)
    }
  }, [refreshStatus])
  const check = async () => {
    setBusy(true)
    setError('')
    await refreshStatus(true)
    if (mounted.current) setBusy(false)
  }
  return (
    <div className="space-y-4 rounded-lg border p-4" data-nechako-connection>
      <h3 className="font-semibold">Original portal connection</h3>
      <p className="text-sm text-muted-foreground">
        Public submissions are available without signing in. Connect with your own original portal account to read the
        records it allows.
      </p>
      <SegmentedControl
        label="Portal request connection"
        value={mode}
        fullWidth={false}
        options={[
          { value: 'direct', label: 'Direct public reads', disabled: busy },
          { value: 'gateway', label: 'Local gateway', disabled: busy || !status?.available },
        ]}
        onChange={(value) => {
          setMode(value)
          setPortalConnectionMode(value)
          onChange?.()
        }}
      />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>
          {status?.available
            ? status.loggedIn
              ? 'Portal connection available · signed in'
              : 'Portal connection available · not signed in'
            : 'Portal sign-in is unavailable here'}
        </span>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void check()}>
          Check connection
        </Button>
      </div>
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {status?.available && (
        <form
          className="space-y-3"
          onSubmit={async (event) => {
            event.preventDefault()
            setBusy(true)
            setError('')
            const credential = password
            setPassword('')
            try {
              const next = await connectPortalSession(username, credential)
              if (mounted.current) {
                setStatus(next)
                setMode('gateway')
                onChange?.()
              }
            } catch (reason) {
              if (mounted.current) {
                setError(errorText(reason))
                setStatus((current) =>
                  current ? { ...current, loggedIn: false, canWrite: false, isAdmin: false } : current,
                )
              }
            } finally {
              if (mounted.current) setBusy(false)
            }
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium">
              Portal username
              <input
                autoComplete="username"
                aria-label="Portal connection username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="mt-1 block w-full rounded-md border bg-background p-2 text-base"
              />
            </label>
            <label className="text-sm font-medium">
              Portal password
              <input
                type="password"
                autoComplete="off"
                aria-label="Portal connection password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1 block w-full rounded-md border bg-background p-2 text-base"
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy || !username || !password}>
              Sign in for portal access
            </Button>
            {status.loggedIn && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  setError('')
                  setPassword('')
                  try {
                    const next = await disconnectPortalSession()
                    if (mounted.current) {
                      setStatus(next)
                      onChange?.()
                    }
                  } catch (reason) {
                    if (mounted.current) setError(errorText(reason))
                  } finally {
                    if (mounted.current) setBusy(false)
                  }
                }}
              >
                Disconnect local session
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Your password is cleared after each attempt. The connection is temporary and follows your account’s access.
          </p>
        </form>
      )}
      {!status?.available && (
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>
            Public captured submissions still work. For records that require access, sign in at the original portal.
          </p>
          <ExternalLink href={NECHAKO_PORTAL}>Open original portal</ExternalLink>
          {import.meta.env.DEV && (
            <details className="text-xs">
              <summary className="cursor-pointer">Development connection setup</summary>
              <p className="mt-2">
                Run <code>python3 scripts/nechako-server/portal_gateway.py</code> alongside Vite, then check the
                connection.
              </p>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
