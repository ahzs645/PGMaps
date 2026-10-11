import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BookOpen, FolderOpen, HelpCircle, Search, Upload, Waves } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { InlineAlert } from '@/components/ui/map-panels'
import { TabBar } from '@/components/ui/tab-bar'
import { fetchJson } from '@/lib/fetchJson'
import { errorText, NECHAKO_PORTAL } from '@/lib/nechakoPortal'
import { PortalLayers } from '@/maps/nechako/PortalLayers'
import { PortalResearch, PortalResearchMap } from '@/maps/nechako/PortalResearch'
import { PortalSearch, PortalProjects } from '@/maps/nechako/PortalChecks'
import { PortalMonitoring } from '@/maps/nechako/PortalMonitoring'
import { PortalFiles } from '@/maps/nechako/PortalFiles'
import { SHOWCASE_BASE } from '@/maps/nechako/data/showcase'
import { loadNechakoBoundary } from '@/maps/nechako/data/boundary'
import { EMPTY_WORKSPACE, importWorkspace, type Workspace } from '@/maps/nechako/data/workspace'

const PANELS = [
  'search',
  'reports',
  'projects',
  'files',
  'research-map',
  'links',
  'about',
  'account',
  'saved-projects',
] as const
type Panel = (typeof PANELS)[number]
const TITLES: Record<Panel, string> = {
  search: 'Search',
  reports: 'Reporting and statistics',
  projects: 'Projects',
  files: 'Import files',
  'research-map': 'Research map and timeline',
  links: 'Watershed links',
  about: 'About this preview',
  account: 'Portal account',
  'saved-projects': 'Saved portal projects',
}

export default function DevNechakoPortal() {
  const [params, setParams] = useSearchParams()
  const requested = params.get('panel')
  const panel = PANELS.includes(requested as Panel) ? (requested as Panel) : undefined
  const [searchView, setSearchView] = useState<'research' | 'submissions'>('research')
  const [workspace, setWorkspace] = useState<Workspace>(EMPTY_WORKSPACE)
  const [bounds, setBounds] = useState<[number, number, number, number]>()
  const [initialBounds, setInitialBounds] = useState<[number, number, number, number]>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
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

  const close = () => showPanel()
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
        className="flex shrink-0 gap-1 overflow-x-auto border-y border-white/20 px-2 py-1.5 md:justify-center"
      >
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
            onOpenFiles={() => showPanel('files')}
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
      {panel && panel !== 'projects' && (
        <DialogShell
          title={TITLES[panel]}
          onClose={close}
          size="xl"
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
            panel === 'research-map' ? 'h-[90dvh] [&>div]:flex [&>div]:flex-col [&>div]:overflow-hidden' : undefined
          }
          bodyClassName={panel === 'research-map' ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : undefined}
        >
          {panel === 'search' && (
            <div className="space-y-4">
              <TabBar
                label="Search source"
                idPrefix="native-search"
                value={searchView}
                onChange={setSearchView}
                options={[
                  { value: 'research', label: 'Research records' },
                  { value: 'submissions', label: 'Portal submissions' },
                ]}
              />
              <section
                role="tabpanel"
                id={`native-search-panel-${searchView}`}
                aria-labelledby={`native-search-tab-${searchView}`}
              >
                {searchView === 'research' ? (
                  <PortalResearch onMap={() => showPanel('research-map')} />
                ) : (
                  <PortalSearch vectors={workspace.vectors} mapBounds={bounds} />
                )}
              </section>
            </div>
          )}
          {panel === 'reports' && <PortalMonitoring />}
          {panel === 'files' && (
            <PortalFiles
              onVectors={(vectors) => {
                setWorkspace((current) => ({ ...current, vectors: [...current.vectors, ...vectors] }))
                close()
              }}
            />
          )}
          {panel === 'research-map' && <PortalResearchMap onBack={close} fill backLabel="Watershed map" />}
          {panel === 'saved-projects' && <PortalProjects />}
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
              <p>
                Account registration, login, publishing and permissions are managed by the original portal. Open it to
                use your account.
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
                Search the 1,408 bundled research records, explore 46 reference locations, add layers from 32 WMS
                services, import files, draw and process geometry, save workspaces, and chart local monitoring CSV
                files.
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
                Saved portal projects and submission search remain subject to the portal’s registration and
                authentication. Private attachments and the full underlying data store are outside this public snapshot.
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
