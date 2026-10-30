import { NativeSelect } from '@/components/ui/form-field'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert, LegendItem, MapGradientLegendItem } from '@/components/ui/map-panels'
import { downloadText } from '@/lib/download'
import { errorText } from '@/lib/nechakoPortal'
import type { VectorData } from './data/workspace'
import { saveLocalWorkbench } from './data/localWorkbench'
import { exportStyleSld } from './data/sldStyle'
import { localStyleDataForVector } from './data/styleLibrary'
import { makeCategoryStyle } from './data/vectorStyle'
import {
  checkedVectorStyle,
  MAX_STYLE_RULES,
  MAX_GRADIENT_STOPS,
  numericFieldRange,
  STYLE_OPERATORS,
  vectorStyleFor,
  vectorStyleLegend,
  vectorGeometryTypes,
  type StyleComparison,
  type StyleGeometry,
  type StyleRule,
  type StyleSymbol,
  type VectorStyle,
} from './data/vectorRules'

const inputClass = 'mt-1 block w-full min-w-0 rounded border bg-background p-2 text-base'
function SymbolFields({
  symbol,
  label,
  onChange,
}: {
  symbol: StyleSymbol
  label: string
  onChange: (symbol: StyleSymbol) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {(['fillColor', 'strokeColor'] as const).map((key) => (
        <label key={key} className="text-xs">
          {key === 'fillColor' ? 'Fill color' : 'Stroke color'}
          <input
            aria-label={label + ' ' + key}
            type="color"
            className="mt-1 block h-9 w-full"
            value={symbol[key]}
            onChange={(event) => onChange({ ...symbol, [key]: event.target.value })}
          />
        </label>
      ))}
      {(
        [
          ['fillOpacity', 'Polygon fill opacity', 1],
          ['strokeOpacity', 'Stroke opacity', 1],
          ['strokeWidth', 'Line width (px)', 20],
          ['pointRadius', 'Point radius (px)', 30],
          ['pointOpacity', 'Point fill opacity', 1],
          ['pointStrokeWidth', 'Point border (px)', 20],
        ] as const
      ).map(([key, title, max]) => (
        <label key={key} className="text-xs">
          {title}
          <input
            type="number"
            aria-label={label + ' ' + key}
            className={inputClass}
            min={0}
            max={max}
            step={max === 1 ? 0.05 : 0.5}
            value={Number.isFinite(symbol[key]) ? symbol[key] : ''}
            onChange={(event) => onChange({ ...symbol, [key]: event.target.valueAsNumber })}
          />
        </label>
      ))}
    </div>
  )
}
function SymbolSwatch({ symbol, geometry }: { symbol: StyleSymbol; geometry: StyleGeometry }) {
  return (
    <svg width="34" height="22" viewBox="0 0 34 22" aria-hidden="true">
      {geometry === 'line' ? (
        <path
          d="M2 18L32 4"
          stroke={symbol.strokeColor}
          strokeOpacity={symbol.strokeOpacity}
          strokeWidth={Math.min(8, symbol.strokeWidth)}
        />
      ) : geometry === 'point' ? (
        <circle
          cx="17"
          cy="11"
          r={Math.min(9, symbol.pointRadius)}
          fill={symbol.fillColor}
          fillOpacity={symbol.pointOpacity}
          stroke={symbol.strokeColor}
          strokeOpacity={symbol.strokeOpacity}
          strokeWidth={Math.min(6, symbol.pointStrokeWidth)}
        />
      ) : (
        <rect
          x="3"
          y="3"
          width="28"
          height="16"
          fill={symbol.fillColor}
          fillOpacity={symbol.fillOpacity}
          stroke={symbol.strokeColor}
          strokeOpacity={symbol.strokeOpacity}
          strokeWidth={Math.min(6, symbol.strokeWidth)}
        />
      )}
    </svg>
  )
}
export function PortalVectorStyleLegend({
  style,
  geometries,
}: {
  style: VectorStyle
  geometries?: Exclude<StyleGeometry, 'any'>[]
}) {
  const legend = vectorStyleLegend(style)
  const symbols =
    style.geometry === 'any'
      ? geometries?.length
        ? geometries
        : (['point', 'line', 'polygon'] as const)
      : [style.geometry]
  return (
    <div className="space-y-2" aria-label="Vector style legend">
      {legend.gradient && (
        <div>
          <p className="text-xs font-medium">
            {legend.gradient.property} · linear RGB gradient ({legend.gradient.channel})
          </p>
          <MapGradientLegendItem
            colors={legend.gradient.stops.map(
              (stop) =>
                stop.color +
                ' ' +
                ((stop.value - legend.gradient!.stops[0].value) /
                  (legend.gradient!.stops.at(-1)!.value - legend.gradient!.stops[0].value)) *
                  100 +
                '%',
            )}
            minLabel={legend.gradient.stops[0].value}
            maxLabel={legend.gradient.stops.at(-1)!.value}
          />
          <p className="mt-1 break-words text-xs">
            Stops: {legend.gradient.stops.map((stop) => stop.value).join(' · ')}. Values beyond the stops use the
            nearest end color.
          </p>
        </div>
      )}
      {legend.rows.map((row, index) => (
        <LegendItem
          key={index}
          color={row.symbol.fillColor}
          label={<span className="whitespace-normal break-words">{row.label}</span>}
          swatch={
            <span className="flex" aria-hidden="true">
              {symbols.map((geometry) => (
                <SymbolSwatch key={geometry} symbol={row.symbol} geometry={geometry} />
              ))}
            </span>
          }
        />
      ))}
    </div>
  )
}
export function PortalVectorStyleEditor({
  vector,
  onChange,
}: {
  vector: VectorData
  onChange: (vector: VectorData) => void
}) {
  const sourceStyle = useMemo(
    () =>
      vectorStyleFor({
        style: vector.style,
        categories: vector.categories,
        color: vector.color,
        fillOpacity: vector.fillOpacity,
        lineOpacity: vector.lineOpacity,
        lineWidth: vector.lineWidth,
        pointRadius: vector.pointRadius,
      }),
    [
      vector.style,
      vector.categories,
      vector.color,
      vector.fillOpacity,
      vector.lineOpacity,
      vector.lineWidth,
      vector.pointRadius,
    ],
  )
  const geometries = useMemo(() => vectorGeometryTypes(vector.data), [vector.data])
  const [draft, setDraft] = useState<VectorStyle>(sourceStyle)
  const [previousSource, setPreviousSource] = useState(sourceStyle)
  const [name, setName] = useState(vector.name + ' style')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [categoryField, setCategoryField] = useState('')
  const [exportGeometry, setExportGeometry] = useState<Exclude<StyleGeometry, 'any'>>(geometries[0] ?? 'polygon')
  if (previousSource !== sourceStyle) {
    setPreviousSource(sourceStyle)
    setDraft(sourceStyle)
    setError('')
    setNotice('')
  }
  const fields = useMemo(
    () => [...new Set(vector.data.features.flatMap((feature) => Object.keys(feature.properties ?? {})))].sort(),
    [vector.data],
  )
  const update = (style: VectorStyle) => {
    setDraft(style)
    setNotice('')
    setError('')
  }
  const run = (action: () => void | Promise<void>) => {
    setError('')
    void Promise.resolve()
      .then(action)
      .catch((reason: unknown) => setError(errorText(reason)))
  }
  const mode = (value: VectorStyle['mode']) => {
    const common = { schema: draft.schema, geometry: draft.geometry, base: draft.base }
    if (value === 'single') update({ ...common, mode: 'single' })
    else if (value === 'rules') update({ ...common, mode: 'rules', rules: draft.mode === 'rules' ? draft.rules : [] })
    else {
      const property = fields[0] ?? ''
      let bounds: [number, number] = [0, 1]
      try {
        bounds = numericFieldRange(vector.data, property)
      } catch {
        /* Custom stop bounds remain editable. */
      }
      update({
        ...common,
        mode: 'gradient',
        property,
        channel: 'both',
        stops: [
          { value: bounds[0], color: '#2166ac' },
          { value: bounds[1], color: '#b2182b' },
        ],
      })
    }
  }
  const updateRule = (index: number, rule: StyleRule) => {
    if (draft.mode === 'rules') update({ ...draft, rules: draft.rules.map((item, i) => (i === index ? rule : item)) })
  }
  const condition = (rule: StyleRule, index: number) => {
    const current = rule.condition
    const type = current.value === null ? 'null' : typeof current.value
    const set = (patch: Record<string, unknown>) =>
      updateRule(index, { ...rule, condition: { ...current, ...patch } as StyleComparison })
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs">
          Field
          <NativeSelect
            aria-label={'Rule ' + (index + 1) + ' field for ' + vector.name}
            className={inputClass}
            value={current.property}
            onChange={(event) => set({ property: event.target.value })}
          >
            <option value="">Choose field</option>
            {!fields.includes(current.property) && current.property && <option>{current.property}</option>}
            {fields.map((field) => (
              <option key={field}>{field}</option>
            ))}
          </NativeSelect>
        </label>
        <label className="text-xs">
          Comparison
          <NativeSelect
            aria-label={'Rule ' + (index + 1) + ' operator for ' + vector.name}
            className={inputClass}
            value={current.operator}
            onChange={(event) => {
              const operator = event.target.value as StyleComparison['operator']
              const value = !['eq', 'ne'].includes(operator) && !['number', 'string'].includes(type) ? 0 : current.value
              updateRule(index, {
                ...rule,
                condition: {
                  property: current.property,
                  operator,
                  value,
                  ...(operator === 'between' ? { upper: value } : {}),
                } as StyleComparison,
              })
            }}
          >
            {STYLE_OPERATORS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="text-xs">
          Value type
          <NativeSelect
            aria-label={'Rule ' + (index + 1) + ' type for ' + vector.name}
            className={inputClass}
            value={type}
            onChange={(event) => {
              const type = event.target.value,
                value = type === 'number' ? 0 : type === 'boolean' ? false : type === 'null' ? null : ''
              set({ value, ...(current.operator === 'between' ? { upper: value } : {}) })
            }}
          >
            <option value="number">Number</option>
            <option value="string">Text</option>
            {['eq', 'ne'].includes(current.operator) && (
              <>
                <option value="boolean">Boolean</option>
                <option value="null">Missing / null</option>
              </>
            )}
          </NativeSelect>
        </label>
        {type !== 'null' && (
          <label className="text-xs">
            Value
            {type === 'boolean' ? (
              <NativeSelect
                aria-label={'Rule ' + (index + 1) + ' value for ' + vector.name}
                className={inputClass}
                value={String(current.value)}
                onChange={(event) => set({ value: event.target.value === 'true' })}
              >
                <option value="false">false</option>
                <option value="true">true</option>
              </NativeSelect>
            ) : (
              <input
                aria-label={'Rule ' + (index + 1) + ' value for ' + vector.name}
                className={inputClass}
                type={type === 'number' ? 'number' : 'text'}
                step="any"
                value={
                  typeof current.value === 'number' && !Number.isFinite(current.value) ? '' : String(current.value)
                }
                onChange={(event) =>
                  set({ value: type === 'number' ? event.target.valueAsNumber : event.target.value })
                }
              />
            )}
          </label>
        )}
        {current.operator === 'between' && (
          <label className="text-xs">
            Upper bound (inclusive)
            <input
              aria-label={'Rule ' + (index + 1) + ' upper for ' + vector.name}
              className={inputClass}
              type={type === 'number' ? 'number' : 'text'}
              step="any"
              value={typeof current.upper === 'number' && !Number.isFinite(current.upper) ? '' : String(current.upper)}
              onChange={(event) => set({ upper: type === 'number' ? event.target.valueAsNumber : event.target.value })}
            />
          </label>
        )}
      </div>
    )
  }
  return (
    <section className="mt-3 space-y-3 rounded border p-3" aria-label={'Advanced style for ' + vector.name}>
      <h4 className="font-semibold">Rules, gradients and reusable styles</h4>
      <p className="text-xs text-muted-foreground">
        Edit a draft, then apply it to this map layer. Rules use the first enabled match. Numbers, text and booleans are
        distinct; null and missing values share a class. Text ordering is case sensitive.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs">
          Style mode
          <NativeSelect
            aria-label={'Style mode for ' + vector.name}
            className={inputClass}
            value={draft.mode}
            onChange={(event) => mode(event.target.value as VectorStyle['mode'])}
          >
            <option value="single">Single symbol</option>
            <option value="rules">Ordered comparison rules</option>
            <option value="gradient">Numeric color gradient</option>
          </NativeSelect>
        </label>
        <label className="text-xs">
          Geometry
          <NativeSelect
            aria-label={'Style geometry for ' + vector.name}
            className={inputClass}
            value={draft.geometry}
            onChange={(event) => update({ ...draft, geometry: event.target.value as StyleGeometry })}
          >
            <option value="any">All geometries</option>
            <option value="point">Points only</option>
            <option value="line">Lines only</option>
            <option value="polygon">Polygons only</option>
          </NativeSelect>
        </label>
      </div>
      {draft.geometry !== 'any' && (
        <p className="text-xs">Only {draft.geometry} geometry will be drawn by this style.</p>
      )}
      <details open={draft.mode === 'single'}>
        <summary className="cursor-pointer text-sm font-medium">
          {draft.mode === 'single' ? 'Symbol' : 'Fallback symbol'}
        </summary>
        <SymbolFields
          label={'Base style for ' + vector.name}
          symbol={draft.base}
          onChange={(base) => update({ ...draft, base })}
        />
      </details>
      {draft.mode === 'rules' && (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1 text-xs">
              Create typed categories from field
              <NativeSelect
                aria-label={'Rule categories field for ' + vector.name}
                className={inputClass}
                value={categoryField}
                onChange={(event) => setCategoryField(event.target.value)}
              >
                <option value="">Choose field</option>
                {fields.map((field) => (
                  <option key={field}>{field}</option>
                ))}
              </NativeSelect>
            </label>
            <Button
              size="sm"
              variant="outline"
              disabled={!categoryField}
              onClick={() =>
                run(() => {
                  const categories = makeCategoryStyle(vector.data, categoryField, vector.color)
                  const generated = vectorStyleFor({ ...vector, style: undefined, categories })
                  if (generated.mode !== 'rules') return
                  const known = new Set(draft.rules.map((rule) => JSON.stringify(rule.condition)))
                  const additions = generated.rules
                    .filter((rule) => !known.has(JSON.stringify(rule.condition)))
                    .map((rule) => ({
                      ...rule,
                      id: crypto.randomUUID(),
                      symbol: { ...draft.base, fillColor: rule.symbol.fillColor, strokeColor: rule.symbol.strokeColor },
                    }))
                  update(checkedVectorStyle({ ...draft, rules: [...draft.rules, ...additions] }))
                  setNotice(
                    'Added ' +
                      additions.length +
                      ' equality rules for distinct typed values; existing rules keep their order.',
                  )
                })
              }
            >
              Add unique categories
            </Button>
          </div>
          {draft.rules.map((rule, index) => (
            <fieldset key={rule.id} className="space-y-2 rounded border p-2">
              <legend className="px-1 text-xs">Rule {index + 1}</legend>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={(event) => updateRule(index, { ...rule, enabled: event.target.checked })}
                />
                Enabled
              </label>
              <label className="block text-xs">
                Rule name
                <input
                  aria-label={'Rule ' + (index + 1) + ' name for ' + vector.name}
                  className={inputClass}
                  value={rule.name}
                  maxLength={160}
                  onChange={(event) => updateRule(index, { ...rule, name: event.target.value })}
                />
              </label>
              {condition(rule, index)}
              <details>
                <summary className="cursor-pointer text-xs">Rule symbol and colors</summary>
                <SymbolFields
                  label={'Rule ' + (index + 1) + ' for ' + vector.name}
                  symbol={rule.symbol}
                  onChange={(symbol) => updateRule(index, { ...rule, symbol })}
                />
              </details>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={index === 0}
                  onClick={() => {
                    const rules = [...draft.rules]
                    ;[rules[index - 1], rules[index]] = [rules[index], rules[index - 1]]
                    update({ ...draft, rules })
                  }}
                >
                  Move rule up
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={index === draft.rules.length - 1}
                  onClick={() => {
                    const rules = [...draft.rules]
                    ;[rules[index + 1], rules[index]] = [rules[index], rules[index + 1]]
                    update({ ...draft, rules })
                  }}
                >
                  Move rule down
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => update({ ...draft, rules: draft.rules.filter((_, i) => i !== index) })}
                >
                  Remove rule
                </Button>
              </div>
            </fieldset>
          ))}
          <Button
            size="sm"
            variant="outline"
            disabled={draft.rules.length >= MAX_STYLE_RULES}
            onClick={() =>
              update({
                ...draft,
                rules: [
                  ...draft.rules,
                  {
                    id: crypto.randomUUID(),
                    name: 'Rule ' + (draft.rules.length + 1),
                    enabled: true,
                    condition: { property: fields[0] ?? '', operator: 'eq', value: 0 },
                    symbol: { ...draft.base },
                  },
                ],
              })
            }
          >
            Add comparison rule
          </Button>
        </>
      )}
      {draft.mode === 'gradient' && (
        <>
          <label className="block text-xs">
            Numeric field
            <NativeSelect
              aria-label={'Gradient field for ' + vector.name}
              className={inputClass}
              value={draft.property}
              onChange={(event) => update({ ...draft, property: event.target.value })}
            >
              <option value="">Choose field</option>
              {!fields.includes(draft.property) && draft.property && <option>{draft.property}</option>}
              {fields.map((field) => (
                <option key={field}>{field}</option>
              ))}
            </NativeSelect>
          </label>
          <label className="block text-xs">
            Color channel
            <NativeSelect
              aria-label={'Gradient channel for ' + vector.name}
              className={inputClass}
              value={draft.channel}
              onChange={(event) => update({ ...draft, channel: event.target.value as 'fill' | 'stroke' | 'both' })}
            >
              <option value="both">Fill and stroke</option>
              <option value="fill">Fill only</option>
              <option value="stroke">Stroke only</option>
            </NativeSelect>
          </label>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              run(() => {
                const [min, max] = numericFieldRange(vector.data, draft.property)
                update({
                  ...draft,
                  stops: draft.stops.map((stop, index) => ({
                    ...stop,
                    value: min + ((max - min) * index) / (draft.stops.length - 1),
                  })),
                })
              })
            }
          >
            Use numeric data range
          </Button>
          {draft.stops.map((stop, index) => (
            <div key={index} className="flex items-end gap-2">
              <label className="min-w-0 flex-1 text-xs">
                Stop {index + 1} value
                <input
                  aria-label={'Gradient stop ' + (index + 1) + ' value for ' + vector.name}
                  type="number"
                  step="any"
                  className={inputClass}
                  value={Number.isFinite(stop.value) ? stop.value : ''}
                  onChange={(event) =>
                    update({
                      ...draft,
                      stops: draft.stops.map((item, i) =>
                        i === index ? { ...item, value: event.target.valueAsNumber } : item,
                      ),
                    })
                  }
                />
              </label>
              <input
                type="color"
                className="h-10 w-12"
                aria-label={'Gradient stop ' + (index + 1) + ' color for ' + vector.name}
                value={stop.color}
                onChange={(event) =>
                  update({
                    ...draft,
                    stops: draft.stops.map((item, i) => (i === index ? { ...item, color: event.target.value } : item)),
                  })
                }
              />
              <Button
                size="sm"
                variant="outline"
                disabled={draft.stops.length <= 2}
                onClick={() => update({ ...draft, stops: draft.stops.filter((_, i) => i !== index) })}
              >
                Remove stop
              </Button>
            </div>
          ))}
          <Button
            size="sm"
            variant="outline"
            disabled={draft.stops.length >= MAX_GRADIENT_STOPS}
            onClick={() =>
              update({ ...draft, stops: [...draft.stops, { value: draft.stops.at(-1)!.value + 1, color: '#b2182b' }] })
            }
          >
            Add gradient stop
          </Button>
          <p className="text-xs text-muted-foreground">
            Stops must increase strictly. Only finite numeric attributes use the gradient; numeric text and null keep
            the fallback symbol. Interpolation is linear in RGB.
          </p>
        </>
      )}
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {notice && <InlineAlert tone="info">{notice}</InlineAlert>}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() =>
            run(() => {
              const style = checkedVectorStyle(draft)
              setDraft(style)
              setPreviousSource(style)
              onChange({ ...vector, style })
              setNotice('Style applied to this map layer. Source geometry and attributes are unchanged.')
            })
          }
        >
          Apply style to layer
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setDraft(sourceStyle)
            setError('')
            setNotice('Draft reset to the current map style.')
          }}
        >
          Reset style draft
        </Button>
        {vector.style && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onChange({ ...vector, style: undefined, styleSource: undefined })}
          >
            Remove custom style
          </Button>
        )}
      </div>
      <details>
        <summary className="cursor-pointer text-sm">Applied map legend</summary>
        <PortalVectorStyleLegend style={sourceStyle} geometries={geometries} />
      </details>
      <label className="block text-xs">
        Style name
        <input
          className={inputClass}
          aria-label={'Saved style name for ' + vector.name}
          value={name}
          maxLength={200}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            run(async () => {
              await saveLocalWorkbench({
                kind: 'style',
                name,
                data: localStyleDataForVector(vector, draft),
              })
              setNotice('Style saved in this browser. Export a file to share or back it up.')
            })
          }
        >
          Save style in browser
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            run(() =>
              downloadText(
                JSON.stringify(localStyleDataForVector(vector, draft), null, 2),
                'nechako-style.json',
                'application/json',
              ),
            )
          }
        >
          Export style JSON
        </Button>
      </div>
      <label className="block text-xs">
        SLD export geometry
        <NativeSelect
          aria-label={'SLD export geometry for ' + vector.name}
          className={inputClass}
          value={exportGeometry}
          onChange={(event) => setExportGeometry(event.target.value as typeof exportGeometry)}
        >
          <option value="point">Point</option>
          <option value="line">Line</option>
          <option value="polygon">Polygon</option>
        </NativeSelect>
      </label>
      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          run(() =>
            downloadText(
              exportStyleSld(draft, name, draft.geometry === 'any' ? exportGeometry : draft.geometry),
              'nechako-style.sld',
              'application/vnd.ogc.sld+xml',
            ),
          )
        }
      >
        Export SLD
      </Button>
      <p className="text-xs text-muted-foreground">
        SLD exports one geometry: circles, plain lines or solid polygons. Gradients use SE 1.1. Full typed definitions
        also travel in style JSON; no server style is changed.
      </p>
    </section>
  )
}
