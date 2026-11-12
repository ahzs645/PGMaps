/**
 * MapLibre GL, with its worker located for Vite.
 *
 * MapLibre 6 ships its tile worker as a separate module and finds it at run
 * time with `new URL('./maplibre-gl-worker.mjs', import.meta.url)`, built from
 * a variable. Neither Vite's dev pre-bundle nor the production build can see
 * that URL, so the worker 404s and no map loads a tile. `?url` makes Vite emit
 * the (self-contained) worker file and hand back its address, and
 * `setWorkerUrl` tells MapLibre to use it.
 *
 * `vite.config.ts` aliases the bare `maplibre-gl` specifier to this module, so
 * every importer — the toolkit, maplibre-gl-lidar, deck.gl's adapter and this
 * app's own files — gets a MapLibre whose worker URL is set before its first
 * map exists, and MapLibre stays in its own lazily loaded chunk. Vitest does
 * not use the alias.
 *
 * `prewarm` keeps the worker pool alive between maps. MapLibre 6 otherwise
 * terminates its workers whenever the last map is removed, and pages here
 * remove maps routinely (the visual-quality road view mounts its own map only
 * while it is open): each removal threw an unhandled "workers were terminated
 * while a message was in flight", and the next map started its workers again.
 */

import { prewarm, setWorkerUrl } from 'maplibre-gl/dist/maplibre-gl.mjs'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'

setWorkerUrl(workerUrl)
prewarm()

export * from 'maplibre-gl/dist/maplibre-gl.mjs'
