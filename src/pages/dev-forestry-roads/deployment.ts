/**
 * Where this deployment of the road designer lives, read from the build's `VITE_ROAD_DESIGN_*`
 * variables (guide `standalone-build.md`). PGMaps sets none of them, so every default is PGMaps'
 * own address; the standalone build (`standalone/forestry-road-design/.env`) sets them for a site of
 * its own, at a domain's root or under a subpath. A page never writes a deployment's address: it
 * reads it from here. Keep this file free of DOM and network access.
 */

/** The published, checksum-pinned home of the LiDAR sample terrain (`terrain.ts`). */
export const PUBLISHED_LIDAR_SAMPLE_BASE = 'https://pgmaps.ahmadjalil.com/data/lidar-analysis/bc-093g086/'

export type RoadDesignDeployment = {
  /** The designer's route below the site's base: `/dev/forestry/road-design` in PGMaps, `/` standalone. */
  designerPath: string
  /** Where *Symbol gallery* goes: a route, an absolute URL, or null when this site has no gallery. */
  blockSheetGallery: string | null
  /** Where the LiDAR sample is read when this site holds no copy of its own. Ends in `/`. */
  lidarSampleMirror: string
}

type Env = Readonly<Record<string, string | boolean | undefined>>

const text = (value: string | boolean | undefined) => (typeof value === 'string' ? value.trim() : undefined)

/** Reads the variables, refusing a value that would send the designer somewhere wrong. */
export function readRoadDesignDeployment(env: Env): RoadDesignDeployment {
  const path = text(env.VITE_ROAD_DESIGN_PATH) || '/dev/forestry/road-design'
  if (!path.startsWith('/') || path.includes('//') || /[?#]/.test(path))
    throw new Error(`VITE_ROAD_DESIGN_PATH must be a path below the site's base, such as "/"; got "${path}".`)
  const gallery = text(env.VITE_ROAD_DESIGN_GALLERY_URL)
  const blockSheetGallery = gallery === undefined ? '/dev/forestry/block-sheets' : gallery || null
  if (blockSheetGallery && !blockSheetGallery.startsWith('/') && !/^https:\/\//.test(blockSheetGallery))
    throw new Error('VITE_ROAD_DESIGN_GALLERY_URL must be a route, an https URL, or empty for none.')
  const mirror = text(env.VITE_ROAD_DESIGN_LIDAR_MIRROR) || PUBLISHED_LIDAR_SAMPLE_BASE
  if (!/^https:\/\/[^/]+\/.*\/$|^https:\/\/[^/]+\/$/.test(mirror))
    throw new Error('VITE_ROAD_DESIGN_LIDAR_MIRROR must be an https folder URL ending in "/".')
  return {
    designerPath: path.length > 1 ? path.replace(/\/+$/, '') : path,
    blockSheetGallery,
    lidarSampleMirror: mirror,
  }
}

export const ROAD_DESIGN_DEPLOYMENT = readRoadDesignDeployment(import.meta.env ?? {})
