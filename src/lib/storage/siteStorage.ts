/**
 * What PGMaps keeps in this browser, as a catalogue (docs/app-updates-and-caching.md,
 * **Managing what is kept**).
 *
 * Every Cache Storage cache and IndexedDB database the app opens is listed here once, with what it
 * holds and whether it is a person's work or something fetched or derived that can be thrown away.
 * The storage dialog reads only this list, and `siteStorage.test.ts` fails when the source opens a
 * cache or database that is not on it: a store nobody can see is a store nobody can clear.
 *
 * Free of DOM and network access; `browserStorage.ts` measures and clears.
 */

/** `work` is a person's own and is never cleared from here; `download` is fetched or derived. */
export type StoreRole = 'work' | 'download'

export interface StoreEntry {
  id: string
  label: string
  /** What it holds, in a line. */
  detail: string
  role: StoreRole
  /** For `download`: what clearing costs. For `work`: where it is managed. */
  note: string
  /** Cache Storage caches, by exact name. */
  caches?: readonly string[]
  /** IndexedDB databases; `stores` narrows an entry to some object stores of a shared database. */
  databases?: ReadonlyArray<{ name: string; stores?: readonly string[] }>
  /** The page where a person manages this work. */
  href?: string
}

const VISUALS_DATABASE = 'pgmaps.forestry-assessment-tools.v1'

export const STORE_CATALOGUE: readonly StoreEntry[] = [
  {
    id: 'app-files',
    label: 'App files',
    detail: 'The pages you have opened and the tools kept for offline use.',
    role: 'download',
    note: 'Fetched again the next time you are online. Until then nothing opens offline.',
    caches: ['pgmaps-shell-v3'],
  },
  {
    id: 'map-data',
    label: 'Map data',
    detail: 'Data files the maps have loaded.',
    role: 'download',
    note: 'Loaded again as you open each map.',
    caches: ['pgmaps-data-v1'],
  },
  {
    id: 'map-tiles',
    label: 'Map tiles',
    detail: 'Terrain and basemap tiles you have viewed.',
    role: 'download',
    note: 'Fetched again as you view each area. Until then those areas do not draw offline.',
    caches: ['pgmaps-tiles-v1', 'pgmaps-terrarium-png-v1', 'geo-toolkit-terrarium-png-v1'],
  },
  {
    id: 'depth-models',
    label: 'Photo depth models',
    detail: 'Depth models downloaded for matching your own photos.',
    role: 'download',
    note: 'Downloaded again (27 to 105 MB) the next time a photo asks for one.',
    caches: ['pgmaps-photo-depth-v1'],
  },
  {
    id: 'depth-estimates',
    label: 'Photo depth estimates',
    detail: 'The depth worked out for each of your photos.',
    role: 'download',
    note: 'Worked out again when a photo needs it. Your photos and cameras are kept.',
    databases: [{ name: VISUALS_DATABASE, stores: ['photoDepth'] }],
  },
  {
    id: 'inventory-copies',
    label: 'Inventory copies',
    detail: 'Dated copies of what visual quality read from the BC inventories, kept only while that option is on.',
    role: 'download',
    note: 'Kept again as each is read online. Until then a read that fails offline is an error.',
    caches: ['pgmaps-inventory-copies-v1'],
  },
  {
    id: 'road-projects',
    label: 'Road projects',
    detail: 'Every project in the road designer, with its terrain.',
    role: 'work',
    note: 'Delete a project in the road designer, under Projects.',
    databases: [{ name: 'pgmaps-forestry-roads-v1' }],
    href: '/dev/forestry/road-design',
  },
  {
    id: 'road-terrain-files',
    label: 'RoadEng terrain files',
    detail: 'The original terrain file of each project opened from RoadEng.',
    role: 'work',
    note: 'Removed with the last project that names it.',
    databases: [{ name: 'pgmaps-forestry-roads-files-v1' }],
    href: '/dev/forestry/road-design',
  },
  {
    id: 'visual-quality',
    label: 'Visual quality',
    detail:
      'The scene, the workspace, your field photos, the open site’s saved pictures and figures, and the previous site, kept to reopen.',
    role: 'work',
    note: 'Remove a photo in its own window; save the project file under Save & export. The previous site is replaced at the next switch of site, and the open site’s copy with it.',
    databases: [
      { name: VISUALS_DATABASE, stores: ['documents', 'scenes', 'attachments', 'ownPhotos', 'previousSites'] },
    ],
    href: '/dev/forestry/visual-quality',
  },
  {
    id: 'branding',
    label: 'Logo and details',
    detail: 'Your logo and the details printed on sheets and reports.',
    role: 'work',
    note: 'Change them under Branding or Your details.',
    databases: [{ name: 'pgmaps-branding' }],
  },
  {
    id: 'castor',
    label: 'Castor scenarios',
    detail: 'Scenarios kept by the Castor tool.',
    role: 'work',
    note: 'Managed in the Castor tool.',
    databases: [{ name: 'pgmaps-forestry-castor-v1' }],
    href: '/dev/forestry/castor',
  },
  {
    id: 'nechako',
    label: 'Nechako workbench',
    detail: 'Files imported into the Nechako local workbench.',
    role: 'work',
    note: 'Managed in the workbench, which has its own storage panel.',
    databases: [{ name: 'pgmaps.nechako.local-workbench.v1' }],
    href: '/dev/nechako/portal?panel=files',
  },
  {
    id: 'index-lab',
    label: 'Labs datasets',
    detail: 'Datasets you added in the Labs.',
    role: 'work',
    note: 'Managed in the Labs.',
    databases: [{ name: 'pgmaps-index-lab' }],
    href: '/labs',
  },
]

/** Bookkeeping, never listed: the service worker's own state and the inventory-copies switch. */
export const INTERNAL_CACHES: readonly string[] = ['pgmaps-offline-state-v1', 'pgmaps-inventory-option-v1']

/** Every cache and database name the catalogue knows. */
export function cataloguedNames(catalogue: readonly StoreEntry[] = STORE_CATALOGUE) {
  const caches = new Set<string>(INTERNAL_CACHES)
  const databases = new Set<string>()
  for (const entry of catalogue) {
    for (const name of entry.caches ?? []) caches.add(name)
    for (const database of entry.databases ?? []) databases.add(database.name)
  }
  return { caches, databases }
}

/**
 * The names present in the browser that the catalogue does not list: a library's own cache, or a
 * store from an older release. Shown as "Other", so nothing kept is invisible.
 */
export function uncatalogued(
  present: { caches: readonly string[]; databases: readonly string[] },
  catalogue: readonly StoreEntry[] = STORE_CATALOGUE,
) {
  const known = cataloguedNames(catalogue)
  return {
    caches: present.caches.filter((name) => !known.caches.has(name)).sort(),
    databases: present.databases.filter((name) => !known.databases.has(name)).sort(),
  }
}

const PRIMITIVE_BYTES = { number: 8, boolean: 4, bigint: 8 } as const
/** Past this many values a record is stopped and the rest is not counted: a size, not an audit. */
export const APPROXIMATE_VALUE_LIMIT = 400_000

/**
 * About how many bytes a stored value takes. IndexedDB reports no sizes, so this walks the value:
 * binary data by its length, text at two bytes a character, a long list of numbers by its length
 * times eight without visiting each. Good to a few percent for terrain grids and photos, which is
 * where the bytes are.
 */
export function approximateBytes(value: unknown, limit = APPROXIMATE_VALUE_LIMIT): number {
  let visited = 0
  const seen = new Set<object>()
  const walk = (item: unknown): number => {
    if (item === null || item === undefined) return 0
    if (typeof item === 'string') return item.length * 2
    if (typeof item === 'number' || typeof item === 'boolean' || typeof item === 'bigint')
      return PRIMITIVE_BYTES[typeof item as keyof typeof PRIMITIVE_BYTES]
    if (typeof item !== 'object') return 0
    if (typeof Blob !== 'undefined' && item instanceof Blob) return item.size
    if (item instanceof ArrayBuffer) return item.byteLength
    if (ArrayBuffer.isView(item)) return item.byteLength
    if (item instanceof Date) return 8
    if (seen.has(item) || ++visited > limit) return 0
    seen.add(item)
    if (Array.isArray(item)) {
      // A grid stored as plain numbers: its length says its size.
      if (item.length > 64 && item.slice(0, 16).every((entry) => typeof entry === 'number')) return item.length * 8
      let bytes = 0
      for (const entry of item) bytes += walk(entry)
      return bytes
    }
    if (item instanceof Map) {
      let bytes = 0
      for (const [key, entry] of item) bytes += walk(key) + walk(entry)
      return bytes
    }
    if (item instanceof Set) {
      let bytes = 0
      for (const entry of item) bytes += walk(entry)
      return bytes
    }
    let bytes = 0
    for (const key of Object.keys(item)) bytes += key.length * 2 + walk((item as Record<string, unknown>)[key])
    return bytes
  }
  return walk(value)
}

/** The share of the browser's allowance in use, 0 to 1; null when the browser does not say. */
export function usageShare(usage: number | undefined, quota: number | undefined): number | null {
  if (!Number.isFinite(usage) || !Number.isFinite(quota) || !quota || quota <= 0) return null
  return Math.min(1, Math.max(0, usage! / quota))
}

/** Above this share the service worker gives up tiles and data files to make room for work. */
export const STORAGE_PRESSURE_SHARE = 0.8
