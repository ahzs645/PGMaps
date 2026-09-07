import { Bookmark, Download, FolderKanban, Search, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  buildProjectLabUrl,
  buildProjectPackageFromShareState,
  downloadProjectPackage,
  loadLocalProjectPackages,
  loadStaticProjectPackages,
  type ProjectPackage,
} from '@/lib/projectPackages'
import { SCORE_PRESETS, getScoreDataSourcesForWeights, getScorePresetMethodology } from '../constants'
import type { SavedIndexEntry } from '../lib/savedIndexes'
import { ExamplesTab } from './ExamplesTab'
import { getDataSourceLabel } from './scoreBuilderPanelUtils'

type ScorePreset = (typeof SCORE_PRESETS)[number]

export type RecipesTab = 'examples' | 'presets' | 'projects' | 'mine'

const TAB_ORDER: RecipesTab[] = ['examples', 'presets', 'projects', 'mine']
const TAB_LABELS: Record<RecipesTab, string> = {
  examples: 'Examples',
  presets: 'Presets',
  projects: 'Projects',
  mine: 'My indexes',
}
const TAB_DESCRIPTIONS: Record<RecipesTab, string> = {
  examples: 'Story-driven recipes that wire a boundary, data sources, and weights together.',
  presets: 'Planning presets that reset the active weights and required data sources.',
  projects: 'Guided project packages. Opening one loads its recipe and pins it as the comparison baseline.',
  mine: 'Name and reload index recipes saved on this device, or download one as a package.',
}

const PRESET_GROUPS = [
  {
    key: 'indexLab',
    label: 'Index Lab Packs',
    description: 'Planning presets for equity, heat, smoke, flood, access, housing, walkability, and local burden.',
  },
  {
    key: 'pairwise',
    label: 'Pairwise Equity',
    description: 'HealthyPlan-style high-need plus low-benefit overlays; these are not weighted composite scores.',
  },
  {
    key: 'hbe',
    label: 'Healthy Built Environment',
    description: 'BCCDC HBE Linkages Toolkit recipes for neighbourhoods, mobility, nature, food, and housing.',
  },
  {
    key: 'air',
    label: 'Air Monitoring',
    description: 'Coverage, reference strength, and sensor-gap recipes.',
  },
  {
    key: 'health',
    label: 'Climate & Community Health',
    description: 'Proxy vulnerability, resilience, heat, shade, and retrofit needs.',
  },
  {
    key: 'livability',
    label: 'Livability & Access',
    description: 'Parks, food access, complete neighbourhoods, and service mix.',
  },
  {
    key: 'housing',
    label: 'Housing & Development',
    description: 'Affordability, redevelopment pressure, and parcel change.',
  },
  {
    key: 'risk',
    label: 'Food & Safety Pressure',
    description: 'Inspection pressure, crime pressure, and other burden-oriented recipes.',
  },
] as const

function getPresetGroupKey(preset: ScorePreset): (typeof PRESET_GROUPS)[number]['key'] {
  if (preset.key.startsWith('healthyPlan')) return 'pairwise'
  if (
    [
      'pgEnvironmentalJusticeProxy',
      'pgSocialEnvironmentalRank',
      'heatReliefPriority',
      'parkAccessEquity',
      'accessPg15Minute',
      'housingClimateRisk',
      'activeLivingWalkability',
      'smokeVulnerabilityProxy',
      'floodVulnerabilityProxy',
      'industrialBurdenProxy',
      'transitEquity',
      'investmentPriority',
    ].includes(preset.key)
  ) {
    return 'indexLab'
  }
  if (preset.key.startsWith('hbe')) return 'hbe'
  if (
    preset.key.includes('Coverage') ||
    preset.key.includes('lowCost') ||
    preset.key.includes('reference') ||
    preset.key.includes('sensor') ||
    preset.key.includes('monitoring') ||
    preset.key.includes('Monitoring')
  ) {
    return 'air'
  }
  if (
    preset.key.includes('climate') ||
    preset.key.includes('Climate') ||
    preset.key.includes('heat') ||
    preset.key.includes('Heat') ||
    preset.key.includes('resilience') ||
    preset.key.includes('Resilience') ||
    preset.key.includes('Retrofit')
  ) {
    return 'health'
  }
  if (
    preset.key.includes('livability') ||
    preset.key.includes('environmentalHealth') ||
    preset.key.includes('complete') ||
    preset.key.includes('school') ||
    preset.key.includes('foodSafetyAccess') ||
    preset.key.includes('transit')
  ) {
    return 'livability'
  }
  if (preset.key.includes('housing') || preset.key.includes('redevelopment') || preset.key.includes('affordability')) {
    return 'housing'
  }
  return 'risk'
}

export interface RecipesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  presets: ScorePreset[]
  activePresetKey: string | null
  onApplyPreset: (presetKey: string) => void
  activeExampleKey: string | null
  onApplyExample: (key: string) => void
  savedIndexes: SavedIndexEntry[]
  onSaveIndex: (label: string) => void
  onApplySavedIndex: (id: string) => void
  onDeleteSavedIndex: (id: string) => void
  onExportProjectPackage?: (label: string) => void
  activeRecipeLabel: string
}

/**
 * The single "load a recipe" surface: examples, presets, project packages, and the
 * user's own saved indexes. Replaces the separate preset dialog plus the Examples
 * and My indexes tabs that used to live in the settings dialog.
 */
export function RecipesDialog({
  open,
  onOpenChange,
  presets,
  activePresetKey,
  onApplyPreset,
  activeExampleKey,
  onApplyExample,
  savedIndexes,
  onSaveIndex,
  onApplySavedIndex,
  onDeleteSavedIndex,
  onExportProjectPackage,
  activeRecipeLabel,
}: RecipesDialogProps) {
  const [activeTab, setActiveTab] = useState<RecipesTab>('examples')
  const [query, setQuery] = useState('')
  const [saveLabel, setSaveLabel] = useState('')

  const normalizedQuery = query.trim().toLowerCase()
  const groupedPresets = useMemo(() => {
    return PRESET_GROUPS.map((group) => ({
      ...group,
      presets: presets.filter((preset) => {
        if (getPresetGroupKey(preset) !== group.key) return false
        if (!normalizedQuery) return true
        return `${preset.label} ${preset.description}`.toLowerCase().includes(normalizedQuery)
      }),
    })).filter((group) => group.presets.length > 0)
  }, [normalizedQuery, presets])

  // Project packages load lazily on first open.
  const [projects, setProjects] = useState<ProjectPackage[] | null>(null)
  useEffect(() => {
    if (!open || projects !== null) return
    let cancelled = false
    loadStaticProjectPackages()
      .then((staticPackages) => {
        if (cancelled) return
        const staticSlugs = new Set(staticPackages.map((pkg) => pkg.slug))
        const locals = loadLocalProjectPackages().filter((pkg) => !staticSlugs.has(pkg.slug))
        setProjects([...staticPackages, ...locals].filter((pkg) => pkg.lab))
      })
      .catch(() => {
        if (!cancelled) setProjects([])
      })
    return () => {
      cancelled = true
    }
  }, [open, projects])

  const filteredProjects = useMemo(() => {
    if (!projects) return []
    if (!normalizedQuery) return projects
    return projects.filter((pkg) => `${pkg.title} ${pkg.summary}`.toLowerCase().includes(normalizedQuery))
  }, [normalizedQuery, projects])

  const close = () => onOpenChange(false)

  const openProject = (pkg: ProjectPackage) => {
    const url = buildProjectLabUrl(pkg)
    if (url) window.location.assign(url)
  }

  const handleSaveIndex = () => {
    onSaveIndex(saveLabel.trim() || activeRecipeLabel)
    setSaveLabel('')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        variant="sheet"
        elevated
        className="sm:max-h-[88vh] sm:w-[min(880px,calc(100vw-2rem))] sm:max-w-[880px]"
        data-score-builder-recipes-dialog="true"
      >
        <DialogHeader className="shrink-0 border-b border-border px-5 pb-3 pt-5 sm:px-6 sm:pt-6">
          <DialogTitle>Recipes</DialogTitle>
          <DialogDescription>{TAB_DESCRIPTIONS[activeTab]}</DialogDescription>
        </DialogHeader>

        <div
          role="tablist"
          aria-label="Recipe sources"
          className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-muted/40 px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {TAB_ORDER.map((tab) => (
            <button
              key={tab}
              role="tab"
              type="button"
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'shrink-0 rounded-md px-3 py-2 text-xs font-medium transition-colors',
                activeTab === tab
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
              )}
            >
              {TAB_LABELS[tab]}
              {tab === 'mine' && savedIndexes.length > 0 && (
                <span className="ml-1.5 rounded bg-muted px-1.5 text-xs text-muted-foreground">{savedIndexes.length}</span>
              )}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:pb-4">
          {activeTab === 'examples' && (
            <ExamplesTab
              activeExampleKey={activeExampleKey}
              onApplyExample={(key) => {
                onApplyExample(key)
                close()
              }}
            />
          )}

          {(activeTab === 'presets' || activeTab === 'projects') && (
            <div className="space-y-4 p-4 sm:px-6">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={activeTab === 'presets' ? 'Search presets...' : 'Search projects...'}
                  className="h-10 w-full rounded-lg border border-input bg-background px-3 pl-9 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>

              {activeTab === 'projects' &&
                (projects === null ? (
                  <div className="text-xs text-muted-foreground">Loading projects...</div>
                ) : filteredProjects.length === 0 ? (
                  <div className="rounded border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                    {normalizedQuery ? 'No projects match that search.' : 'No project packages yet.'}
                  </div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {filteredProjects.map((pkg) => (
                      <button
                        key={pkg.slug}
                        type="button"
                        onClick={() => openProject(pkg)}
                        className="rounded-lg border border-border bg-background p-3 text-left transition-colors hover:border-cyan-400 hover:bg-cyan-50/60 dark:hover:bg-cyan-950/25"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-sm font-semibold text-foreground">{pkg.title}</div>
                          <FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground" />
                        </div>
                        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{pkg.summary}</div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                            {pkg.lab?.boundaryLevel.toUpperCase()}
                          </span>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                            {Object.keys(pkg.lab?.weights ?? {}).length} metrics
                          </span>
                          {pkg.local && (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                              Local
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                ))}

              {activeTab === 'presets' &&
                groupedPresets.map((group) => (
                  <section key={group.key}>
                    <div className="mb-2">
                      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {group.label}
                      </div>
                      <div className="text-xs text-muted-foreground">{group.description}</div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {group.presets.map((preset) => {
                        const active = preset.key === activePresetKey
                        const sources = getScoreDataSourcesForWeights(preset.weights)
                        const methodology = getScorePresetMethodology(preset)
                        return (
                          <button
                            key={preset.key}
                            type="button"
                            onClick={() => {
                              onApplyPreset(preset.key)
                              close()
                            }}
                            className={cn(
                              'rounded-lg border p-3 text-left transition-colors',
                              active
                                ? 'border-cyan-500 bg-cyan-50 ring-1 ring-cyan-500/30 dark:bg-cyan-950/35'
                                : 'border-border bg-background hover:border-cyan-400 hover:bg-cyan-50/60 dark:hover:bg-cyan-950/25',
                            )}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="text-sm font-semibold text-foreground">{preset.label}</div>
                              {active && (
                                <span className="rounded bg-cyan-100 px-1.5 py-0.5 text-xs font-semibold text-cyan-800 dark:bg-cyan-900/50 dark:text-cyan-100">
                                  Active
                                </span>
                              )}
                            </div>
                            <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{preset.description}</div>
                            <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                              <div>
                                <span className="font-semibold text-foreground">Purpose:</span> {methodology.purpose}
                              </div>
                              <div>
                                <span className="font-semibold text-foreground">Components:</span>{' '}
                                {methodology.components.join(', ') || 'Custom metrics'}
                              </div>
                              <div>
                                <span className="font-semibold text-foreground">Normalization:</span>{' '}
                                {methodology.normalization}
                              </div>
                              {methodology.proxy && (
                                <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-200">
                                  Proxy recipe: needs more data before it should be treated as a validated index.
                                </div>
                              )}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1">
                              {sources.map((source) => (
                                <span
                                  key={source}
                                  className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                                >
                                  {getDataSourceLabel(source)}
                                </span>
                              ))}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </section>
                ))}

              {activeTab === 'presets' && groupedPresets.length === 0 && (
                <div className="rounded border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                  No presets match that search.
                </div>
              )}
            </div>
          )}

          {activeTab === 'mine' && (
            <div className="space-y-4 p-4 sm:px-6" data-score-builder-saved-indexes="true">
              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <div className="text-xs font-semibold text-foreground">Save current index</div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Stores the boundary, data sources, weights, custom metrics, and method settings on this device.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <input
                    value={saveLabel}
                    onChange={(event) => setSaveLabel(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') handleSaveIndex()
                    }}
                    placeholder={activeRecipeLabel}
                    aria-label="Index name"
                    className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  />
                  <button
                    type="button"
                    onClick={handleSaveIndex}
                    className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md border border-cyan-500 bg-cyan-500 px-3 text-xs font-medium text-white transition-colors hover:bg-cyan-600"
                  >
                    <Bookmark className="h-3.5 w-3.5" />
                    Save
                  </button>
                  {onExportProjectPackage && (
                    <button
                      type="button"
                      onClick={() => onExportProjectPackage(saveLabel)}
                      title="Download the current recipe as a project package file"
                      className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md border border-input px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Package
                    </button>
                  )}
                </div>
                {onExportProjectPackage && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    A package file can be imported on the Projects page or shared with someone else.
                  </p>
                )}
              </div>

              {savedIndexes.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  No saved indexes yet. Save the current recipe above to reload it later.
                </div>
              ) : (
                <div className="space-y-2">
                  {savedIndexes.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background p-3"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">{entry.label}</div>
                        <div className="text-xs text-muted-foreground">
                          Saved {new Date(entry.savedAt).toLocaleDateString()} ·{' '}
                          {entry.state.enabledDataSources.length} sources
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            onApplySavedIndex(entry.id)
                            close()
                          }}
                          className="h-10 rounded-md border border-input px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted md:h-8"
                        >
                          Load
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            downloadProjectPackage(buildProjectPackageFromShareState(entry.state, entry.label))
                          }
                          title="Download as project package"
                          aria-label={`Download ${entry.label} as a project package`}
                          className="flex h-10 w-10 items-center justify-center rounded-md border border-input text-muted-foreground transition-colors hover:text-foreground md:h-8 md:w-8"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteSavedIndex(entry.id)}
                          title="Delete saved index"
                          aria-label={`Delete ${entry.label}`}
                          className="flex h-10 w-10 items-center justify-center rounded-md border border-input text-muted-foreground transition-colors hover:text-red-600 md:h-8 md:w-8"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
