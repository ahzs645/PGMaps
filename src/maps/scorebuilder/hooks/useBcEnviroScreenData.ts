import { useEffect, useState } from 'react'
import {
  validateBcEnviroScreenRelease,
  type BcEnviroScreenLhaRow,
  type BcEnviroScreenManifest,
  type BcEnviroScreenReleaseDocument,
} from '../lib/bcEnviroScreenRelease'

const DEFAULT_BASE_URL = 'https://data.map.ahmad.sh/environmental-burden/bc-enviro-screen'
const BASE_URL = (import.meta.env.VITE_BC_ENVIRO_SCREEN_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '')
const LOCAL_RELEASE_BASE_URL = '/data/environmental-burden/bc-enviro-screen/release'

interface LatestPointer {
  schemaVersion: number
  releaseId: string
  manifestUrl: string
  files: Record<string, string>
}

interface ValidRelease {
  releaseId: string
  manifest: BcEnviroScreenManifest
  rowsByLhaCode: Map<string, BcEnviroScreenLhaRow>
}

interface ReleaseBoundDocument {
  schemaVersion: number
  releaseId: string
}

let lastValidRelease: ValidRelease | null = null
const EMPTY_ROWS = new Map<string, BcEnviroScreenLhaRow>()

async function fetchJson<T>(url: string, cache: RequestCache, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache, signal })
  if (!response.ok) throw new Error(`BC EnviroScreen request failed (${response.status}): ${url}`)
  return response.json() as Promise<T>
}

async function loadReleaseFromBase(
  baseUrl: string,
  signal: AbortSignal,
  usePointerUrls: boolean,
): Promise<ValidRelease> {
  const latestResponse = await fetch(`${baseUrl}/latest.json`, { cache: 'no-cache', signal })
  if (!latestResponse.ok) throw new Error(`BC EnviroScreen latest pointer failed (${latestResponse.status}).`)
  const latest = (await latestResponse.json()) as LatestPointer
  if (latest.schemaVersion !== 1 || !latest.releaseId || !latest.manifestUrl) {
    throw new Error('BC EnviroScreen latest pointer is invalid.')
  }
  const localReleaseBase = `${baseUrl}/${latest.releaseId}`
  const manifestUrl = usePointerUrls ? latest.manifestUrl : `${localReleaseBase}/manifest.json`
  const indicatorUrl = usePointerUrls ? latest.files?.['lha-indicators'] : `${localReleaseBase}/lha-indicators.json`
  const definitionsUrl = usePointerUrls
    ? latest.files?.['indicator-definitions']
    : `${localReleaseBase}/indicator-definitions.json`
  const scoresUrl = usePointerUrls ? latest.files?.['lha-scores'] : `${localReleaseBase}/lha-scores.json`
  if (!indicatorUrl || !definitionsUrl || !scoresUrl) {
    throw new Error('BC EnviroScreen latest pointer is missing calculation-ready release files.')
  }
  const [manifest, indicators, definitions, scores] = await Promise.all([
    fetchJson<BcEnviroScreenManifest>(manifestUrl, 'force-cache', signal),
    fetchJson<BcEnviroScreenReleaseDocument>(indicatorUrl, 'force-cache', signal),
    fetchJson<ReleaseBoundDocument>(definitionsUrl, 'force-cache', signal),
    fetchJson<ReleaseBoundDocument>(scoresUrl, 'force-cache', signal),
  ])
  if (manifest.releaseId !== latest.releaseId)
    throw new Error('BC EnviroScreen latest pointer targets mismatched files.')
  if (definitions.releaseId !== latest.releaseId || scores.releaseId !== latest.releaseId) {
    throw new Error('BC EnviroScreen release files do not share one release ID.')
  }
  return {
    releaseId: latest.releaseId,
    manifest,
    rowsByLhaCode: validateBcEnviroScreenRelease(manifest, indicators),
  }
}

async function loadRelease(signal: AbortSignal): Promise<ValidRelease> {
  try {
    return await loadReleaseFromBase(BASE_URL, signal, true)
  } catch (remoteError) {
    if (signal.aborted) throw remoteError
    try {
      return await loadReleaseFromBase(LOCAL_RELEASE_BASE_URL, signal, false)
    } catch (localError) {
      const remoteMessage = remoteError instanceof Error ? remoteError.message : 'remote release unavailable'
      const localMessage = localError instanceof Error ? localError.message : 'local release unavailable'
      throw new Error(`BC EnviroScreen release unavailable. Remote: ${remoteMessage} Local: ${localMessage}`)
    }
  }
}

export function useBcEnviroScreenData(enabled: boolean) {
  const [release, setRelease] = useState<ValidRelease | null>(() => (enabled ? lastValidRelease : null))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    Promise.resolve().then(() => {
      if (!controller.signal.aborted) setError(null)
    })
    loadRelease(controller.signal)
      .then((next) => {
        lastValidRelease = next
        setRelease(next)
        setError(null)
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        setRelease(lastValidRelease)
        setError(reason instanceof Error ? reason.message : 'Unable to load BC EnviroScreen release.')
      })
    return () => controller.abort()
  }, [enabled])

  return {
    releaseId: enabled ? (release?.releaseId ?? null) : null,
    manifest: enabled ? (release?.manifest ?? null) : null,
    rowsByLhaCode: enabled ? (release?.rowsByLhaCode ?? EMPTY_ROWS) : EMPTY_ROWS,
    loading: enabled && !release && !error,
    error: enabled ? error : null,
    usingCachedRelease: Boolean(enabled && error && release),
  }
}
