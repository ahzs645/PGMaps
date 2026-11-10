import { LidarWorkspace } from './dev-lidar/LidarWorkspace'

/**
 * The point cloud is published by vendor/pgmaps-lidar-data, not this site: at 495 MB it put
 * the Pages deployment over GitHub's 1 GB limit. Override it to use locally built tiles.
 */
const LIDAR_CLOUD_BASE =
  import.meta.env.VITE_LIDAR_CLOUD_BASE ?? 'https://projects.ahmadjalil.com/pgmaps-lidar-data/bc-093g086/'

export default function DevLidar() {
  const origin = window.location.origin
  return (
    <LidarWorkspace
      cloudBase={LIDAR_CLOUD_BASE}
      analysisBase={new URL(`${import.meta.env.BASE_URL}data/lidar-analysis/bc-093g086/`, origin).href}
    />
  )
}
