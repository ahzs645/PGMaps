import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Where a build script reads a `public/data` path from.
 *
 * A folder bcdatamapper publishes on its own site is left out of `public/data`
 * (src/config/data-hosts.json), so a script that needs one of its files during
 * a build reads the submodule's copy. The submodule's `pages/site.json` is the
 * one list of how those folders are laid out. Every other path stays in
 * `public/data`.
 *
 * Returns a function from a path below `public/data` to an absolute path.
 */
export function createDataSourceResolver(root) {
  const vendorRoot = join(root, 'vendor', 'bcdatamapper')
  const { mappings } = JSON.parse(readFileSync(join(vendorRoot, 'pages', 'site.json'), 'utf8'))

  return (relativePath) => {
    const path = relativePath
      .split(/[\\/]+/)
      .filter((part) => part && part !== '.')
      .join('/')
    const candidates = []
    for (const [source, target] of mappings) {
      if (path === target) candidates.push(join(vendorRoot, source))
      else if (path.startsWith(`${target}/`)) candidates.push(join(vendorRoot, source, path.slice(target.length + 1)))
    }
    // Several mappings can fill one folder; the file is in whichever has it.
    // With none on disk, name the first so the caller's error points at it.
    return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0] ?? join(root, 'public', 'data', path)
  }
}
