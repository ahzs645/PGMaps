import {
  defaultBrandSettings,
  parseBrandRecord,
  parseBrandSettings,
  type BrandRecord,
  type BrandSettings,
  type ExportBrand,
} from './model'

export type BrandingState = { brands: BrandRecord[]; settings: BrandSettings; ready: boolean; error: string }
const initial: BrandingState = { brands: [], settings: defaultBrandSettings, ready: false, error: '' }
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
    const [records, preferences] = await Promise.all([
      request<unknown[]>('brands', 'readonly', (s) => s.getAll()),
      request<unknown>('preferences', 'readonly', (s) => s.get('current')),
    ])
    const brands = records.map(parseBrandRecord)
    const settings = preferences ? parseBrandSettings(preferences) : { ...defaultBrandSettings }
    if (!brands.some((brand) => brand.key === settings.selected)) settings.selected = null
    publish({ brands, settings, ready: true, error: '' })
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
export function exportBrand(state: BrandingState): ExportBrand | undefined {
  const brand = state.brands.find((brand) => brand.key === state.settings.selected)
  return brand && state.settings.exports
    ? { brand, typography: state.settings.typography, pdfFonts: state.settings.pdfFonts }
    : undefined
}
