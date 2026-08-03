import { useMemo } from 'react'
import { useFetchData } from '@/hooks/useFetchData'

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
  // The dataset is not in every build; `optional` covers both a real 404 and
  // the HTML the static host serves in its place.
  const { data, loading, error } = useFetchData<unknown>(CIMD_PATH, { enabled, optional: true })
  const records = useMemo(() => (data ? parseCimdRecords(data) : []), [data])

  return { records, loading, error }
}
