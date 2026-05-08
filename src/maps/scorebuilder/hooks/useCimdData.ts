import { useEffect, useState } from 'react'

export interface CimdRecord {
  daCode: string
  population: number
  composite: number
  residentialInstability: number
  economicDependency: number
  situationalVulnerability: number
  ethnoCulturalComposition: number
  quintile: number | null
}

const CIMD_PATH = '/data/cimd/prince_george_cimd_2021.json'

function parseNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseNullableNumber(value: unknown): number | null {
  const parsed = parseNumber(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function normalizeIndex(value: unknown): number {
  const parsed = parseNumber(value)
  if (parsed > 1) return Math.max(0, Math.min(1, parsed / 100))
  return Math.max(0, Math.min(1, parsed))
}

function parseCimdRecords(payload: unknown): CimdRecord[] {
  const rows = Array.isArray(payload) ? payload : []
  return rows
    .map((row): CimdRecord | null => {
      if (!row || typeof row !== 'object') return null
      const item = row as Record<string, unknown>
      const daCode = String(item.daCode ?? item.DAUID ?? item.da ?? '').trim()
      if (!daCode) return null
      return {
        daCode,
        population: parseNumber(item.population ?? item.Population),
        composite: normalizeIndex(item.composite ?? item.cimdComposite ?? item.CIMD),
        residentialInstability: normalizeIndex(item.residentialInstability ?? item.RI),
        economicDependency: normalizeIndex(item.economicDependency ?? item.ED),
        situationalVulnerability: normalizeIndex(item.situationalVulnerability ?? item.SV),
        ethnoCulturalComposition: normalizeIndex(item.ethnoCulturalComposition ?? item.EC),
        quintile: parseNullableNumber(item.quintile ?? item.cimdQuintile),
      }
    })
    .filter((record): record is CimdRecord => record !== null)
}

export function useCimdData(enabled = true) {
  const [records, setRecords] = useState<CimdRecord[]>([])
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }

    const controller = new AbortController()

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(CIMD_PATH, { signal: controller.signal })
        if (response.status === 404) {
          if (!controller.signal.aborted) setRecords([])
          return
        }
        if (!response.ok) throw new Error(`Failed to fetch CIMD data: ${response.status}`)
        const contentType = response.headers.get('content-type') || ''
        if (!contentType.includes('application/json')) {
          if (!controller.signal.aborted) setRecords([])
          return
        }
        const payload = await response.json()
        if (!controller.signal.aborted) setRecords(parseCimdRecords(payload))
      } catch (err) {
        if (controller.signal.aborted) return
        setError((err as Error).message || 'Unable to load CIMD data')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void load()
    return () => controller.abort()
  }, [enabled])

  return { records, loading, error }
}
