/**
 * Takes the pictures and figures the test views post (views.js) and serves views.js to the page.
 * Listens on this machine only.
 *
 *   node scripts/forestry/tree-views/receive.mjs <folder for the results>
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
const dir = process.argv[2] ?? 'tmp/tree-views'
const harness = new URL('./views.js', import.meta.url)
http
  .createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'content-type')
    const url = new URL(req.url, 'http://x')
    if (req.method === 'GET' && url.pathname === '/views.js') {
      res.setHeader('content-type', 'text/javascript')
      res.end(fs.readFileSync(harness))
      return
    }
    if (req.method !== 'POST') {
      res.end('ok')
      return
    }
    const name = path.basename(url.searchParams.get('name') || 'shot')
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, name), Buffer.concat(chunks))
      res.end('saved')
    })
  })
  .listen(48731, '127.0.0.1')
