import { Link, useSearchParams } from 'react-router-dom'
import { lazy, Suspense, useState, useCallback } from 'react'
import { TabBar, type TabOption } from '@/components/ui/tab-bar'
import { InlineAlert } from '@/components/ui/map-panels'
import { errorText, NECHAKO_PORTAL } from '@/lib/nechakoPortal'
import { PortalLayers } from '@/maps/nechako/PortalLayers'
import { PortalFormats } from '@/maps/nechako/PortalChecks'
import { PortalResearch, PortalResearchMap } from '@/maps/nechako/PortalResearch'
import { FEATURE_COMPARISON, FORMAT_COMPARISON } from '@/maps/nechako/comparison'
import { PortalFiles } from '@/maps/nechako/PortalFiles'
import { PortalSourceLayers } from '@/maps/nechako/PortalSourceLayers'
import { PortalLocalWorkbench } from '@/maps/nechako/PortalLocalWorkbench'
import { applyLocalDefaultStyle } from '@/maps/nechako/data/styleLibrary'
import { PortalMonitoring } from '@/maps/nechako/PortalMonitoring'
import { EMPTY_WORKSPACE, type VectorData, type Workspace } from '@/maps/nechako/data/workspace'
import { PortalShowcase } from '@/maps/nechako/PortalShowcase'
import type { CatalogueSource } from '@/maps/nechako/data/showcase'
import { PortalInventory } from '@/maps/nechako/PortalInventory'
import { PortalCollections, EMPTY_COLLECTION_SESSION, type CollectionSession } from '@/maps/nechako/PortalCollections'
import { PortalOptions } from '@/maps/nechako/PortalOptions'
import { PortalPublicProjects } from '@/maps/nechako/PortalPublicProjects'
import { PortalUnifiedSearch } from '@/maps/nechako/PortalUnifiedSearch'
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
import type { InventoryPanel } from '@/maps/nechako/data/portalInventory'
import type { ProjectPackage } from '@/lib/projectPackages'

const ProjectWorkspace = lazy(() => import('@/maps/project-workspace/ProjectWorkspace'))

type View =
  | 'source-layers'
  | 'local-workbench'
  | 'showcase'
  | 'layers'
  | 'search'
  | 'research'
  | 'research-map'
  | 'projects'
  | 'formats'
  | 'compare'
  | 'files'
  | 'monitoring'
  | 'inventory'
  | 'collections'
  | 'stories'
  | 'options'
  | 'reader'
  | 'connection'
  | 'administration'
  | 'reports'
const VIEWS: readonly TabOption<View>[] = [
  { value: 'showcase', label: 'Showcase' },
  { value: 'inventory', label: 'Data inventory' },
  { value: 'collections', label: 'Community projects' },
  { value: 'stories', label: 'Stories' },
  { value: 'options', label: 'All options' },
  { value: 'connection', label: 'Connection' },
  { value: 'administration', label: 'Administration' },
  { value: 'reports', label: 'Form reports' },
  { value: 'layers', label: 'Layers' },
  { value: 'source-layers', label: 'Source layers & queries' },
  { value: 'local-workbench', label: 'Local workbench' },
  { value: 'search', label: 'Search' },
  { value: 'research', label: 'Research' },
  { value: 'research-map', label: 'Research map' },
  { value: 'projects', label: 'Projects' },
  { value: 'monitoring', label: 'Monitoring' },
  { value: 'files', label: 'Files & imports' },
  { value: 'formats', label: 'Formats' },
  { value: 'compare', label: 'Comparison' },
]

function Comparison() {
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Stewardship Portal ↔ PGMaps</h2>
      <p className="max-w-3xl text-sm text-muted-foreground">
        Updated October 21, 2026 from the public interface, source client definitions and the earlier October 12
        authenticated audit. The supplied login was rejected during the latest check, so new administrator views have
        contract and fixture verification; protected live behavior still needs a working account.
      </p>
      <InlineAlert title="What loads today">
        Captured public submissions and research, nine public map definitions, a learning adaptation, local GIS tools
        and live map services are available. The hosted portal connection supports permitted source reads and downloads;
        the updated service adds verified administrator reads. Form, schema, submission, system and schedule inspectors
        and map-image composition extend the native interface. Browser-local layers, styles, GIS/GPAP imports, monitoring extracts and project packages persist through Local workbench. Source mutations remain restricted to existing reviewed
        development adapters or the original portal.
      </InlineAlert>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[1000px] text-left text-sm">
          <caption className="sr-only">Full feature comparison</caption>
          <thead className="bg-muted">
            <tr>
              {['Capability', 'Portal evidence', 'Existing PGMaps', 'This dev view', 'Remaining work'].map((label) => (
                <th key={label} scope="col" className="p-3">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FEATURE_COMPARISON.map((row) => (
              <tr key={row.feature} className="border-t align-top">
                <th scope="row" className="p-3 font-medium">
                  {row.feature}
                </th>
                <td className="p-3">{row.portal}</td>
                <td className="p-3">{row.pgmaps}</td>
                <td className="p-3">{row.devView}</td>
                <td className="p-3">{row.next}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className="text-lg font-semibold">Data types and conversion</h3>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[850px] text-left text-sm">
          <caption className="sr-only">Data format comparison</caption>
          <thead className="bg-muted">
            <tr>
              {['Format / source', 'Portal evidence', 'Existing PGMaps', 'Handling still needed'].map((label) => (
                <th key={label} scope="col" className="p-3">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FORMAT_COMPARISON.map((row) => (
              <tr key={row.format} className="border-t align-top">
                <th scope="row" className="p-3 font-medium">
                  {row.format}
                </th>
                <td className="p-3">{row.evidence}</td>
                <td className="p-3">{row.pgmaps}</td>
                <td className="p-3">{row.next}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className="text-lg font-semibold">CORS and maintenance</h3>
      <ul className="list-disc space-y-2 pl-5 text-sm">
        <li>
          All 32 WMS capabilities URLs were readable from the deployed PGMaps origin. Representative map images and
          identify responses also passed.
        </li>
        <li>
          A later browser check requested PNG maps for all 135 advertised named layers: 132 passed at their reported
          extents. Canvec contours timed out at their reported extent but returned a PNG at watershed scale. Two
          EchoScreen layers, “Cancer rank - Sensitive Population” and “COPD rank - Sensitive Population”, repeatedly
          returned LayerNotDefined. These are source rendering failures, not CORS failures.
        </li>
        <li>
          Anonymous GET and form POST work for the tested public PHP reads. Credentialed requests, JSON POST and
          X-Requested-With were blocked in browser tests.
        </li>
        <li>
          The hosted connection keeps source cookies in an isolated temporary session and uses an in-memory browser
          capability. It does not rely on cross-site source cookies.
        </li>
        <li>
          Direct source requests may still receive registration errors. Use the configured portal connection for
          permitted source reads; the earlier registration-blocked observations do not describe that connection.
        </li>
        <li>
          Local GIS conversion, CSV monitoring, workspace conversion and submission-resource reads are now available.
          Keep portal publishing and permissions authoritative. Protected payloads and server deployment still need
          verification.
        </li>
      </ul>
    </div>
  )
}

export default function DevNechako() {
  const [monitoringContext, setMonitoringContext] = useState<{
    submissionId: string
    formId: string
    layerId?: string
    recId?: string
  }>()
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
  const [workspaceRevision, setWorkspaceRevision] = useState(0)
  const [mapBounds, setMapBounds] = useState<[number, number, number, number]>()
  const [params, setParams] = useSearchParams()
  const [collectionSession, setCollectionSession] = useState<CollectionSession>(EMPTY_COLLECTION_SESSION)
  const [selectedProject, setSelectedProject] = useState<ProjectPackage | null>(null)
  const requested = params.get('view')
  const view: View =
    requested === 'reader'
      ? 'reader'
      : VIEWS.some((item) => item.value === requested)
        ? (requested as View)
        : 'showcase'
  const catalogueSource: CatalogueSource = params.get('source') === 'live' ? 'live' : 'snapshot'
  const showView = (value: View) =>
    setParams((current) => {
      const next = new URLSearchParams(current)
      next.set('view', value)
      next.set('source', 'snapshot')
      return next
    })
  const showAdministration = (admin: PortalAdministrationView) =>
    setParams((current) => {
      const next = new URLSearchParams(current)
      next.set('view', 'administration')
      next.set('admin', admin)
      return next
    })
  const openPanel = (panel: InventoryPanel) => {
    const views: Partial<Record<InventoryPanel, View>> = {
      search: 'search',
      submissions: 'search',
      reports: 'reports',
      monitoring: 'monitoring',
      projects: 'layers',
      files: 'files',
      'research-map': 'research-map',
      'saved-projects': 'projects',
      collections: 'collections',
      stories: 'stories',
      account: 'connection',
      administration: 'administration',
      inventory: 'inventory',
      'source-layers': 'source-layers',
      'local-workbench': 'local-workbench',
    }
    if (views[panel]) showView(views[panel])
    else window.location.assign(`/dev/nechako/portal?panel=${panel}`)
  }
  const addLocalVectors = async (vectors: VectorData[]) => {
    const warnings: string[] = []
    const styled = await Promise.all(
      vectors.map(async (vector) => {
        try {
          return await applyLocalDefaultStyle(vector)
        } catch (reason) {
          warnings.push(`Default style unavailable for ${vector.name}: ${errorText(reason)}`)
          return vector
        }
      }),
    )
    setWorkspace((current) => ({
      ...current,
      vectors: [...current.vectors, ...styled],
      warnings: [...(current.warnings ?? []), ...warnings],
    }))
    showView('layers')
  }
  return (
    <div className="container mx-auto space-y-6 px-4 pb-10 pt-24 sm:px-6 md:pt-10">
      <div className="space-y-3">
        <Link to="/dev" className="text-sm text-primary underline">
          Dev library
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">Nechako portal workbench</h1>
        <Link to="/dev/nechako/portal" className="inline-block text-sm text-primary underline">
          Open portal interface
        </Link>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          Explore public portal content from PGMaps and compare what each site supports.
        </p>
        <a
          href={NECHAKO_PORTAL}
          target="_blank"
          rel="noreferrer"
          className="inline-block text-sm text-primary underline"
        >
          Open Stewardship Portal
        </a>
      </div>
      <TabBar
        label="Nechako portal views"
        idPrefix="nechako"
        value={view}
        options={selectedProject ? [...VIEWS, { value: 'reader', label: 'Project reader' }] : VIEWS}
        onChange={(value) =>
          setParams((current) => {
            const next = new URLSearchParams(current)
            next.set('view', value)
            return next
          })
        }
      />
      {/* Keep the map and its selections alive when switching comparison/search tabs. */}
      <section
        role="tabpanel"
        id="nechako-panel-layers"
        aria-labelledby="nechako-tab-layers"
        hidden={view !== 'layers'}
      >
        <div className="mb-4">
          <label className="text-sm font-medium">
            Map catalogue source
            <select
              aria-label="Map catalogue source"
              value={catalogueSource}
              className="ml-2 max-w-full rounded-md border bg-background p-2 text-base"
              onChange={(event) =>
                setParams((current) => {
                  const next = new URLSearchParams(current)
                  next.set('source', event.target.value)
                  return next
                })
              }
            >
              <option value="snapshot">Repository snapshot</option>
              <option value="live">Live portal catalogue</option>
            </select>
          </label>
        </div>
        <PortalLayers
          key={workspaceRevision + catalogueSource}
          workspace={workspace}
          setWorkspace={setWorkspace}
          onBounds={setMapBounds}
          catalogueSource={catalogueSource}
          onOpenFiles={() => showView('files')}
          onOpenSourceLayers={() => showView('source-layers')}
          onOpenWorkbench={() => showView('local-workbench')}
        />
      </section>
      <section
        role="tabpanel"
        id="nechako-panel-monitoring"
        aria-labelledby="nechako-tab-monitoring"
        hidden={view !== 'monitoring'}
      >
        <PortalMonitoring key={session.revision} {...monitoringContext} />
      </section>
      <section role="tabpanel" id="nechako-panel-files" aria-labelledby="nechako-tab-files" hidden={view !== 'files'}>
        <PortalFiles
          write={portalWrite}
          canWrite={session.canWrite}
          onVectors={(vectors) => void addLocalVectors(vectors)}
        />
      </section>
      {view !== 'layers' && view !== 'monitoring' && view !== 'files' && (
        <section role="tabpanel" id={`nechako-panel-${view}`} aria-labelledby={`nechako-tab-${view}`}>
          {view === 'source-layers' && (
            <PortalSourceLayers
              workspace={workspace}
              onVectors={(vectors) => void addLocalVectors(vectors)}
              onOpenFiles={() => showView('files')}
              onOpenWorkbench={() => showView('local-workbench')}
            />
          )}
          {view === 'local-workbench' && (
            <PortalLocalWorkbench
              workspace={workspace}
              onWorkspace={(imported) => {
                setWorkspace(imported)
                setWorkspaceRevision((value) => value + 1)
                showView('layers')
              }}
            />
          )}
          {view === 'showcase' && (
            <PortalShowcase
              onView={(value) => {
                setParams((current) => {
                  const next = new URLSearchParams(current)
                  next.set('view', value)
                  next.set('source', 'snapshot')
                  return next
                })
              }}
              onWorkspace={(imported) => {
                setWorkspace((current) => ({
                  ...current,
                  camera: imported.camera,
                  vectors: [
                    ...current.vectors.filter((vector) => !imported.vectors.some((item) => item.id === vector.id)),
                    ...imported.vectors,
                  ],
                  warnings: [...new Set([...current.warnings, ...imported.warnings])],
                }))
                setWorkspaceRevision((value) => value + 1)
                showView('layers')
              }}
            />
          )}
          {view === 'search' && (
            <PortalUnifiedSearch
              key={session.revision}
              files={collectionSession.files}
              workspace={workspace}
              mapBounds={mapBounds}
              onWorkspace={(imported) => {
                setWorkspace(imported)
                setWorkspaceRevision((value) => value + 1)
                showView('layers')
              }}
              onProject={(project) => {
                setSelectedProject(project)
                showView('reader')
              }}
              onResearchMap={() => showView('research-map')}
              onMonitoring={(context) => {
                setMonitoringContext(context)
                showView('monitoring')
              }}
            />
          )}
          {view === 'research' && <PortalResearch onMap={() => showView('research-map')} />}
          {view === 'research-map' && <PortalResearchMap onBack={() => showView('showcase')} />}
          {view === 'projects' && (
            <PortalProjectManager
              key={session.revision}
              workspace={workspace}
              onWorkspace={(imported) => {
                setWorkspace(imported)
                setWorkspaceRevision((value) => value + 1)
                showView('layers')
              }}
              write={portalWrite}
              canWrite={session.canWrite}
            />
          )}
          {view === 'connection' && <LocalPortalConnection />}
          {view === 'administration' && (
            <PortalAdministration
              key={`${session.revision}:${parsePortalAdministrationView(params.get('admin'))}`}
              initialView={parsePortalAdministrationView(params.get('admin'))}
              write={portalWrite}
            />
          )}
          {view === 'reports' && <PortalFormReports key={session.revision} />}
          {view === 'inventory' && <PortalInventory onOpen={openPanel} importedFiles={collectionSession.files} />}
          {view === 'options' && (
            <PortalOptions
              onAdministration={showAdministration}
              onOpen={openPanel}
              onMapPane={() => showView('layers')}
            />
          )}
          {(view === 'collections' || view === 'stories') && (
            <div className="space-y-6">
              {view === 'collections' && (
                <PortalPublicProjects
                  onWorkspace={(imported) => {
                    setWorkspace(imported)
                    setWorkspaceRevision((value) => value + 1)
                    showView('layers')
                  }}
                />
              )}
              <PortalCollections
                mode={view === 'stories' ? 'stories' : 'all'}
                session={collectionSession}
                onSessionChange={setCollectionSession}
                learningStoryAvailable
                showObservedIndex={false}
                onWorkspace={(imported) => {
                  setWorkspace(imported)
                  setWorkspaceRevision((value) => value + 1)
                  showView('layers')
                }}
                onProject={(project) => {
                  setSelectedProject(project)
                  showView('reader')
                }}
              />
            </div>
          )}
          {view === 'reader' &&
            (selectedProject ? (
              <div className="relative h-[80vh] min-h-[500px] overflow-hidden rounded-lg border">
                <Suspense fallback={<InlineAlert loading>Opening project reader…</InlineAlert>}>
                  <ProjectWorkspace project={selectedProject} onBack={() => showView('collections')} />
                </Suspense>
              </div>
            ) : (
              <InlineAlert>Import a project or story in Community projects to open the reader.</InlineAlert>
            ))}
          {view === 'formats' && <PortalFormats defaultSource={catalogueSource} />}
          {view === 'compare' && <Comparison />}
        </section>
      )}
    </div>
  )
}
