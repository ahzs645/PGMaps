/**
 * A KMZ: the KML of `kml.ts` zipped as `doc.kml`, first in the archive because Google Earth opens
 * the first KML it finds, with any icons or images the styles refer to beside it. fflate is pure
 * JavaScript, so this runs in a worker or in Node alike. No DOM or network access.
 */
import { strToU8, zipSync, type Zippable } from 'fflate'
import type { GisLayer } from './layers'
import { writeKml, type KmlOptions } from './kml'

export interface KmzOptions extends KmlOptions {
  /** Further files by path inside the archive (an icon an `iconHref` names, say). */
  files?: Readonly<Record<string, Uint8Array>>
  /** The archive's file times; now when not given. */
  modified?: Date
}

export interface KmzResult {
  bytes: Uint8Array
  warnings: string[]
}

/**
 * Writes `layers` as a KMZ. Throws for an extra file path that would leave the archive, or that is a
 * second KML (a client would have to guess which to open), and for a coordinate `writeKml` refuses.
 */
export function writeKmz(layers: readonly GisLayer[], options: KmzOptions): KmzResult {
  const { files = {}, modified, ...kmlOptions } = options
  for (const path of Object.keys(files)) {
    if (!path || path.startsWith('/') || path.split(/[\\/]/).some((part) => part === '..' || part === ''))
      throw Error(`KMZ file path "${path}" must be relative and stay inside the archive.`)
    if (/\.kml$/i.test(path)) throw Error(`KMZ file "${path}" is a second KML; the archive holds only doc.kml.`)
  }
  const { kml, warnings } = writeKml(layers, kmlOptions)
  const entries: Zippable = { 'doc.kml': strToU8(kml) }
  for (const [path, bytes] of Object.entries(files)) entries[path] = bytes
  const bytes = zipSync(entries, { level: 6, ...(modified ? { mtime: modified } : {}) })
  return { bytes, warnings }
}
