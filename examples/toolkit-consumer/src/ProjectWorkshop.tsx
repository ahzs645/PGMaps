import { useMemo, useState } from 'react'
import { Map, MapFillLayer } from '@pgmaps/geo-toolkit/map'
import { SceneStoryRenderer } from '@pgmaps/geo-toolkit/stories/SceneStoryRenderer'
import {
  createProjectCodec,
  createMemoryProjectRepository,
  createWebStorageProjectRepository,
  exportProject,
  downloadProjectJson,
  importProjectFile,
  type ProjectRepository,
  type ProjectExportPort,
} from '@pgmaps/geo-toolkit/projects/projectRepository'
import { WorkspaceProvider } from '@pgmaps/geo-toolkit/workspace'
import { calculateIndex, districtGeometry, gridGeometry } from './data'
import { initialProject, type AtlasProject } from './sceneProject'
import { styles } from './mapStyles'
import { MapReadyState } from './MapReadyState'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
// The host owns its saved-project schema. Both repositories and JSON transport
// use the same injected validation; neither knows about PG Maps catalogs.
const codec = createProjectCodec(
  (value: unknown): AtlasProject => {
    if (
      !isRecord(value) ||
      typeof value.id !== 'string' ||
      !value.id ||
      typeof value.title !== 'string' ||
      typeof value.summary !== 'string' ||
      !Array.isArray(value.scenes) ||
      !value.scenes.length ||
      !Array.isArray(value.layers)
    )
      throw new Error('Expected an atlas project.')
    const layerIds = new Set(
      value.layers.map((layer) => {
        if (
          !isRecord(layer) ||
          typeof layer.id !== 'string' ||
          !['local:districts', 'local:habitats'].includes(String(layer.data)) ||
          ['idProperty', 'labelProperty', 'fillColor', 'lineColor'].some((key) => typeof layer[key] !== 'string') ||
          ['fillOpacity', 'lineOpacity', 'lineWidth'].some(
            (key) => typeof layer[key] !== 'number' || !Number.isFinite(layer[key]),
          )
        )
          throw new Error('Expected a supported local atlas layer.')
        if (
          layer.category !== undefined &&
          (!isRecord(layer.category) ||
            typeof layer.category.property !== 'string' ||
            !isRecord(layer.category.colors) ||
            Object.values(layer.category.colors).some((color) => typeof color !== 'string') ||
            typeof layer.category.fallback !== 'string')
        )
          throw new Error('Expected a valid category palette.')
        return layer.id
      }),
    )
    if (layerIds.size !== value.layers.length) throw new Error('Layer IDs must be unique.')
    for (const scene of value.scenes) {
      if (
        !isRecord(scene) ||
        ['label', 'title', 'text', 'focus'].some((key) => typeof scene[key] !== 'string') ||
        !Array.isArray(scene.visibleLayerIds) ||
        scene.visibleLayerIds.some((id) => typeof id !== 'string' || !layerIds.has(id))
      )
        throw new Error('Expected a valid atlas scene.')
      if (
        scene.camera !== undefined &&
        (!isRecord(scene.camera) ||
          !Array.isArray(scene.camera.center) ||
          scene.camera.center.length !== 2 ||
          scene.camera.center.some((coordinate) => typeof coordinate !== 'number' || !Number.isFinite(coordinate)) ||
          typeof scene.camera.zoom !== 'number' ||
          !Number.isFinite(scene.camera.zoom))
      )
        throw new Error('Expected a valid scene camera.')
    }
    return JSON.parse(JSON.stringify(value)) as AtlasProject
  },
  { id: (project) => project.id },
)

const memoryRepository = createMemoryProjectRepository(codec)
const browserExport: ProjectExportPort = {
  async write(artifact) {
    downloadProjectJson(artifact)
  },
}
const geometry = districtGeometry(calculateIndex(60))

/** The host can inject a remote repository and a different export transport. */
export function ProjectWorkshop({
  repository,
  exportPort = browserExport,
}: {
  repository: ProjectRepository<AtlasProject>
  exportPort?: ProjectExportPort
}) {
  const [project, setProject] = useState(initialProject)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [cameras] = useState(
    () => new globalThis.Map<string, { center: [number, number]; zoom: number; bearing: number; pitch: number }>(),
  )
  const run = async (operation: () => Promise<string>) => {
    setBusy(true)
    try {
      setMessage(await operation())
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The operation failed.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div>
      <label className="project-title-label">
        Project title
        <input value={project.title} onChange={(event) => setProject({ ...project, title: event.target.value })} />
      </label>
      <div className="example-actions">
        <button
          className="inspect-button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await repository.save(project)
              return 'Project saved.'
            })
          }
        >
          Save project
        </button>
        <button
          className="inspect-button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const saved = await repository.get(project.id)
              if (!saved) return 'No saved project was found.'
              setProject(saved)
              return 'Saved project loaded.'
            })
          }
        >
          Load saved project
        </button>
        <button
          className="inspect-button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await exportProject(project, codec, exportPort)
              return 'Project exported as JSON.'
            })
          }
        >
          Export project JSON
        </button>
        <label className="import-project">
          Import project JSON
          <input
            type="file"
            accept="application/json,.json"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file)
                void run(async () => {
                  setProject(await importProjectFile(file, codec, repository))
                  return 'Project imported and saved.'
                })
              event.currentTarget.value = ''
            }}
          />
        </label>
      </div>
      <p role="status" data-testid="project-status">
        {message}
      </p>
      <div className="workspace-frame project-frame" data-testid="project-workspace">
        <WorkspaceProvider theme="light">
          <SceneStoryRenderer
            title={project.title}
            summary={project.summary}
            scenes={project.scenes}
            layers={project.layers}
            options={{ layout: 'panel', mobileSheet: 'half', sceneTransition: 'jump', cameraFit: 'off' }}
            renderMap={(state) => (
              <Map
                theme="light"
                styles={styles}
                viewport={state.camera}
                onViewportChange={(camera) => {
                  cameras.set(project.id, camera)
                }}
                center={[-2.75, 50.95]}
                zoom={6.2}
                controls={null}
                loader="spinner"
                attributionControl={false}
              >
                {state.resolvedLayers.map((resolved) => (
                  <MapFillLayer
                    key={resolved.layer.id}
                    data={resolved.layer.data === 'local:districts' ? geometry : gridGeometry}
                    visible={state.visibleLayerIds.has(resolved.layer.id)}
                    fillColor={resolved.fillColor}
                    fillOpacity={resolved.fillOpacity}
                    lineColor={resolved.lineColor}
                    lineWidth={resolved.lineWidth}
                  />
                ))}
                <MapReadyState />
              </Map>
            )}
          />
        </WorkspaceProvider>
      </div>
    </div>
  )
}

export function ProjectExperience() {
  const [storage, setStorage] = useState('memory')
  const browserRepository = useMemo(
    () => createWebStorageProjectRepository(codec, window.localStorage, 'willow-bay:projects'),
    [],
  )
  return (
    <section className="example-section" aria-labelledby="project-heading">
      <h2 id="project-heading">Create a scene project</h2>
      <p>Navigate the scenes, save a named project, or take its definition to another website.</p>
      <label>
        Save projects to{' '}
        <select aria-label="Project storage" value={storage} onChange={(event) => setStorage(event.target.value)}>
          <option value="memory">This session</option>
          <option value="browser">This browser</option>
        </select>
      </label>
      <ProjectWorkshop repository={storage === 'memory' ? memoryRepository : browserRepository} />
    </section>
  )
}
