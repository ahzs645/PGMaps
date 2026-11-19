/** Lazy WebGL2 presentation of the existing engineering scene. No terrain fetches or calculations. */
import * as THREE from 'three'
import type { TerrainFace } from './TerrainGround'
import { terrainElevationColor, terrainSlopeColor } from './terrainDisplay'
import { TERRAIN_SHARPEN_DELAY_MS, terrainRenderSize } from './terrainRenderQuality'
import { prepareTerrainGpuTexture } from './terrainGpuTexture'
import type { TerrainGpuData, TerrainGpuHandle, TerrainGpuView } from './terrainGpuTypes'

/** Smooth only natural ground. Design triangles keep their exact coordinates and hard breaklines. */
function groundGeometry(data: TerrainGpuData) {
  const vertices = new Map<string, number>()
  const positions: number[] = [],
    indices: number[] = [],
    estimated: number[] = []
  for (const face of data.ground) {
    const ids = face.vertices.map((v) => {
      const key = `${v.x}:${v.y}:${v.z}:${face.estimated ? 1 : 0}`
      const existing = vertices.get(key)
      if (existing !== undefined) return existing
      const index = positions.length / 3
      vertices.set(key, index)
      positions.push(v.x, v.y, v.z - data.originZ)
      estimated.push(face.estimated ? 1 : 0)
      return index
    })
    for (let i = 1; i + 1 < ids.length; i++) {
      const a = face.vertices[0],
        b = face.vertices[i],
        c = face.vertices[i + 1]
      if ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) < 0) indices.push(ids[0], ids[i + 1], ids[i])
      else indices.push(ids[0], ids[i], ids[i + 1])
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  const normal = geometry.getAttribute('normal')
  const colors = new Float32Array(positions.length)
  const uv = data.ortho && data.imagePoint ? new Float32Array((positions.length / 3) * 2) : null
  const color = new THREE.Color()
  for (let i = 0; i < positions.length / 3; i++) {
    const slope = (Math.atan2(Math.hypot(normal.getX(i), normal.getY(i)), Math.abs(normal.getZ(i))) * 180) / Math.PI
    const rgb =
      data.colour === 'slope'
        ? terrainSlopeColor(slope)
        : data.colour === 'elevation'
          ? terrainElevationColor(positions[i * 3 + 2] + data.originZ, data.low, data.high)
          : data.colour === 'ortho'
            ? [255, 255, 255]
            : [151, 170, 137]
    color.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace)
    if (estimated[i]) color.lerp(new THREE.Color('#d6b783'), 0.3)
    color.toArray(colors, i * 3)
    if (uv) {
      const [u, v] = data.imagePoint!(positions[i * 3], positions[i * 3 + 1])
      uv[i * 2] = u
      uv[i * 2 + 1] = v
    }
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  if (uv) geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  return geometry
}

function facesGeometry(faces: TerrainFace[], originZ: number) {
  const positions: number[] = [],
    colors: number[] = [],
    stations: number[] = []
  const color = new THREE.Color()
  for (const face of faces) {
    color.set(face.fill || '#b5916a')
    for (let i = 1; i + 1 < face.vertices.length; i++)
      for (const v of [face.vertices[0], face.vertices[i], face.vertices[i + 1]]) {
        positions.push(v.x, v.y, v.z - originZ)
        colors.push(color.r, color.g, color.b)
        stations.push(face.station ?? NaN)
      }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setAttribute('station', new THREE.Float32BufferAttribute(stations, 1))
  geometry.computeVertexNormals()
  return geometry
}

function release(group: THREE.Group) {
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) return
    object.geometry.dispose()
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if ('map' in material && material.map instanceof THREE.Texture) material.map.dispose()
      material.dispose()
    }
  })
  group.clear()
}

/** The same perspective as previewCamera: labels, pointer-anchored zoom and GPU picking agree. */
export function setTerrainGpuCamera(camera: THREE.PerspectiveCamera, view: TerrainGpuView, originZ: number) {
  const { camera: source, angle, tilt, exaggeration, width, height } = view
  const right = new THREE.Vector3(Math.cos(angle), -Math.sin(angle), 0)
  const up = new THREE.Vector3(Math.sin(angle) * Math.sin(tilt), Math.cos(angle) * Math.sin(tilt), Math.cos(tilt))
  const back = new THREE.Vector3(-Math.sin(angle) * Math.cos(tilt), -Math.cos(angle) * Math.cos(tilt), Math.sin(tilt))
  const eye = new THREE.Vector3(
    source.focus.x,
    source.focus.y,
    (source.focus.z - originZ) * exaggeration,
  ).addScaledVector(back, source.cameraDistance)
  camera.matrixAutoUpdate = false
  camera.matrixWorld.makeBasis(right, up, back).setPosition(eye)
  camera.matrix.copy(camera.matrixWorld)
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert()
  const near = Math.max(0.01, source.cameraDistance / 10000)
  const far = source.cameraDistance * 8
  const focal = (2 * source.scale * source.cameraDistance) / Math.max(1, height)
  const offsetX = (2 * source.anchor.x) / Math.max(1, width) - 1
  const offsetY = 1 - (2 * source.anchor.y) / Math.max(1, height)
  camera.projectionMatrix.set(
    (focal * height) / Math.max(1, width),
    0,
    -offsetX,
    0,
    0,
    focal,
    -offsetY,
    0,
    0,
    0,
    -(far + near) / (far - near),
    (-2 * far * near) / (far - near),
    0,
    0,
    -1,
    0,
  )
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
}

export function createTerrainGpu(
  canvas: HTMLCanvasElement,
  onStatus: (status: 'webgl' | 'canvas', reason?: string) => void,
): TerrainGpuHandle {
  const context = canvas.getContext('webgl2', { alpha: true, antialias: true, powerPreference: 'high-performance' })
  if (!context) throw Error('This browser cannot create an accelerated 3D view. Using the canvas preview.')
  const renderer = new THREE.WebGLRenderer({ canvas, context, alpha: true, antialias: true })
  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.localClippingEnabled = true
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera()
  const group = new THREE.Group()
  scene.add(group)
  scene.add(new THREE.AmbientLight(0xffffff, 1.5))
  const sun = new THREE.DirectionalLight(0xffffff, 2.2)
  sun.position.set(-0.35, -0.45, 0.82)
  scene.add(sun)
  let data: TerrainGpuData | undefined, view: TerrainGpuView | undefined
  let disposed = false,
    lost = false,
    ready = false,
    moving = false
  let frame = 0,
    sharpen: ReturnType<typeof setTimeout> | undefined
  let draws = 0,
    revision = 0
  let cameraKey = ''
  let ground: THREE.Mesh | undefined, road: THREE.Mesh | undefined, earthwork: THREE.Mesh | undefined
  const pickables: THREE.Object3D[] = []
  const culverts = new Map<string, THREE.Mesh>()
  const materials: THREE.Material[] = []
  const raycaster = new THREE.Raycaster()

  const invalidate = () => {
    if (disposed || lost || frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (disposed || lost || !data || !view) return
      try {
        const size = terrainRenderSize({
          width: view.width,
          height: view.height,
          devicePixelRatio: window.devicePixelRatio || 1,
          quality: view.quality,
          moving,
          maxDimension: renderer.capabilities.maxTextureSize,
        })
        if (canvas.width !== size.width || canvas.height !== size.height)
          renderer.setSize(size.width, size.height, false)
        setTerrainGpuCamera(camera, view, data.originZ)
        group.scale.z = view.exaggeration
        group.updateMatrixWorld(true)
        const bounds = view.bounds
        const clipping = [
          new THREE.Plane(new THREE.Vector3(1, 0, 0), -bounds[0]),
          new THREE.Plane(new THREE.Vector3(-1, 0, 0), bounds[2]),
          new THREE.Plane(new THREE.Vector3(0, 1, 0), -bounds[1]),
          new THREE.Plane(new THREE.Vector3(0, -1, 0), bounds[3]),
        ]
        if (view.cutaway) {
          const { point, normal } = view.cutaway
          clipping.push(
            new THREE.Plane(new THREE.Vector3(normal[0], normal[1], 0), -point.x * normal[0] - point.y * normal[1]),
          )
        }
        for (const material of materials) {
          material.clippingPlanes = clipping
          if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshBasicMaterial)
            material.wireframe = view.wireframe
        }
        if (earthwork) earthwork.visible = view.showEarthwork
        if (road) road.visible = true
        // X-ray exposes buried structures without altering the terrain or their actual positions.
        if (ground && ground.material instanceof THREE.MeshStandardMaterial) {
          if (ground.material.transparent !== view.xray) ground.material.needsUpdate = true
          ground.material.transparent = view.xray
          ground.material.opacity = view.xray ? 0.35 : 1
          ground.material.depthWrite = !view.xray
        }
        for (const [id, mesh] of culverts) {
          const material = mesh.material as THREE.MeshStandardMaterial
          material.depthTest = !view.xray
          material.color.set(id === view.selectedCulvertId ? '#e11d48' : '#60a5fa')
          mesh.renderOrder = view.xray ? 20 : 0
        }
        renderer.render(scene, camera)
        canvas.dataset.renderCount = String(++draws)
        canvas.dataset.triangleCount = String(renderer.info.render.triangles)
        canvas.dataset.drawCalls = String(renderer.info.render.calls)
        canvas.dataset.pixelRatio = size.pixelRatio.toFixed(3)
        canvas.dataset.geometryRevision = String(revision)
        canvas.dataset.moving = String(moving)
        canvas.style.visibility = 'visible'
        if (!ready) {
          ready = true
          onStatus('webgl')
        }
      } catch (error) {
        ready = false
        canvas.style.visibility = 'hidden'
        onStatus('canvas', error instanceof Error ? error.message : 'The accelerated scene could not be drawn.')
      }
    })
  }
  const onLost = (event: Event) => {
    event.preventDefault()
    lost = true
    ready = false
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    canvas.style.visibility = 'hidden'
    onStatus('canvas', '3D acceleration was interrupted. The canvas preview remains available while it recovers.')
  }
  const onRestored = () => {
    lost = false
    invalidate()
  }
  canvas.addEventListener('webglcontextlost', onLost)
  canvas.addEventListener('webglcontextrestored', onRestored)
  const onVisibility = () => {
    if (!document.hidden) invalidate()
  }
  document.addEventListener('visibilitychange', onVisibility)

  const addMesh = (geometry: THREE.BufferGeometry, material: THREE.MeshStandardMaterial) => {
    const mesh = new THREE.Mesh(geometry, material)
    material.side = THREE.DoubleSide
    group.add(mesh)
    materials.push(material)
    return mesh
  }
  return {
    setData(next) {
      if (disposed || data === next) return
      data = next
      release(group)
      pickables.length = 0
      materials.length = 0
      culverts.clear()
      ground = addMesh(
        groundGeometry(next),
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }),
      )
      if (next.ortho && next.imagePoint) {
        const ortho = prepareTerrainGpuTexture(next.ortho, renderer.capabilities.maxTextureSize)
        const texture = new THREE.DataTexture(Uint8Array.from(ortho.rgba), ortho.width, ortho.height, THREE.RGBAFormat)
        texture.colorSpace = THREE.SRGBColorSpace
        texture.magFilter = THREE.LinearFilter
        texture.minFilter = THREE.LinearMipmapLinearFilter
        texture.generateMipmaps = true
        texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
        texture.needsUpdate = true
        // Preserve transparent/no-data pixels and do not stretch the edge of a photo outside its footprint.
        const material = ground.material as THREE.MeshStandardMaterial
        material.map = texture
        material.onBeforeCompile = (shader) => {
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <map_fragment>',
            `
            #ifdef USE_MAP
              vec4 image = texture2D(map, vMapUv);
              float covered = step(0.0, vMapUv.x) * step(vMapUv.x, 1.0) * step(0.0, vMapUv.y) * step(vMapUv.y, 1.0);
              diffuseColor.rgb *= mix(vec3(0.52, 0.61, 0.46), image.rgb, image.a * covered * ${ortho.opacity.toFixed(5)});
            #endif
          `,
          )
        }
        material.customProgramCacheKey = () => `terrain-ortho-${ortho.opacity}`
      }
      if (next.design?.indices.length) {
        const geometry = new THREE.BufferGeometry()
        const positions = next.design.positions.slice()
        for (let i = 2; i < positions.length; i += 3) positions[i] -= next.originZ
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
        geometry.setIndex(new THREE.BufferAttribute(next.design.indices, 1))
        geometry.computeVertexNormals()
        road = addMesh(
          geometry,
          new THREE.MeshStandardMaterial({
            color: next.design.kind === 'finished' ? '#c5bda7' : '#bd956b',
            flatShading: true,
            roughness: 1,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
          }),
        )
      } else
        road = addMesh(
          facesGeometry(next.road, next.originZ),
          new THREE.MeshStandardMaterial({
            vertexColors: true,
            flatShading: true,
            roughness: 1,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
          }),
        )
      road.userData.road = true
      pickables.push(ground, road)
      earthwork = addMesh(
        facesGeometry(next.design ? [] : next.earthwork, next.originZ),
        new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }),
      )
      earthwork.userData.road = true
      pickables.push(earthwork)
      const linePositions: number[] = [],
        lineColors: number[] = []
      const color = new THREE.Color()
      for (const line of next.lines) {
        color.set(line.color)
        for (const p of [line.a, line.b]) {
          linePositions.push(p.x, p.y, p.z - next.originZ + 0.03)
          lineColors.push(color.r, color.g, color.b)
        }
      }
      const lineGeometry = new THREE.BufferGeometry()
      lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3))
      lineGeometry.setAttribute('color', new THREE.Float32BufferAttribute(lineColors, 3))
      const lineMaterial = new THREE.LineBasicMaterial({ vertexColors: true })
      materials.push(lineMaterial)
      group.add(new THREE.LineSegments(lineGeometry, lineMaterial))
      for (const culvert of next.culverts) {
        const mesh = addMesh(
          facesGeometry(culvert.faces, next.originZ),
          new THREE.MeshStandardMaterial({ color: '#60a5fa', roughness: 0.7, metalness: 0.15 }),
        )
        mesh.userData.culvertId = culvert.id
        mesh.userData.station = culvert.station
        pickables.push(mesh)
        culverts.set(culvert.id, mesh)
      }
      revision++
      invalidate()
    },
    setView(next) {
      if (disposed) return
      view = next
      const key = JSON.stringify([
        next.camera.focus,
        next.camera.scale,
        next.angle,
        next.tilt,
        next.width,
        next.height,
        next.exaggeration,
      ])
      if (key !== cameraKey) {
        moving = !!cameraKey
        cameraKey = key
        if (sharpen) clearTimeout(sharpen)
        if (moving)
          sharpen = setTimeout(() => {
            moving = false
            invalidate()
          }, TERRAIN_SHARPEN_DELAY_MS)
      }
      invalidate()
    },
    pick(x, y) {
      if (!data || !view || lost || !ready) return null
      raycaster.setFromCamera(new THREE.Vector2((x / view.width) * 2 - 1, 1 - (y / view.height) * 2), camera)
      const hits = raycaster.intersectObjects(pickables, false)
      if (view.xray) hits.sort((a, b) => Number(!!b.object.userData.culvertId) - Number(!!a.object.userData.culvertId))
      for (const hit of hits) {
        const p = hit.point
        const b = view.bounds
        if (p.x < b[0] || p.x > b[2] || p.y < b[1] || p.y > b[3]) continue
        if (
          view.cutaway &&
          (p.x - view.cutaway.point.x) * view.cutaway.normal[0] +
            (p.y - view.cutaway.point.y) * view.cutaway.normal[1] <
            0
        )
          continue
        if (hit.object === ground) {
          if (view.xray) continue
          return null
        }
        if (hit.object === earthwork && !view.showEarthwork) continue
        if (hit.object.userData.culvertId)
          return { station: hit.object.userData.station, culvertId: hit.object.userData.culvertId }
        let nearest: TerrainGpuData['stations'][number] | undefined,
          distance = Infinity
        for (const station of data.stations) {
          const d = (p.x - station.x) ** 2 + (p.y - station.y) ** 2
          if (d < distance) {
            distance = d
            nearest = station
          }
        }
        return nearest ? { station: nearest.station } : null
      }
      return null
    },
    dispose() {
      if (disposed) return
      disposed = true
      if (frame) cancelAnimationFrame(frame)
      if (sharpen) clearTimeout(sharpen)
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      document.removeEventListener('visibilitychange', onVisibility)
      release(group)
      renderer.dispose()
      // Release the context on a real unmount; fullscreen/resize never disposes the renderer.
      renderer.forceContextLoss()
    },
  }
}
