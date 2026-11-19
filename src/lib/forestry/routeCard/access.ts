/** An access road stored in longitude and latitude, as a planar line in BC Albers metres. No DOM or network access. */
import { albers, planarFromGeoJson, type Planar } from './geometry'

export const accessPlanar = (
  lines: ReadonlyArray<ReadonlyArray<[number, number]>> | null | undefined,
): Planar | null =>
  lines?.length
    ? planarFromGeoJson({ type: 'MultiLineString', coordinates: lines.map((line) => [...line]) }, ([lng, lat]) =>
        albers(lng, lat),
      )
    : null
