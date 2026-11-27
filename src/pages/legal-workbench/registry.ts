import Dexie, { type Table } from 'dexie'
import { checkFactLinks, parsePack, releaseKey, type Pack } from '../../../packages/legal-rules/src/contract'

const bundled = import.meta.glob('../../../packages/legal-rules/packs/*.json', { eager: true, import: 'default' })
export const defaults = Object.values(bundled).map(parsePack)
const byKey = new Map(defaults.map((p) => [releaseKey(p), p]))
if (byKey.size !== defaults.length) throw Error('Duplicate bundled legal pack release.')
checkFactLinks(defaults)
function identical(a: Pack, b: Pack) {
  if (JSON.stringify(a) !== JSON.stringify(b))
    throw Error('Release ' + releaseKey(a) + ' already exists with different contents. Assign a new version.')
}
const db = new Dexie('pgmaps-legal-pack-library-v1') as Dexie & { releases: Table<{ key: string; pack: Pack }, string> }
db.version(1).stores({ releases: 'key' })
export async function loadLibrary() {
  const stored = await db.releases.toArray()
  const library = new Map(byKey)
  for (const row of stored) {
    const p = parsePack(row.pack),
      key = releaseKey(p),
      existing = library.get(key)
    if (existing) identical(existing, p)
    else library.set(key, p)
  }
  return [...library.values()]
}
export async function installPacks(raw: unknown[]) {
  const incoming = raw.map(parsePack)
  // A fact linked to another instrument's must take the same answers in every release held.
  checkFactLinks([
    ...(await loadLibrary()).filter((p) => !incoming.some((x) => releaseKey(x) === releaseKey(p))),
    ...incoming,
  ])
  await db.transaction('rw', db.releases, async () => {
    for (const p of incoming) {
      const key = releaseKey(p)
      const existing = byKey.get(key) ?? (await db.releases.get(key))?.pack
      if (existing) identical(existing, p)
      else await db.releases.add({ key, pack: p })
    }
  })
  return incoming
}
