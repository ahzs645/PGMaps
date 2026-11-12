import { unzipSync } from 'fflate'
import { brandDefinitions, inspectBrandFiles, packMemberPath } from 'brandkit/pack/host'
import { consumerProfile } from 'brandkit/consumer'
import { loadBrandFonts } from 'brandkit/fonts'
import { object } from '../lib/jsonGuards'
import { parseBrandProfile, parseBrandRecord, type BrandFont, type BrandRecord } from './model'

const MAX_ZIP = 32 * 1024 * 1024,
  MAX_EXPANDED = 64 * 1024 * 1024
const library = import.meta.glob('../../vendor/brandkit/library/fonts/**/*', {
  query: '?url',
  import: 'default',
}) as Record<string, () => Promise<string>>
const decode = (bytes: Uint8Array) => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
const buffer = (bytes: Uint8Array) => bytes.slice().buffer as ArrayBuffer
const hex = (data: ArrayBuffer) => [...new Uint8Array(data)].map((n) => n.toString(16).padStart(2, '0')).join('')
const base64 = (bytes: Uint8Array) => {
  let result = ''
  for (let i = 0; i < bytes.length; i += 8192) result += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(result)
}

/** Inspect declared sizes and paths before allocating each expanded member. Nothing is extracted or executed. */
export function brandArchive(bytes: Uint8Array) {
  if (bytes.byteLength > MAX_ZIP) throw Error('Choose a Brandkit pack smaller than 32 MB.')
  let expanded = 0
  const paths = new Set<string>()
  const entries = unzipSync(bytes, {
    filter: (file) => {
      const path = packMemberPath(file.name.replace(/\/$/, ''))
      if (paths.has(path)) throw Error('The pack contains duplicate file paths.')
      paths.add(path)
      expanded += file.originalSize
      if (paths.size > 4000 || file.originalSize > 16 * 1024 * 1024 || expanded > MAX_EXPANDED)
        throw Error('The pack expands beyond the brand import limit.')
      return !file.name.endsWith('/')
    },
  })
  return new Map(Object.entries(entries).map(([path, data]) => [packMemberPath(path), data]))
}

export async function importBrand(file: File): Promise<BrandRecord> {
  if (file.size > MAX_ZIP) throw Error('Choose a brand file smaller than 32 MB.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const key = hex(await crypto.subtle.digest('SHA-256', buffer(bytes)))
  if (/\.json$/i.test(file.name)) {
    if (bytes.length > 4 * 1024 * 1024) throw Error('The consumer profile exceeds 4 MB.')
    return parseBrandRecord({ key, profile: parseBrandProfile(decode(bytes)), fonts: [], notices: [] })
  }
  const members = brandArchive(bytes)
  const { default: JSZip } = await import('jszip')
  await JSZip.loadAsync(bytes, { checkCRC32: true })
  const definitions = brandDefinitions(members)
  if (!definitions.length) {
    const profiles = [...members.keys()].filter((path) => /(?:^|\/)consumer-profile\.json$/.test(path))
    if (profiles.length !== 1) throw Error('Choose a pack containing one brand or one consumer profile.')
    return parseBrandRecord({
      key,
      profile: parseBrandProfile(decode(members.get(profiles[0])!)),
      fonts: [],
      notices: [],
    })
  }
  if (definitions.length !== 1) throw Error('This archive contains several brands. Import each brand pack separately.')
  const selected = inspectBrandFiles(members, { definitionPath: definitions[0] })
  if (selected.brand.schema !== 'brandkit/1') throw Error('Unsupported source brand schema.')
  let usedSharedFonts = false
  const read = async (path: string) => {
    const local = selected.files.get(packMemberPath(path))
    if (local) return buffer(local)
    const shared = selected.library.get(path)
    const asset = shared && library['../../vendor/brandkit/library/' + packMemberPath(shared)]
    if (!asset) throw Error(`Missing font file: ${path}. Export a complete pack from Brandkit.`)
    usedSharedFonts = true
    const response = await fetch(await asset())
    if (!response.ok) throw Error('The shared Brandkit font could not be loaded.')
    const data = await response.arrayBuffer()
    const expected = (selected.manifest?.library as Record<string, string> | undefined)?.[path]
    if (expected && hex(await crypto.subtle.digest('SHA-256', data)) !== expected)
      throw Error('The pack requires another version of its shared font. Export a complete pack from Brandkit.')
    return data
  }
  const fonts = await loadBrandFonts(selected.brand, read)
  if (fonts.failures.length)
    throw Error(`Could not load ${fonts.failures[0].file}. Import a complete Brandkit pack or a consumer profile.`)
  const profile = parseBrandProfile(consumerProfile({ brand: selected.brand, fonts }))
  const faces: BrandFont[] = [],
    seen = new Set<string>()
  for (const value of Object.values(object(selected.brand.fonts, 'source fonts'))) {
    const font = object(value, 'source font')
    if (typeof font.file !== 'string') continue
    const identity = JSON.stringify([font.family, font.weight, font.style ?? 'normal', font.file])
    if (seen.has(identity)) continue
    seen.add(identity)
    const data = new Uint8Array(await read(font.file))
    if (data.length > 2_000_000) throw Error('A brand font exceeds the 2 MB font limit.')
    const signature = String.fromCharCode(...data.subarray(0, 4))
    const format =
      signature === 'OTTO'
        ? 'otf'
        : signature === 'wOF2'
          ? 'woff2'
          : signature === 'wOFF'
            ? 'woff'
            : data[0] === 0 && data[1] === 1 && data[2] === 0 && data[3] === 0
              ? 'ttf'
              : null
    if (!format) throw Error(`Unsupported font file: ${font.file}.`)
    faces.push({
      family: String(font.consumerFamily ?? font.family),
      weight: Number(font.weight ?? 400),
      style: String(font.style ?? 'normal'),
      file: font.file,
      dataUrl: `data:font/${format};base64,${base64(data)}`,
    })
  }
  const notices = [...selected.files]
    .filter(([path]) => /(?:licen[cs]e|ofl|font-notice)/i.test(path) && /\.(?:txt|md)$/i.test(path))
    .map(([, data]) => new TextDecoder().decode(data))
  if (usedSharedFonts)
    for (const name of ['Inter-OFL.txt', 'SpaceMono-OFL.txt']) {
      const response = await fetch(await library['../../vendor/brandkit/library/fonts/' + name]())
      if (!response.ok) throw Error('The shared font licence could not be loaded.')
      notices.push(await response.text())
    }
  return parseBrandRecord({ key, profile, fonts: faces, notices })
}
