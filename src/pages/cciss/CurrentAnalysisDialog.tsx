import { useState } from 'react'
import { DialogShell } from '@/components/ui/dialog-shell'
import { InlineAlert, SidebarSection } from '@/components/ui/map-panels'
import type { ComparisonSnapshot } from './comparison'
import { CURRENT_BUNDLE_LIMIT, parseCurrentBundle } from './currentAnalysis'
import { CurrentWorkspace, type LoadedBundle } from './CurrentWorkspace'
import { FileImportField } from './FileImportField'
import { errorMessage, useLatestRequest } from './useLatestRequest'

type Point = [number, number]

/** Imports a current-data bundle, then hands it to a fresh `CurrentWorkspace` for each file. */
export function CurrentAnalysisDialog({
  point,
  onPointChange,
  onClose,
  onCaptureComparison,
  onOpenComparison,
  comparisonCount,
}: {
  point?: Point
  onPointChange?: (point: Point) => void
  onClose: () => void
  onCaptureComparison?: (snapshot: ComparisonSnapshot) => void
  onOpenComparison?: () => void
  comparisonCount?: number
}) {
  const [loaded, setLoaded] = useState<LoadedBundle | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const request = useLatestRequest()

  async function importFile(file: File) {
    const revision = request.next()
    setError('')
    setLoading(true)
    try {
      if (file.size > CURRENT_BUNDLE_LIMIT) throw new Error('Choose a pilot JSON file smaller than 25 MB.')
      const bundle = parseCurrentBundle(await file.text())
      if (request.isLatest(revision)) setLoaded({ bundle, sourceFile: file.name, revision })
    } catch (cause) {
      if (request.isLatest(revision)) setError(errorMessage(cause))
    } finally {
      if (request.isLatest(revision)) setLoading(false)
    }
  }

  return (
    <DialogShell
      title="CCISS current-data analysis"
      subtitle="Import model members → choose a site → assess"
      onClose={onClose}
      size="xl"
    >
      <div className="space-y-4">
        <InlineAlert tone="info">
          Import a CCISS pilot export to calculate weighted BGC predictions locally. Matching ecological tables can
          enable site-series overlap and species suitability. Files stay in this browser session.
        </InlineAlert>
        <FileImportField
          label="Import current CCISS JSON"
          description="Accepts a raw pilot export or a self-contained analysis bundle. Maximum 25 MB."
          accept=".json,application/json"
          buttonLabel="Import JSON"
          disabled={loading}
          onFile={(file) => void importFile(file)}
          onError={(cause) => setError(errorMessage(cause))}
        />
        {loading && <InlineAlert loading>Validating imported data…</InlineAlert>}
        {error && (
          <InlineAlert tone="error">
            <p>{error}</p>
            {loaded && <p>The previous dataset remains loaded: {loaded.sourceFile}.</p>}
          </InlineAlert>
        )}
        {!loaded ? (
          <SidebarSection title="Data needed for a current assessment">
            <p className="text-sm">
              The current province-wide model-member data are not bundled with PGMaps. Request a version-matched pilot
              export from the data owner, including its site geometries, codebook and model dimensions. Add compatible
              E1, E1_Phase and S1 ecological tables for species calculations.
            </p>
            <p className="mt-2 text-sm">
              Importing data does not establish agreement with the deployed Shiny calculator. Dataset versions,
              available calculations and validation limits are shown with every assessment.
            </p>
          </SidebarSection>
        ) : (
          <CurrentWorkspace
            key={loaded.revision}
            loaded={loaded}
            point={point}
            onPointChange={onPointChange}
            onCaptureComparison={onCaptureComparison}
            onOpenComparison={onOpenComparison}
            comparisonCount={comparisonCount}
          />
        )}
      </div>
    </DialogShell>
  )
}
