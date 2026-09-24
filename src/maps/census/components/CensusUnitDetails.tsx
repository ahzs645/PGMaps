import { KeyValueRows } from '@/components/ui/map-panels'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { formatAreaSqKm, formatValue } from '../constants'
import type { CensusUnit } from '../types'

interface CensusUnitDetailsProps {
  unit: CensusUnit
  isVariableMode: boolean
  metricLabel: string
  metricValue: string
  variableCategoryName: string | null
  variableLabel: string | null
  variableValue: number | null
  className?: string
}

/** The selected unit's headline value and counts, shared by the sidebar card and the phone card. */
export function CensusUnitDetails({
  unit,
  isVariableMode,
  metricLabel,
  metricValue,
  variableCategoryName,
  variableLabel,
  variableValue,
  className,
}: CensusUnitDetailsProps) {
  return (
    <div className={cn('space-y-2', className)}>
      {isVariableMode ? (
        <div>
          <div className="text-xs text-amber-700 dark:text-amber-300">{variableCategoryName}</div>
          <div className="text-2xl font-bold text-amber-800 dark:text-amber-200">{formatValue(variableValue)}</div>
          <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">{variableLabel}</div>
        </div>
      ) : (
        <div>
          <div className="text-2xl font-bold text-amber-800 dark:text-amber-200">{metricValue}</div>
          <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">{metricLabel}</div>
        </div>
      )}
      <KeyValueRows
        rows={[
          { label: 'Area', value: `${formatAreaSqKm(unit.areaSqKm)} km²` },
          { label: 'Population', value: formatNumber(unit.population || 0) },
          { label: 'Households', value: formatNumber(unit.households || 0) },
          { label: 'Dwellings', value: formatNumber(unit.dwellings || 0) },
          { label: 'DA count', value: formatNumber(unit.daCount) },
          { label: 'DB count', value: formatNumber(unit.dbCount) },
        ]}
      />
    </div>
  )
}
