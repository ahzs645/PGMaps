import { Bookmark, Download, FolderKanban, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { PanelDialog } from '@/components/ui/dialog-shell'
import { InlineAlert, SearchInput } from '@/components/ui/map-panels'
import { EmptyHint, ListState } from '@/components/ui/result-list'
import { TabBar } from '@/components/ui/tab-bar'
import { DEFAULT_LOCALE } from '@/lib/format'
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

  const tabOptions = TAB_ORDER.map((tab) => ({
    value: tab,
    label: TAB_LABELS[tab],
    badge: tab === 'mine' && savedIndexes.length > 0 ? savedIndexes.length : undefined,
  }))

  return (
    <PanelDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Recipes"
      subtitle={TAB_DESCRIPTIONS[activeTab]}
      className="sm:max-h-[88vh] sm:w-[min(880px,calc(100vw-2rem))] sm:max-w-[880px]"
      bodyClassName="p-0 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:p-0 sm:pb-4"
      contentProps={{ 'data-score-builder-recipes-dialog': 'true' }}
      toolbar={
        <TabBar
          value={activeTab}
          options={tabOptions}
          onChange={setActiveTab}
          label="Recipe sources"
          className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        />
      }
    >
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
          <SearchInput
            icon
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onClear={() => setQuery('')}
            placeholder={activeTab === 'presets' ? 'Search presets...' : 'Search projects...'}
            aria-label={activeTab === 'presets' ? 'Search presets' : 'Search projects'}
            className="focus:ring-cyan-500"
          />

          {activeTab === 'projects' &&
            (projects === null ? (
              <ListState loading loadingLabel="Loading projects..." className="p-2" />
            ) : filteredProjects.length === 0 ? (
              <EmptyHint>{normalizedQuery ? 'No projects match that search.' : 'No project packages yet.'}</EmptyHint>
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
                      <Badge pill>{pkg.lab?.boundaryLevel.toUpperCase()}</Badge>
                      <Badge pill>{Object.keys(pkg.lab?.weights ?? {}).length} metrics</Badge>
                      {pkg.local && <Badge pill>Local</Badge>}
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
                            <Badge tone="cyan" className="font-semibold">
                              Active
                            </Badge>
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
                            <InlineAlert tone="warning" className="px-2 py-1">
                              Proxy recipe: needs more data before it should be treated as a validated index.
                            </InlineAlert>
                          )}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {sources.map((source) => (
                            <Badge key={source} pill>
                              {getDataSourceLabel(source)}
                            </Badge>
                          ))}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </section>
            ))}

          {activeTab === 'presets' && groupedPresets.length === 0 && (
            <EmptyHint>No presets match that search.</EmptyHint>
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
            <EmptyHint>No saved indexes yet. Save the current recipe above to reload it later.</EmptyHint>
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
                      Saved {new Date(entry.savedAt).toLocaleDateString(DEFAULT_LOCALE)} ·{' '}
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
                      className="h-8 rounded-md border border-input px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted touch:h-10"
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
                      className="flex h-8 w-8 items-center justify-center rounded-md border border-input text-muted-foreground transition-colors hover:text-foreground touch:h-10 touch:w-10"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteSavedIndex(entry.id)}
                      title="Delete saved index"
                      aria-label={`Delete ${entry.label}`}
                      className="flex h-8 w-8 items-center justify-center rounded-md border border-input text-muted-foreground transition-colors hover:text-red-600 touch:h-10 touch:w-10"
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
    </PanelDialog>
  )
}
