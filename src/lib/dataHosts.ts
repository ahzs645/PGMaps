/**
 * Where each `public/data` folder is served from.
 *
 * The app requests every data file as `/data/<folder>/...`. A folder listed
 * under a host in `src/config/data-hosts.json` is fetched from that host's
 * `baseUrl` instead, with the same layout below it, and
 * `scripts/sync-bcdatamapper-data.mjs` stops copying it into the build.
 * Moving a folder off the Pages site is then one line in that file. See
 * docs/data-hosts.md.
 *
 * Kept free of DOM, network and `import.meta.env` so the sync script's copy of
 * the matching rule and the unit tests can check it.
 */

export interface DataHost {
  /** A label for logs and docs, e.g. "bcdatamapper". */
  name: string
  /** The URL that stands in for `/data` on this host, without a trailing slash. */
  baseUrl: string
  /** Paths below `/data` served by this host: a folder ("census"), a sub-folder ("canada/cell-sites") or a file ("restaurants.json"). */
  folders: string[]
}

export interface DataHostsConfig {
  hosts: DataHost[]
}

const ABSOLUTE_HTTP = /^https?:\/\/[^/]+/i
const FOLDER = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/

/** Validate the config, throwing on anything that would route data wrongly. */
export function parseDataHosts(value: unknown): DataHost[] {
  const hosts = (value as Partial<DataHostsConfig> | null)?.hosts
  if (!Array.isArray(hosts)) throw new Error('data-hosts: "hosts" must be an array')
  const owner = new Map<string, string>()
  return hosts.map((host: Partial<DataHost>, index) => {
    const name = typeof host?.name === 'string' && host.name ? host.name : `hosts[${index}]`
    if (typeof host?.baseUrl !== 'string' || !ABSOLUTE_HTTP.test(host.baseUrl)) {
      throw new Error(`data-hosts: ${name} needs an absolute http(s) baseUrl`)
    }
    if (!Array.isArray(host.folders)) throw new Error(`data-hosts: ${name} needs a "folders" array`)
    for (const folder of host.folders) {
      if (typeof folder !== 'string' || !FOLDER.test(folder) || folder.split('/').includes('..')) {
        throw new Error(`data-hosts: ${name} lists an invalid folder ${JSON.stringify(folder)}`)
      }
      for (const [other, otherHost] of owner) {
        if (other === folder || other.startsWith(`${folder}/`) || folder.startsWith(`${other}/`)) {
          throw new Error(`data-hosts: "${folder}" (${name}) overlaps "${other}" (${otherHost})`)
        }
      }
      owner.set(folder, name)
    }
    return { name, baseUrl: host.baseUrl.replace(/\/+$/, ''), folders: [...host.folders] }
  })
}

/**
 * The remote URL for a root-relative `/data/...` path, or null when the path
 * stays on this site. Query strings and fragments are carried over.
 */
export function remoteDataUrl(path: string, hosts: readonly DataHost[]): string | null {
  if (!path.startsWith('/data/') || hosts.length === 0) return null
  const rest = path.slice('/data/'.length)
  const pathPart = rest.split(/[?#]/, 1)[0]
  for (const host of hosts) {
    for (const folder of host.folders) {
      if (pathPart === folder || pathPart.startsWith(`${folder}/`)) return `${host.baseUrl}/${rest}`
    }
  }
  return null
}

/** The origins data is fetched from besides this site, for the service worker's cache rules. */
export function dataHostOrigins(hosts: readonly DataHost[]): string[] {
  return [...new Set(hosts.filter((host) => host.folders.length > 0).map((host) => new URL(host.baseUrl).origin))]
}
