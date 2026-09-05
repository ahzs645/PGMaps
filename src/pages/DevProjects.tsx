import { PaginationControls } from '@/components/ui/pagination-controls'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { usePagination } from '@/hooks/usePagination'
import { iconClass, KIND_LABELS } from '@/maps/project-workspace/projectPresentation'
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  Download,
  ExternalLink,
  FileText,
  FolderKanban,
  Layers,
  Search,
  Settings2,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { AppSelect } from '@/components/ui/select'
import {
  buildProjectLabUrl,
  downloadProjectPackage,
  findProjectPackageBySlug,
  importProjectPackageFile,
  loadLocalProjectPackages,
  loadProjectCatalogSummaries,
  removeLocalProjectPackage,
  type ProjectKind,
  type ProjectPackage,
  type ProjectTheme,
} from '@/lib/projectPackages'
import { useProjectCatalogWebMCP } from '@/lib/projectWebMCP'
import { cn } from '@/lib/utils'

const ProjectWorkspace = lazy(() => import('@/maps/project-workspace/ProjectWorkspace'))
type CatalogFilter = 'all' | ProjectKind

const THEME_ACCENT: Record<ProjectTheme, string> = {
  cyan: 'border-cyan-500 bg-cyan-50 text-cyan-800 dark:border-cyan-700 dark:bg-cyan-950/35 dark:text-cyan-100',
  amber: 'border-amber-500 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/35 dark:text-amber-100',
  emerald:
    'border-emerald-500 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-100',
  blue: 'border-blue-500 bg-blue-50 text-blue-900 dark:border-blue-700 dark:bg-blue-950/35 dark:text-blue-100',
  slate: 'border-slate-400 bg-slate-50 text-slate-800 dark:border-slate-600 dark:bg-slate-950/35 dark:text-slate-100',
}

const FILTER_OPTIONS: Array<{ value: CatalogFilter; label: string }> = [
  { value: 'all', label: 'All types' },
  { value: 'map-story', label: 'Map stories' },
  { value: 'raster-story', label: 'Raster stories' },
  { value: 'index-preset', label: 'Index presets' },
  { value: 'research-pack', label: 'Research packs' },
]

const FEATURED_PROJECT_SLUGS = [
  'canada-administrative-divisions',
  'echoscreen-climate-health',
  'score-preset-pedestrian-network-study-mi',
  'where-is-north-bc',
  'nechako-watershed-research-portal',
  'roadless-areas-bc-ecoregions',
  'bc-big-tree-registry',
  'inaturalist-species-at-risk-bc',
  'inaturalist-species-at-risk-live-bc',
  'air-quality-bylaws-bc',
  'fine-particulate-matter-bc',
  'ground-level-ozone-bc',
  'nitrogen-dioxide-bc',
  'sulphur-dioxide-bc',
  'lidarbc-data-availability',
  'bc-population-distribution',
  'grizzly-bear-conservation-bc',
  'invasive-species-bc',
  'municipal-solid-waste-bc',
] as const

const FEATURED_PROJECT_ORDER = new Map<string, number>(FEATURED_PROJECT_SLUGS.map((slug, index) => [slug, index]))

function accentClass(project: ProjectPackage): string {
  return THEME_ACCENT[project.theme]
}

function useProjectPackages() {
  const [staticProjects, setStaticProjects] = useState<ProjectPackage[] | null>(null)
  const [localProjects, setLocalProjects] = useState<ProjectPackage[]>(() => loadLocalProjectPackages())
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadProjectCatalogSummaries()
      .then((packages) => {
        if (!cancelled) setStaticProjects(packages)
      })
      .catch(() => {
        if (!cancelled) {
          setStaticProjects([])
          setLoadError(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const projects = useMemo(() => {
    const staticList = staticProjects ?? []
    const staticSlugs = new Set(staticList.map((pkg) => pkg.slug))
    return [...staticList, ...localProjects.filter((pkg) => !staticSlugs.has(pkg.slug))]
  }, [localProjects, staticProjects])

  const importProject = useCallback(async (file: File) => {
    const imported = await importProjectPackageFile(file)
    setLocalProjects(loadLocalProjectPackages())
    return imported
  }, [])

  const removeProject = useCallback((slug: string) => {
    removeLocalProjectPackage(slug)
    setLocalProjects(loadLocalProjectPackages())
  }, [])

  return { projects, loading: staticProjects === null, loadError, importProject, removeProject }
}

function ProjectDetailSections({ project, onRemove }: { project: ProjectPackage; onRemove?: (slug: string) => void }) {
  const detailParagraphs = project.details?.length ? project.details : [project.summary, project.sourceNote]
  const [lightboxOpen, setLightboxOpen] = useState(false)

  useEffect(() => {
    if (!lightboxOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLightboxOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [lightboxOpen])

  return (
    <>
      <section className="p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
          <BookOpen className="h-4 w-4" />
          About
        </div>
        <div className="space-y-2 text-sm leading-6 text-muted-foreground">
          {detailParagraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
        {project.image && (
          <button
            type="button"
            onClick={() => setLightboxOpen(true)}
            className="mt-3 block w-full cursor-zoom-in"
            aria-label={`Zoom into ${project.image.alt}`}
          >
            <img
              src={project.image.src}
              alt={project.image.alt}
              loading="lazy"
              className="max-h-72 w-full rounded-md object-contain"
            />
          </button>
        )}
      </section>

      <section className="border-t p-4">
        <div className="grid grid-cols-2 gap-2">
          {[
            ['Owner', project.owner],
            ['Region', project.region],
            ['Updated', project.updated],
            ['Preset', project.lab?.presetKey ?? KIND_LABELS[project.kind]],
          ].map(([label, value]) => (
            <div key={label} className="rounded-md border bg-muted/20 px-3 py-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
              <div className="mt-0.5 truncate text-sm font-semibold text-foreground">{value}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
          <Layers className="h-4 w-4" />
          Resources
        </div>
        <div className="space-y-3">
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Layer Stack</div>
            <div className="flex flex-wrap gap-1.5">
              {project.layers.map((layer) => (
                <span key={layer.id} className="rounded-md border bg-muted/20 px-2 py-1 text-xs text-muted-foreground">
                  {layer.label}
                </span>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {project.catalogMetrics.map((metric) => (
              <div key={metric.label} className="rounded-md border bg-muted/20 px-3 py-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{metric.label}</div>
                <div className="mt-0.5 text-sm font-semibold text-foreground">{metric.value}</div>
              </div>
            ))}
          </div>

          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Files</div>
            <div className="space-y-2">
              {project.files.map((file) => (
                <div key={file.label} className="flex items-start gap-2 rounded-md border bg-muted/20 px-3 py-2">
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{file.label}</div>
                    <div className="text-xs leading-5 text-muted-foreground">{file.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {project.links && project.links.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Links</div>
              <div className="space-y-2">
                {project.links.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    target={link.href.startsWith('http') ? '_blank' : undefined}
                    rel={link.href.startsWith('http') ? 'noreferrer' : undefined}
                    className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
                  >
                    <span className="truncate">{link.label}</span>
                    <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </a>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Package</div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  // Catalog previews hold metadata-only summaries; download the
                  // real package (falls back to what we have if the fetch fails).
                  void findProjectPackageBySlug(project.slug).then((full) => downloadProjectPackage(full ?? project))
                }}
              >
                <Download className="h-4 w-4" />
                Download package
              </Button>
              {project.local && onRemove && (
                <Button type="button" variant="outline" size="sm" onClick={() => onRemove(project.slug)}>
                  <Trash2 className="h-4 w-4" />
                  Remove
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>

      {lightboxOpen && project.image && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={project.image.alt}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4"
          onClick={() => setLightboxOpen(false)}
        >
          <img src={project.image.src} alt={project.image.alt} className="max-h-full max-w-full object-contain" />
          <button
            type="button"
            aria-label="Close image"
            onClick={() => setLightboxOpen(false)}
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
    </>
  )
}

function ProjectBadges({ project, compact = false }: { project: ProjectPackage; compact?: boolean }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <span className={cn('rounded-md border px-2 py-0.5 text-xs font-semibold', accentClass(project))}>
        {KIND_LABELS[project.kind]}
      </span>
      {!compact && (
        <span className="rounded-md border bg-muted/30 px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {project.status}
        </span>
      )}
      {project.local && (
        <span className="rounded-md border border-dashed bg-muted/30 px-2 py-0.5 text-xs font-medium text-muted-foreground">
          Local
        </span>
      )}
    </div>
  )
}

function ProjectActions({
  project,
  onOpen,
  labLabel = 'Open in Index Lab',
}: {
  project: ProjectPackage
  onOpen: () => void
  labLabel?: string
}) {
  const labUrl = buildProjectLabUrl(project)
  return (
    <div className={cn('grid gap-2', labUrl ? 'sm:grid-cols-2' : '')}>
      <Button type="button" size="sm" onClick={onOpen}>
        Enter Project
        <ArrowRight className="h-4 w-4" />
      </Button>
      {labUrl && (
        <Button asChild variant="outline" size="sm">
          <Link to={labUrl}>
            <Settings2 className="h-4 w-4" />
            {labLabel}
          </Link>
        </Button>
      )}
    </div>
  )
}

function ProjectCatalogMobileCard({
  project,
  expanded,
  onToggleExpand,
  onOpen,
  onRemove,
}: {
  project: ProjectPackage
  expanded: boolean
  onToggleExpand: () => void
  onOpen: () => void
  onRemove: (slug: string) => void
}) {
  const labUrl = buildProjectLabUrl(project)

  return (
    <article className="overflow-hidden rounded-lg border bg-background shadow-sm">
      <div className="p-3">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-white',
              iconClass(project),
            )}
          >
            <FolderKanban className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <ProjectBadges project={project} compact />
            <h2 className="text-sm font-bold leading-tight text-foreground">{project.title}</h2>
          </div>
        </div>

        <p className={cn('mt-2 text-sm leading-6 text-muted-foreground', !expanded && 'line-clamp-2')}>
          {project.summary}
        </p>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button type="button" size="sm" className="min-h-11" onClick={onOpen}>
            Enter Project
            <ArrowRight className="h-4 w-4" />
          </Button>
          <button
            type="button"
            onClick={onToggleExpand}
            aria-expanded={expanded}
            className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md border bg-muted/20 px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50"
          >
            {expanded ? 'Hide details' : 'Details'}
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t">
          {labUrl && (
            <div className="border-b p-3">
              <Button asChild variant="outline" size="sm" className="min-h-11 w-full">
                <Link to={labUrl}>
                  <Settings2 className="h-4 w-4" />
                  Open in Index Lab
                </Link>
              </Button>
            </div>
          )}
          <ProjectDetailSections project={project} onRemove={onRemove} />
        </div>
      )}
    </article>
  )
}

function ProjectCatalogPreview({
  project,
  onOpenProject,
  onRemove,
}: {
  project: ProjectPackage
  onOpenProject: () => void
  onRemove: (slug: string) => void
}) {
  return (
    <aside className="hidden min-h-0 flex-col overflow-hidden rounded-lg border bg-background shadow-sm xl:flex">
      <div className="border-b p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <ProjectBadges project={project} />
            <h2 className="text-lg font-bold leading-tight text-foreground">{project.title}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{project.summary}</p>
          </div>
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-white',
              iconClass(project),
            )}
          >
            <FolderKanban className="h-5 w-5" />
          </div>
        </div>

        <div className="mt-4">
          <ProjectActions project={project} onOpen={onOpenProject} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <ProjectDetailSections project={project} onRemove={onRemove} />
      </div>
    </aside>
  )
}

function ProjectCatalogPage({
  projects,
  additionalProjectCount,
  showingMoreProjects,
  loading,
  loadError,
  query,
  onQueryChange,
  filter,
  onFilterChange,
  selectedProject,
  onSelectProject,
  onOpenProject,
  onImportFile,
  onRemoveProject,
  onToggleMoreProjects,
  importError,
}: {
  projects: ProjectPackage[]
  additionalProjectCount: number
  showingMoreProjects: boolean
  loading: boolean
  loadError: boolean
  query: string
  onQueryChange: (value: string) => void
  filter: CatalogFilter
  onFilterChange: (value: CatalogFilter) => void
  selectedProject: ProjectPackage | null
  onSelectProject: (slug: string) => void
  onOpenProject: (slug: string) => void
  onImportFile: (file: File) => void
  onRemoveProject: (slug: string) => void
  onToggleMoreProjects: () => void
  importError: string | null
}) {
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null)
  const desktop = useMediaQuery('(min-width: 1280px)')
  const resultsRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLElement>(null)
  const pagination = usePagination(projects, 12, JSON.stringify([query, filter, showingMoreProjects]))
  const changePage = (page: number) => {
    pagination.setPage(page)
    setExpandedSlug(null)
    resultsRef.current?.scrollTo({ top: 0 })
    headerRef.current?.scrollIntoView({ block: 'start' })
  }
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  function onToggleExpand(slug: string) {
    setExpandedSlug((current) => (current === slug ? null : slug))
  }

  const emptyMessage = loading
    ? 'Loading project packages…'
    : loadError
      ? 'The project manifest failed to load.'
      : 'No projects match the current search.'

  return (
    <div className="bg-muted/30 p-3 pt-[calc(env(safe-area-inset-top)+4rem)] text-foreground sm:p-5 sm:pt-[calc(env(safe-area-inset-top)+4rem)] md:pt-5 xl:h-[calc(100vh-4rem)] xl:min-h-0">
      <div className="mx-auto max-w-[98rem] gap-4 xl:grid xl:h-full xl:grid-cols-[minmax(0,1.35fr)_minmax(0,0.85fr)]">
        <section className="flex min-h-0 min-w-0 flex-col rounded-lg border bg-background shadow-sm">
          <header
            ref={headerRef}
            className="sticky top-16 z-20 shrink-0 scroll-mt-16 rounded-t-lg border-b bg-background p-3 sm:p-4 xl:static"
          >
            <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-end 2xl:justify-between">
              <div className="hidden min-w-0 sm:block">
                <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                  Open a project to explore its map and story, or send its recipe to Index Lab and play with the weights
                  yourself.
                </p>
              </div>

              <div className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-2 sm:grid-cols-[2.75rem_minmax(0,1fr)_10rem]">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-11 w-11 px-0 sm:h-9"
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Import project package"
                  title="Import project package"
                >
                  <Upload className="h-4 w-4" />
                </Button>
                <div className="relative col-span-2 row-start-1 min-w-0 sm:col-span-1 sm:col-start-2">
                  <Search className="pointer-events-none absolute left-3 top-3.5 sm:top-2.5 h-4 w-4 text-muted-foreground" />
                  <input
                    value={query}
                    onChange={(event) => onQueryChange(event.target.value)}
                    placeholder="Search projects"
                    aria-label="Search projects"
                    className="h-11 w-full rounded-md sm:h-9 border bg-background pl-9 pr-3 text-sm outline-none transition-shadow focus:ring-2 focus:ring-primary/25"
                  />
                </div>
                <AppSelect
                  value={filter}
                  onValueChange={(value) => onFilterChange(value as CatalogFilter)}
                  options={FILTER_OPTIONS}
                  triggerAriaLabel="Filter projects"
                  className="min-w-0"
                  triggerClassName="h-11 sm:h-9"
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) onImportFile(file)
                    event.target.value = ''
                  }}
                />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <span role="status" className="text-xs text-muted-foreground">
                {pagination.start}–{pagination.end} of {projects.length} projects
              </span>
              {additionalProjectCount > 0 && !query.trim() && filter === 'all' && (
                <Button
                  variant="outline"
                  className="h-11 sm:h-9"
                  aria-pressed={showingMoreProjects}
                  onClick={onToggleMoreProjects}
                >
                  {showingMoreProjects ? 'Show featured' : 'Browse all projects'}
                </Button>
              )}
            </div>
            {importError && (
              <div className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                {importError}
              </div>
            )}
          </header>

          {desktop ? (
            <div ref={resultsRef} className="min-h-0 flex-1 overflow-auto">
              <table className="w-full table-fixed border-separate border-spacing-0 text-left">
                <thead className="sticky top-0 z-10 bg-background text-xs uppercase tracking-wide text-muted-foreground shadow-[0_1px_0_0_hsl(var(--border))]">
                  <tr>
                    <th className="w-[48%] px-4 py-3 font-semibold">Project</th>
                    <th className="w-[20%] px-3 py-3 font-semibold">Type</th>
                    <th className="w-[18%] px-3 py-3 font-semibold">Resources</th>
                    <th className="w-[14%] px-4 py-3 text-right font-semibold">Open</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {pagination.items.map((project) => {
                    const active = selectedProject?.slug === project.slug
                    return (
                      <tr
                        key={project.slug}
                        className={cn('align-top transition-colors', active ? 'bg-primary/5' : 'hover:bg-muted/30')}
                      >
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => onSelectProject(project.slug)}
                            className="flex w-full min-w-0 items-start gap-3 text-left"
                          >
                            <span
                              className={cn(
                                'flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-white',
                                iconClass(project),
                              )}
                            >
                              <FolderKanban className="h-4 w-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex min-w-0 items-center gap-2">
                                <span className="truncate text-sm font-semibold text-foreground">{project.title}</span>
                                {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
                              </span>
                              <span className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                                {project.summary}
                              </span>
                            </span>
                          </button>
                        </td>
                        <td className="px-3 py-3">
                          <div>
                            <span
                              className={cn(
                                'inline-flex rounded-md border px-2 py-0.5 text-xs font-semibold',
                                accentClass(project),
                              )}
                            >
                              {KIND_LABELS[project.kind]}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-xs leading-5 text-muted-foreground">
                          <div>
                            <span className="font-medium text-foreground">
                              {project.catalogCounts?.layers ?? project.layers.length}
                            </span>{' '}
                            layers
                          </div>
                          <div>
                            <span className="font-medium text-foreground">
                              {project.catalogCounts?.scenes ?? project.scenes.length}
                            </span>{' '}
                            scenes
                          </div>
                          <div>
                            <span className="font-medium text-foreground">{project.lab ? 'Lab' : 'Story'}</span> recipe
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            type="button"
                            variant={active ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => onOpenProject(project.slug)}
                          >
                            Enter
                            <ArrowRight className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              {projects.length === 0 && (
                <div className="p-8 text-center text-sm text-muted-foreground">{emptyMessage}</div>
              )}
            </div>
          ) : (
            <div ref={resultsRef} className="grid gap-3 p-3 md:grid-cols-2">
              {pagination.items.map((project) => (
                <ProjectCatalogMobileCard
                  key={project.slug}
                  project={project}
                  expanded={expandedSlug === project.slug}
                  onToggleExpand={() => onToggleExpand(project.slug)}
                  onOpen={() => onOpenProject(project.slug)}
                  onRemove={onRemoveProject}
                />
              ))}
              {projects.length === 0 && (
                <div className="p-8 text-center text-sm text-muted-foreground">{emptyMessage}</div>
              )}
            </div>
          )}
          {pagination.pageCount > 1 && (
            <PaginationControls
              label="Project pages"
              page={pagination.page}
              pageCount={pagination.pageCount}
              onPageChange={changePage}
            />
          )}
        </section>

        {desktop &&
          (selectedProject ? (
            <ProjectCatalogPreview
              project={selectedProject}
              onOpenProject={() => onOpenProject(selectedProject.slug)}
              onRemove={onRemoveProject}
            />
          ) : (
            <aside className="hidden min-h-0 items-center justify-center rounded-lg border bg-background p-6 text-center text-sm text-muted-foreground shadow-sm xl:flex">
              Select a project to preview its details.
            </aside>
          ))}
      </div>
    </div>
  )
}

export default function DevProjects() {
  const { projects, loading, loadError, importProject, removeProject } = useProjectPackages()
  const navigate = useNavigate()
  const { projectSlug: routeProjectSlug } = useParams<{ projectSlug?: string }>()
  const [searchParams] = useSearchParams()
  const legacyProjectSlug = searchParams.get('project')
  const projectSlug = routeProjectSlug ?? legacyProjectSlug
  // Catalog entries are metadata-only summaries; a routed project needs its
  // full package, fetched on demand (one file, not the whole manifest).
  const [routedProject, setRoutedProject] = useState<{ slug: string; pkg: ProjectPackage | null } | null>(null)
  useEffect(() => {
    if (!projectSlug) return
    let cancelled = false
    findProjectPackageBySlug(projectSlug).then((pkg) => {
      if (!cancelled) setRoutedProject({ slug: projectSlug, pkg })
    })
    return () => {
      cancelled = true
    }
  }, [projectSlug])
  const routedProjectReady = !projectSlug || routedProject?.slug === projectSlug
  const selectedProject = projectSlug && routedProject?.slug === projectSlug ? routedProject.pkg : null
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<CatalogFilter>('all')
  const [showingMoreProjects, setShowingMoreProjects] = useState(false)
  const [previewProjectSlug, setPreviewProjectSlug] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  // Preserve old shared links while making every project URL path-based and canonical.
  useEffect(() => {
    if (routeProjectSlug || !legacyProjectSlug) return
    navigate(`/dev/projects/${encodeURIComponent(legacyProjectSlug)}`, { replace: true })
  }, [legacyProjectSlug, navigate, routeProjectSlug])

  const matchingProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return projects.filter((project) => {
      if (filter !== 'all' && project.kind !== filter) return false
      if (!normalizedQuery) return true
      return `${project.slug} ${project.title} ${project.summary} ${project.lab?.presetKey ?? ''}`
        .toLowerCase()
        .includes(normalizedQuery)
    })
  }, [filter, projects, query])

  const { featuredProjects, additionalProjects } = useMemo(() => {
    const featured: ProjectPackage[] = []
    const additional: ProjectPackage[] = []

    for (const project of matchingProjects) {
      if (FEATURED_PROJECT_ORDER.has(project.slug)) featured.push(project)
      else additional.push(project)
    }

    featured.sort((left, right) => FEATURED_PROJECT_ORDER.get(left.slug)! - FEATURED_PROJECT_ORDER.get(right.slug)!)

    return { featuredProjects: featured, additionalProjects: additional }
  }, [matchingProjects])

  const filteredProjects =
    showingMoreProjects || query.trim() || filter !== 'all'
      ? [...featuredProjects, ...additionalProjects]
      : featuredProjects
  const selectedPreviewProject =
    filteredProjects.find((project) => project.slug === previewProjectSlug) ?? filteredProjects[0] ?? null

  function openProject(slug: string) {
    navigate(`/dev/projects/${encodeURIComponent(slug)}`)
  }

  function backToCatalog() {
    navigate('/dev/projects')
  }

  async function handleImportFile(file: File) {
    try {
      const imported = await importProject(file)
      setImportError(null)
      setShowingMoreProjects(true)
      setPreviewProjectSlug(imported.slug)
      setFilter('all')
      setQuery(imported.slug)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'The file could not be imported.')
    }
  }

  function handleRemoveProject(slug: string) {
    removeProject(slug)
    if (projectSlug === slug) backToCatalog()
    if (previewProjectSlug === slug) setPreviewProjectSlug(null)
  }

  useProjectCatalogWebMCP({
    active: !projectSlug,
    projects,
    navigate,
  })

  if (projectSlug && !routedProjectReady) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center text-sm text-muted-foreground">
        Loading project package…
      </div>
    )
  }

  if (selectedProject) {
    return (
      <Suspense
        fallback={
          <div role="status" className="flex h-full items-center justify-center p-8">
            Loading project…
          </div>
        }
      >
        <ProjectWorkspace key={selectedProject.slug} project={selectedProject} onBack={backToCatalog} />
      </Suspense>
    )
  }

  return (
    <ProjectCatalogPage
      projects={filteredProjects}
      additionalProjectCount={additionalProjects.length}
      showingMoreProjects={showingMoreProjects}
      loading={loading}
      loadError={loadError}
      query={query}
      onQueryChange={setQuery}
      filter={filter}
      onFilterChange={setFilter}
      selectedProject={selectedPreviewProject}
      onSelectProject={setPreviewProjectSlug}
      onOpenProject={openProject}
      onImportFile={handleImportFile}
      onRemoveProject={handleRemoveProject}
      onToggleMoreProjects={() => setShowingMoreProjects((current) => !current)}
      importError={importError}
    />
  )
}
