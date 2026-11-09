import { ComparisonDialog } from './ComparisonDialog'
import { CurrentAnalysisDialog } from './CurrentAnalysisDialog'
import { LegacyAnalysisDialog } from './LegacyAnalysisDialog'
import { ShinyReportDialog } from './ShinyReportDialog'
import type { useComparisonSnapshots } from './useComparisonSnapshots'
import type { CcissAnalysisMode } from './workspace'

/** The open analysis, if any. Every analysis can save into, and open, the page's one comparison collection. */
export function AnalysisDialogs({
  mode,
  point,
  onPointChange,
  comparisons,
  onOpenComparison,
  onClose,
}: {
  mode: CcissAnalysisMode
  point: [number, number]
  onPointChange: (point: [number, number]) => void
  comparisons: ReturnType<typeof useComparisonSnapshots>
  onOpenComparison: () => void
  onClose: () => void
}) {
  const capture = {
    onClose,
    onCaptureComparison: comparisons.save,
    onOpenComparison,
    comparisonCount: comparisons.snapshots.length,
  }
  switch (mode) {
    case 'report':
      return <ShinyReportDialog {...capture} />
    case 'legacy':
      return <LegacyAnalysisDialog {...capture} point={point} onPointChange={onPointChange} />
    case 'current':
      return <CurrentAnalysisDialog {...capture} point={point} onPointChange={onPointChange} />
    case 'compare':
      return (
        <ComparisonDialog
          snapshots={comparisons.snapshots}
          onImportSnapshot={comparisons.save}
          onRemoveSnapshot={comparisons.remove}
          onRenameSnapshot={comparisons.rename}
          onClose={onClose}
        />
      )
    default:
      return null
  }
}
