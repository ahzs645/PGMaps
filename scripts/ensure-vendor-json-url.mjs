// Vite resolves @firstform/json-url from vendor/json-url/dist, so dev needs
// the vendored package checked out and built before the server starts.
import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const vendorDir = join(root, 'vendor', 'json-url')

if (!existsSync(join(vendorDir, 'package.json'))) {
  console.error(
    '\nvendor/json-url is an empty git submodule. Initialize it first:\n\n' +
      '  git submodule update --init vendor/json-url\n  npm install\n',
  )
  process.exit(1)
}

if (!existsSync(join(vendorDir, 'dist', 'index.js'))) {
  console.log('Building vendor/json-url (first run only)...')
  try {
    execSync('npm run build', { cwd: vendorDir, stdio: 'inherit' })
  } catch {
    console.error(
      '\nFailed to build vendor/json-url. Try:\n\n' +
        '  npm --prefix vendor/json-url install\n  npm --prefix vendor/json-url run build\n',
    )
    process.exit(1)
  }
}
