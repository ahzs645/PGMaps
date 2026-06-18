import { copyFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const indexPath = join(root, 'dist', 'index.html')
const fallbackPath = join(root, 'dist', '404.html')

if (!existsSync(indexPath)) {
  console.error('[spa] dist/index.html does not exist; run vite build first')
  process.exit(1)
}

copyFileSync(indexPath, fallbackPath)
console.log('[spa] copied dist/index.html -> dist/404.html')
