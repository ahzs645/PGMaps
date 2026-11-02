import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const projectRoot = __dirname
const standaloneRoot = path.resolve(projectRoot, 'standalone/forestry-castor')
const dataRoot = path.resolve(projectRoot, 'public/data/forestry-castor')
const allowedData = ['simple_castordb.sqlite', 'LICENSE', 'NOTICE', 'provenance.json'] as const
const sampleSha = '8d19a48acba51de568d6994b8b41c0d9b6d3533aa6ea8c7a0e3cd95afe23535d'

function sourceState() {
  try {
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim()
    const dirty = !!execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], {
      cwd: projectRoot,
      encoding: 'utf8',
    }).trim()
    return { repository: 'https://github.com/ahzs645/PGMaps', revision, dirty }
  } catch {
    return { repository: 'https://github.com/ahzs645/PGMaps', revision: null, dirty: null }
  }
}

/** Emit only Castor-owned static inputs. The whole PGMaps public folder is excluded. */
function castorStaticAssets(): Plugin {
  return {
    name: 'castor-standalone-static-assets',
    apply: 'build',
    buildStart() {
      const files = allowedData.map((name) => {
        const bytes = readFileSync(path.join(dataRoot, name))
        const sha256 = createHash('sha256').update(bytes).digest('hex')
        if (name === 'simple_castordb.sqlite' && sha256 !== sampleSha)
          throw new Error('The pinned original dataCastor sample checksum does not match.')
        this.emitFile({ type: 'asset', fileName: `data/forestry-castor/${name}`, source: bytes })
        return { path: `data/forestry-castor/${name}`, bytes: bytes.byteLength, sha256 }
      })
      this.emitFile({ type: 'asset', fileName: '.nojekyll', source: '' })
      this.emitFile({
        type: 'asset',
        fileName: 'source-manifest.json',
        source:
          JSON.stringify(
            {
              schema: 'pgmaps-castor-standalone-source-v1',
              source: sourceState(),
              entry: 'standalone/forestry-castor/main.tsx',
              workbench: 'src/pages/DevForestryCastor.tsx',
              model: 'src/features/forestry-castor',
              upstream: {
                forestryCastor: 'e2a580eb1fcc634780bb3599da7265a1e871484f',
                growingStockCastor: '8ea945a91b4ec71d0ddd28714641b6dcae229c5c',
                dataCastor: '884ce9d726942b3d2eae7b88120bd1b7ad863a19',
              },
              files,
              runtime:
                'Static browser application; local worker calculations, local file inputs, same-origin SQLite Wasm and sample data.',
            },
            null,
            2,
          ) + '\n',
      })
    },
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const index = bundle['index.html']
        if (index?.type === 'asset') this.emitFile({ type: 'asset', fileName: '404.html', source: index.source })
      },
    },
  }
}

function castorDevelopmentData(): Plugin {
  return {
    name: 'castor-standalone-development-data',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = (request.url ?? '').split('?')[0]
        const base = server.config.base.replace(/\/$/, '')
        const prefix = pathname.startsWith(`${base}/data/forestry-castor/`)
          ? `${base}/data/forestry-castor/`
          : '/data/forestry-castor/'
        if (!pathname.startsWith(prefix)) {
          next()
          return
        }
        const name = pathname.slice(prefix.length)
        if (!(allowedData as readonly string[]).includes(name)) {
          response.statusCode = 404
          response.end('Unknown Castor input')
          return
        }
        response.setHeader(
          'content-type',
          name.endsWith('.json')
            ? 'application/json'
            : name.endsWith('.sqlite')
              ? 'application/vnd.sqlite3'
              : 'text/plain; charset=utf-8',
        )
        response.setHeader('cache-control', 'no-store')
        response.end(readFileSync(path.join(dataRoot, name)))
      })
    },
  }
}

export default defineConfig({
  root: standaloneRoot,
  base: '/forestryCastor/',
  publicDir: false,
  plugins: [react(), castorStaticAssets(), castorDevelopmentData()],
  resolve: { alias: { '@': path.resolve(projectRoot, 'src') } },
  css: { postcss: projectRoot },
  build: {
    outDir: path.resolve(standaloneRoot, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/maplibre-gl/')) return 'maplibre'
        },
      },
    },
  },
  server: { host: '127.0.0.1', port: 42179, fs: { allow: [projectRoot] } },
  preview: { host: '127.0.0.1', port: 42179 },
})
