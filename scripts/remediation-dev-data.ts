import type { Plugin } from 'vite'
import fs from 'node:fs'
import path from 'node:path'

// Access Only source: serve the research cache locally, never copy it to public/.
export function remediationDevDataPlugin(): Plugin {
  return {
    name: 'remediation-local-data',
    apply: 'serve',
    configureServer(server) {
      const root = path.resolve(server.config.root, 'vendor/bcdatamapper/datascrapers/bc/environmental-remediation/cache')
      server.middlewares.use('/__dev_remediation', (req, res) => {
        const filename = (req.url ?? '').split('?')[0].replace(/^\//, '')
        if (!/^(map-manifest\.json|sites-[a-f0-9]{64}\.geojson\.gz)$/.test(filename)) {
          res.statusCode = 404
          res.end('Unknown remediation product')
          return
        }
        const stream = fs.createReadStream(path.join(root, filename))
        stream.on('error', () => {
          if (res.headersSent) { res.destroy(); return }
          res.statusCode = 404
          res.end('Run npm run remediation:sync first.')
        })
        stream.on('open', () => {
          res.setHeader('content-type', 'application/json')
          res.setHeader('cache-control', 'no-store')
          if (filename.endsWith('.gz')) res.setHeader('content-encoding', 'gzip')
          stream.pipe(res)
        })
        res.on('close', () => stream.destroy())
      })
    },
  }
}
