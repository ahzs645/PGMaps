import { createElement, type ComponentProps } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerrainGpu } from './TerrainGpu'
import { previewCamera } from './previewCamera'
import type { TerrainGpuData, TerrainGpuHandle, TerrainGpuView } from './terrainGpuTypes'
import type { TerrainSlopeTexture } from './terrainSlopeTexture'

const { createTerrainGpu } = vi.hoisted(() => ({
  createTerrainGpu:
    vi.fn<
      (canvas: HTMLCanvasElement, onStatus: (status: 'webgl' | 'canvas', reason?: string) => void) => TerrainGpuHandle
    >(),
}))
vi.mock('./terrainGpuRenderer', () => ({ createTerrainGpu }))

function gpuStub() {
  return {
    setData: vi.fn<(data: TerrainGpuData) => void>(),
    setView: vi.fn<(view: TerrainGpuView) => void>(),
    setGroundTexture: vi.fn<TerrainGpuHandle['setGroundTexture']>(),
    pick: vi.fn<TerrainGpuHandle['pick']>(() => null),
    dispose: vi.fn<() => void>(),
  }
}

function fixture() {
  const data: TerrainGpuData = {
    ground: [],
    road: [],
    earthwork: [],
    lines: [],
    culverts: [],
    stations: [],
    colour: 'plain',
    low: 0,
    high: 10,
    originZ: 0,
  }
  const cameraInputs = {
    bounds: [-50, -50, 50, 50],
    low: 0,
    high: 10,
    target: [0, 0],
    targetZ: 5,
    angle: 0.7,
    tilt: 0.6,
    exaggeration: 1,
    width: 600,
    height: 240,
    zoom: 1,
  }
  const view: TerrainGpuView = {
    ...cameraInputs,
    camera: previewCamera(cameraInputs),
    quality: 'auto',
    wireframe: false,
    showEarthwork: true,
    xray: false,
  }
  const props: ComponentProps<typeof TerrainGpu> = {
    data,
    view,
    projectionKey: 'initial',
    handle: { current: null },
    onStatus: vi.fn(),
  }
  const canvas = { style: { visibility: 'visible' } }
  return { props, canvas }
}

let renderer: ReactTestRenderer | undefined
beforeEach(() => {
  createTerrainGpu.mockReset()
})
afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = undefined
})

async function mount({ props, canvas }: ReturnType<typeof fixture>) {
  await act(async () => {
    renderer = create(createElement(TerrainGpu, props), {
      createNodeMock: (element) => (element.type === 'canvas' ? canvas : null),
    })
    await vi.dynamicImportSettled()
  })
}

describe('terrain GPU lifecycle', () => {
  it('keeps the canvas fallback when an accelerated context cannot be created', async () => {
    const input = fixture()
    createTerrainGpu.mockImplementation(() => {
      throw Error('WebGL2 is unavailable')
    })

    await mount(input)

    expect(createTerrainGpu).toHaveBeenCalledTimes(1)
    expect(createTerrainGpu).toHaveBeenCalledWith(input.canvas, expect.any(Function))
    expect(input.props.onStatus).toHaveBeenNthCalledWith(1, 'canvas')
    expect(input.props.onStatus).toHaveBeenLastCalledWith('canvas', 'WebGL2 is unavailable')
    expect(input.props.handle.current).toBeNull()
    expect(input.canvas.style.visibility).toBe('hidden')
  })

  it('releases a renderer whose initial geometry upload fails, without retrying on later updates', async () => {
    const input = fixture()
    const gpu = gpuStub()
    gpu.setData.mockImplementationOnce(() => {
      throw Error('Geometry upload failed')
    })
    createTerrainGpu.mockReturnValue(gpu)

    await mount(input)

    expect(input.props.onStatus).toHaveBeenLastCalledWith('canvas', 'Geometry upload failed')
    expect(input.props.handle.current).toBeNull()
    expect(input.canvas.style.visibility).toBe('hidden')
    expect(gpu.setView).not.toHaveBeenCalled()
    expect(gpu.dispose).toHaveBeenCalledTimes(1)

    await act(async () =>
      renderer!.update(
        createElement(TerrainGpu, {
          ...input.props,
          data: { ...input.props.data },
          view: { ...input.props.view, width: 900 },
        }),
      ),
    )
    await act(async () => renderer!.unmount())
    renderer = undefined
    expect(createTerrainGpu).toHaveBeenCalledTimes(1)
    expect(gpu.setData).toHaveBeenCalledTimes(1)
    expect(gpu.setView).not.toHaveBeenCalled()
    expect(gpu.dispose).toHaveBeenCalledTimes(1)
  })

  it.each(['setData', 'setView'] as const)('clears the renderer after a later %s failure', async (method) => {
    const input = fixture()
    const gpu = gpuStub()
    createTerrainGpu.mockReturnValue(gpu)
    await mount(input)
    await act(async () => createTerrainGpu.mock.calls[0][1]('webgl'))
    gpu[method].mockImplementationOnce(() => {
      throw Error('Updated scene is unavailable')
    })

    await act(async () =>
      renderer!.update(
        createElement(TerrainGpu, {
          ...input.props,
          data: { ...input.props.data, colour: 'elevation' },
          view: { ...input.props.view, width: 900 },
        }),
      ),
    )

    expect(input.props.onStatus).toHaveBeenLastCalledWith('canvas', 'Updated scene is unavailable')
    expect(input.props.handle.current).toBeNull()
    expect(input.canvas.style.visibility).toBe('hidden')
    expect(gpu.dispose).toHaveBeenCalledTimes(1)
    await act(async () => renderer!.unmount())
    renderer = undefined
    expect(gpu.dispose).toHaveBeenCalledTimes(1)
  })

  it('reuses the context across updates and recovery, then releases it on unmount', async () => {
    const input = fixture()
    const gpu = gpuStub()
    createTerrainGpu.mockReturnValue(gpu)
    await mount(input)
    const status = createTerrainGpu.mock.calls[0][1]
    await act(async () => status('webgl'))
    expect(input.props.handle.current).toBe(gpu)

    const nextData: TerrainGpuData = { ...input.props.data, colour: 'elevation' }
    const nextView: TerrainGpuView = { ...input.props.view, width: 1200, height: 800, quality: 'high' }
    const onStatus = vi.fn()
    await act(async () =>
      renderer!.update(
        createElement(TerrainGpu, {
          ...input.props,
          data: nextData,
          view: nextView,
          projectionKey: 'resize',
          onStatus,
        }),
      ),
    )

    expect(createTerrainGpu).toHaveBeenCalledTimes(1)
    expect(gpu.setData).toHaveBeenCalledTimes(2)
    expect(gpu.setData).toHaveBeenLastCalledWith(nextData)
    expect(gpu.setView).toHaveBeenCalledTimes(2)
    expect(gpu.setView).toHaveBeenLastCalledWith(nextView)
    expect(gpu.dispose).not.toHaveBeenCalled()
    expect(renderer!.root.findByType('canvas').props.style).toEqual({ width: 1200, height: 800 })

    // Context loss is recoverable: retain the instance and forward its status to the latest callback.
    await act(async () => status('canvas', 'Context was lost'))
    expect(onStatus).toHaveBeenLastCalledWith('canvas', 'Context was lost')
    expect(input.props.handle.current).toBe(gpu)
    expect(gpu.dispose).not.toHaveBeenCalled()
    await act(async () => status('webgl'))
    expect(onStatus).toHaveBeenLastCalledWith('webgl', undefined)

    await act(async () => renderer!.unmount())
    renderer = undefined
    expect(input.props.handle.current).toBeNull()
    expect(gpu.dispose).toHaveBeenCalledTimes(1)
  })

  it('hands a slope texture to the renderer without rebuilding the scene', async () => {
    const input = fixture()
    const gpu = gpuStub()
    createTerrainGpu.mockReturnValue(gpu)
    const texture: TerrainSlopeTexture = {
      width: 1,
      height: 1,
      rgba: new Uint8Array([10, 20, 30, 255]),
      bounds: [0, 0, 1, 1],
      texelM: 1,
    }
    await act(async () => {
      renderer = create(createElement(TerrainGpu, { ...input.props, groundTexture: texture }), {
        createNodeMock: (element) => (element.type === 'canvas' ? input.canvas : null),
      })
      await vi.dynamicImportSettled()
    })
    // A renderer created after the texture was baked takes it straight away.
    expect(gpu.setGroundTexture).toHaveBeenLastCalledWith(texture)
    const builds = gpu.setData.mock.calls.length
    await act(async () => renderer!.update(createElement(TerrainGpu, { ...input.props, groundTexture: null })))
    expect(gpu.setGroundTexture).toHaveBeenLastCalledWith(null)
    expect(gpu.setData).toHaveBeenCalledTimes(builds)
  })
})
