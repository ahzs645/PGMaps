import { useEffect, useMemo, useState } from 'react'
import { ChevronsLeft, ChevronsRight } from 'lucide-react'
import { CensusMap } from './components/CensusMap'
import { CensusSidebar } from './components/CensusSidebar'
import { CENSUS_HIERARCHIES, CENSUS_METRICS } from './constants'
import { useCensusData } from './hooks/useCensusData'
import type { CensusArea, CensusHierarchyLevel, CensusMetricKey, CensusUnit } from './types'

const LEGEND_SWATCHES = ['#fef3c7', '#fde68a', '#fbbf24', '#f59e0b', '#b45309']

function getAreaHierarchyId(area: CensusArea, hierarchy: CensusHierarchyLevel): string {
  switch (hierarchy) {
    case 'rpid':
      return area.rpid || area.id
    case 'rgid':
      return area.rgid || area.id
    case 'ruid':
      return area.ruid || area.id
    case 'rguid':
      return area.rguid || area.id
    case 'da':
    default:
      return area.id
  }
}

function getUnitName(level: CensusHierarchyLevel, id: string, area: CensusArea): string {
  if (level === 'da') {
    return area.name || `DA ${id}`
  }
  return `${level.toUpperCase()} ${id}`
}

function aggregateUnits(areas: CensusArea[], level: CensusHierarchyLevel): CensusUnit[] {
  const map = new Map<string, CensusUnit>()

  areas.forEach((area) => {
    const id = getAreaHierarchyId(area, level)
    const existing = map.get(id)

    if (!existing) {
      map.set(id, {
        id,
        level,
        name: getUnitName(level, id, area),
        daCount: 1,
        population: area.population,
        populationDensity: null,
        households: area.households,
        dwellings: area.dwellings,
        areaSqKm: area.areaSqKm
      })
      return
    }

    existing.daCount += 1
    existing.population = (existing.population || 0) + (area.population || 0)
    existing.households = (existing.households || 0) + (area.households || 0)
    existing.dwellings = (existing.dwellings || 0) + (area.dwellings || 0)
    existing.areaSqKm = (existing.areaSqKm || 0) + (area.areaSqKm || 0)
  })

  const units = Array.from(map.values()).map((unit) => {
    const population = unit.population || 0
    const areaSqKm = unit.areaSqKm || 0
    return {
      ...unit,
      populationDensity: areaSqKm > 0 ? population / areaSqKm : null
    }
  })

  units.sort((a, b) => a.id.localeCompare(b.id))
  return units
}

export default function CensusSection() {
  const { areas, bounds, loading, error } = useCensusData()
  const [showSidebar, setShowSidebar] = useState(true)
  const [selectedHierarchy, setSelectedHierarchy] = useState<CensusHierarchyLevel>('da')
  const [selectedMetric, setSelectedMetric] = useState<CensusMetricKey>('populationDensity')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null)

  const allUnits = useMemo(() => {
    return aggregateUnits(areas, selectedHierarchy)
  }, [areas, selectedHierarchy])

  const filteredUnits = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return allUnits
    return allUnits.filter((unit) => {
      return unit.id.toLowerCase().includes(query) || unit.name.toLowerCase().includes(query)
    })
  }, [allUnits, searchQuery])

  const selectedUnit = useMemo(() => {
    if (!selectedUnitId) return null
    return filteredUnits.find((unit) => unit.id === selectedUnitId)
      || allUnits.find((unit) => unit.id === selectedUnitId)
      || null
  }, [allUnits, filteredUnits, selectedUnitId])

  const selectedMetricLabel = useMemo(() => {
    return CENSUS_METRICS.find((item) => item.key === selectedMetric)?.label || 'Metric'
  }, [selectedMetric])

  const selectedHierarchyLabel = useMemo(() => {
    return CENSUS_HIERARCHIES.find((item) => item.key === selectedHierarchy)?.label || 'Hierarchy'
  }, [selectedHierarchy])

  useEffect(() => {
    setSelectedUnitId(null)
  }, [selectedHierarchy])

  return (
    <div className="relative flex h-full w-full bg-slate-100 dark:bg-slate-950">
      {showSidebar && (
        <CensusSidebar
          units={allUnits}
          filteredUnits={filteredUnits}
          selectedUnit={selectedUnit}
          selectedMetric={selectedMetric}
          selectedHierarchy={selectedHierarchy}
          searchQuery={searchQuery}
          loading={loading}
          error={error}
          onMetricChange={setSelectedMetric}
          onHierarchyChange={setSelectedHierarchy}
          onSearchQueryChange={setSearchQuery}
          onUnitClick={(unit) => setSelectedUnitId(unit.id)}
          onClearSelection={() => setSelectedUnitId(null)}
        />
      )}

      <button
        onClick={() => setShowSidebar(!showSidebar)}
        aria-label={showSidebar ? 'Hide sidebar' : 'Show sidebar'}
        className={`absolute top-6 z-20 flex h-10 w-8 items-center justify-center border border-l-0 border-slate-300/80 bg-slate-50/95 text-slate-600 shadow-md backdrop-blur transition-[left,background-color,color,border-color] hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-200 dark:hover:bg-slate-800 ${
          showSidebar ? 'left-[350px] rounded-r-lg' : 'left-0 rounded-r-lg'
        }`}
      >
        {showSidebar ? <ChevronsLeft className="h-4 w-4" /> : <ChevronsRight className="h-4 w-4" />}
      </button>

      <div className="relative flex-1">
        <CensusMap
          areas={areas}
          units={allUnits}
          selectedMetric={selectedMetric}
          selectedHierarchy={selectedHierarchy}
          selectedUnitId={selectedUnitId}
          bounds={bounds}
          onUnitClick={(id) => setSelectedUnitId(id)}
        />

        <div className="absolute bottom-6 right-6 z-10 rounded-xl border border-border bg-background/95 p-4 shadow-xl backdrop-blur">
          <h4 className="mb-1 text-xs font-semibold text-foreground">{selectedHierarchyLabel}</h4>
          <h5 className="mb-2 text-xs text-muted-foreground">{selectedMetricLabel}</h5>
          <div className="flex items-center gap-1.5">
            {LEGEND_SWATCHES.map((color) => (
              <span
                key={color}
                className="h-3 w-6 rounded-sm border border-black/10 dark:border-white/10"
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
          <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>Low</span>
            <span>High</span>
          </div>
        </div>
      </div>
    </div>
  )
}
