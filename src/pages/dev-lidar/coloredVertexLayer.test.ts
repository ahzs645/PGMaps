import type { CustomLayerInterface, Map } from 'maplibre-gl'
import { describe, expect, it, vi } from 'vitest'
import { coloredVertexLayer } from './coloredVertexLayer'

function context() {
  let id = 0
  const calls = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    ARRAY_BUFFER: 5,
    STATIC_DRAW: 6,
    FLOAT: 7,
    DEPTH_TEST: 8,
    LEQUAL: 9,
    BLEND: 10,
    CULL_FACE: 11,
    TRIANGLES: 12,
    POINTS: 13,
    createShader: vi.fn(() => ({ id: ++id })),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => 'compile failed'),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({ id: ++id })),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    getProgramInfoLog: vi.fn(() => 'link failed'),
    deleteProgram: vi.fn(),
    createVertexArray: vi.fn(() => ({ id: ++id })),
    createBuffer: vi.fn(() => ({ id: ++id })),
    deleteBuffer: vi.fn(),
    deleteVertexArray: vi.fn(),
    bindVertexArray: vi.fn(),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    getAttribLocation: vi.fn((_program: unknown, name: string) => (name === 'position' ? 0 : 1)),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    getUniformLocation: vi.fn(() => ({ id: ++id })),
    useProgram: vi.fn(),
    uniformMatrix4fv: vi.fn(),
    enable: vi.fn(),
    depthFunc: vi.fn(),
    depthMask: vi.fn(),
    disable: vi.fn(),
    drawArrays: vi.fn(),
  }
  return { calls, gl: calls as unknown as WebGL2RenderingContext }
}
const vertices = new Float32Array(18)
const layer = (primitive: 'triangles' | 'points') =>
  coloredVertexLayer({
    id: 'test-layer',
    origin: [0.3, 0.4, 0],
    vertices,
    primitive,
    vertexShader: 'vertex source',
    fragmentShader: 'fragment source',
  })
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const args = (matrix?: number[], modern = false) =>
  (modern
    ? { defaultProjectionData: { mainMatrix: matrix } }
    : { modelViewProjectionMatrix: matrix }) as unknown as Parameters<CustomLayerInterface['render']>[1]

describe('LiDAR colored vertex layer lifetime', () => {
  it.each(['triangles', 'points'] as const)(
    'draws %s with the original interleaving and local-origin projection',
    (primitive) => {
      const { gl, calls } = context(),
        item = layer(primitive)
      item.onAdd?.({} as Map, gl)
      expect(calls.bufferData).toHaveBeenCalledWith(calls.ARRAY_BUFFER, vertices, calls.STATIC_DRAW)
      expect(calls.vertexAttribPointer.mock.calls).toEqual([
        [0, 3, calls.FLOAT, false, 24, 0],
        [1, 3, calls.FLOAT, false, 24, 12],
      ])
      item.render(gl, args(identity, true))
      expect(calls.uniformMatrix4fv).toHaveBeenCalledWith(
        expect.anything(),
        false,
        new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, Math.fround(0.3), Math.fround(0.4), 0, 1]),
      )
      expect(calls.drawArrays).toHaveBeenCalledWith(primitive === 'triangles' ? calls.TRIANGLES : calls.POINTS, 0, 3)
      item.render(gl, args(identity))
      expect(calls.drawArrays).toHaveBeenCalledTimes(2)
      item.onRemove?.({} as Map, gl)
      item.onRemove?.({} as Map, gl)
      expect(calls.deleteShader).toHaveBeenCalledTimes(2)
      expect(calls.deleteProgram).toHaveBeenCalledTimes(1)
      expect(calls.deleteBuffer).toHaveBeenCalledTimes(1)
      expect(calls.deleteVertexArray).toHaveBeenCalledTimes(1)
      item.render(gl, args(identity))
      expect(calls.drawArrays).toHaveBeenCalledTimes(2)
    },
  )

  it('does not draw before setup or when neither projection matrix is available', () => {
    const { gl, calls } = context(),
      item = layer('triangles')
    item.render(gl, args(identity))
    item.onAdd?.({} as Map, gl)
    item.render(gl, args())
    expect(calls.drawArrays).not.toHaveBeenCalled()
  })

  it('releases already-created shaders when the second shader fails to compile', () => {
    const { gl, calls } = context(),
      item = layer('points')
    calls.getShaderParameter.mockReturnValueOnce(true).mockReturnValueOnce(false)
    expect(() => item.onAdd?.({} as Map, gl)).toThrow('compile failed')
    expect(calls.deleteShader).toHaveBeenCalledTimes(2)
    expect(calls.createProgram).not.toHaveBeenCalled()
  })

  it('releases a failed program and its shaders when linking fails', () => {
    const { gl, calls } = context(),
      item = layer('triangles')
    calls.getProgramParameter.mockReturnValue(false)
    expect(() => item.onAdd?.({} as Map, gl)).toThrow('link failed')
    expect(calls.deleteShader).toHaveBeenCalledTimes(2)
    expect(calls.deleteProgram).toHaveBeenCalledTimes(1)
    item.onRemove?.({} as Map, gl)
    expect(calls.deleteProgram).toHaveBeenCalledTimes(1)
  })
})
