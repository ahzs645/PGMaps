import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { PUBLIC } from './scripts/road-design/manifest.mjs'

/**
 * The standalone forestry road designer: the same designer and help PGMaps serves, built as a site of
 * its own. Where it is deployed is never written here: `ROAD_DESIGN_BASE` and the `VITE_ROAD_DESIGN_*`
 * variables come from `standalone/forestry-road-design/.env`, a `.env.<mode>.local` beside it, or the
 * build's environment (guide docs/forestry-road-design/standalone-build.md).
 */
const projectRoot = __dirname
const standaloneRoot = path.resolve(projectRoot, 'standalone/forestry-road-design')
const publicRoot = path.resolve(projectRoot, 'public')

/** `/`, or `/some/path/`: the form Vite's `base` and the router's basename both expect. */
function siteBase(value: string | undefined) {
  const trimmed = (value ?? '/').trim()
  if (/^[a-z]+:/i.test(trimmed))
    throw new Error(`ROAD_DESIGN_BASE must be a path such as "/" or "/road-design/"; got "${trimmed}".`)
  return `/${trimmed.replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/')
}

function sourceState() {
  try {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8' }).trim()
    return { revision: git('rev-parse', 'HEAD'), dirty: !!git('status', '--porcelain', '--untracked-files=normal') }
  } catch {
    return { revision: null, dirty: null }
  }
}

/** Every file below a `public/` entry, as [published path, absolute path]. */
function publicFiles(): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const visit = (rel: string) => {
    const abs = path.join(publicRoot, rel)
    if (!fs.existsSync(abs)) throw new Error(`public/${rel} is listed in scripts/road-design/manifest.mjs but missing.`)
    if (fs.statSync(abs).isDirectory()) for (const name of fs.readdirSync(abs).sort()) visit(path.posix.join(rel, name))
    else out.push([rel, abs])
  }
  for (const entry of PUBLIC) visit(entry)
  return out
}

/** Only the designer's own runtime files from `public/`: never PGMaps' data or the rest of its site. */
function roadDesignStaticFiles(env: Record<string, string>): Plugin {
  return {
    name: 'road-design-static-files',
    buildStart() {
      if (this.meta.watchMode) return
      const files = publicFiles().map(([rel, abs]) => {
        const bytes = fs.readFileSync(abs)
        this.emitFile({ type: 'asset', fileName: rel, source: bytes })
        return { path: rel, bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }
      })
      this.emitFile({ type: 'asset', fileName: '.nojekyll', source: '' })
      // Cloudflare (and Netlify) read this; other hosts ignore it. File names under assets/ carry their hash.
      this.emitFile({
        type: 'asset',
        fileName: '_headers',
        source: '/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n',
      })
      const settings = Object.fromEntries(
        Object.entries(env).filter(
          ([key]) => key === 'ROAD_DESIGN_BASE' || key.startsWith('VITE_ROAD_DESIGN_') || key === 'VITE_DATA_HOSTS',
        ),
      )
      this.emitFile({
        type: 'asset',
        fileName: 'source-manifest.json',
        source: `${JSON.stringify({ schema: 'pgmaps-road-design-standalone-source-v1', source: sourceState(), entry: 'standalone/forestry-road-design/main.tsx', settings, files }, null, 2)}\n`,
      })
    },
    configureServer(server) {
      const served = new Map(publicFiles())
      server.middlewares.use((request, response, next) => {
        const base = server.config.base
        const pathname = decodeURIComponent((request.url ?? '').split('?')[0])
        if (!pathname.startsWith(base)) return next()
        let rel = pathname.slice(base.length)
        if (!served.has(rel) && served.has(`${rel.replace(/\/$/, '')}/index.html`))
          rel = `${rel.replace(/\/$/, '')}/index.html`
        const file = served.get(rel)
        if (!file) return next()
        response.setHeader('cache-control', 'no-store')
        fs.createReadStream(file).pipe(response)
      })
    },
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        // Static hosts answer an unknown address with 404.html; the router then opens the right page.
        const index = bundle['index.html']
        if (index?.type === 'asset') this.emitFile({ type: 'asset', fileName: '404.html', source: index.source })
      },
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, standaloneRoot, '')
  return {
    root: standaloneRoot,
    envDir: standaloneRoot,
    base: siteBase(process.env.ROAD_DESIGN_BASE ?? env.ROAD_DESIGN_BASE),
    publicDir: false,
    plugins: [react(), roadDesignStaticFiles({ ...env, ...process.env } as Record<string, string>)],
    resolve: {
      alias: [
        {
          find: /^brandkit\/consumer$/,
          replacement: path.resolve(projectRoot, 'vendor/brandkit/src/engine/consumer.js'),
        },
        { find: /^brandkit\/fonts$/, replacement: path.resolve(projectRoot, 'vendor/brandkit/src/fonts/provider.js') },
        { find: /^brandkit\/pack\/host$/, replacement: path.resolve(projectRoot, 'vendor/brandkit/src/pack/host.js') },
        { find: '@', replacement: path.resolve(projectRoot, 'src') },
        // As in vite.config.ts: MapLibre 6's worker URL is set before any map exists.
        { find: /^maplibre-gl$/, replacement: path.resolve(projectRoot, 'src/lib/maplibre-gl-entry.ts') },
      ],
    },
    css: { postcss: projectRoot },
    optimizeDeps: {
      include: ['whitebox-wasm', 'whitebox-wasm/tools', 'laz-perf', 'pdfjs-dist', 'pdf-lib'],
      entries: [path.join(standaloneRoot, 'index.html')],
    },
    build: {
      outDir: path.resolve(standaloneRoot, 'dist'),
      emptyOutDir: true,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes('node_modules/maplibre-gl/')) return 'maplibre'
            if (id.includes('node_modules/@turf')) return 'turf'
          },
        },
      },
    },
    server: { host: '127.0.0.1', port: 42180, fs: { allow: [projectRoot] } },
    preview: { host: '127.0.0.1', port: 42180 },
  }
})
