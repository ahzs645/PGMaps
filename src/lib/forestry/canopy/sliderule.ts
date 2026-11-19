/**
 * ICESat-2 ground photons from SlideRule's public cluster, for checking a terrain surface.
 *
 * SlideRule (University of Washington, BSD-3-Clause service and clients) answers `POST /source/atl03x` with
 * a stream of records: an 8-byte header (version 2, type-name length, data length, all big-endian), the
 * type name, then the data. The photon table arrives as a file carried in `arrowrec.meta`, `arrowrec.data`
 * and `arrowrec.eof` records; with `output.format = 'csv'` the file is plain text. The record layouts here
 * were read from the server's own `/source/definition` replies, not from client code.
 *
 * Heights come back on the ITRF2014 ellipsoid. A caller converts them with a geoid (EGM2008 here, which the
 * 093G086 bench found within 3 cm of CGVD2013) before comparing with a surface.
 *
 * Keep this module free of DOM and network access: `fetch` is passed in.
 */

export const SLIDERULE_URL = 'https://sliderule.slideruleearth.io'
export const SLIDERULE_CREDIT =
  'ICESat-2 ATL03/ATL08 (NASA NSIDC) through SlideRule Earth (University of Washington), heights to EGM2008'

/** ATL08's photon classes as SlideRule names them in a request and numbers them in a reply. */
export const ATL08_GROUND = 1
/** June to October: snow-free in the BC Interior. Winter passes read the snowpack as ground. */
export const SNOW_FREE_MONTHS = [6, 7, 8, 9, 10] as const
/** A box larger than this (degrees²) is refused: SlideRule reads every granule crossing it. */
export const ICESAT2_MAX_BOX_DEG2 = 0.02

const REC_VERSION = 2
const REC_HEADER = 8
const FILENAME_BYTES = 128

export interface SlideRuleRecord {
  type: string
  data: Uint8Array
}

/** Splits a SlideRule stream into records as chunks arrive. A record may span any number of chunks. */
export class SlideRuleRecordReader {
  private buffer = new Uint8Array(0)

  push(chunk: Uint8Array): SlideRuleRecord[] {
    const joined = new Uint8Array(this.buffer.length + chunk.length)
    joined.set(this.buffer)
    joined.set(chunk, this.buffer.length)
    const out: SlideRuleRecord[] = []
    let at = 0
    const view = new DataView(joined.buffer, joined.byteOffset, joined.byteLength)
    while (joined.length - at >= REC_HEADER) {
      const version = view.getUint16(at)
      if (version !== REC_VERSION) throw new Error(`SlideRule record version ${version}, expected ${REC_VERSION}`)
      const typeBytes = view.getUint16(at + 2)
      const dataBytes = view.getUint32(at + 4)
      const end = at + REC_HEADER + typeBytes + dataBytes
      if (end > joined.length) break
      const typeEnd = at + REC_HEADER + typeBytes - 1 // the name is null-terminated
      const type = new TextDecoder().decode(joined.subarray(at + REC_HEADER, typeEnd))
      out.push({ type, data: joined.slice(at + REC_HEADER + typeBytes, end) })
      at = end
    }
    this.buffer = joined.slice(at)
    return out
  }

  /** Bytes of an unfinished record left at the end of the stream. */
  get pending(): number {
    return this.buffer.length
  }
}

function cString(bytes: Uint8Array): string {
  const nul = bytes.indexOf(0)
  return new TextDecoder().decode(nul < 0 ? bytes : bytes.subarray(0, nul))
}

export interface SlideRuleFile {
  name: string
  bytes: Uint8Array
}

export interface SlideRuleMessage {
  kind: 'event' | 'exception'
  text: string
  code?: number
}

/**
 * Collects the files carried in `arrowrec.*` records and the server's messages.
 * `arrowrec.meta`: filename (128 bytes), size (int64 LE). `arrowrec.data`: filename, then the bytes.
 * `exceptrec`: code (int32 LE) at 0, level at 4, text (256 bytes) at 8. `eventrec`: message from byte 60.
 */
export class SlideRuleFileCollector {
  readonly files: SlideRuleFile[] = []
  readonly messages: SlideRuleMessage[] = []
  private open = new Map<string, { size: number; parts: Uint8Array[]; received: number }>()

  add(record: SlideRuleRecord): void {
    const { type, data } = record
    if (type === 'arrowrec.meta') {
      const name = cString(data.subarray(0, FILENAME_BYTES))
      const size = Number(new DataView(data.buffer, data.byteOffset).getBigInt64(FILENAME_BYTES, true))
      this.open.set(name, { size, parts: [], received: 0 })
    } else if (type === 'arrowrec.data') {
      const name = cString(data.subarray(0, FILENAME_BYTES))
      const file = this.open.get(name)
      if (!file) throw new Error(`SlideRule sent data for ${name} before its header`)
      const part = data.subarray(FILENAME_BYTES)
      file.parts.push(part)
      file.received += part.length
      if (file.received >= file.size) this.close(name)
    } else if (type === 'arrowrec.eof') {
      const name = cString(data.subarray(0, FILENAME_BYTES))
      if (this.open.has(name)) this.close(name)
    } else if (type === 'exceptrec') {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
      this.messages.push({ kind: 'exception', code: view.getInt32(0, true), text: cString(data.subarray(8, 264)) })
    } else if (type === 'eventrec') {
      this.messages.push({ kind: 'event', text: cString(data.subarray(60)) })
    }
  }

  private close(name: string) {
    const file = this.open.get(name)!
    const bytes = new Uint8Array(file.received)
    let at = 0
    for (const p of file.parts) {
      bytes.set(p, at)
      at += p.length
    }
    this.files.push({ name, bytes })
    this.open.delete(name)
  }

  /** Files whose header came but whose bytes did not all arrive. */
  get unfinished(): string[] {
    return [...this.open.keys()]
  }
}

/** NASA's Common Metadata Repository: lists the granules crossing a box (CORS open, no login). */
export const CMR_GRANULES_URL = 'https://cmr.earthdata.nasa.gov/search/granules.json'
/** The ATL03 release SlideRule reads. */
export const ATL03_VERSION = '007'
const CMR_PAGE = 2000

/** `ATL03_20220702190657_01661606_007_01.h5` → `2022-07-02`; null for a name in another form. */
export function granuleDate(name: string): string | null {
  const m = /^ATL03_(\d{4})(\d{2})(\d{2})\d{6}_/.exec(name)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

/**
 * The ATL03 granules crossing a box, from CMR. SlideRule otherwise opens every one, and about two thirds of
 * them are snow-season passes this check throws away (13 of 36 kept near Prince George), at tens of
 * seconds each when the cluster is busy.
 */
export async function listGranules(
  box: [number, number, number, number],
  fetchFn: typeof fetch,
  signal?: AbortSignal,
): Promise<string[]> {
  const url = `${CMR_GRANULES_URL}?short_name=ATL03&version=${ATL03_VERSION}&bounding_box=${box.join(',')}&page_size=${CMR_PAGE}`
  const res = await fetchFn(url, { signal })
  if (!res.ok) throw new Error(`NASA's granule search answered ${res.status}`)
  const body = (await res.json()) as { feed?: { entry?: { title?: string }[] } }
  const titles = (body.feed?.entry ?? []).flatMap((e) => (e.title && granuleDate(e.title) ? [e.title] : []))
  const hits = Number(res.headers.get('cmr-hits'))
  if (Number.isFinite(hits) && hits > titles.length)
    throw new Error(`NASA lists ${hits} ICESat-2 granules for the box; more than one page of ${CMR_PAGE} is not read`)
  return [...new Set(titles)].sort()
}

/** The request body for ground photons inside a lon/lat box, returned as CSV. */
export function groundPhotonRequest(box: [number, number, number, number], resources?: readonly string[]) {
  const [w, s, e, n] = box
  if (!(e > w && n > s)) throw new Error('The ICESat-2 box is empty')
  if ((e - w) * (n - s) > ICESAT2_MAX_BOX_DEG2)
    throw new Error(`The ICESat-2 box is ${((e - w) * (n - s)).toFixed(3)} deg²; keep it under ${ICESAT2_MAX_BOX_DEG2}`)
  return {
    parms: {
      poly: [
        { lon: w, lat: s },
        { lon: e, lat: s },
        { lon: e, lat: n },
        { lon: w, lat: n },
        { lon: w, lat: s },
      ],
      cnf: 0,
      srt: -1,
      atl08_class: ['atl08_ground'],
      ...(resources ? { resources: [...resources] } : {}),
      output: { format: 'csv', path: 'pgmaps-ground.csv', open_on_complete: true },
    },
  }
}

export interface GroundPhoton {
  lon: number
  lat: number
  /** ITRF2014 ellipsoid height, metres. */
  ellipsoidH: number
  /** UTC date, YYYY-MM-DD. */
  date: string
  spot: number
  rgt: number
}

function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

/** A `time_ns` / `time` column as nanoseconds since 1970, or an ISO string, to a UTC date. */
function utcDate(value: string): string | null {
  if (/^\d{15,}$/.test(value)) return new Date(Number(BigInt(value) / 1_000_000n)).toISOString().slice(0, 10)
  const t = Date.parse(value.endsWith('Z') || /[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`)
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10)
}

/**
 * Reads SlideRule's CSV of ATL03 photons. Columns are found by name, so a server that adds or reorders
 * columns still reads; a reply without position, height or time is refused rather than guessed.
 */
export function parseGroundPhotonCsv(text: string): GroundPhoton[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0)
  if (lines.length === 0) return []
  const head = splitCsvLine(lines[0]).map((h) => h.trim())
  const col = (...names: string[]) => names.map((n) => head.indexOf(n)).find((i) => i >= 0) ?? -1
  const iLon = col('longitude', 'lon', 'x')
  const iLat = col('latitude', 'lat', 'y')
  const iH = col('height', 'h_ph')
  const iT = col('time_ns', 'time')
  const iClass = col('atl08_class')
  const iSpot = col('spot')
  const iRgt = col('rgt')
  const iGeom = col('geometry')
  if ((iLon < 0 || iLat < 0) && iGeom < 0) throw new Error(`SlideRule's photons have no position (${head.join(', ')})`)
  if (iH < 0 || iT < 0) throw new Error(`SlideRule's photons have no height or time (${head.join(', ')})`)
  const out: GroundPhoton[] = []
  for (let r = 1; r < lines.length; r++) {
    const f = splitCsvLine(lines[r])
    if (iClass >= 0 && Number(f[iClass]) !== ATL08_GROUND) continue
    let lon = iLon >= 0 ? Number(f[iLon]) : NaN
    let lat = iLat >= 0 ? Number(f[iLat]) : NaN
    if (!(Number.isFinite(lon) && Number.isFinite(lat)) && iGeom >= 0) {
      const m = /POINT\s*\(\s*(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/.exec(f[iGeom])
      if (m) {
        lon = Number(m[1])
        lat = Number(m[2])
      }
    }
    const h = Number(f[iH])
    const date = utcDate(f[iT])
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(h) || !date) continue
    out.push({
      lon,
      lat,
      ellipsoidH: h,
      date,
      spot: iSpot >= 0 ? Number(f[iSpot]) : 0,
      rgt: iRgt >= 0 ? Number(f[iRgt]) : 0,
    })
  }
  return out
}

/**
 * Granules named in SlideRule's failure alerts. A granule that fails returns no photons at all, and the
 * request still succeeds, so this is the only sign: on 18 November 2026 the three newest passes over
 * 093G086 failed to read (H5Coro read failures) and took 30% of the photons with them.
 */
export function failedGranules(messages: readonly SlideRuleMessage[]): string[] {
  const names = new Set<string>()
  for (const m of messages)
    if (m.kind === 'exception' && (m.code ?? 0) < 0 && m.code !== -2)
      for (const hit of m.text.matchAll(/ATL03_\d{14}_\d{8}_\d{3}_\d{2}\.h5/g)) names.add(hit[0])
  return [...names].sort()
}

export function isSnowFree(date: string): boolean {
  return (SNOW_FREE_MONTHS as readonly number[]).includes(Number(date.slice(5, 7)))
}

export interface GroundPhotonResult {
  photons: GroundPhoton[]
  /** Every pass date crossing the box, snow-free or not (from NASA's granule list). */
  allDates: string[]
  /** Snow-free granules SlideRule was asked to read. */
  granulesRead: number
  /** Of those, the ones SlideRule reported it could not read (any beam), by name. */
  granulesFailed: string[]
  messages: SlideRuleMessage[]
  seconds: number
}

/**
 * Lists the granules crossing a box (CMR), then asks SlideRule for ATL08 ground photons from the snow-free
 * ones only. Takes one to ten minutes, as SlideRule's public cluster allows. `onStage` names each step and
 * `onProgress` gets the bytes received so far.
 */
export async function fetchGroundPhotons(
  box: [number, number, number, number],
  fetchFn: typeof fetch,
  options: {
    signal?: AbortSignal
    onProgress?: (bytes: number) => void
    onStage?: (stage: string) => void
    base?: string
    now?: () => number
  } = {},
): Promise<GroundPhotonResult> {
  const now = options.now ?? (() => Date.now())
  const t0 = now()
  options.onStage?.('Listing ICESat-2 passes (NASA CMR)')
  const granules = await listGranules(box, fetchFn, options.signal)
  const snowFree = granules.filter((g) => isSnowFree(granuleDate(g)!))
  const allDates = [...new Set(granules.map((g) => granuleDate(g)!))].sort()
  if (!snowFree.length)
    return { photons: [], allDates, granulesRead: 0, granulesFailed: [], messages: [], seconds: (now() - t0) / 1000 }
  options.onStage?.(`Asking SlideRule for ground photons from ${snowFree.length} snow-free passes`)
  // The body goes as plain text, as SlideRule's own clients send it: with `content-type:
  // application/json` the server reports progress and never processes a granule (seen 2026-11-18).
  // Plain text is also a CORS-safe type, so the browser sends no preflight.
  const res = await fetchFn(`${options.base ?? SLIDERULE_URL}/source/atl03x`, {
    method: 'POST',
    body: JSON.stringify(groundPhotonRequest(box, snowFree)),
    signal: options.signal,
  })
  if (!res.ok) throw new Error(`SlideRule answered ${res.status}`)
  if (!res.body) throw new Error('SlideRule sent no body')
  const reader = new SlideRuleRecordReader()
  const files = new SlideRuleFileCollector()
  const stream = res.body.getReader()
  let received = 0
  for (;;) {
    const { value, done } = await stream.read()
    if (done) break
    received += value.length
    options.onProgress?.(received)
    for (const rec of reader.push(value)) files.add(rec)
  }
  if (reader.pending) throw new Error(`SlideRule's reply ended inside a record (${reader.pending} bytes left)`)
  if (files.unfinished.length) throw new Error(`SlideRule's reply ended before ${files.unfinished[0]} was complete`)
  const csv = files.files.find((f) => f.name.endsWith('.csv')) ?? files.files[0]
  if (!csv) {
    // No file is never "no photons": SlideRule ends a request at 600 s without one. Alerts below 0 are
    // per-granule failures and "running N seconds" (−2), so the last real failure, if any, is named.
    const failure = files.messages.filter((m) => m.kind === 'exception' && (m.code ?? 0) < 0 && m.code !== -2).at(-1)
    const ran = files.messages
      .filter((m) => m.code === -2)
      .at(-1)
      ?.text.match(/running (\d+) seconds/)?.[1]
    throw new Error(
      `SlideRule sent no photon file${ran ? ` after running ${ran} s (it stops a request at 600 s)` : ''}${failure ? `; last failure: ${failure.text}` : ''}. Try again later.`,
    )
  }
  const all = parseGroundPhotonCsv(new TextDecoder().decode(csv.bytes))
  return {
    photons: all.filter((p) => isSnowFree(p.date)),
    allDates,
    granulesRead: snowFree.length,
    granulesFailed: failedGranules(files.messages),
    messages: files.messages,
    seconds: (now() - t0) / 1000,
  }
}
