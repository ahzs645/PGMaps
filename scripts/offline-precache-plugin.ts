import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import type { Plugin } from 'vite'
import {
  buildPrecacheManifest,
  referencedFiles,
  type BuiltFile,
  type ExtraFile,
} from '../src/lib/offline/precacheManifest'

/**
 * Writes `offline-precache.json` beside `sw.js` (docs/app-updates-and-caching.md, **Offline tools**):
 * the shell `index.html` loads and, for each tool kept offline, every built file it can reach.
 * The service worker reads it; nothing in the page does.
 *
 * It also holds the shell to a size budget. The shell is downloaded by every visitor to every page
 * before anything draws, and a static import added to the wrong file moves a whole library into it
 * with no error anywhere.
 */
export interface OfflinePrecacheOptions {
  /**
   * `roots` match the chunks a tool starts from; `extras` are files or folders in `public/` it reads
   * at run time (a folder ends in `/`).
   */
  groups: Array<{ id: string; roots: RegExp; extras?: string[] }>
  /** A reachable file larger than this is named as deferred rather than precached. */
  maxFileBytes: number
  /** Files or folders in `public/` that `index.html` names; they are not part of the build's graph. */
  shellExtras: string[]
  /** The build fails when the shell's JavaScript and CSS pass either figure. */
  shellBudget: { rawBytes: number; gzipBytes: number }
}

interface BundleChunk {
  type: 'chunk'
  fileName: string
  code: string
  imports: string[]
  dynamicImports: string[]
  isEntry: boolean
  viteMetadata?: { importedCss?: Set<string>; importedAssets?: Set<string> }
}
interface BundleAsset {
  type: 'asset'
  fileName: string
  source: string | Uint8Array
}

const TEXT_ASSET = /\.(?:js|mjs|css|html)$/
const megabytes = (bytes: number) => `${(bytes / 1048576).toFixed(2)} MB`

/** The files under `public/` that `paths` name, each with a digest of its bytes. */
function publicFiles(publicDir: string, paths: readonly string[], fail: (message: string) => never): ExtraFile[] {
  const found: ExtraFile[] = []
  const add = (relative: string) => {
    const absolute = path.join(publicDir, relative)
    const stats = fs.statSync(absolute, { throwIfNoEntry: false })
    // A path that is gone would leave the tool without a file it reads, with nothing reported.
    if (!stats) fail(`offline precache: "${relative}" is not in ${publicDir}`)
    else if (stats.isDirectory()) {
      for (const name of fs.readdirSync(absolute).sort()) {
        if (!name.startsWith('.')) add(`${relative.replace(/\/$/, '')}/${name}`)
      }
    } else {
      const revision = createHash('sha256').update(fs.readFileSync(absolute)).digest('hex').slice(0, 12)
      found.push({ file: relative, revision })
    }
  }
  for (const entry of paths) add(entry)
  return found
}

export function offlinePrecache(options: OfflinePrecacheOptions): Plugin {
  let publicDir = ''
  return {
    name: 'pgmaps-offline-precache',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      publicDir = config.publicDir
    },
    generateBundle(_, bundle) {
      const outputs = Object.values(bundle) as unknown as Array<BundleChunk | BundleAsset>
      const namesByBase = new Map<string, string>()
      for (const output of outputs) {
        namesByBase.set(output.fileName.slice(output.fileName.lastIndexOf('/') + 1), output.fileName)
      }

      const files: BuiltFile[] = []
      const entries: string[] = []
      const sizes = new Map<string, { raw: number; gzip: () => number }>()
      for (const output of outputs) {
        if (output.fileName.endsWith('.map')) continue
        if (output.fileName.endsWith('.html')) {
          // The page that names the shell is not part of it (navigation has its own cache rule),
          // but a script another plugin adds to it is, e.g. the update notice's.
          if (output.type === 'asset' && output.fileName === 'index.html') {
            const html = typeof output.source === 'string' ? output.source : Buffer.from(output.source).toString('utf8')
            entries.push(...referencedFiles(html, namesByBase, output.fileName))
          }
          continue
        }
        if (output.type === 'chunk') {
          const bytes = Buffer.byteLength(output.code)
          const statics = new Set([...output.imports, ...(output.viteMetadata?.importedCss ?? [])])
          const lazy = new Set([
            ...output.dynamicImports,
            ...(output.viteMetadata?.importedAssets ?? []),
            // Workers, WebAssembly and data reach a chunk only as a URL in its text.
            ...referencedFiles(output.code, namesByBase, output.fileName),
          ])
          for (const name of statics) lazy.delete(name)
          files.push({ fileName: output.fileName, bytes, chunk: true, staticRefs: [...statics], lazyRefs: [...lazy] })
          sizes.set(output.fileName, { raw: bytes, gzip: () => gzipSync(output.code, { level: 9 }).length })
          if (output.isEntry) entries.push(output.fileName)
          continue
        }
        const source = output.source
        const bytes = typeof source === 'string' ? Buffer.byteLength(source) : source.byteLength
        const refs = TEXT_ASSET.test(output.fileName)
          ? referencedFiles(
              typeof source === 'string' ? source : Buffer.from(source).toString('utf8'),
              namesByBase,
              output.fileName,
            )
          : []
        // A stylesheet's fonts and images load with it; a worker's files load when it asks.
        const isCss = output.fileName.endsWith('.css')
        files.push({
          fileName: output.fileName,
          bytes,
          chunk: false,
          staticRefs: isCss ? refs : [],
          lazyRefs: isCss ? [] : refs,
        })
        sizes.set(output.fileName, { raw: bytes, gzip: () => gzipSync(source, { level: 9 }).length })
      }

      if (!entries.length) {
        // A missing entry would switch the precache and the budget off with nothing reported.
        this.error('offline precache: the build has no entry chunk')
      }
      const fail = (message: string): never => this.error(message)
      const manifest = buildPrecacheManifest(files, {
        entries: [...new Set(entries)],
        shellExtras: publicFiles(publicDir, options.shellExtras, fail),
        groups: options.groups.map((group) => ({
          id: group.id,
          roots: group.roots,
          extras: publicFiles(publicDir, group.extras ?? [], fail),
        })),
        maxFileBytes: options.maxFileBytes,
      })

      const code = manifest.shell.filter((name) => /\.(?:js|mjs|css)$/.test(name))
      const raw = code.reduce((sum, name) => sum + sizes.get(name)!.raw, 0)
      const gzip = code.reduce((sum, name) => sum + sizes.get(name)!.gzip(), 0)
      if (raw > options.shellBudget.rawBytes || gzip > options.shellBudget.gzipBytes) {
        const largest = code
          .map((name) => [sizes.get(name)!.raw, name] as const)
          .sort((a, b) => b[0] - a[0])
          .slice(0, 5)
          .map(([bytes, name]) => `  ${megabytes(bytes)}  ${name}`)
        this.error(
          `The shell every page loads is ${megabytes(raw)} (${megabytes(gzip)} gzipped), over its budget of ` +
            `${megabytes(options.shellBudget.rawBytes)} (${megabytes(options.shellBudget.gzipBytes)} gzipped).\n` +
            `Largest shell files:\n${largest.join('\n')}\n` +
            'A static import probably pulled a page-only library into the shell; load it with import() instead, ' +
            'or raise the budget in vite.config.ts on purpose.',
        )
      }

      this.emitFile({ type: 'asset', fileName: 'offline-precache.json', source: JSON.stringify(manifest) })
      const groups = Object.entries(manifest.groups)
        .map(([id, group]) => `${id} ${group.files.length + group.extras.length} files ${megabytes(group.bytes)}`)
        .join(', ')
      this.info(
        `offline precache ${manifest.build}: shell ${manifest.shell.length} files ${megabytes(raw)} ` +
          `(${megabytes(gzip)} gzipped); ${groups}`,
      )
    },
  }
}
