import { defineConfig, type Plugin, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import { webUpdateNotice } from '@plugin-web-update-notification/vite'
import path from 'path'
import fs from 'fs'
import type { IncomingMessage, ServerResponse } from 'http'
import { aqmapApiPlugin } from './src/maps/aqmap/server/aqmapApiPlugin'
import { remediationDevDataPlugin } from './scripts/remediation-dev-data'
import { waterTempDevDataPlugin } from './scripts/water-temp-dev-data'

// Local review only: restricted EDI caches never enter public/ or the build.
function earlyLearningDevDataPlugin(): Plugin {
  const root = path.resolve(__dirname, 'vendor/bcdatamapper/datascrapers/bc/early-learning/cache/products')
  return {
    name: 'early-learning-local-review',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev_early_learning', (req, res) => {
        const filename = (req.url ?? '').split('?')[0].replace(/^\//, '')
        if (!/^(latest\.json|releases\/[a-f0-9]{64}\.json|blobs\/[a-f0-9]{64}\.json\.gz)$/.test(filename)) {
          res.statusCode = 404
          res.end('Unknown EDI product')
          return
        }
        const stream = fs.createReadStream(path.join(root, filename))
        stream.on('error', () => {
          res.statusCode = 404
          res.end('Run the local EDI normalizer first.')
        })
        stream.on('open', () => {
          res.setHeader('content-type', 'application/json')
          res.setHeader('cache-control', 'no-store')
          if (filename.endsWith('.gz')) res.setHeader('content-encoding', 'gzip')
          stream.pipe(res)
        })
      })
    },
  }
}

function networkDevDataPlugin(): Plugin {
  const root = path.resolve(__dirname, 'vendor/bcdatamapper/datascrapers/network')
  return {
    name: 'network-dev-data',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/__dev_network_data', (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const rawUrl = req.url ?? '/'
        const pathname = decodeURIComponent(rawUrl.split('?')[0] ?? '/')
        const relativePath = pathname.replace(/^\/+/, '')
        const filePath = path.resolve(root, relativePath)
        if (!filePath.startsWith(root + path.sep)) {
          res.statusCode = 403
          res.end('Forbidden')
          return
        }
        fs.stat(filePath, (statError, stats) => {
          if (statError || !stats.isFile()) {
            next()
            return
          }
          if (filePath.endsWith('.mvt')) {
            res.setHeader('content-type', 'application/vnd.mapbox-vector-tile')
          } else if (filePath.endsWith('.png')) {
            res.setHeader('content-type', 'image/png')
          } else if (filePath.endsWith('.geojson.gz')) {
            res.setHeader('content-type', 'application/json')
          } else if (filePath.endsWith('.json')) {
            res.setHeader('content-type', 'application/json')
          }
          res.setHeader('cache-control', 'no-store')
          fs.createReadStream(filePath).pipe(res)
        })
      })
    },
  }
}

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [
    react(),
    {
      name: 'forestry-help-index',
      configureServer(server) {
        const base = server.config.base
        server.middlewares.use((request, response, next) => {
          const url = new URL(request.url ?? '/', 'http://localhost')
          const relative = url.pathname.slice(base.length)
          if (url.pathname.startsWith(base) && relative === 'help') {
            response.writeHead(302, { Location: url.pathname + '/' + url.search }).end()
            return
          }
          if (url.pathname.startsWith(base) && /^help\/(?:[a-z0-9-]+\/)?$/.test(relative))
            request.url = url.pathname + 'index.html' + url.search
          next()
        })
      },
    },
    webUpdateNotice({
      versionType: 'git_commit_hash',
      checkInterval: 5 * 60 * 1000,
      checkOnWindowFocus: true,
      checkImmediately: true,
      checkOnLoadFileError: true,
      hiddenDefaultNotification: true,
      logVersion: true,
    }),
    aqmapApiPlugin(),
    networkDevDataPlugin(),
    earlyLearningDevDataPlugin(),
    remediationDevDataPlugin(),
    waterTempDevDataPlugin(),
  ],
  resolve: {
    alias: [
      { find: /^brandkit\/consumer$/, replacement: path.resolve(__dirname, 'vendor/brandkit/src/engine/consumer.js') },
      { find: /^brandkit\/fonts$/, replacement: path.resolve(__dirname, 'vendor/brandkit/src/fonts/provider.js') },
      { find: /^brandkit\/pack\/host$/, replacement: path.resolve(__dirname, 'vendor/brandkit/src/pack/host.js') },
      { find: '@', replacement: path.resolve(__dirname, './src') },
      // MapLibre 6 locates its worker at run time in a way Vite cannot follow;
      // the entry sets the worker URL first (see src/lib/maplibre-gl-entry.ts).
      // Exact match only, so `maplibre-gl/dist/...` still reaches the package.
      { find: /^maplibre-gl$/, replacement: path.resolve(__dirname, './src/lib/maplibre-gl-entry.ts') },
    ],
  },
  // Only imported dynamically from a worker; pre-bundle at startup so the first LAZ import does
  // not hit a mid-session re-optimisation ("Failed to fetch dynamically imported module").
  optimizeDeps: {
    include: ['whitebox-wasm', 'whitebox-wasm/tools', 'laz-perf'],
    // Vite scans every HTML file for imports to pre-bundle. The visual tools
    // trial bench is a separate project with its own packages (EZ-Tree,
    // maplibre-gl-three, Giro3D); scanned from here they fail to resolve and
    // stop the dev server.
    entries: ['**/*.html', '!docs/forestry-visual-tools-trial/**', '!vendor/brandkit/**'],
  },
  build: {
    rollupOptions: {
      input: { app: 'index.html', ribbonHelp: 'help/ribbon.html' },
      output: {
        manualChunks(id) {
          // The trailing slash matters: without it maplibre-gl-lidar, and the
          // luma.gl 9.4 nested under it, joined this always-loaded chunk and
          // clashed with deck.gl's luma.gl 9.3 on every deck.gl page.
          if (id.includes('node_modules/maplibre-gl/')) return 'maplibre'
          if (id.includes('node_modules/@turf')) return 'turf'
        },
      },
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    // Optional local GDAL service; start with python3 scripts/nechako-server/converter.py.
    proxy: {
      '/api/nechako-portal': 'http://127.0.0.1:42175',
      '/api/nechako': 'http://127.0.0.1:42174',
    },
    // Network snapshots contain thousands of static tiles served by middleware.
    watch: { ignored: ['**/vendor/bcdatamapper/datascrapers/network/*/output/**'] },
  },
})
