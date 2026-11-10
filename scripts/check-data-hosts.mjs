// Checks every host in src/config/data-hosts.json before a deploy relies on it.
//
// Fails when a host's data/version.json is unreachable or does not list a
// folder the app sends there: the deployed app would get 404s.
// Warns when the bcdatamapper site serves different files than the pinned
// submodule commit would publish. That is expected after a data push to
// bcdatamapper; it means the pointer is behind (or the site needs a rollback).
//
// Usage: node scripts/check-data-hosts.mjs
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { hosts } = JSON.parse(readFileSync(join(root, 'src', 'config', 'data-hosts.json'), 'utf8'))
const annotate = (level, message) =>
  console.log(process.env.GITHUB_ACTIONS ? `::${level}::${message}` : `[data-hosts] ${level}: ${message}`)

let failed = false
for (const host of hosts) {
  if (host.folders.length === 0) continue
  const url = `${host.baseUrl.replace(/\/+$/, '')}/version.json`
  let version
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    version = await response.json()
  } catch (error) {
    annotate('error', `${host.name}: cannot read ${url} (${error.message}); its folders would not load`)
    failed = true
    continue
  }
  const missing = host.folders.filter((folder) => !version.folders?.[folder])
  if (missing.length > 0) {
    annotate('error', `${host.name} at ${version.commit?.slice(0, 12)} does not publish: ${missing.join(', ')}`)
    failed = true
    continue
  }
  console.log(
    `[data-hosts] ${host.name}: serves ${host.folders.join(', ')} from commit ${version.commit?.slice(0, 12)}`,
  )

  if (host.name !== 'bcdatamapper') continue
  const vendorRoot = join(root, 'vendor', 'bcdatamapper')
  const siteModule = join(vendorRoot, 'pages', 'site.mjs')
  if (!existsSync(siteModule)) {
    annotate('warning', 'bcdatamapper: submodule not checked out; cannot compare the live site with the pinned commit')
    continue
  }
  const { folderFingerprints, readSite } = await import(pathToFileURL(siteModule).href)
  const pinned = folderFingerprints(vendorRoot, readSite(vendorRoot))
  const differ = host.folders.filter((folder) => pinned[folder]?.sha256 !== version.folders[folder].sha256)
  if (differ.length > 0) {
    annotate(
      'warning',
      `bcdatamapper serves ${differ.join(', ')} from ${version.commit?.slice(0, 12)}, which differs from the pinned submodule's files. ` +
        'Move the pointer forward if the live data is right, or republish the pinned commit (docs/data-hosts.md).',
    )
  } else {
    console.log('[data-hosts] bcdatamapper: live folders match the pinned submodule')
  }
}
process.exit(failed ? 1 : 0)
