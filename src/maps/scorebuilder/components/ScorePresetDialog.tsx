import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { SCORE_PRESETS, getScoreDataSourcesForWeights, getScorePresetMethodology } from '../constants'

type ScorePreset = (typeof SCORE_PRESETS)[number]

interface ScorePresetDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  presets: ScorePreset[]
  activePresetKey: string | null
  onApplyPreset: (presetKey: string) => void
}

const PRESET_GROUPS = [
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

function getDataSourceLabel(source: string): string {
  if (source === 'airQuality') return 'Air'
  if (source === 'parks') return 'Parks'
  if (source === 'heatShade') return 'Heat/Shade'
  if (source === 'restaurants') return 'Food'
  if (source === 'census') return 'Census'
  if (source === 'bcAssessment') return 'Property'
  if (source === 'crime') return 'Crime'
  if (source === 'transit') return 'Transit'
  if (source === 'deprivation') return 'CIMD'
  return source
}

export function ScorePresetDialog({
  open,
  onOpenChange,
  presets,
  activePresetKey,
  onApplyPreset,
}: ScorePresetDialogProps) {
  const [query, setQuery] = useState('')
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

  const applyPreset = (presetKey: string) => {
    onApplyPreset(presetKey)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border px-6 pb-4 pt-6">
          <DialogTitle>Browse Presets</DialogTitle>
          <DialogDescription>Pick a recipe to reset the active weights and required data sources.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 overflow-y-auto px-6 pb-6">
          <div className="relative pt-1">
            <Search className="pointer-events-none absolute left-3 top-[1.05rem] h-4 w-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search presets..."
              className="w-full rounded-lg border border-input bg-background px-3 py-2 pl-9 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
          </div>

          {groupedPresets.map((group) => (
            <section key={group.key}>
              <div className="mb-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </div>
                <div className="text-[11px] text-muted-foreground">{group.description}</div>
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
                      onClick={() => applyPreset(preset.key)}
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
                          <span className="rounded bg-cyan-100 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-800 dark:bg-cyan-900/50 dark:text-cyan-100">
                            Active
                          </span>
                        )}
                      </div>
                      <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{preset.description}</div>
                      <div className="mt-2 grid gap-1 text-[10px] text-muted-foreground">
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
                            className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
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

          {groupedPresets.length === 0 && (
            <div className="rounded border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              No presets match that search.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
