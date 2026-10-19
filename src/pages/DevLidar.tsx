import { useEffect } from 'react'
import { LidarWorkspace } from './dev-lidar/LidarWorkspace'

export default function DevLidar() {
  useEffect(() => {
    const visibility = (hidden: boolean) =>
      window.dispatchEvent(new CustomEvent('pgmaps:mobile-toolbar-visibility', { detail: { hidden } }))
    visibility(true)
    return () => {
      visibility(false)
    }
  }, [])
  const origin = window.location.origin
  return (
    <LidarWorkspace
      cloudBase={new URL(`${import.meta.env.BASE_URL}data/lidar/bc-093g086/`, origin).href}
      analysisBase={new URL(`${import.meta.env.BASE_URL}data/lidar-analysis/bc-093g086/`, origin).href}
    />
  )
}
