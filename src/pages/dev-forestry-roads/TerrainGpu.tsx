import { memo, useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import type { TerrainGpuData, TerrainGpuHandle, TerrainGpuView } from './terrainGpuTypes'
import type { TerrainSlopeTexture } from './terrainSlopeTexture'

interface Props {
  data: TerrainGpuData
  view: TerrainGpuView
  /** Laid over the ground while it is coloured by slope; handed over without rebuilding the scene. */
  groundTexture?: TerrainSlopeTexture | null
  projectionKey: string
  handle: MutableRefObject<TerrainGpuHandle | null>
  onStatus: (status: 'webgl' | 'canvas', reason?: string) => void
}

/**
 * One lazily loaded GPU context for the life of the pane, including fullscreen and resize. React
 * owns the canvas; Three never reparents or removes it. Until the first complete frame, the canvas
 * fallback stays visible. A lost context keeps its canvas so the browser can restore it.
 */
export const TerrainGpu = memo(function TerrainGpu({ data, view, groundTexture = null, handle, onStatus }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const instance = useRef<TerrainGpuHandle | null>(null)
  const latest = useRef({ data, view, groundTexture, onStatus })
  latest.current = { data, view, groundTexture, onStatus }
  const dispose = useCallback(() => {
    const renderer = instance.current
    instance.current = null
    if (handle.current === renderer) handle.current = null
    renderer?.dispose()
  }, [handle])
  const fail = useCallback(
    (error: unknown) => {
      dispose()
      if (canvas.current) canvas.current.style.visibility = 'hidden'
      latest.current.onStatus('canvas', error instanceof Error ? error.message : '3D acceleration is unavailable.')
    },
    [dispose],
  )
  useEffect(() => {
    const element = canvas.current
    if (!element) return
    let disposed = false
    latest.current.onStatus('canvas')
    void import('./terrainGpuRenderer')
      .then(({ createTerrainGpu }) => {
        if (disposed) return
        const renderer = createTerrainGpu(element, (status, reason) => latest.current.onStatus(status, reason))
        instance.current = renderer
        handle.current = renderer
        renderer.setData(latest.current.data)
        renderer.setGroundTexture(latest.current.groundTexture)
        renderer.setView(latest.current.view)
      })
      .catch((error: unknown) => {
        if (!disposed) fail(error)
      })
    return () => {
      disposed = true
      dispose()
    }
  }, [handle, dispose, fail])
  useEffect(() => {
    try {
      handle.current?.setData(data)
    } catch (error) {
      fail(error)
    }
  }, [data, handle, fail])
  useEffect(() => {
    try {
      handle.current?.setGroundTexture(groundTexture)
    } catch (error) {
      fail(error)
    }
  }, [groundTexture, handle, fail])
  useEffect(() => {
    try {
      handle.current?.setView(view)
    } catch (error) {
      fail(error)
    }
  }, [view, handle, fail])
  return (
    <foreignObject width={view.width} height={view.height} pointerEvents="none">
      <canvas
        ref={canvas}
        style={{ width: view.width, height: view.height }}
        data-testid="road-terrain-gpu-canvas"
        data-render-count="0"
        aria-hidden="true"
      />
    </foreignObject>
  )
})
