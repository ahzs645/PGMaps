import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const execFileAsync = promisify(execFile)

const OUTPUT_DIR = 'public/data/flood'
const RAW_DIR = join(OUTPUT_DIR, 'raw')
const TEXT_DIR = join(OUTPUT_DIR, 'text')
const SEED_FILE = 'scripts/flood-advisory-seeds.txt'
const RFC_ROOT = 'https://bcrfc.env.gov.bc.ca'
const WARNINGS_INDEX = `${RFC_ROOT}/warnings/index.htm`
const ADVISORY_ROOT = `${RFC_ROOT}/warnings/advisories/`
const DEFAULT_LEGACY_MAX = 250

const MONTHS = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
}

const STATUS_PATTERNS = [
  ['ended', /\bended\b/i],
  ['upgraded', /\bupgrad(?:e|ed|ing)\b/i],
  ['downgraded', /\bdowngrad(?:e|ed|ing)\b/i],
  ['updated', /\bupdate(?:d)?\b/i],
  ['maintained', /\bmaintain(?:ed|ing)\b/i],
  ['issued', /\bissu(?:ed|ing)\b/i],
]

const LEVEL_PATTERNS = [
  ['Flood Warning', /\bFlood Warning\b/i],
  ['Flood Watch', /\bFlood Watch\b/i],
  ['High Streamflow Advisory', /\bHigh Streamflow Advisory\b/i],
]

function parseArgs() {
  const args = process.argv.slice(2)
  const options = {
    legacyMax: DEFAULT_LEGACY_MAX,
    legacyYearMax: 180,
    legacyYears: [2021, 2022, 2023, 2024],
    legacy: true,
    legacyYear: true,
    wayback: true,
    concurrency: 4,
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    const next = args[i + 1]
    if (arg === '--legacy-max' && next) {
      options.legacyMax = Number(next)
      i += 1
    } else if (arg === '--legacy-year-max' && next) {
      options.legacyYearMax = Number(next)
      i += 1
    } else if (arg === '--legacy-years' && next) {
      options.legacyYears = next.split(',').map((year) => Number(year.trim())).filter(Number.isFinite)
      i += 1
    } else if (arg === '--legacy' && next) {
      options.legacy = next !== 'false'
      i += 1
    } else if (arg === '--legacy-year' && next) {
      options.legacyYear = next !== 'false'
      i += 1
    } else if (arg === '--wayback' && next) {
      options.wayback = next !== 'false'
      i += 1
    } else if (arg === '--concurrency' && next) {
      options.concurrency = Number(next)
      i += 1
    }
  }

  return options
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchWithRetry(url, options = {}, attempts = 4) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(30000),
        headers: {
          'user-agent': 'PGMaps flood advisory sync/1.0',
          ...(options.headers ?? {}),
        },
        ...options,
      })
      return response
    } catch (error) {
      lastError = error
      if (attempt < attempts) await wait(500 * attempt)
    }
  }
  throw lastError
}

function normalizeUrl(value) {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.startsWith('#')) return null
  if (/^https?:\/\//i.test(trimmed)) {
    const parsed = new URL(trimmed.replace(/^http:/i, 'https:'))
    if (parsed.hostname === 'bcrfc.env.gov.bc.ca' && parsed.port === '80') parsed.port = ''
    return parsed.href
  }
  if (trimmed.startsWith('/')) return `${RFC_ROOT}${trimmed}`
  if (trimmed.startsWith('advisories/')) return new URL(trimmed, `${RFC_ROOT}/warnings/`).href
  return new URL(trimmed, ADVISORY_ROOT).href
}

function advisoryIdFromUrl(url) {
  const parsed = new URL(url)
  const name = basename(parsed.pathname)
  const stem = name.replace(/\.[a-z0-9]+$/i, '')
  return stem.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '')
}

function hashText(value) {
  return createHash('sha1').update(value).digest('hex').slice(0, 12)
}

function rawFilename(url) {
  const parsed = new URL(url)
  const name = basename(parsed.pathname)
  const extension = extname(name) || '.bin'
  return `${advisoryIdFromUrl(url)}-${hashText(url)}${extension.toLowerCase()}`
}

function stripHtml(source) {
  return source
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&ndash;|&#8211;/g, '-')
    .replace(/&mdash;|&#8212;/g, '-')
    .replace(/&rsquo;|&#8217;/g, "'")
    .replace(/&ldquo;|&rdquo;|&#8220;|&#8221;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim()
}

async function discoverCurrentIndex() {
  const response = await fetchWithRetry(WARNINGS_INDEX)
  if (!response.ok) throw new Error(`Failed current warnings index: ${response.status}`)
  const html = await response.text()
  const discoveries = []
  const linkRegex = /href=["']([^"']*advisories\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match
  while ((match = linkRegex.exec(html))) {
    const url = normalizeUrl(match[1])
    if (!url) continue
    discoveries.push({
      url,
      method: 'current-index',
      titleHint: stripHtml(match[2]),
    })
  }
  return discoveries
}

async function discoverSeedFile() {
  if (!existsSync(SEED_FILE)) return []
  const text = await readFile(SEED_FILE, 'utf8')
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter(Boolean)
    .map((line) => normalizeUrl(line))
    .filter(Boolean)
    .map((url) => ({ url, method: 'seed-file' }))
}

async function urlExists(url) {
  const response = await fetchWithRetry(url, { method: 'GET' }, 2)
  return response.ok
}

async function discoverLegacyNumbered(max) {
  const candidates = []
  for (let i = 1; i <= max; i += 1) {
    candidates.push(`${ADVISORY_ROOT}flood_${i}.htm`)
    candidates.push(`${ADVISORY_ROOT}flood_${String(i).padStart(3, '0')}.htm`)
  }

  const found = []
  let cursor = 0
  const workers = Array.from({ length: 10 }, async () => {
    while (cursor < candidates.length) {
      const url = candidates[cursor]
      cursor += 1
      try {
        if (await urlExists(url)) found.push({ url, method: 'legacy-number-probe' })
      } catch {
        // Ignore missing or transient legacy pages; the discovery manifest records found URLs only.
      }
    }
  })
  await Promise.all(workers)
  return found
}

async function discoverLegacyYearNumbered(years, max) {
  const candidates = []
  for (const year of years) {
    for (let i = 1; i <= max; i += 1) {
      candidates.push(`${ADVISORY_ROOT}flood_${year}_${String(i).padStart(3, '0')}.htm`)
    }
  }

  const found = []
  let cursor = 0
  const workers = Array.from({ length: 12 }, async () => {
    while (cursor < candidates.length) {
      const url = candidates[cursor]
      cursor += 1
      try {
        if (await urlExists(url)) found.push({ url, method: 'legacy-year-number-probe' })
      } catch {
        // Missing pages are expected in sparse legacy sequences.
      }
    }
  })
  await Promise.all(workers)
  return found
}

async function discoverWayback() {
  const patterns = [
    'bcrfc.env.gov.bc.ca/warnings/advisories/*',
    'http://bcrfc.env.gov.bc.ca/warnings/advisories/*',
    'https://bcrfc.env.gov.bc.ca/warnings/advisories/*',
    'www.env.gov.bc.ca/bcrfc/warnings/advisories/*',
    'www.env.gov.bc.ca/rfc/warnings/advisories/*',
  ]

  const found = []
  for (const pattern of patterns) {
    const cdxUrl = 'https://web.archive.org/cdx?' + new URLSearchParams({
      url: pattern,
      output: 'json',
      fl: 'original,statuscode,mimetype,timestamp',
      filter: 'statuscode:200',
      collapse: 'urlkey',
      limit: '2000',
    }).toString()

    try {
      const response = await fetchWithRetry(cdxUrl, {}, 1)
      if (!response.ok) continue
      const text = await response.text()
      if (!text.trim().startsWith('[')) continue
      const rows = JSON.parse(text)
      found.push(...rows.slice(1)
        .map((row) => {
          const url = normalizeUrl(row[0])
          if (!url || !/\/warnings\/advisories\//i.test(url)) return null
          return {
            url,
            method: 'wayback-cdx',
            archiveUrl: `https://web.archive.org/web/${row[3]}id_/${row[0]}`,
          }
        })
        .filter(Boolean))
    } catch {
      // Wayback is useful when available but often rate-limits or returns transient 503s.
    }
  }
  return found
}

function mergeDiscoveries(groups) {
  const byUrl = new Map()
  for (const item of groups.flat()) {
    const url = normalizeUrl(item.url)
    if (!url) continue
    const existing = byUrl.get(url)
    if (existing) {
      existing.methods = Array.from(new Set([...existing.methods, item.method]))
      existing.titleHint ||= item.titleHint
    } else {
      byUrl.set(url, {
        url,
        methods: [item.method],
        titleHint: item.titleHint ?? null,
        archiveUrl: item.archiveUrl ?? null,
      })
    }
  }
  return Array.from(byUrl.values()).sort((a, b) => a.url.localeCompare(b.url))
}

async function downloadRaw(discovery) {
  let response = await fetchWithRetry(discovery.url)
  let downloadedFrom = discovery.url
  if (!response.ok && discovery.archiveUrl) {
    response = await fetchWithRetry(discovery.archiveUrl)
    downloadedFrom = discovery.archiveUrl
  }
  if (!response.ok) {
    throw new Error(`Download failed ${response.status}`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  const filename = rawFilename(discovery.url)
  const rawPath = join(RAW_DIR, filename)
  await writeFile(rawPath, bytes)
  return {
    rawPath,
    contentType: response.headers.get('content-type') ?? null,
    byteLength: bytes.byteLength,
    downloadedFrom,
  }
}

async function extractText(rawPath, url, contentType) {
  const lower = url.toLowerCase()
  if (lower.endsWith('.pdf') || contentType?.includes('pdf')) {
    const { stdout } = await execFileAsync('pdftotext', ['-layout', rawPath, '-'], {
      maxBuffer: 10 * 1024 * 1024,
    })
    return stdout.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').trim()
  }
  const html = await readFile(rawPath, 'utf8')
  return stripHtml(html)
}

function parseIssuedAt(text, url) {
  const candidates = [
    /ISSUED:\s*([A-Za-z]+\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s*[AP]\.?M\.?)/i,
    /Issued:\s*([A-Za-z]+\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s*[AP]\.?M\.?)/i,
    /ISSUED:\s*([0-9]{1,2}:[0-9]{2}\s*[AP]\.?M\.?\s+[A-Za-z]+\s+[0-9]{1,2},\s+[0-9]{4})/i,
    /Issued:\s*([0-9]{1,2}:[0-9]{2}\s*[AP]\.?M\.?\s+[A-Za-z]+\s+[0-9]{1,2},\s+[0-9]{4})/i,
    /Issued:\s*([0-9]{1,2}:[0-9]{2}\s*[AP]\.?M\.?\s+[A-Za-z]+\s+[0-9]{1,2}\s+[0-9]{4})/i,
    /Updated:\s*([0-9]{1,2}:[0-9]{2}\s*[AP]\.?M\.?\s+[A-Za-z]+\s+[0-9]{1,2},?\s+[0-9]{4})/i,
    /Upgraded:\s*([0-9]{1,2}:[0-9]{2}\s*[AP]\.?M\.?\s+[A-Za-z]+\s+[0-9]{1,2},?\s+[0-9]{4})/i,
  ]
  for (const pattern of candidates) {
    const match = text.match(pattern)
    if (match) return normalizeIssuedString(match[1])
  }

  const hourDate = text.match(/\b(?:ISSUED|UPDATED|Updated):\s*([0-9]{1,2})([0-9]{2})h?\s+([A-Za-z]+)\s+([0-9]{1,2})(?:st|nd|rd|th)?,?\s+([0-9]{4})/i)
  if (hourDate) {
    const [, hour, minute, monthName, day, year] = hourDate
    return normalizeIssuedString(`${hour}:${minute} AM ${monthName} ${day}, ${year}`)
  }

  const pmDate = text.match(/\b(?:Updated|ISSUED):\s*([0-9]{1,2}):([0-9]{2})\s*([ap])m,?\s+([A-Za-z]+)\s+([0-9]{1,2})(?:st|nd|rd|th)?,?\s+([0-9]{4})/i)
  if (pmDate) {
    const [, hour, minute, ampm, monthName, day, year] = pmDate
    return normalizeIssuedString(`${hour}:${minute} ${ampm.toUpperCase()}M ${monthName} ${day}, ${year}`)
  }

  const dateTime = text.match(/\b(?:ISSUED|UPDATED):\s*([A-Za-z]+)\s+([0-9]{1,2}),?\s+([0-9]{4})\s+([0-9]{1,2}):([0-9]{2})\s*([AP]\.?M\.?)/i)
  if (dateTime) {
    const [, monthName, day, year, hour, minute, ampm] = dateTime
    return normalizeIssuedString(`${hour}:${minute} ${ampm} ${monthName} ${day}, ${year}`)
  }

  const filename = basename(new URL(url).pathname)
  const compactIssued = text.match(/\b(?:Issued|Updated):\s*([0-9]{1,2})([A-Za-z]+)([0-9]{4})\s+([0-9]{1,2}:[0-9]{2}\s*[AP]\.?M\.?)/i)
  if (compactIssued) {
    const [, day, monthName, year, time] = compactIssued
    return normalizeIssuedString(`${time} ${monthName} ${day}, ${year}`)
  }

  const fileMatch = filename.match(/(?:HSA|FWT|FWN|FWN_FWT_HSA)_(\d{4})_(\d{2})_(\d{2})_(\d{3,4})/i)
  if (fileMatch) {
    const [, year, month, day, hhmmRaw] = fileMatch
    const hhmm = hhmmRaw.padStart(4, '0')
    const hour = Number(hhmm.slice(0, 2))
    const minute = Number(hhmm.slice(2))
    const date = new Date(Number(year), Number(month) - 1, Number(day), hour, minute)
    return {
      issuedAtLocal: `${year}-${month}-${day} ${hhmm.slice(0, 2)}:${hhmm.slice(2)}`,
      issuedAt: Number.isNaN(date.getTime()) ? null : date.toISOString(),
      issuedYear: Number(year),
    }
  }

  const advisoryFileMatch = filename.match(/Advisory_(\d{4})([A-Za-z]+)(\d{1,2})_?(\d{3,4})?/i)
  if (advisoryFileMatch) {
    const [, year, monthName, day, hhmmRaw = '1200'] = advisoryFileMatch
    const hhmm = hhmmRaw.padStart(4, '0')
    return normalizeIssuedString(`${hhmm.slice(0, 2)}:${hhmm.slice(2)} AM ${monthName} ${day}, ${year}`)
  }

  const namedFileMatch = filename.match(/(?:FloodWarning|FloodWatch)_(\d{4})([A-Za-z]+)(\d{1,2})_?(\d{3,4})?/i)
  if (namedFileMatch) {
    const [, year, monthName, day, hhmmRaw = '1200'] = namedFileMatch
    const hhmm = hhmmRaw.padStart(4, '0')
    return normalizeIssuedString(`${hhmm.slice(0, 2)}:${hhmm.slice(2)} AM ${monthName} ${day}, ${year}`)
  }

  return { issuedAtLocal: null, issuedAt: null, issuedYear: null }
}

function normalizeIssuedString(value) {
  const clean = value.replace(/\./g, '').replace(/\s+/g, ' ').trim()
  const dateFirstMatch = clean.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*([AP]M)$/i)
  if (dateFirstMatch) {
    const [, monthText, dayText, yearText, hourText, minuteText, ampm] = dateFirstMatch
    return buildIssuedResult(clean, hourText, minuteText, ampm, monthText, dayText, yearText)
  }

  const match = clean.match(/^(\d{1,2}):(\d{2})\s*([AP]M)\s+([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/i)
  if (!match) return { issuedAtLocal: clean, issuedAt: null, issuedYear: null }
  const [, hourText, minuteText, ampm, monthText, dayText, yearText] = match
  return buildIssuedResult(clean, hourText, minuteText, ampm, monthText, dayText, yearText)
}

function buildIssuedResult(clean, hourText, minuteText, ampm, monthText, dayText, yearText) {
  let hour = Number(hourText)
  const minute = Number(minuteText)
  if (/pm/i.test(ampm) && hour !== 12) hour += 12
  if (/am/i.test(ampm) && hour === 12) hour = 0
  const month = MONTHS[monthText.toLowerCase()]
  if (month == null) return { issuedAtLocal: clean, issuedAt: null, issuedYear: Number(yearText) || null }
  const date = new Date(Number(yearText), month, Number(dayText), hour, minute)
  return {
    issuedAtLocal: clean,
    issuedAt: Number.isNaN(date.getTime()) ? null : date.toISOString(),
    issuedYear: Number(yearText),
  }
}

function parseTitle(text, titleHint) {
  if (titleHint) return titleHint.replace(/\s+/g, ' ').trim()
  const issuedIndex = text.search(/\bISSUED:|\bIssued:/i)
  const beforeIssued = issuedIndex > 0 ? text.slice(0, issuedIndex) : text.slice(0, 500)
  const marker = 'Flood Warnings and Advisories'
  const markerIndex = beforeIssued.lastIndexOf(marker)
  const candidate = markerIndex >= 0 ? beforeIssued.slice(markerIndex + marker.length) : beforeIssued
  return candidate.replace(/\s+/g, ' ').trim() || basename(text)
}

function parseLevels(value) {
  return LEVEL_PATTERNS
    .filter(([, pattern]) => pattern.test(value))
    .map(([level]) => level)
}

function parseStatuses(value) {
  return STATUS_PATTERNS
    .filter(([, pattern]) => pattern.test(value))
    .map(([status]) => status)
}

function splitNamedAreas(title) {
  return title
    .replace(/\b(ENDED|UPDATE|NEW|UPGRADE|DOWNGRADE|MAINTAINED|ISSUED)\b/gi, ' ')
    .replace(/\b(Flood Warning|Flood Watch|High Streamflow Advisory)\b/gi, ' ')
    .replace(/\bIssued:.*$/i, ' ')
    .split(/[,;–-]|\band\b|\bincluding\b|\(|\)/i)
    .map((part) => part.replace(/\b(River|tributaries|tributary|areas|around|for|the|of)\b/gi, ' ').replace(/\s+/g, ' ').trim())
    .filter((part) => part.length >= 3)
}

async function loadBoundaryNames() {
  const files = [
    ['droughtBasin', 'public/data/drought/basins.geojson', 'basinName'],
    ['fwaWatershedGroup', 'public/data/boundaries/BCFWA/watershed_groups_province_simplified.geojson', 'boundaryName'],
    ['fwaAssessmentWatershed', 'public/data/boundaries/BCFWA/assessment_watersheds.geojson', 'boundaryName'],
    ['fwaMajorWatershed', 'public/data/boundaries/BCFWA/major_watersheds_province_simplified.geojson', 'boundaryName'],
  ]
  const names = []
  for (const [source, path, field] of files) {
    if (!existsSync(path)) continue
    const collection = JSON.parse(await readFile(path, 'utf8'))
    for (const feature of collection.features ?? []) {
      const name = feature.properties?.[field]
      const id = feature.properties?.boundaryCode ?? feature.properties?.basinId ?? name
      if (typeof name === 'string' && name.trim()) {
        names.push({ source, id: String(id), name: name.trim() })
      }
    }
  }
  return names
}

function matchBoundaries(text, title, boundaryNames) {
  const haystack = `${title}\n${text}`.toLowerCase()
  const matches = []
  const seen = new Set()
  for (const boundary of boundaryNames) {
    const name = boundary.name.toLowerCase()
    if (name.length < 4) continue
    if (!haystack.includes(name)) continue
    const key = `${boundary.source}:${boundary.id}`
    if (seen.has(key)) continue
    seen.add(key)
    matches.push(boundary)
  }
  return matches
}

function dedupeEvents(events) {
  const byKey = new Map()
  for (const event of events) {
    const key = `${event.issuedAtLocal ?? event.issuedAt ?? 'unknown'}::${event.title.toLowerCase().replace(/\s+/g, ' ').trim()}`
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, { ...event, duplicateUrls: [] })
      continue
    }
    existing.duplicateUrls.push(event.url)
    existing.sourceMethods = Array.from(new Set([...existing.sourceMethods, ...event.sourceMethods]))
  }
  return Array.from(byKey.values())
}

function summarizeConsistency(events) {
  const eras = {
    legacyArchived: events.filter((event) => (event.issuedYear ?? 0) < 2018 || event.issuedYear == null),
    htmlTemplate: events.filter((event) => (event.issuedYear ?? 0) >= 2018 && (event.issuedYear ?? 0) <= 2020),
    pdfTemplate: events.filter((event) => (event.issuedYear ?? 0) >= 2021),
  }

  const summarize = (items) => ({
    records: items.length,
    withIssuedAt: items.filter((event) => event.issuedAt).length,
    withLevels: items.filter((event) => event.levels.length > 0).length,
    withStatuses: items.filter((event) => event.statuses.length > 0).length,
    withMatchedBoundaries: items.filter((event) => event.matchedBoundaries.length > 0).length,
    withExtractedText: items.filter((event) => event.textLength > 0).length,
    formats: items.reduce((acc, event) => {
      const format = event.url.toLowerCase().endsWith('.pdf') ? 'pdf' : 'html'
      acc[format] = (acc[format] ?? 0) + 1
      return acc
    }, {}),
  })

  return {
    schema: {
      stableFields: [
        'id',
        'url',
        'title',
        'issuedAt',
        'issuedAtLocal',
        'issuedYear',
        'levels',
        'statuses',
        'namedAreas',
        'matchedBoundaries',
        'rawPath',
        'textPath',
      ],
      variableFields: [
        'title verbosity and ministry header',
        'date wording',
        'PDF versus legacy HTML source format',
        'region naming granularity',
        'station/return-period detail in narrative text',
      ],
    },
    eras: Object.fromEntries(Object.entries(eras).map(([key, items]) => [key, summarize(items)])),
  }
}

async function mapLimit(items, limit, mapper) {
  const results = []
  let cursor = 0
  const workers = Array.from({ length: limit }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await mapper(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

async function processDiscovery(discovery, boundaryNames) {
  try {
    const downloaded = await downloadRaw(discovery)
    const text = await extractText(downloaded.rawPath, discovery.url, downloaded.contentType)
    const id = advisoryIdFromUrl(discovery.url)
    const textPath = join(TEXT_DIR, `${id}.txt`)
    await writeFile(textPath, `${text}\n`)
    const title = parseTitle(text, discovery.titleHint)
    const issued = parseIssuedAt(`${title}\n${text}`, discovery.url)
    const classificationText = `${title}\n${text.slice(0, 1200)}`
    const levels = parseLevels(classificationText)
    const statuses = parseStatuses(classificationText)
    const namedAreas = Array.from(new Set(splitNamedAreas(title)))
    const matchedBoundaries = matchBoundaries(text, title, boundaryNames)

    return {
      ok: true,
      event: {
        id,
        url: discovery.url,
        sourceMethods: discovery.methods,
        title,
        issuedAt: issued.issuedAt,
        issuedAtLocal: issued.issuedAtLocal,
        issuedYear: issued.issuedYear,
        levels,
        statuses,
        namedAreas,
        matchedBoundaries,
        rawPath: downloaded.rawPath.replace(/^public\//, '/'),
        textPath: textPath.replace(/^public\//, '/'),
        downloadedFrom: downloaded.downloadedFrom,
        contentType: downloaded.contentType,
        byteLength: downloaded.byteLength,
        textLength: text.length,
      },
    }
  } catch (error) {
    return {
      ok: false,
      failure: {
        url: discovery.url,
        sourceMethods: discovery.methods,
        error: error.message,
      },
    }
  }
}

async function main() {
  const options = parseArgs()
  await mkdir(RAW_DIR, { recursive: true })
  await mkdir(TEXT_DIR, { recursive: true })

  console.log('Discovering BC RFC flood advisories...')
  const current = await discoverCurrentIndex()
  const seeds = await discoverSeedFile()
  const legacy = options.legacy ? await discoverLegacyNumbered(options.legacyMax) : []
  const legacyYear = options.legacyYear ? await discoverLegacyYearNumbered(options.legacyYears, options.legacyYearMax) : []
  const wayback = options.wayback ? await discoverWayback() : []
  const discoveries = mergeDiscoveries([current, seeds, legacy, legacyYear, wayback])
  console.log(`Discovered ${discoveries.length} unique advisory URLs`)

  const boundaryNames = await loadBoundaryNames()
  const processed = await mapLimit(discoveries, options.concurrency, (discovery) => processDiscovery(discovery, boundaryNames))
  const parsedEvents = processed
    .filter((item) => item.ok)
    .map((item) => item.event)
  const duplicateInputCount = parsedEvents.length
  const events = dedupeEvents(parsedEvents)
    .sort((a, b) => {
      const aTime = a.issuedAt ? new Date(a.issuedAt).getTime() : 0
      const bTime = b.issuedAt ? new Date(b.issuedAt).getTime() : 0
      return aTime - bTime || a.id.localeCompare(b.id)
    })
  const failures = processed.filter((item) => !item.ok).map((item) => item.failure)

  const yearCounts = events.reduce((acc, event) => {
    const year = event.issuedYear ?? 'unknown'
    acc[year] = (acc[year] ?? 0) + 1
    return acc
  }, {})

  const levelCounts = events.reduce((acc, event) => {
    for (const level of event.levels.length ? event.levels : ['Unknown']) {
      acc[level] = (acc[level] ?? 0) + 1
    }
    return acc
  }, {})
  const consistency = summarizeConsistency(events)

  const manifest = {
    generatedAt: new Date().toISOString(),
    source: 'BC River Forecast Centre flood warnings/advisories',
    sourceIndex: WARNINGS_INDEX,
    outputFiles: {
      advisories: '/data/flood/advisories.json',
      manifest: '/data/flood/manifest.json',
      discovery: '/data/flood/discovery.json',
    },
    discovery: {
      currentIndex: current.length,
      seedFile: seeds.length,
      legacyNumberProbe: legacy.length,
      legacyYearNumberProbe: legacyYear.length,
      waybackCdx: wayback.length,
      uniqueUrls: discoveries.length,
      failures: failures.length,
      legacyMax: options.legacy ? options.legacyMax : null,
      legacyYearMax: options.legacyYear ? options.legacyYearMax : null,
      legacyYears: options.legacyYear ? options.legacyYears : [],
    },
    records: {
      advisories: events.length,
      parsedAdvisoriesBeforeDedupe: duplicateInputCount,
      duplicateAdvisories: duplicateInputCount - events.length,
      firstIssuedAt: events.find((event) => event.issuedAt)?.issuedAt ?? null,
      lastIssuedAt: [...events].reverse().find((event) => event.issuedAt)?.issuedAt ?? null,
      yearCounts,
      levelCounts,
    },
    consistency,
    limitations: [
      'BC RFC does not expose a public archive listing for /warnings/advisories; directory listing returns 403.',
      'Historical completeness is limited to URLs discoverable from the current index, seed file, legacy numbered probes, and optional Wayback CDX results.',
      'Advisory polygons are not supplied historically; matchedBoundaries are inferred from names in the bulletin text.',
    ],
  }

  await writeFile(join(OUTPUT_DIR, 'advisories.json'), `${JSON.stringify(events, null, 2)}\n`)
  await writeFile(join(OUTPUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  await writeFile(join(OUTPUT_DIR, 'discovery.json'), `${JSON.stringify({ generatedAt: manifest.generatedAt, discoveries, failures }, null, 2)}\n`)

  console.log(`Wrote ${events.length} advisories to ${OUTPUT_DIR}/advisories.json`)
  console.log(`Issued range: ${manifest.records.firstIssuedAt ?? 'unknown'} to ${manifest.records.lastIssuedAt ?? 'unknown'}`)
  if (failures.length) console.log(`Failures: ${failures.length}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
