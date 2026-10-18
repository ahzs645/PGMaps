import { LidarWorkspace } from './dev-lidar/LidarWorkspace'

export default function DevLidar() {
  const origin = window.location.origin
  return (
    <LidarWorkspace
      cloudBase={new URL(`${import.meta.env.BASE_URL}data/lidar/bc-093g086/`, origin).href}
      analysisBase={new URL(`${import.meta.env.BASE_URL}data/lidar-analysis/bc-093g086/`, origin).href}
    />
  )
}
