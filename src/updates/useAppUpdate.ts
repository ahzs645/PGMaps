import { useCallback, useEffect, useState } from 'react'

const UPDATE_EVENT = 'plugin_web_update_notice'
const DISMISSED_VERSION_KEY = 'pgmaps.update.dismissed-version'

interface PluginUpdateEventDetail {
  version?: unknown
}

interface PluginWebUpdateNoticeApi {
  checkUpdate: () => void
  dismissUpdate: () => void
  closeNotification: () => void
}

declare global {
  interface Window {
    pluginWebUpdateNotice_?: PluginWebUpdateNoticeApi
  }
}

export function buildUpdateReloadUrl(href: string, timestamp = Date.now()): string {
  const url = new URL(href)
  url.searchParams.set('_update', timestamp.toString())
  return url.toString()
}

export function useAppUpdate() {
  const [availableVersion, setAvailableVersion] = useState<string | null>(null)

  useEffect(() => {
    const handleUpdate = (event: Event) => {
      const version = (event as CustomEvent<PluginUpdateEventDetail>).detail?.version
      if (typeof version !== 'string' || version.length === 0) return

      try {
        if (window.localStorage.getItem(DISMISSED_VERSION_KEY) === version) return
      } catch {
        // Storage can be unavailable in private browsing; keep the notice usable.
      }
      setAvailableVersion(version)
    }

    document.body.addEventListener(UPDATE_EVENT, handleUpdate)
    return () => document.body.removeEventListener(UPDATE_EVENT, handleUpdate)
  }, [])

  const checkForUpdates = useCallback(() => {
    window.pluginWebUpdateNotice_?.checkUpdate()
  }, [])

  const dismissUpdate = useCallback(() => {
    if (availableVersion) {
      try {
        window.localStorage.setItem(DISMISSED_VERSION_KEY, availableVersion)
      } catch {
        // Session-only dismissal still works through local React state.
      }
    }
    window.pluginWebUpdateNotice_?.dismissUpdate()
    setAvailableVersion(null)
  }, [availableVersion])

  const applyUpdate = useCallback(() => {
    window.location.replace(buildUpdateReloadUrl(window.location.href))
  }, [])

  return {
    availableVersion,
    updateAvailable: availableVersion !== null,
    checkForUpdates,
    dismissUpdate,
    applyUpdate,
  }
}
