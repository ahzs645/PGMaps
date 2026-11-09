import { Button } from '@/components/ui/button'
import { InlineAlert, KeyValueRows, SidebarSection } from '@/components/ui/map-panels'
import { ExternalLink } from '@/components/ui/text-button'
import { FileImportField } from './FileImportField'

const GEOTIFF = '.tif,.tiff,image/tiff'
const BGC_LEGEND = 'https://thebeczone.ca/shiny/cciss/downloadable_docs/Subzone_Legend.csv'

/** Local GeoTIFFs that replace the prepared rasters the point is read from. Files stay in the browser. */
export function RasterFilesSection({
  bgcFile,
  suitabilityFile,
  onBgcFile,
  onSuitabilityFile,
  onReset,
  bgcError,
  suitabilityError,
  sources,
}: {
  bgcFile: File | null
  suitabilityFile: File | null
  onBgcFile: (file: File) => void
  onSuitabilityFile: (file: File) => void
  onReset: () => void
  bgcError: string
  suitabilityError: string
  /** Where each loaded raster came from; `null` while it has not loaded. */
  sources: { bgc: string | null; suitability: string | null }
}) {
  return (
    <SidebarSection title="Read exact raster values">
      <p className="mb-3 text-xs text-muted-foreground">
        Matching prepared GeoTIFFs load automatically when available. You can also inspect a local download; selected
        files stay in this browser.
      </p>
      <div className="space-y-3">
        <FileImportField label="Reference BGC GeoTIFF" accept={GEOTIFF} onFile={onBgcFile} />
        {bgcError && <InlineAlert tone="error">{bgcError}</InlineAlert>}
        <FileImportField
          label="Local suitability GeoTIFF"
          accept={GEOTIFF}
          onFile={onSuitabilityFile}
          description="Local file values retain their numeric codes. Use the file’s own legend to interpret them."
        />
        {suitabilityError && <InlineAlert tone="error">{suitabilityError}</InlineAlert>}
        {(sources.bgc || sources.suitability) && (
          <KeyValueRows
            rows={[
              sources.bgc !== null && { label: 'BGC source', value: sources.bgc },
              sources.suitability !== null && { label: 'Suitability source', value: sources.suitability },
            ]}
          />
        )}
        <div className="flex flex-wrap items-center gap-3">
          {(bgcFile || suitabilityFile) && (
            <Button size="sm" variant="outline" onClick={onReset}>
              Use prepared data again
            </Button>
          )}
          <ExternalLink href={BGC_LEGEND}>BGC ID legend</ExternalLink>
        </div>
      </div>
    </SidebarSection>
  )
}
