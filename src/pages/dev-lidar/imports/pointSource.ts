import type { LidarControl } from 'maplibre-gl-lidar'
import type { PointSource } from './types'
export const POINT_BUDGET = 750000
export async function loadPointSource(
  control: Pick<LidarControl, 'loadPointCloud' | 'loadPointCloudStreaming' | 'loadPointCloudEptStreaming'>,
  source: PointSource,
) {
  const options = { pointBudget: POINT_BUDGET, maxConcurrentRequests: 3 }
  if (source.kind === 'ept') return control.loadPointCloudEptStreaming(source.url!, options)
  if (source.kind === 'copc') return control.loadPointCloudStreaming(source.file ?? source.url!, options)
  return control.loadPointCloud(source.file!)
}
