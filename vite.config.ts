import { defineConfig, type Plugin, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import { webUpdateNotice } from '@plugin-web-update-notification/vite'
import path from 'path'
import fs from 'fs'
import type { IncomingMessage, ServerResponse } from 'http'
import { aqmapApiPlugin } from './src/maps/aqmap/server/aqmapApiPlugin'

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
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/maplibre-gl')) return 'maplibre'
          if (id.includes('node_modules/@turf')) return 'turf'
        },
      },
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
  },
})
