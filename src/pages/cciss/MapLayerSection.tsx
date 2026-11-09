import { Button } from '@/components/ui/button'
import { SelectField } from '@/components/ui/form-field'
import { InfoTip } from '@/components/ui/info-tip'
import type { CategoricalRasterStatus } from '@/components/ui/map-categorical-raster'
import { CollapsibleSection, InlineAlert, SidebarSection } from '@/components/ui/map-panels'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { TextButton } from '@/components/ui/text-button'
import { ccissMapOptions, type CcissLayerSelection } from './layers'
import type { CcissMapSourceOption, CcissRenderSource } from './mapSources'
import type { CcissTraceMethod } from './workspace'

const TRACE_NOTES: Record<CcissTraceMethod, string> = {
  grid: 'Full published layer coverage for mapped 1961–1990 Pl/C4, reconstructed on an assumed 10-arc-second grid. Purple marks unresolved cells. Inferred display classes; not used for calculations.',
  pixels:
    'Pixel-by-pixel colour tracing of the same nine tiles. Purple marks ambiguous pixels (0.42%). Inferred display classes; not used for calculations. No coverage outside the test area.',
}
const TRACE_VIEWS: Record<CcissTraceMethod, { href: string; label: string }> = {
  grid: { href: '?lng=-126.526528&lat=54.154306&z=4.5&render=trace&traceMethod=grid', label: 'View whole layer' },
  pixels: {
    href: '?lng=-124.666920&lat=54.209275&z=12&render=trace&traceMethod=pixels',
    label: 'View pixel-trace sample',
  },
}

type Options = ReturnType<typeof ccissMapOptions>

function OptionSelect<K extends 'kind' | 'period' | 'species' | 'edatope' | 'statistic' | 'gcm'>({
  label,
  field,
  options,
  selection,
  onChange,
  className,
}: {
  label: string
  field: K
  options: readonly { id: CcissLayerSelection[K]; label: string }[]
  selection: CcissLayerSelection
  onChange: (patch: Partial<CcissLayerSelection>) => void
  className?: string
}) {
  return (
    <SelectField
      label={label}
      fieldClassName={className}
      value={selection[field]}
      onChange={(event) => onChange({ [field]: event.target.value } as Partial<CcissLayerSelection>)}
    >
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </SelectField>
  )
}

/** The published product to show: what it maps, when, and for which species or model. */
function LayerFields({
  selection,
  options,
  onChange,
}: {
  selection: CcissLayerSelection
  options: Options
  onChange: (patch: Partial<CcissLayerSelection>) => void
}) {
  const shared = { selection, onChange }
  return (
    <div className="grid grid-cols-2 gap-2">
      <OptionSelect {...shared} label="Display" field="kind" options={options.kinds} className="col-span-2" />
      <OptionSelect {...shared} label="Time period" field="period" options={options.periods} className="col-span-2" />
      {selection.kind === 'suitability' ? (
        <>
          <OptionSelect {...shared} label="Species" field="species" options={options.species} />
          <OptionSelect {...shared} label="Edatope" field="edatope" options={options.edatopes} />
          {options.statistics.length > 1 && (
            <OptionSelect
              {...shared}
              label="Map type"
              field="statistic"
              options={options.statistics}
              className="col-span-2"
            />
          )}
        </>
      ) : (
        <>
          {options.showZoneGrouping && (
            <label className="col-span-2 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={selection.byZone}
                onChange={(event) => onChange({ byZone: event.target.checked })}
              />
              Group by zone
            </label>
          )}
          {options.gcms.length > 0 && (
            <OptionSelect {...shared} label="Climate model" field="gcm" options={options.gcms} className="col-span-2" />
          )}
        </>
      )}
    </div>
  )
}

export function MapLayerSection({
  selection,
  onSelectionChange,
  onResetSelection,
  sources,
  renderSource,
  onRenderSourceChange,
  traceMethod,
  onTraceMethodChange,
  polygonLayer,
  polygonStatus,
  numericLayer,
  numericRaster,
  localRasterSelected,
  tiles,
  comparisonOpenByDefault,
}: {
  selection: CcissLayerSelection
  onSelectionChange: (patch: Partial<CcissLayerSelection>) => void
  onResetSelection: () => void
  sources: CcissMapSourceOption[]
  renderSource: CcissRenderSource
  onRenderSourceChange: (source: CcissRenderSource) => void
  traceMethod: CcissTraceMethod
  onTraceMethodChange: (method: CcissTraceMethod) => void
  /** A traced or vector polygon layer is drawn. */
  polygonLayer: boolean
  polygonStatus: CategoricalRasterStatus
  /** A prepared numeric GeoTIFF matches the selection. */
  numericLayer: boolean
  numericRaster: { loaded: boolean; missing: boolean }
  localRasterSelected: boolean
  tiles: { tileId: string; available: boolean | null; retry: () => void }
  comparisonOpenByDefault: boolean
}) {
  const options = ccissMapOptions(selection)
  const selected = sources.find((source) => source.id === renderSource)!
  const sourceOptions = (ids: CcissRenderSource[], disable: (source: CcissMapSourceOption) => boolean) =>
    sources
      .filter((source) => ids.includes(source.id))
      .map((source) => ({ value: source.id, label: source.label, disabled: disable(source) }))
  const native = renderSource === 'native'

  return (
    <SidebarSection title="Map layer">
      <LayerFields selection={selection} options={options} onChange={onSelectionChange} />

      <div className="mt-3 space-y-1">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>Map source</span>
          <InfoTip label="About map sources">
            Tile trace is the default. Numeric vector preserves the downloaded GeoTIFF’s cell boundaries and codes. The
            location and zoom stay in place as you switch.
          </InfoTip>
        </div>
        <SegmentedControl<CcissRenderSource>
          label="Map source"
          value={renderSource}
          onChange={onRenderSourceChange}
          variant="solid"
          options={sourceOptions(['trace', 'vector'], (source) => !source.available)}
        />
        <p className="text-xs text-muted-foreground">{selected.description}</p>
      </div>

      {!selected.available && renderSource !== 'tiles' && (
        <InlineAlert title="No prepared overlay for this selection" className="mt-3">
          {selected.reason}{' '}
          {localRasterSelected ? (
            <TextButton onClick={() => onRenderSourceChange('native')}>View the selected GeoTIFF</TextButton>
          ) : (
            <TextButton onClick={() => onRenderSourceChange('tiles')}>View original CCISS tiles</TextButton>
          )}
          , or <TextButton onClick={onResetSelection}>return to Pl/C4</TextButton>.
        </InlineAlert>
      )}

      {polygonLayer && (
        <div className="mt-3 space-y-2">
          {renderSource === 'trace' ? (
            <>
              <SegmentedControl<CcissTraceMethod>
                label="Tile reconstruction method"
                value={traceMethod}
                variant="solid"
                onChange={onTraceMethodChange}
                options={[
                  { value: 'grid', label: 'Grid cells' },
                  { value: 'pixels', label: 'Image pixels (sample)' },
                ]}
              />
              <p className="text-xs text-muted-foreground">{TRACE_NOTES[traceMethod]}</p>
              <a
                className="text-xs font-medium text-sky-700 hover:underline dark:text-sky-400"
                href={TRACE_VIEWS[traceMethod].href}
              >
                {TRACE_VIEWS[traceMethod].label}
              </a>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Polygons from the same historical Pl/C4 download. Original cell boundaries and class codes are preserved.
            </p>
          )}
          <InlineAlert
            tone={polygonStatus.state === 'error' ? 'error' : 'info'}
            loading={polygonStatus.state === 'loading'}
          >
            {polygonStatus.message}
          </InlineAlert>
        </div>
      )}

      {numericLayer && native && (
        <p className="mt-2 text-xs text-muted-foreground">
          PGMaps draws the downloaded GeoTIFF’s cells at every zoom. Regional features also differ from the public
          mapped tiles; the blue branch west of Prince George appears only in the download.
          {!numericRaster.loaded &&
            (numericRaster.missing
              ? ' The numeric GeoTIFF is not hosted here; select a local download below.'
              : ' Loading the numeric GeoTIFF…')}
        </p>
      )}
      {localRasterSelected && (
        <p className="mt-2 text-xs text-muted-foreground">
          A local GeoTIFF is selected. Use Direct GeoTIFF in Comparison options to render it; the prepared numeric
          vector belongs to the hosted download.
        </p>
      )}
      {renderSource === 'tiles' && tiles.available === false && (
        <InlineAlert tone="error" className="mt-3">
          This tile set is unavailable from the CCISS server.
          <Button className="mt-2" size="sm" variant="outline" onClick={tiles.retry}>
            Retry map tiles
          </Button>
        </InlineAlert>
      )}

      <CollapsibleSection
        label="Comparison options"
        collapseOn="always"
        className="mt-3 rounded-md border"
        contentClassName="space-y-2 px-3 pb-3"
        defaultOpen={comparisonOpenByDefault}
      >
        <SegmentedControl<CcissRenderSource>
          label="Other map sources"
          value={renderSource}
          onChange={onRenderSourceChange}
          options={sourceOptions(['tiles', 'native'], (source) => source.id !== 'tiles' && !source.available)}
        />
        <p className="text-xs text-muted-foreground">
          Direct GeoTIFF draws the numeric raster and supports local uploads. Original tiles are only loaded when
          selected.
        </p>
        <p className="break-all text-xs text-muted-foreground">CCISS tile set: {tiles.tileId}</p>
      </CollapsibleSection>
    </SidebarSection>
  )
}
