import { Button } from '@/components/ui/button'
import { CheckboxField, FORM_INPUT_CLASS, FormField, StyledSelect } from '@/components/ui/form-field'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert } from '@/components/ui/map-panels'
import {
  MAX_SERIES_FILE_NAME_LENGTH,
  MAX_SHEET_SERIES_PAGES,
  SERIES_TOKENS,
  seriesContainer,
  seriesFileNames,
  seriesPages,
  SHEET_SERIES_ORDERS,
  unfilledSeriesTokens,
  type SheetOutputSettings,
  type SheetSeriesBlock,
  type SheetSeriesBundle,
  type SheetSeriesOrder,
} from '@/lib/forestry/blockSheet/sheetSeries'
import { SHEET_FORMAT_INFO, SHEET_FORMATS, type SheetFormat } from '@/lib/mapSheet/sheetFormats'

const BUNDLES: readonly { value: SheetSeriesBundle; label: string }[] = [
  { value: 'pdf', label: 'One PDF, a page a block' },
  { value: 'zip', label: 'A ZIP of one PDF a block' },
]

/**
 * How a printed map sheet is written: PDF, editable SVG or PNG; one sheet, or one sheet per block
 * as a series (which blocks, in what order, each file's name); and the optional mask outside the
 * block. Sits beside `MapSheetSetup`, which chooses what the sheet shows. Value in, change out: the
 * tool keeps the settings (`SheetOutputSettings`, `parseSheetOutputSettings`) and writes the files
 * (`sheetFile`, `writeSheetSeries`).
 */
export function MapSheetOutput({
  value,
  onChange,
  blocks = [],
  formats = SHEET_FORMATS,
  showFormat = true,
  mask = true,
  disabled,
}: {
  value: SheetOutputSettings
  onChange: (value: SheetOutputSettings) => void
  /** The blocks a series can take, in the tool's order. With fewer than two, no series is offered. */
  blocks?: readonly SheetSeriesBlock[]
  /** The formats this tool offers; all three by default. */
  formats?: readonly SheetFormat[]
  /**
   * Show the format choice. False where the tool's own dialog already chooses the format (and passes it in
   * `value.format`), so the choice is not shown twice; the series still follows `value.format`.
   */
  showFormat?: boolean
  /** Offer the mask outside the block. */
  mask?: boolean
  disabled?: boolean
}) {
  const set = (patch: Partial<SheetOutputSettings>) => onChange({ ...value, ...patch })
  const format = formats.includes(value.format) ? value.format : (formats[0] ?? 'pdf')
  const canSeries = blocks.length > 1
  const series = canSeries && value.series
  const chosen = new Set(value.blocks === 'all' ? blocks.map((block) => block.id) : value.blocks)
  const pages = seriesPages(blocks, { order: value.order, selected: value.blocks })
  const container = seriesContainer({ format, bundle: value.bundle })
  const unfilled = unfilledSeriesTokens(value.fileName, blocks)
  const example = pages.length ? seriesFileNames(value.fileName, pages, SHEET_FORMAT_INFO[format].extension)[0] : null
  const toggle = (id: string, on: boolean) => {
    const next = blocks.filter((block) => (block.id === id ? on : chosen.has(block.id))).map((block) => block.id)
    set({ blocks: next.length === blocks.length ? 'all' : next })
  }
  return (
    <fieldset disabled={disabled} className="grid min-w-0 gap-3 text-xs" data-testid="map-sheet-output">
      <div className="grid gap-2 sm:grid-cols-2">
        {showFormat && (
          <FormField label="Format" htmlFor="map-sheet-format" description={SHEET_FORMAT_INFO[format].description}>
            <StyledSelect
              id="map-sheet-format"
              className={FORM_INPUT_CLASS}
              value={format}
              onChange={(event) => set({ format: event.target.value as SheetFormat })}
            >
              {formats.map((entry) => (
                <option key={entry} value={entry}>
                  {SHEET_FORMAT_INFO[entry].label}
                </option>
              ))}
            </StyledSelect>
          </FormField>
        )}
        {mask && (
          <CheckboxField
            className="self-center"
            label="Dim the map outside the block"
            description="The footer says the map is dimmed. Off: the map is drawn evenly."
            checked={value.mask}
            onCheckedChange={(checked) => set({ mask: checked })}
          />
        )}
      </div>
      {canSeries && (
        <CheckboxField
          label="One sheet per block"
          description={`A series of up to ${MAX_SHEET_SERIES_PAGES} sheets, each framed on its own block.`}
          checked={value.series}
          onCheckedChange={(checked) => set({ series: checked })}
        />
      )}
      {series && (
        <div className="grid min-w-0 gap-3 rounded-md border p-2" data-testid="map-sheet-series">
          <FormField label={`Blocks (${pages.length} of ${blocks.length})`} group>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              <Button type="button" variant="link" size="2xs" className="px-0" onClick={() => set({ blocks: 'all' })}>
                All
              </Button>
              <Button type="button" variant="link" size="2xs" className="px-0" onClick={() => set({ blocks: [] })}>
                None
              </Button>
            </div>
            <div className="grid max-h-40 gap-1 overflow-y-auto sm:grid-cols-2" data-testid="map-sheet-series-blocks">
              {blocks.map((block) => (
                <CheckboxField
                  key={block.id}
                  label={block.name || 'Unnamed block'}
                  checked={chosen.has(block.id)}
                  onCheckedChange={(checked) => toggle(block.id, checked)}
                />
              ))}
            </div>
          </FormField>
          {pages.length > MAX_SHEET_SERIES_PAGES && (
            <InlineAlert tone="warning">
              {pages.length} blocks are chosen; a series is at most {MAX_SHEET_SERIES_PAGES} sheets.
            </InlineAlert>
          )}
          {!pages.length && <InlineAlert tone="warning">Choose at least one block.</InlineAlert>}
          <div className="grid gap-2 sm:grid-cols-2">
            <FormField label="Order" htmlFor="map-sheet-series-order">
              <StyledSelect
                id="map-sheet-series-order"
                className={FORM_INPUT_CLASS}
                value={value.order}
                onChange={(event) => set({ order: event.target.value as SheetSeriesOrder })}
              >
                {SHEET_SERIES_ORDERS.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </StyledSelect>
            </FormField>
            {format === 'pdf' ? (
              <FormField label="Written as" htmlFor="map-sheet-series-bundle">
                <StyledSelect
                  id="map-sheet-series-bundle"
                  className={FORM_INPUT_CLASS}
                  value={value.bundle}
                  onChange={(event) => set({ bundle: event.target.value as SheetSeriesBundle })}
                >
                  {BUNDLES.map((entry) => (
                    <option key={entry.value} value={entry.value}>
                      {entry.label}
                    </option>
                  ))}
                </StyledSelect>
              </FormField>
            ) : (
              <p className="self-end text-muted-foreground">
                Written as a ZIP of one {SHEET_FORMAT_INFO[format].extension.toUpperCase()} a block.
              </p>
            )}
          </div>
          {container === 'zip' && (
            <FormField
              label="File names"
              htmlFor="map-sheet-series-file-name"
              hintAction={
                <InfoTip label="About file name tokens">
                  <span className="block">Tokens fill in for each block:</span>
                  {SERIES_TOKENS.map((entry) => (
                    <span key={entry.token} className="block">
                      <code>{entry.token}</code> {entry.means}
                    </span>
                  ))}
                  <span className="mt-1 block">
                    A token that does not fill stays as typed. The same tokens work in the sheet&apos;s typed fields.
                    Two blocks with the same name get -2, -3.
                  </span>
                </InfoTip>
              }
              description={example ? `First file: ${example}` : undefined}
              error={unfilled.length ? `Will not fill: ${unfilled.join(', ')}` : undefined}
            >
              <input
                id="map-sheet-series-file-name"
                className={FORM_INPUT_CLASS}
                value={value.fileName}
                maxLength={MAX_SERIES_FILE_NAME_LENGTH * 2}
                onChange={(event) => set({ fileName: event.target.value })}
              />
            </FormField>
          )}
        </div>
      )}
    </fieldset>
  )
}
