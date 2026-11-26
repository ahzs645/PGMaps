/** Imported map themes, kept in the browser (IndexedDB) as the ZIPs they came in, so a reload keeps them. */
import Dexie, { type Table } from 'dexie'

export interface StoredMapTheme {
  id: string
  name: string
  savedAt: string
  zip: Uint8Array
}

class MapThemeDatabase extends Dexie {
  themes!: Table<StoredMapTheme, string>
  constructor() {
    super('pgmaps.illustrated-map-themes.v1')
    this.version(1).stores({ themes: 'id, name' })
  }
}

let database: MapThemeDatabase | null = null
const db = () => (database ??= new MapThemeDatabase())

export const listMapThemes = () => db().themes.orderBy('name').toArray()
export const saveMapTheme = (theme: StoredMapTheme) => db().themes.put(theme)
export const deleteMapTheme = (id: string) => db().themes.delete(id)
