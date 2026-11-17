import {
  defaultBrandSettings,
  parseBrandRecord,
  parseBrandSettings,
  parseUploadedLogo,
  type BrandRecord,
  type BrandSettings,
  type ExportBrand,
  type UploadedLogo,
} from './model'
import { parsePreparerProfile, type PreparerProfile } from './profile'

export type BrandingState = {
  brands: BrandRecord[]
  settings: BrandSettings
  /** The user's own logo for sheets and reports, kept in this browser; null when none was added. */
  logo: UploadedLogo | null
  /** Who prepares the sheets and reports (`profile.ts`), kept in this browser; null when none was entered. */
  profile: PreparerProfile | null
  ready: boolean
  error: string
}
const initial: BrandingState = {
  brands: [],
  settings: defaultBrandSettings,
  logo: null,
  profile: null,
  ready: false,
  error: '',
}
let state = initial
const listeners = new Set<() => void>()
let loading: Promise<void> | undefined
let channel: BroadcastChannel | undefined
const publish = (next: BrandingState) => {
  state = next
  listeners.forEach((listener) => listener())
}

async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('pgmaps-branding', 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('brands', { keyPath: 'key' })
      request.result.createObjectStore('preferences')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function request<T>(
  table: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(table, mode)
    const result = action(transaction.objectStore(table))
    transaction.oncomplete = () => {
      db.close()
      resolve(result.result)
    }
    transaction.onabort = transaction.onerror = () => {
      db.close()
      reject(transaction.error ?? Error('Brand storage failed.'))
    }
  })
}

async function reload() {
  try {
    const [records, preferences, storedLogo, storedProfile] = await Promise.all([
      request<unknown[]>('brands', 'readonly', (s) => s.getAll()),
      request<unknown>('preferences', 'readonly', (s) => s.get('current')),
      request<unknown>('preferences', 'readonly', (s) => s.get('logo')),
      request<unknown>('preferences', 'readonly', (s) => s.get('profile')),
    ])
    const brands = records.map(parseBrandRecord)
    const settings = preferences ? parseBrandSettings(preferences) : { ...defaultBrandSettings }
    if (!brands.some((brand) => brand.key === settings.selected)) settings.selected = null
    // A stored logo that no longer parses is dropped rather than failing the brands with it.
    let logo: UploadedLogo | null = null
    try {
      logo = storedLogo ? parseUploadedLogo(storedLogo) : null
    } catch {
      logo = null
    }
    let profile: PreparerProfile | null = null
    try {
      profile = storedProfile ? parsePreparerProfile(storedProfile) : null
    } catch {
      profile = null
    }
    publish({ brands, settings, logo, profile, ready: true, error: '' })
  } catch (e) {
    publish({ ...state, ready: true, error: e instanceof Error ? e.message : 'Branding storage is unavailable.' })
  }
}

export function initializeBranding() {
  loading ??= reload().then(() => {
    if (typeof BroadcastChannel === 'function') {
      channel = new BroadcastChannel('pgmaps-branding')
      channel.onmessage = () => void reload()
    }
  })
  return loading
}
export const getBrandingState = () => state
export const serverBrandingState = () => initial
export const subscribeBranding = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export async function saveBrand(brand: BrandRecord) {
  await request('brands', 'readwrite', (s) => s.put(parseBrandRecord(brand)))
  await reload()
  channel?.postMessage('changed')
}
export async function saveBrandSettings(settings: BrandSettings) {
  const parsed = parseBrandSettings(settings)
  const selected = state.brands.find((brand) => brand.key === parsed.selected)
  if (parsed.selected && !selected) throw Error('Choose an imported brand first.')
  await request('preferences', 'readwrite', (s) => s.put(parsed, 'current'))
  await reload()
  channel?.postMessage('changed')
}
export async function removeBrand(key: string) {
  await request('brands', 'readwrite', (s) => s.delete(key))
  if (state.settings.selected === key) await saveBrandSettings({ ...state.settings, selected: null, pdfFonts: false })
  else {
    await reload()
    channel?.postMessage('changed')
  }
}
/** Keeps the user's own logo in this browser (or removes it with null), for every sheet and report. */
export async function saveUploadedLogo(logo: UploadedLogo | null) {
  if (logo) {
    const parsed = parseUploadedLogo(logo)
    await request('preferences', 'readwrite', (s) => s.put(parsed, 'logo'))
  } else await request('preferences', 'readwrite', (s) => s.delete('logo'))
  await reload()
  channel?.postMessage('changed')
}

/** Keeps who prepares sheets and reports in this browser (or removes it with null); never in a project file. */
export async function savePreparerProfile(profile: PreparerProfile | null) {
  const parsed = profile ? parsePreparerProfile(profile) : null
  if (parsed && Object.values(parsed).some(Boolean))
    await request('preferences', 'readwrite', (s) => s.put(parsed, 'profile'))
  else await request('preferences', 'readwrite', (s) => s.delete('profile'))
  await reload()
  channel?.postMessage('changed')
}

/** Which logo a printed sheet or report takes: the user's own first, then the selected brand's when exports use it. */
export function printedLogo(
  state: BrandingState,
):
  | { source: 'uploaded'; name: string; logo: UploadedLogo }
  | { source: 'brand'; name: string; brand: BrandRecord }
  | null {
  if (state.logo) return { source: 'uploaded', name: state.logo.name, logo: state.logo }
  const brand = exportBrand(state)
  return brand ? { source: 'brand', name: brand.brand.profile.name, brand: brand.brand } : null
}

export function exportBrand(state: BrandingState): ExportBrand | undefined {
  const brand = state.brands.find((brand) => brand.key === state.settings.selected)
  return brand && state.settings.exports
    ? { brand, typography: state.settings.typography, pdfFonts: state.settings.pdfFonts }
    : undefined
}
