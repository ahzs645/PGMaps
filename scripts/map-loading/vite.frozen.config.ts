// A dev server that does not watch or hot-reload, for measurements (`measure.mjs` beside this file).
// The shared checkout is edited by several sessions at once: a watching server reloads the page in
// the middle of a run. This one serves each module as it was when first asked for, so restart it
// after every edit. Its dependency cache is its own, so it never re-bundles another server's.
//
//   npx vite --config scripts/map-loading/vite.frozen.config.ts --host 127.0.0.1 --port 42320 --strictPort
import path from 'node:path'
import { mergeConfig } from 'vite'
import base from '../../vite.config'

export default mergeConfig(base, {
  cacheDir: path.resolve(__dirname, '../../tmp/map-loading/.vite'),
  server: { watch: null, hmr: false },
})
