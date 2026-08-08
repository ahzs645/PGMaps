import path from 'node:path'
import fs from 'node:fs/promises'

// Relative, not aliased: this module is reachable from vite.config.ts, which
// esbuild resolves without the app's `@` alias.
import { parseCsvRecords } from '../../../lib/parseCsv'
import type { AqmapDataFormat } from './aqmapDataAdapter'

export interface AqmapPlotPoint {
  date: string
  pm25: number
}

const AQMAP_BASE_URL = 'https://aqmap.ca/aqmap'
const PLOT_PREFIXES: Record<string, string> = {
  agency: 'agency',
  fem: 'agency',
  purpleair: 'purpleair',
  pa: 'purpleair',
  aqegg: 'aqegg',
  egg: 'aqegg',
}

function normalizePlotNetwork(network: string): string {
  return PLOT_PREFIXES[network.toLowerCase()] ?? 'agency'
}

function buildPlotFilename(network: string, siteId: string): string {
  const normalized = normalizePlotNetwork(network)
  return normalized === 'agency' ? `${siteId}_recent_hourly.csv` : `sensor_${siteId}_recent_hourly.csv`
}

function parseCsvRows(text: string): AqmapPlotPoint[] {
  return parseCsvRecords(text)
    .map((record) => {
      const date = (record.date ?? record.Date ?? record.timestamp ?? '').trim()
      const rawPm25 = record.pm25 ?? record.value ?? record.pm25_1hr ?? record.PM25
      const pm25 = Number.parseFloat(String(rawPm25 ?? '').trim())
      if (!date || !Number.isFinite(pm25)) return null

      return { date, pm25 }
    })
    .filter((point): point is AqmapPlotPoint => point !== null)
}

async function loadLocalPlotRows(network: string, siteId: string): Promise<AqmapPlotPoint[] | null> {
  const normalized = normalizePlotNetwork(network)
  const filename = buildPlotFilename(normalized, siteId)
  const localPath = path.resolve(process.cwd(), 'public', 'data', 'plotting', normalized, filename)

  try {
    const text = await fs.readFile(localPath, 'utf8')
    return parseCsvRows(text)
  } catch {
    return null
  }
}

async function fetchRemotePlotRows(network: string, siteId: string): Promise<AqmapPlotPoint[] | null> {
  const normalized = normalizePlotNetwork(network)
  const filename = buildPlotFilename(normalized, siteId)
  const url = `${AQMAP_BASE_URL}/data/plotting/${normalized}/${filename}`

  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const text = await response.text()
    return parseCsvRows(text)
  } catch {
    return null
  }
}

export async function loadAqmapPlotRows(network: string, siteId: string): Promise<AqmapPlotPoint[] | null> {
  const local = await loadLocalPlotRows(network, siteId)
  if (local && local.length > 0) return local

  return fetchRemotePlotRows(network, siteId)
}

export function serializePlotData(points: AqmapPlotPoint[], format: AqmapDataFormat): string {
  if (format === 'json') {
    return JSON.stringify(points)
  }
  const delimiter = format === 'tsv' ? '\t' : ','
  const header = `date${delimiter}pm25`
  if (!points.length) return header

  const body = points
    .map((point) => `${point.date}${delimiter}${point.pm25}`)
    .join('\n')

  return `${header}\n${body}`
}
