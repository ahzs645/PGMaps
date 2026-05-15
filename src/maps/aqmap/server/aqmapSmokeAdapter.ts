import fs from 'node:fs/promises'
import path from 'node:path'

import {
  SMOKE_FALLBACK_DATA,
  type SmokeFeatureCollection,
  type SmokeLayerDataMap,
  type SmokeLayerKey,
} from '../lib/smokeLayers'

const AQMAP_ORIGIN = 'https://aqmap.ca/aqmap'

const LOCAL_PATHS: Record<SmokeLayerKey, string[]> = {
  modelledSmoke: [
    path.resolve(process.cwd(), 'public', 'airdatamap', 'data', 'smoke', 'modelled.json'),
    path.resolve(process.cwd(), 'public', 'data', 'smoke', 'modelled.json'),
  ],
  visibleSmoke: [
    path.resolve(process.cwd(), 'public', 'airdatamap', 'data', 'smoke', 'visible.json'),
    path.resolve(process.cwd(), 'public', 'data', 'smoke', 'visible.json'),
  ],
}

const REMOTE_PATHS: Record<SmokeLayerKey, string> = {
  modelledSmoke: `${AQMAP_ORIGIN}/data/smoke/modelled/geojson`,
  visibleSmoke: `${AQMAP_ORIGIN}/data/smoke/visible/geojson`,
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isFeatureCollection(value: unknown): value is SmokeFeatureCollection {
  if (!isPlainObject(value)) return false
  if (value.type !== 'FeatureCollection') return false
  return Array.isArray(value.features)
}

function toFeatureCollection(value: unknown): SmokeFeatureCollection | null {
  if (isFeatureCollection(value)) return value
  return null
}

function normalizeCollection(value: unknown): SmokeFeatureCollection | null {
  if (!isPlainObject(value)) return null
  return toFeatureCollection(value.data)
}

async function loadJsonFromText(text: string): Promise<SmokeFeatureCollection | null> {
  try {
    const parsed = JSON.parse(text)
    return toFeatureCollection(parsed) ?? normalizeCollection(parsed) ?? null
  } catch {
    return null
  }
}

async function readLocalSmokeData(key: SmokeLayerKey): Promise<SmokeFeatureCollection | null> {
  const candidates = LOCAL_PATHS[key]
  for (const localPath of candidates) {
    try {
      const text = await fs.readFile(localPath, 'utf8')
      const parsed = await loadJsonFromText(text)
      if (parsed) return parsed
    } catch {
      // Try next location.
    }
  }

  return null
}

async function fetchRemoteSmokeData(key: SmokeLayerKey): Promise<SmokeFeatureCollection | null> {
  try {
    const response = await fetch(REMOTE_PATHS[key])
    if (!response.ok) return null
    const text = await response.text()
    return loadJsonFromText(text)
  } catch {
    return null
  }
}

export async function loadSmokeLayerData(key: SmokeLayerKey): Promise<SmokeFeatureCollection> {
  const local = await readLocalSmokeData(key)
  if (local) return local

  const remote = await fetchRemoteSmokeData(key)
  if (remote) return remote

  return SMOKE_FALLBACK_DATA[key]
}

export async function loadAllSmokeLayerData(): Promise<SmokeLayerDataMap> {
  const modelledSmoke = await loadSmokeLayerData('modelledSmoke')
  const visibleSmoke = await loadSmokeLayerData('visibleSmoke')

  return {
    modelledSmoke,
    visibleSmoke,
  }
}
