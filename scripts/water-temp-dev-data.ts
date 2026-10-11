import { createReadStream } from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

/** Read the existing source checkout for local review; never copy or deploy its data. */
export function waterTempDevDataPlugin(): Plugin {
  const root = path.resolve(
    process.env.PGMAPS_WATER_TEMP_DATA_DIR ?? path.join(process.cwd(), '../unbcwatertemp-viz/public/data'),
  )
  return {
    name: 'water-temperature-local-review',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev_water_temp', (req, res) => {
        const file = (req.url ?? '').split('?')[0].replace(/^\//, '')
        if (!/^(stations\.json|config\.json|data\/[A-Za-z0-9_-]+\.json)$/.test(file)) {
          res.statusCode = 404
          res.end('Unknown water temperature file')
          return
        }
        const stream = createReadStream(path.join(root, file))
        stream.on('error', () => {
          if (res.headersSent) {
            res.destroy()
            return
          }
          res.statusCode = 404
          res.end('Local snapshot unavailable. Set PGMAPS_WATER_TEMP_DATA_DIR to the source public/data directory.')
        })
        stream.on('open', () => {
          res.setHeader('content-type', 'application/json')
          res.setHeader('cache-control', 'no-store')
          stream.pipe(res)
        })
        res.on('close', () => stream.destroy())
      })
    },
  }
}
