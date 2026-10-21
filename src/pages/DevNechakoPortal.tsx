import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BookOpen, Database, FolderOpen, HelpCircle, Library, List, Search, Upload, Waves } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { InlineAlert } from '@/components/ui/map-panels'
import { fetchJson } from '@/lib/fetchJson'
import { errorText, NECHAKO_PORTAL } from '@/lib/nechakoPortal'
import { PortalLayers } from '@/maps/nechako/PortalLayers'
import { PortalResearchMap } from '@/maps/nechako/PortalResearch'
import { PortalSearch } from '@/maps/nechako/PortalChecks'
import { PortalMonitoring } from '@/maps/nechako/PortalMonitoring'
import { PortalFiles } from '@/maps/nechako/PortalFiles'
import { SHOWCASE_BASE } from '@/maps/nechako/data/showcase'
import { loadNechakoBoundary } from '@/maps/nechako/data/boundary'
import { EMPTY_WORKSPACE, importWorkspace, type Workspace } from '@/maps/nechako/data/workspace'
import { PortalInventory } from '@/maps/nechako/PortalInventory'
import { PortalCollections, EMPTY_COLLECTION_SESSION, type CollectionSession } from '@/maps/nechako/PortalCollections'
import { PortalOptions } from '@/maps/nechako/PortalOptions'
import { PortalPublicProjects } from '@/maps/nechako/PortalPublicProjects'
import { normalizeProjectPackage, type ProjectPackage } from '@/lib/projectPackages'
import learningJson from '../../public/data/projects/nechako-learning-module.json'
import { PortalUnifiedSearch } from '@/maps/nechako/PortalUnifiedSearch'
import { PortalSubmissionSearch } from '@/maps/nechako/PortalSubmissionSearch'
import { LocalPortalConnection } from '@/maps/nechako/LocalPortalConnection'
import {
  PortalAdministration,
  parsePortalAdministrationView,
  type PortalAdministrationView,
} from '@/maps/nechako/PortalAdministration'
import { PortalProjectManager } from '@/maps/nechako/PortalProjectManager'
import { PortalFormReports } from '@/maps/nechako/PortalFormReports'
import { portalWrite } from '@/lib/nechakoPortal'
import { usePortalSession } from '@/maps/nechako/data/usePortalSession'
import { TabBar } from '@/components/ui/tab-bar'

const ProjectWorkspace = lazy(() => import('@/maps/project-workspace/ProjectWorkspace'))
const learningProject = normalizeProjectPackage(learningJson)

const PANELS = [
  'search',
  'submissions',
  'reports',
  'monitoring',
  'projects',
  'files',
  'research-map',
  'links',
  'about',
  'account',
  'saved-projects',
  'inventory',
  'collections',
  'stories',
  'options',
  'project-viewer',
  'administration',
  'map-export',
] as const
type Panel = (typeof PANELS)[number]
const TITLES: Record<Panel, string> = {
  search: 'Find Submissions : SEARCH',
  submissions: 'Portal submissions',
  reports: 'Reporting and statistics',
  monitoring: 'Monitoring and observations',
  projects: 'Projects',
  files: 'Import files',
  'research-map': 'Research map and timeline',
  links: 'Watershed links',
  about: 'About this preview',
  account: 'Portal account',
  'saved-projects': 'Saved portal projects',
  inventory: 'Information and data size',
  collections: 'Community projects and collections',
  stories: 'Stories and learning',
  options: 'All portal options',
  'project-viewer': 'Project reader',
  administration: 'Administration and workflow',
  'map-export': 'Export map image',
}

export default function DevNechakoPortal() {
  const [reportsView, setReportsView] = useState<'forms' | 'monitoring'>('forms')
  const [monitoringContext, setMonitoringContext] = useState<{
    submissionId: string
    formId: string
    layerId?: string
    recId?: string
  }>()
  const [params, setParams] = useSearchParams()
  const requested = params.get('panel')
  const panel = PANELS.includes(requested as Panel) ? (requested as Panel) : undefined
  const adminView = parsePortalAdministrationView(params.get('admin'))
  const [workspace, setWorkspace] = useState<Workspace>(EMPTY_WORKSPACE)
  const clearSessionWorkspace = useCallback(
    () =>
      setWorkspace((current) =>
        current.sessionBound
          ? {
              ...EMPTY_WORKSPACE,
              camera: current.camera,
              warnings: [
                'The portal connection changed; unsaved source-session map data was cleared. Explicit browser saves remain available.',
              ],
            }
          : current,
      ),
    [],
  )
  const session = usePortalSession(clearSessionWorkspace)
  const [bounds, setBounds] = useState<[number, number, number, number]>()
  const [initialBounds, setInitialBounds] = useState<[number, number, number, number]>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [collectionSession, setCollectionSession] = useState<CollectionSession>(EMPTY_COLLECTION_SESSION)
  const [selectedProject, setSelectedProject] = useState<ProjectPackage | null>(learningProject)
  const [requestedPane, setRequestedPane] = useState<{ pane: 'tools' | 'layers'; revision: number }>()
  const showPanel = useCallback(
    (value?: Panel) =>
      setParams((current) => {
        const next = new URLSearchParams(current)
        if (value) next.set('panel', value)
        else next.delete('panel')
        return next
      }),
    [setParams],
  )

  useEffect(() => {
    const controller = new AbortController()
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, 30000)
    const initialize = async () => {
      const [saved, boundary] = await Promise.all([
        fetchJson(`${SHOWCASE_BASE}research-workspace.json`, controller.signal),
        loadNechakoBoundary(controller.signal),
      ])
      const initial = importWorkspace(saved)
      const researchLocations = initial.vectors.find((vector) => vector.id === 'nechako-research-locations')
      if (researchLocations) researchLocations.visible = false
      initial.vectors.push(boundary.vector)
      if (!controller.signal.aborted) {
        setInitialBounds(boundary.bounds)
        setWorkspace(initial)
      }
    }
    void initialize()
      .catch((reason) => {
        if (!controller.signal.aborted) setError(errorText(reason))
        else if (timedOut) setError('The bundled map data took too long to load. Retry to open the preview.')
      })
      .finally(() => {
        clearTimeout(timeout)
        if (!controller.signal.aborted || timedOut) setLoading(false)
      })
    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [retry])

  const showAdministration = (view: PortalAdministrationView) =>
    setParams((current) => {
      const next = new URLSearchParams(current)
      next.set('panel', 'administration')
      next.set('admin', view)
      return next
    })
  const close = () => showPanel()
  const openProject = (project: ProjectPackage) => {
    setSelectedProject(project)
    showPanel('project-viewer')
  }
  const loadWorkspace = (imported: Workspace) => {
    setInitialBounds(undefined)
    setWorkspace(imported)
    close()
  }
  const toolbarClass =
    'h-10 shrink-0 gap-1.5 rounded-sm border border-white/20 bg-white/10 px-3 text-white hover:bg-white/20 hover:text-white'
  return (
    <div className="flex h-full min-h-0 flex-col bg-[#075747] pt-16 md:pt-0" data-nechako-native-portal>
      <header className="shrink-0 bg-gradient-to-r from-[#238eab] to-[#075747] px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-4xl">Nechako Watershed Portal</h1>
            <p className="mt-1 text-xs text-white/85">Community data catalogue · PGMaps preview</p>
          </div>
          <Link to="/dev/nechako" className="text-xs text-white underline underline-offset-4">
            Data workbench
          </Link>
        </div>
      </header>
      <nav
        aria-label="Watershed portal"
        className="flex shrink-0 gap-1 overflow-x-auto border-y border-white/20 px-2 py-1.5"
      >
        <Button className={toolbarClass} onClick={() => showPanel('inventory')}>
          <Database className="h-4 w-4" /> Data inventory
        </Button>
        <Button className={toolbarClass} onClick={() => showPanel('collections')}>
          <Library className="h-4 w-4" /> Community projects
        </Button>
        <Button className={toolbarClass} onClick={() => showPanel('stories')}>
          <BookOpen className="h-4 w-4" /> Stories
        </Button>
        <Button className={toolbarClass} onClick={() => showPanel('search')}>
          <Search className="h-4 w-4" />
          Search
        </Button>
        <Button className={toolbarClass} onClick={() => showPanel('reports')}>
          <Waves className="h-4 w-4" />
          Reports
        </Button>
        <Button className={toolbarClass} onClick={() => showPanel('links')}>
          Links
        </Button>
        <Button className={toolbarClass} onClick={() => showPanel('projects')}>
          <FolderOpen className="h-4 w-4" />
          Projects
        </Button>
        <Button className={toolbarClass} onClick={() => showPanel('files')}>
          <Upload className="h-4 w-4" />
          Import
        </Button>
        <Button className={toolbarClass} onClick={() => showPanel('research-map')}>
          <BookOpen className="h-4 w-4" />
          Research map
        </Button>
        <Button className={toolbarClass} onClick={() => showPanel('account')}>
          Login / Sign-up
        </Button>
        <Button className={toolbarClass} onClick={() => showPanel('options')}>
          <List className="h-4 w-4" /> All options
        </Button>
        <Button className={toolbarClass} onClick={() => showPanel('administration')}>
          Administration
        </Button>
        <Button className={toolbarClass} aria-label="About this preview" onClick={() => showPanel('about')}>
          <HelpCircle className="h-4 w-4" />
        </Button>
      </nav>
      <div className="relative min-h-0 flex-1 bg-background">
        {loading || error ? (
          <div className="p-5">
            <InlineAlert
              loading={loading}
              tone={error ? 'error' : 'info'}
              title={error ? 'Map preview unavailable' : 'Opening watershed map'}
            >
              {error || 'Loading research locations and the watershed catalogue…'}
              {error && (
                <Button
                  className="ml-2"
                  variant="outline"
                  onClick={() => {
                    setLoading(true)
                    setError('')
                    setRetry((value) => value + 1)
                  }}
                >
                  Retry preview
                </Button>
              )}
            </InlineAlert>
          </div>
        ) : (
          <PortalLayers
            workspace={workspace}
            setWorkspace={setWorkspace}
            onBounds={setBounds}
            catalogueSource="snapshot"
            layout="portal"
            initialBounds={initialBounds}
            projectsOpen={panel === 'projects'}
            onProjectsClose={close}
            exportOpen={panel === 'map-export'}
            onOpenExport={() => showPanel('map-export')}
            onExportClose={close}
            onOpenFiles={() => showPanel('files')}
            requestedPane={requestedPane}
          />
        )}
      </div>
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 px-2 py-1 text-[11px] text-white/90">
        <span>
          Map centre (EPSG:4326): {workspace.camera.center[1].toFixed(4)}, {workspace.camera.center[0].toFixed(4)}
        </span>
        <span>
          Public data snapshot · live map imagery ·{' '}
          <Link to="/dev" className="underline">
            Dev library
          </Link>
        </span>
      </footer>
      {panel && panel !== 'projects' && panel !== 'map-export' && (
        <DialogShell
          title={panel === 'project-viewer' && selectedProject ? selectedProject.title : TITLES[panel]}
          onClose={close}
          size={panel === 'search' ? 'lg' : 'xl'}
          closeLabel="Close portal window"
          contentProps={{
            onKeyDown: (event) => {
              // Handle the focused window even before the document-level dialog
              // listener attaches. A nested record dialog owns its own Escape.
              if (
                event.key === 'Escape' &&
                !event.defaultPrevented &&
                event.target instanceof Element &&
                event.target.closest('[role="dialog"]') === event.currentTarget
              ) {
                event.preventDefault()
                event.stopPropagation()
                close()
              }
            },
          }}
          className={
            panel === 'search'
              ? 'h-[min(700px,92dvh)] sm:h-[min(550px,92dvh)] sm:!max-w-[800px] [&>header]:p-3 [&>div]:flex [&>div]:min-h-0 [&>div]:flex-1 [&>div]:flex-col [&>div]:overflow-hidden'
              : panel === 'research-map' || panel === 'project-viewer'
                ? 'h-[90dvh] [&>div]:flex [&>div]:flex-col [&>div]:overflow-hidden'
                : undefined
          }
          bodyClassName={
            panel === 'search'
              ? 'flex min-h-0 flex-1 flex-col overflow-hidden !p-3'
              : panel === 'research-map' || panel === 'project-viewer'
                ? 'flex min-h-0 flex-1 flex-col overflow-hidden'
                : undefined
          }
        >
          {panel === 'inventory' && (
            <PortalInventory
              onOpen={showPanel}
              importedFiles={collectionSession.files}
              searchCollections={
                <PortalUnifiedSearch
                  key={session.revision}
                  files={collectionSession.files}
                  workspace={workspace}
                  mapBounds={bounds}
                  onWorkspace={loadWorkspace}
                  onProject={openProject}
                  onResearchMap={() => showPanel('research-map')}
                  onMonitoring={(context) => {
                    setMonitoringContext(context)
                    setReportsView('monitoring')
                    showPanel('reports')
                  }}
                />
              }
            />
          )}
          {(panel === 'collections' || panel === 'stories') && (
            <div className="space-y-5">
              {panel === 'collections' && <PortalPublicProjects onWorkspace={loadWorkspace} />}
              {panel === 'stories' && learningProject && (
                <div className="space-y-2 rounded-lg border bg-muted/20 p-4">
                  <h2 className="text-xl font-semibold">Welcome to the Nechako Watershed</h2>
                  <p className="text-sm leading-6 text-muted-foreground">
                    A public learning adaptation: five place cases, 25 discussion prompts, and a map you can follow
                    chapter by chapter. The original module remains linked for its complete source material.
                  </p>
                  <Button onClick={() => openProject(learningProject)}>Read learning story in this portal</Button>
                </div>
              )}
              <PortalCollections
                mode={panel === 'stories' ? 'stories' : 'all'}
                session={collectionSession}
                onSessionChange={setCollectionSession}
                onWorkspace={loadWorkspace}
                onProject={openProject}
                learningStoryAvailable={Boolean(learningProject)}
                showObservedIndex={false}
              />
            </div>
          )}
          {panel === 'options' && (
            <PortalOptions
              onOpen={showPanel}
              onAdministration={showAdministration}
              onMapPane={(pane) => {
                setRequestedPane((current) => ({ pane, revision: (current?.revision ?? 0) + 1 }))
                close()
              }}
            />
          )}
          {panel === 'project-viewer' &&
            (selectedProject ? (
              <div className="relative min-h-0 flex-1" data-nechako-project-reader>
                <Suspense fallback={<InlineAlert loading>Opening project reader…</InlineAlert>}>
                  <ProjectWorkspace project={selectedProject} onBack={() => showPanel('stories')} />
                </Suspense>
              </div>
            ) : (
              <InlineAlert>No project selected. Open Stories or import a supported project package.</InlineAlert>
            ))}
          {panel === 'search' && <PortalSubmissionSearch mapBounds={bounds} vectors={workspace.vectors} />}
          {panel === 'submissions' && (
            <PortalSearch
              key={session.revision}
              vectors={workspace.vectors}
              mapBounds={bounds}
              onMonitoring={(context) => {
                setMonitoringContext(context)
                setReportsView('monitoring')
                showPanel('reports')
              }}
            />
          )}
          {(panel === 'reports' || panel === 'monitoring') && (
            <div className="space-y-4">
              <TabBar
                label="Reporting workflow"
                value={panel === 'monitoring' ? 'monitoring' : reportsView}
                onChange={(value) => {
                  setReportsView(value)
                  if (panel === 'monitoring') showPanel('reports')
                }}
                options={[
                  { value: 'forms', label: 'Original form reports' },
                  { value: 'monitoring', label: 'Monitoring and local charts' },
                ]}
              />
              {panel !== 'monitoring' && reportsView === 'forms' ? (
                <PortalFormReports key={session.revision} />
              ) : (
                <PortalMonitoring key={session.revision} {...monitoringContext} />
              )}
            </div>
          )}
          {panel === 'files' && (
            <PortalFiles
              write={portalWrite}
              canWrite={session.canWrite}
              onVectors={(vectors) => {
                setWorkspace((current) => ({ ...current, vectors: [...current.vectors, ...vectors] }))
                close()
              }}
            />
          )}
          {panel === 'research-map' && <PortalResearchMap onBack={close} fill backLabel="Watershed map" />}
          {panel === 'saved-projects' && (
            <PortalProjectManager
              key={session.revision}
              workspace={workspace}
              onWorkspace={loadWorkspace}
              write={portalWrite}
              canWrite={session.canWrite}
            />
          )}
          {panel === 'administration' && (
            <PortalAdministration
              key={`${session.revision}:${adminView ?? 'dashboard'}`}
              initialView={adminView ?? undefined}
              write={portalWrite}
            />
          )}
          {panel === 'links' && (
            <div className="space-y-4 text-sm">
              <a className="block text-primary underline" href={NECHAKO_PORTAL} target="_blank" rel="noreferrer">
                Original Nechako Watershed Portal
              </a>
              <Link className="block text-primary underline" to="/dev/nechako?view=showcase">
                Bundled data, public attachment links and attribution
              </Link>
              <Link className="block text-primary underline" to="/dev/nechako?view=compare">
                Feature comparison and integration status
              </Link>
              <Button variant="outline" onClick={() => showPanel('saved-projects')}>
                Check saved portal projects
              </Button>
            </div>
          )}
          {panel === 'account' && (
            <div className="space-y-4 text-sm">
              <LocalPortalConnection />
              <p>
                Sign in above to read records allowed by your original portal account. Registration, password changes
                and publication remain available at the original portal.
              </p>
              <Button asChild>
                <a href={NECHAKO_PORTAL} target="_blank" rel="noreferrer">
                  Open portal login and sign-up
                </a>
              </Button>
            </div>
          )}
          {panel === 'about' && (
            <div className="space-y-4 text-sm">
              <p>
                This PGMaps preview recreates the portal’s map-centred layout using React, MapLibre and our shared map
                toolkit.
              </p>
              <p>
                Search captured public submissions and research, load source projects, add WMS layers, import files,
                draw and process geometry, save workspaces, compose map images and chart monitoring observations. All
                options maps the original menus to the available workflows.
              </p>
              <p>
                Research locations are reference points, not study footprints. The repository snapshot was captured
                October 11, 2026. Basemaps, WMS imagery and identify responses use live services.
              </p>
              <p>
                The Nechako outline uses the same BC Freshwater Atlas named watershed (8886) as EchoScreen, from its
                50-metre simplified snapshot. It loads locally and can be used as the submission search area.
              </p>
              <InlineAlert tone="warning" title="Portal integration limits">
                The portal connection supports permitted reads and native downloads. Administrator reads require a
                verified administrator session and the updated connection service. Hosted source writes remain disabled.
                Direct requests may still encounter source registration or CORS errors. The options directory identifies
                workflows that remain in the original portal; imported collections remain in this browser session.
              </InlineAlert>
              <Link className="block text-primary underline" to="/dev/nechako?view=compare">
                Review the full comparison
              </Link>
            </div>
          )}
        </DialogShell>
      )}
    </div>
  )
}
