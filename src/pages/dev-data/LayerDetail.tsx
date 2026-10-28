import { ArrowLeft, Check } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ExternalLink, SelectAllActions } from '@/components/ui/text-button'
import { FilterChipGroup, InlineAlert, KeyValueRows, SidebarSection } from '@/components/ui/map-panels'
import { LayerSwatch } from '@/components/ui/layer-list-item'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { AppSelect } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { StatGroup } from '@/components/ui/stat-group'
import {
  columnNumbers,
  columnStats,
  isCategoryCandidate,
  isMeasureCandidate,
  type AttributeSchema,
} from '@/lib/featureAttributes'
import { formatBytes, formatDate, formatNumber } from '@/lib/format'
import {
  RAMPS,
  SIMPLE_COLORS,
  buildCategoriesStyle,
  buildRangeStyle,
  buildSizeStyle,
  primaryColor,
  rampPreview,
  type LayerStyle,
  type LayerStyleType,
  type RampId,
  type StyleClassification,
} from '@/lib/layerStyle'
import { cn } from '@/lib/utils'
import { LARGE_LAYER_BYTES } from './catalog'
import {
  distinctValues,
  effectiveStyle,
  featureInBounds,
  filteredCollection,
  numberFormatter,
  type DataFeature,
  type LoadedLayer,
  type ViewportBounds,
} from './layerData'
import { LayerLegend } from './LayerLegend'
import type { DataLayer, WorkspaceAction } from './model'

const STYLE_TYPE_LABELS: Record<LayerStyleType, string> = {
  simple: 'Simple',
  categories: 'Categories',
  range: 'Color range',
  size: 'Size',
}

const CLASS_OPTIONS = [3, 4, 5, 6, 7].map((count) => ({ value: String(count), label: `${count} classes` }))
const CLASSIFICATION_OPTIONS = [
  { value: 'quantile', label: 'Quantile' },
  { value: 'equal-interval', label: 'Equal' },
] as const satisfies ReadonlyArray<{ value: StyleClassification; label: string }>

/**
 * A layer's own panel, opened from the layer list: Felt's style editor, a pair
 * of widgets (stat cards and a category filter) and where the data comes from.
 */
export function LayerDetail({
  layer,
  loaded,
  bounds,
  onAction,
  onBack,
}: {
  layer: DataLayer
  loaded: LoadedLayer
  bounds: ViewportBounds | null
  onAction: (action: WorkspaceAction) => void
  onBack: () => void
}) {
  const style = effectiveStyle(layer, loaded)
  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <button
          type="button"
          className="flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-muted touch:size-10"
          aria-label="Back to layers"
          onClick={onBack}
        >
          <ArrowLeft className="size-4" />
        </button>
        <LayerSwatch color={primaryColor(style)} shape={layer.geometry} />
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{layer.label}</h2>
      </div>

      {loaded.status === 'loading' && (
        <SidebarSection>
          <InlineAlert loading>Loading {layer.label}…</InlineAlert>
        </SidebarSection>
      )}
      {loaded.status === 'error' && (
        <SidebarSection>
          <InlineAlert tone="error" title="This layer did not load">
            {loaded.error}
          </InlineAlert>
        </SidebarSection>
      )}
      {loaded.status === 'idle' && (
        <SidebarSection>
          <InlineAlert>Show this layer to load its data.</InlineAlert>
        </SidebarSection>
      )}

      {loaded.status === 'ready' && (
        <>
          <StyleEditor layer={layer} loaded={loaded} style={style} onAction={onAction} />
          <Insights layer={layer} loaded={loaded} style={style} bounds={bounds} onAction={onAction} />
        </>
      )}
      <AboutLayer layer={layer} loaded={loaded} />
    </>
  )
}

function ColorSwatches({
  value,
  onChange,
  label,
}: {
  value: string
  onChange: (color: string) => void
  label: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={label}>
      {SIMPLE_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value.toLowerCase() === color}
          aria-label={color}
          className="flex size-7 items-center justify-center rounded-full border border-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ backgroundColor: color }}
          onClick={() => onChange(color)}
        >
          {value.toLowerCase() === color && <Check className="size-4 text-white drop-shadow" aria-hidden="true" />}
        </button>
      ))}
      <label
        className="relative flex size-7 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-border text-[10px] text-muted-foreground"
        title="Custom colour"
      >
        <span aria-hidden="true">+</span>
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
          aria-label="Custom colour"
        />
      </label>
    </div>
  )
}

function FieldLabel({ children }: { children: string }) {
  return <div className="mb-1 text-xs font-medium text-muted-foreground">{children}</div>
}

function StyleEditor({
  layer,
  loaded,
  style,
  onAction,
}: {
  layer: DataLayer
  loaded: LoadedLayer
  style: LayerStyle
  onAction: (action: WorkspaceAction) => void
}) {
  const features = loaded.collection.features
  const attributes = loaded.attributes
  const categoryColumns = useMemo(
    () => attributes.filter((attribute) => isCategoryCandidate(attribute, columnStats(features, attribute, 1))),
    [attributes, features],
  )
  const measureColumns = useMemo(() => attributes.filter(isMeasureCandidate), [attributes])
  const sizeable = layer.geometry !== 'fill'
  const setStyle = (next: LayerStyle | null) => {
    if (next) onAction({ type: 'setStyle', id: layer.id, style: next })
  }
  const attributeFor = (key: string) => attributes.find((attribute) => attribute.key === key)!

  const categoriesFor = (column: string) => buildCategoriesStyle(column, columnStats(features, attributeFor(column)))
  const rangeFor = (
    column: string,
    options: { classes?: number; classification?: StyleClassification; ramp?: RampId } = {},
  ) => buildRangeStyle(column, columnNumbers(features, attributeFor(column)), options)
  const sizeFor = (
    column: string,
    options: { classes?: number; classification?: StyleClassification; color?: string } = {},
  ) =>
    buildSizeStyle(
      column,
      columnNumbers(features, attributeFor(column)),
      layer.geometry === 'line' ? 'line' : 'point',
      {
        color: options.color ?? primaryColor(style),
        classes: options.classes,
        classification: options.classification,
      },
    )

  const typeOptions = (Object.keys(STYLE_TYPE_LABELS) as LayerStyleType[]).map((type) => ({
    value: type,
    label: STYLE_TYPE_LABELS[type],
    disabled:
      (type === 'categories' && categoryColumns.length === 0) ||
      (type === 'range' && measureColumns.length === 0) ||
      (type === 'size' && (!sizeable || measureColumns.length === 0)),
    title: type === 'size' && !sizeable ? 'Size applies to points and lines' : undefined,
  }))

  const changeType = (type: LayerStyleType) => {
    if (type === style.type) return
    if (type === 'simple') setStyle({ type: 'simple', color: primaryColor(style) })
    else if (type === 'categories' && categoryColumns[0]) setStyle(categoriesFor(categoryColumns[0].key))
    else if (type === 'range' && measureColumns[0]) setStyle(rangeFor(measureColumns[0].key))
    else if (type === 'size' && measureColumns[0]) setStyle(sizeFor(measureColumns[0].key))
  }

  return (
    <SidebarSection title="Style" headingLevel={3}>
      <div className="space-y-3">
        <SegmentedControl label="Style type" size="sm" value={style.type} options={typeOptions} onChange={changeType} />

        {style.type === 'simple' && (
          <div>
            <FieldLabel>Colour</FieldLabel>
            <ColorSwatches
              label="Layer colour"
              value={style.color}
              onChange={(color) => setStyle({ type: 'simple', color })}
            />
          </div>
        )}

        {style.type === 'categories' && (
          <div>
            <FieldLabel>Colour by</FieldLabel>
            <AppSelect
              value={style.column}
              triggerAriaLabel="Colour by column"
              options={categoryColumns.map((attribute) => ({ value: attribute.key, label: attribute.label }))}
              onValueChange={(column) => setStyle(categoriesFor(column))}
            />
          </div>
        )}

        {style.type === 'range' && (
          <>
            <div>
              <FieldLabel>Colour by</FieldLabel>
              <AppSelect
                value={style.column}
                triggerAriaLabel="Colour range column"
                options={measureColumns.map((attribute) => ({ value: attribute.key, label: attribute.label }))}
                onValueChange={(column) =>
                  setStyle(
                    rangeFor(column, {
                      classification: style.classification,
                      ramp: style.ramp,
                      classes: style.colors.length,
                    }),
                  )
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <AppSelect
                value={String(style.colors.length)}
                triggerAriaLabel="Number of classes"
                options={CLASS_OPTIONS}
                onValueChange={(classes) =>
                  setStyle(
                    rangeFor(style.column, {
                      classes: Number(classes),
                      classification: style.classification,
                      ramp: style.ramp,
                    }),
                  )
                }
              />
              <SegmentedControl
                label="Classification"
                size="sm"
                value={style.classification}
                options={CLASSIFICATION_OPTIONS}
                onChange={(classification) =>
                  setStyle(rangeFor(style.column, { classes: style.colors.length, classification, ramp: style.ramp }))
                }
              />
            </div>
            <div>
              <FieldLabel>Colour ramp</FieldLabel>
              <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Colour ramp">
                {(Object.keys(RAMPS) as RampId[]).map((ramp) => (
                  <button
                    key={ramp}
                    type="button"
                    role="radio"
                    aria-checked={style.ramp === ramp}
                    aria-label={RAMPS[ramp].label}
                    title={RAMPS[ramp].label}
                    className={cn(
                      'h-6 rounded border border-border',
                      style.ramp === ramp && 'ring-2 ring-primary ring-offset-1',
                    )}
                    style={{ background: `linear-gradient(to right, ${rampPreview(ramp).join(', ')})` }}
                    onClick={() =>
                      setStyle(
                        rangeFor(style.column, {
                          classes: style.colors.length,
                          classification: style.classification,
                          ramp,
                        }),
                      )
                    }
                  />
                ))}
              </div>
            </div>
          </>
        )}

        {style.type === 'size' && (
          <>
            <div>
              <FieldLabel>Size by</FieldLabel>
              <AppSelect
                value={style.column}
                triggerAriaLabel="Size by column"
                options={measureColumns.map((attribute) => ({ value: attribute.key, label: attribute.label }))}
                onValueChange={(column) =>
                  setStyle(
                    sizeFor(column, {
                      classification: style.classification,
                      classes: style.sizes.length,
                      color: style.color,
                    }),
                  )
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <AppSelect
                value={String(style.sizes.length)}
                triggerAriaLabel="Number of size classes"
                options={CLASS_OPTIONS}
                onValueChange={(classes) =>
                  setStyle(
                    sizeFor(style.column, {
                      classes: Number(classes),
                      classification: style.classification,
                      color: style.color,
                    }),
                  )
                }
              />
              <SegmentedControl
                label="Classification"
                size="sm"
                value={style.classification}
                options={CLASSIFICATION_OPTIONS}
                onChange={(classification) =>
                  setStyle(sizeFor(style.column, { classes: style.sizes.length, classification, color: style.color }))
                }
              />
            </div>
            <div>
              <FieldLabel>Colour</FieldLabel>
              <ColorSwatches
                label="Layer colour"
                value={style.color}
                onChange={(color) => setStyle({ ...style, color })}
              />
            </div>
          </>
        )}

        <div>
          <div className="mb-1 flex items-center justify-between text-xs font-medium text-muted-foreground">
            <span id={`${layer.id}-opacity`}>Opacity</span>
            <span className="tabular-nums">{Math.round(layer.opacity * 100)}%</span>
          </div>
          <Slider
            aria-labelledby={`${layer.id}-opacity`}
            min={0}
            max={100}
            step={5}
            value={[Math.round(layer.opacity * 100)]}
            onValueChange={([value]) => onAction({ type: 'setOpacity', id: layer.id, opacity: value / 100 })}
          />
        </div>

        {style.type !== 'simple' && (
          <div className="rounded-md border border-border p-2">
            <FieldLabel>Legend</FieldLabel>
            <LayerLegend
              layer={layer}
              style={style}
              attributes={attributes}
              collection={loaded.collection}
              onToggleCategory={(column, value, allValues) =>
                onAction({ type: 'toggleCategory', id: layer.id, column, value, allValues })
              }
            />
          </div>
        )}
      </div>
    </SidebarSection>
  )
}

type InsightScope = 'all' | 'view'

const SCOPE_OPTIONS = [
  { value: 'all', label: 'Whole layer' },
  { value: 'view', label: 'In view' },
] as const satisfies ReadonlyArray<{ value: InsightScope; label: string }>

/**
 * Felt's dashboard widgets for one layer: stat cards (feature count, a sum and
 * an average) and a category filter whose chips filter the map and table.
 */
function Insights({
  layer,
  loaded,
  style,
  bounds,
  onAction,
}: {
  layer: DataLayer
  loaded: LoadedLayer
  style: LayerStyle
  bounds: ViewportBounds | null
  onAction: (action: WorkspaceAction) => void
}) {
  const [scope, setScope] = useState<InsightScope>('all')
  const attributes = loaded.attributes
  const measures = useMemo(() => attributes.filter(isMeasureCandidate), [attributes])
  const categoryOptions = useMemo(
    () =>
      attributes.filter((attribute) =>
        isCategoryCandidate(attribute, columnStats(loaded.collection.features, attribute, 1)),
      ),
    [attributes, loaded.collection.features],
  )
  const [measureKey, setMeasureKey] = useState<string | null>(null)
  const [categoryKey, setCategoryKey] = useState<string | null>(null)
  const measure = measures.find((attribute) => attribute.key === measureKey) ?? measures[0]
  const defaultCategory = layer.filter?.column ?? (style.type === 'categories' ? style.column : undefined)
  const category =
    categoryOptions.find((attribute) => attribute.key === (categoryKey ?? defaultCategory)) ?? categoryOptions[0]

  const inScope = useMemo<DataFeature[]>(() => {
    const features = loaded.collection.features
    return scope === 'view' && bounds ? features.filter((feature) => featureInBounds(feature, bounds)) : features
  }, [bounds, loaded.collection.features, scope])
  const shown = useMemo(() => {
    const visible = new Set(filteredCollection(loaded.collection, layer, style).features)
    return inScope.filter((feature) => visible.has(feature))
  }, [inScope, layer, loaded.collection, style])

  const measureStats = measure ? columnStats(shown, measure) : null
  const format = numberFormatter(measure)
  const categoryStats = category ? columnStats(inScope, category, 12) : null
  const chipValues = categoryStats?.topValues.map((entry) => entry.value) ?? []
  const allValues = category ? distinctValues(loaded.collection, category.key) : []
  const selectedValues = category && layer.filter?.column === category.key ? layer.filter.values : allValues
  const chipColor = (value: string) =>
    style.type === 'categories' && category && style.column === category.key
      ? (style.categories.find((entry) => entry.value === value)?.color ?? style.otherColor ?? undefined)
      : undefined

  return (
    <SidebarSection
      title="Insights"
      headingLevel={3}
      actions={
        <SegmentedControl
          label="Insight scope"
          size="sm"
          fullWidth={false}
          value={scope}
          options={SCOPE_OPTIONS}
          onChange={setScope}
        />
      }
    >
      <div className="space-y-3">
        <StatGroup
          variant="tiles"
          size="sm"
          items={
            [
              { key: 'count', label: layer.filter ? 'Shown' : 'Features', value: formatNumber(shown.length) },
              measureStats &&
                measure && {
                  key: 'sum',
                  label: 'Sum',
                  value: measureStats.sum != null ? format(measureStats.sum) : '—',
                },
              measureStats &&
                measure && {
                  key: 'mean',
                  label: 'Average',
                  value: measureStats.mean != null ? format(measureStats.mean) : '—',
                },
            ].filter(Boolean) as Array<{ key: string; label: string; value: string }>
          }
        />
        {measures.length > 1 && (
          <AppSelect
            value={measure?.key ?? ''}
            triggerAriaLabel="Summarize column"
            options={measures.map((attribute) => ({ value: attribute.key, label: `Summarize ${attribute.label}` }))}
            onValueChange={setMeasureKey}
          />
        )}

        {category && categoryStats && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">Filter by</span>
              <SelectAllActions
                allSelected={!layer.filter}
                noneSelected={layer.filter?.column === category.key && layer.filter.values.length === 0}
                onAll={() => onAction({ type: 'setFilter', id: layer.id, filter: null })}
                onNone={() =>
                  onAction({ type: 'setFilter', id: layer.id, filter: { column: category.key, values: [] } })
                }
              />
            </div>
            {categoryOptions.length > 1 && (
              <AppSelect
                value={category.key}
                triggerAriaLabel="Filter column"
                options={categoryOptions.map((attribute) => ({ value: attribute.key, label: attribute.label }))}
                onValueChange={(key) => {
                  setCategoryKey(key)
                  if (layer.filter && layer.filter.column !== key)
                    onAction({ type: 'setFilter', id: layer.id, filter: null })
                }}
              />
            )}
            <FilterChipGroup
              variant="filled"
              items={(categoryStats.topValues ?? []).map((entry) => ({
                value: entry.value,
                label: entry.value,
                count: formatNumber(entry.count),
                color: chipColor(entry.value),
              }))}
              selectedValues={selectedValues}
              onToggle={(value) =>
                onAction({ type: 'toggleCategory', id: layer.id, column: category.key, value, allValues })
              }
            />
            {categoryStats.distinct > chipValues.length && (
              <p className="text-xs text-muted-foreground">
                Showing the {chipValues.length} most common of {formatNumber(categoryStats.distinct)} values.
              </p>
            )}
          </div>
        )}
      </div>
    </SidebarSection>
  )
}

function AboutLayer({ layer, loaded }: { layer: DataLayer; loaded: LoadedLayer }) {
  const source = layer.source
  const attributes: AttributeSchema[] = loaded.attributes
  return (
    <SidebarSection title="About this data" headingLevel={3} className="border-b-0">
      {layer.description && <p className="mb-2 text-xs leading-5 text-muted-foreground">{layer.description}</p>}
      <KeyValueRows
        variant="grid"
        rows={[
          source.kind === 'catalog'
            ? {
                label: 'Source',
                value: <ExternalLink href={source.entry.sourceUrl}>City of Prince George GIS Hub</ExternalLink>,
              }
            : { label: 'Source', value: `Uploaded ${source.fileName}` },
          source.kind === 'catalog' &&
            Boolean(source.entry.snapshotDate) && {
              label: 'Snapshot',
              value: formatDate(`${source.entry.snapshotDate ?? ''}T12:00:00`),
            },
          {
            label: 'Rows',
            value: formatNumber(
              loaded.status === 'ready'
                ? loaded.collection.features.length
                : source.kind === 'catalog'
                  ? source.entry.rowCount
                  : source.rowCount,
            ),
          },
          source.kind === 'upload' &&
            source.skipped > 0 && { label: 'Skipped', value: `${formatNumber(source.skipped)} without geometry` },
          source.kind === 'catalog' && {
            label: 'File size',
            value: `${formatBytes(source.entry.bytes)}${source.entry.bytes > LARGE_LAYER_BYTES ? ' (large)' : ''}`,
          },
          attributes.length > 0 && { label: 'Columns', value: formatNumber(attributes.length) },
        ]}
      />
    </SidebarSection>
  )
}
