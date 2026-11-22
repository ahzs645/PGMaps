/**
 * The tile protocols an imagery feed can name (`ImageryFeed.tileProtocol`), each with the browser
 * module that registers it. A feed stays free of DOM access; the timeline registers its protocol
 * before its layers draw. A new protocol is one entry here.
 */
import { registerSentinelTiles } from '@/lib/sentinel2/tileProtocol'
import { SENTINEL_TILE_PROTOCOL } from '@/lib/sentinel2/tiles'

const PROTOCOLS: Record<string, () => void> = {
  [SENTINEL_TILE_PROTOCOL]: registerSentinelTiles,
}

/** Registers a feed's protocol once; a name nobody registers is an error, never silently blank tiles. */
export function ensureImageryProtocol(name: string | undefined) {
  if (!name) return
  const register = PROTOCOLS[name]
  if (!register) throw new Error(`No tile protocol "${name}" is registered for imagery feeds.`)
  register()
}
