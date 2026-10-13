import { importWorkspace, type Workspace } from './workspace'
export type ProjectRead = (path: string, params: Record<string, string>, signal?: AbortSignal) => Promise<unknown>
export type LocalProject = {
  id: string
  name: string
  updatedAt: string
  workspace: Workspace
  history: { savedAt: string; workspace: Workspace }[]
}
export type LocalProjectLibrary = { schema: 'nechako-local-projects-v1'; projects: LocalProject[]; defaultId?: string }
export const PROJECT_LIBRARY_KEY = 'pgmaps.nechako.projects.v1'
export function checkedProjectLibrary(input: unknown): LocalProjectLibrary {
  const library = input as LocalProjectLibrary
  if (
    library?.schema !== 'nechako-local-projects-v1' ||
    !Array.isArray(library.projects) ||
    library.projects.length > 100
  )
    throw new Error('Invalid local project library.')
  const ids = new Set<string>()
  const projects = library.projects.map((project) => {
    if (
      !project.id ||
      ids.has(project.id) ||
      typeof project.name !== 'string' ||
      !project.name.trim() ||
      !Array.isArray(project.history) ||
      project.history.length > 20
    )
      throw new Error('Invalid local project metadata.')
    ids.add(project.id)
    return {
      ...project,
      workspace: importWorkspace(project.workspace),
      history: project.history.map((item) => ({ ...item, workspace: importWorkspace(item.workspace) })),
    }
  })
  if (library.defaultId && !ids.has(library.defaultId)) throw new Error('The default project is missing.')
  return { ...library, projects }
}
export function saveLocalProject(
  library: LocalProjectLibrary,
  workspace: Workspace,
  name: string,
  id: string,
  now: string,
): LocalProjectLibrary {
  const cleanName = name.trim()
  if (!cleanName || cleanName.length > 200) throw new Error('Enter a project name of 1–200 characters.')
  if (library.projects.some((project) => project.name === cleanName && project.id !== id))
    throw new Error('A local project already has that name.')
  const previous = library.projects.find((project) => project.id === id)
  const project: LocalProject = {
    id,
    name: cleanName,
    updatedAt: now,
    workspace: importWorkspace(workspace),
    history: previous
      ? [{ savedAt: previous.updatedAt, workspace: previous.workspace }, ...previous.history].slice(0, 20)
      : [],
  }
  return checkedProjectLibrary({
    ...library,
    projects: previous
      ? library.projects.map((item) => (item.id === id ? project : item))
      : [...library.projects, project],
  })
}
export function checkedNativeProjects(input: unknown): {
  uid: string
  projects: { id: string; name: string; creatorId: string }[]
} {
  const data = input as { uid: string | number; projects: Record<string, unknown>[] }
  if (!data || !Array.isArray(data.projects) || !/^(?:-1|\d+)$/.test(String(data.uid)))
    throw new Error('Invalid native project catalogue.')
  return {
    uid: String(data.uid),
    projects: data.projects.map((project) => {
      if (!/^\d+$/.test(String(project.project_id)) || typeof project.project_name !== 'string')
        throw new Error('Invalid native project entry.')
      return { id: String(project.project_id), name: project.project_name, creatorId: String(project.creator_id) }
    }),
  }
}
export function latestNativeHistory(input: unknown): string | undefined {
  const data = input as { mostRecentHistoryRec?: { history_id?: unknown } }
  const id = data?.mostRecentHistoryRec?.history_id
  return id !== undefined && /^\d+$/.test(String(id)) ? String(id) : undefined
}
export type ProjectMutation = { path: string; params: Record<string, string>; summary: string }
/** Preserve unsupported source layers; patch supported native camera/visibility/style without guessing a native vector serializer. */
export function nativeProjectSave(workspace: Workspace): { projectJson: string; retainedUnsupported: number } {
  const original = workspace.originalProject as
    | { attributes?: Record<string, unknown>; layers?: Record<string, unknown>[] }
    | undefined
  const source = (original?.attributes ?? original) as { layers?: Record<string, unknown>[] } | undefined
  if (!Array.isArray(source?.layers))
    throw new Error(
      'Load an original portal project first. New PGMaps-only sources and vector edits cannot yet be serialized into the native project format.',
    )
  const imported = importWorkspace(workspace.originalProject)
  const currentItems = [...workspace.layers, ...workspace.tiles, ...workspace.vectors]
  const originalItems = [...imported.layers, ...imported.tiles, ...imported.vectors]
  if (
    currentItems.length !== originalItems.length ||
    currentItems.some((item) => !originalItems.some((originalItem) => originalItem.id === item.id))
  )
    throw new Error('Source additions/removals need native serialization. Export this browser workspace instead.')
  for (const vector of workspace.vectors) {
    const previous = imported.vectors.find((item) => item.id === vector.id)
    if (
      JSON.stringify(vector.data) !== JSON.stringify(previous?.data) ||
      vector.categories ||
      vector.color !== previous?.color ||
      vector.pointRadius !== previous?.pointRadius ||
      vector.lineWidth !== previous?.lineWidth ||
      vector.fillOpacity !== previous?.fillOpacity
    )
      throw new Error(
        'Edited vector geometry and PGMaps styling cannot yet be written into native layerData. Export this browser workspace instead.',
      )
  }
  let retainedUnsupported = 0
  const layers = source.layers.map((layer, index) => {
    const id = `native-${index}`
    const current = currentItems.find((item) => item.id === id)
    if (!current) {
      retainedUnsupported++
      return layer
    }
    const result: Record<string, unknown> = { ...layer, checked: current.visible !== false }
    if ('source' in current) {
      const params: Record<string, unknown> = { ...(layer.params as Record<string, unknown>), STYLES: current.style }
      const url = new URL(current.source.resource)
      if (current.native) {
        if (
          url.origin !== 'https://nechakowatershed-portal.ca' ||
          url.pathname !== '/cgi-bin/mapserv' ||
          !url.searchParams.get('map')
        )
          throw new Error('Native mapfile writes require a verified original portal MapServer reference.')
        result.mapfile = url.searchParams.get('map')
        result.mapfileName = current.layer.name
        if (url.searchParams.has('SLD')) result.portalSld = url.searchParams.get('SLD')
        else if (
          new URL(imported.layers.find((item) => item.id === current.id)!.source.resource).searchParams.has('SLD')
        )
          delete result.portalSld
      }
      for (const key of ['MAP', 'SLD', 'SLD_BODY', 'FILTER', 'CQL_FILTER']) {
        if (url.searchParams.has(key)) params[key] = url.searchParams.get(key)
        else if (key === 'SLD') delete params[key]
      }
      return { ...result, params }
    }
    return result
  })
  const scale = (40075016.68557849 * 96 * 39.37) / (512 * 2 ** workspace.camera.zoom)
  return { projectJson: JSON.stringify({ coordinates: workspace.camera.center, scale, layers }), retainedUnsupported }
}
export function projectMutation(
  mode: 'save' | 'saveNew' | 'rename' | 'shareProject' | 'stopSharing' | 'default' | 'unsetDefault',
  projectId: string,
  options: { name?: string; projectJson?: string; additions?: string[]; removals?: string[] } = {},
): ProjectMutation {
  if (mode !== 'saveNew' && mode !== 'unsetDefault' && !/^\d+$/.test(projectId))
    throw new Error('Choose an original project.')
  const name = options.name?.trim()
  if ((mode === 'rename' || mode === 'saveNew') && (!name || name.length > 200))
    throw new Error('Enter a name of 1–200 characters.')
  if ((mode === 'save' || mode === 'saveNew') && !options.projectJson)
    throw new Error('Missing reviewed native project JSON.')
  const permissions = (values: string[] = []) =>
    JSON.stringify([
      ...new Set(
        values.map((value) => {
          if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
            throw new Error('Sharing requires native numeric user IDs.')
          return Number(value)
        }),
      ),
    ])
  const params: Record<string, string> =
    mode === 'default' || mode === 'unsetDefault'
      ? { projectId: mode === 'unsetDefault' ? 'unset' : projectId }
      : { mode, ...(mode === 'saveNew' ? {} : { projectId }) }
  if (mode === 'rename' || mode === 'saveNew') params.projectName = name!
  if (mode === 'save' || mode === 'saveNew') params.projectJson = options.projectJson!
  if (mode === 'shareProject') {
    params.permissionAdditions = permissions(options.additions)
    params.permissionRemovals = permissions(options.removals)
    if (options.additions?.some((id) => options.removals?.includes(id)))
      throw new Error('A user cannot be both added and removed.')
  }
  return {
    path:
      mode === 'default' || mode === 'unsetDefault'
        ? 'rest/openmap/setDefaultProject.php'
        : 'rest/openmap/savedProjects.php',
    params,
    summary: `${mode} ${mode === 'saveNew' ? name : `project ${projectId}`}`,
  }
}
