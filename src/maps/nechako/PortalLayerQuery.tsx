import { NativeSelect } from '@/components/ui/form-field'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { downloadText } from '@/lib/download'
import { errorText } from '@/lib/nechakoPortal'
import {
  LAYER_QUERY_OPERATORS,
  checkedLayerQuery,
  displayLayerQuery,
  layerQueryFields,
  queryLayer,
  type LayerPredicate,
  type LayerQuery,
  type LayerQueryNode,
} from './data/layerQuery'
import { materializeLayer } from './data/localLayers'
import { saveLocalWorkbench } from './data/localWorkbench'
import type { VectorData } from './data/workspace'

type DraftRule = Omit<LayerPredicate, 'value' | 'upper'> & {
  valueType: 'string' | 'number' | 'boolean' | 'null'
  text: string
  upperText: string
}
type DraftGroup = { kind: 'group'; match: 'all' | 'any'; negate: boolean; children: DraftNode[] }
type DraftNode = DraftRule | DraftGroup
const newRule = (field: string): DraftRule => ({
  kind: 'rule',
  field,
  operator: 'eq',
  valueType: 'string',
  text: '',
  upperText: '',
})
function numeric(text: string) {
  if (!text.trim() || !Number.isFinite(Number(text))) throw new Error('Enter a finite numeric comparison value.')
  return Number(text)
}
function compile(node: DraftNode): LayerQueryNode {
  if (node.kind === 'group') return { ...node, children: node.children.map(compile) }
  if (node.operator.startsWith('is-')) return { kind: 'rule', field: node.field, operator: node.operator }
  const value =
    node.valueType === 'null'
      ? null
      : node.valueType === 'number'
        ? numeric(node.text)
        : node.valueType === 'boolean'
          ? node.text === 'true'
          : node.text
  return {
    kind: 'rule',
    field: node.field,
    operator: node.operator,
    value: node.operator.startsWith('is-') ? undefined : value,
    upper: node.operator === 'between' ? numeric(node.upperText) : undefined,
  }
}
function draftNode(node: LayerQueryNode): DraftNode {
  if (node.kind === 'group') return { ...node, negate: node.negate ?? false, children: node.children.map(draftNode) }
  const type = node.value === null ? 'null' : typeof node.value
  return {
    ...node,
    valueType: type === 'number' || type === 'boolean' || type === 'null' ? type : 'string',
    text: node.value === null || node.value === undefined ? '' : String(node.value),
    upperText: node.upper === undefined ? '' : String(node.upper),
  }
}
function QueryNodeEditor({
  node,
  fields,
  onChange,
  depth = 0,
}: {
  node: DraftNode
  fields: string[]
  onChange: (node: DraftNode) => void
  depth?: number
}) {
  if (node.kind === 'group')
    return (
      <fieldset className="min-w-0 space-y-2 rounded border p-3">
        <legend className="px-1 text-xs font-semibold">{depth ? 'Nested conditions' : 'Layer conditions'}</legend>
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect
            aria-label={`Condition match level ${depth + 1}`}
            className="rounded border bg-background p-2"
            value={node.match}
            onChange={(event) => onChange({ ...node, match: event.target.value as 'all' | 'any' })}
          >
            <option value="all">All conditions (AND)</option>
            <option value="any">Any condition (OR)</option>
          </NativeSelect>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={node.negate}
              onChange={(event) => onChange({ ...node, negate: event.target.checked })}
            />
            Negate group (NOT)
          </label>
        </div>
        {node.children.map((child, index) => (
          <div key={index} className="min-w-0 space-y-1">
            <QueryNodeEditor
              node={child}
              fields={fields}
              depth={depth + 1}
              onChange={(next) =>
                onChange({ ...node, children: node.children.map((item, i) => (i === index ? next : item)) })
              }
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onChange({ ...node, children: node.children.filter((_item, i) => i !== index) })}
            >
              Remove {child.kind === 'group' ? 'group' : 'condition'} {index + 1}
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onChange({ ...node, children: [...node.children, newRule(fields[0] ?? '')] })}
          >
            Add condition
          </Button>
          {depth < 4 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                onChange({
                  ...node,
                  children: [
                    ...node.children,
                    { kind: 'group', match: 'all', negate: false, children: [newRule(fields[0] ?? '')] },
                  ],
                })
              }
            >
              Add nested group
            </Button>
          )}
        </div>
      </fieldset>
    )
  const needsValue = !node.operator.startsWith('is-')
  return (
    <div className="grid min-w-0 gap-2 rounded bg-muted/30 p-2 sm:grid-cols-2">
      <label className="min-w-0 text-xs">
        Field
        <NativeSelect
          aria-label="Query field"
          className="mt-1 w-full rounded border bg-background p-2 text-sm"
          value={node.field}
          onChange={(event) => onChange({ ...node, field: event.target.value })}
        >
          {fields.map((field) => (
            <option key={field}>{field}</option>
          ))}
        </NativeSelect>
      </label>
      <label className="min-w-0 text-xs">
        Comparison
        <NativeSelect
          aria-label="Query comparison"
          className="mt-1 w-full rounded border bg-background p-2 text-sm"
          value={node.operator}
          onChange={(event) => {
            const operator = event.target.value as LayerPredicate['operator']
            const ordered = ['lt', 'lte', 'gt', 'gte', 'between'].includes(operator)
            onChange({
              ...node,
              operator,
              valueType: ordered ? 'number' : ['contains', 'starts'].includes(operator) ? 'string' : node.valueType,
            })
          }}
        >
          {Object.entries(LAYER_QUERY_OPERATORS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </NativeSelect>
      </label>
      {needsValue && (
        <>
          <label className="text-xs">
            Value type
            <NativeSelect
              aria-label="Query value type"
              className="mt-1 w-full rounded border bg-background p-2 text-sm"
              value={node.valueType}
              onChange={(event) =>
                onChange({
                  ...node,
                  valueType: event.target.value as DraftRule['valueType'],
                  text: event.target.value === 'boolean' ? 'true' : node.text,
                })
              }
            >
              <option value="string">Text</option>
              <option value="number">Number</option>
              <option value="boolean">Boolean</option>
              <option value="null">Null</option>
            </NativeSelect>
          </label>
          {node.valueType === 'boolean' ? (
            <label className="text-xs">
              Value
              <NativeSelect
                aria-label="Query value"
                className="mt-1 w-full rounded border bg-background p-2 text-sm"
                value={node.text}
                onChange={(event) => onChange({ ...node, text: event.target.value })}
              >
                <option value="true">true</option>
                <option value="false">false</option>
              </NativeSelect>
            </label>
          ) : (
            node.valueType !== 'null' && (
              <label className="text-xs">
                {node.operator === 'between' ? 'Lower value' : 'Value'}
                <input
                  aria-label="Query value"
                  className="mt-1 w-full rounded border bg-background p-2 text-base"
                  value={node.text}
                  onChange={(event) => onChange({ ...node, text: event.target.value })}
                />
              </label>
            )
          )}
          {node.operator === 'between' && (
            <label className="text-xs">
              Upper value
              <input
                aria-label="Query upper value"
                className="mt-1 w-full rounded border bg-background p-2 text-base"
                value={node.upperText}
                onChange={(event) => onChange({ ...node, upperText: event.target.value })}
              />
            </label>
          )}
        </>
      )}
    </div>
  )
}
export function PortalLayerQuery({ vector, onAdd }: { vector: VectorData; onAdd: (vectors: VectorData[]) => void }) {
  const fields = useMemo(() => layerQueryFields(vector.data), [vector.data])
  const [draft, setDraft] = useState<DraftNode>(() => ({
    kind: 'group',
    match: 'all',
    negate: false,
    children: [newRule(fields[0] ?? '')],
  }))
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const preview = useMemo(() => {
    try {
      const query: LayerQuery = { schema: 'nechako-layer-query-v1', expression: compile(draft) }
      return { query, data: queryLayer(vector.data, query) }
    } catch (reason) {
      return { error: errorText(reason) }
    }
  }, [draft, vector.data])
  const derived = () => ({
    ...vector,
    id: crypto.randomUUID(),
    name: `${vector.name} · query`.slice(0, 200),
    data: preview.data!,
    original: { parentLayerId: vector.id, parent: vector.original, query: preview.query, scope: 'cached feature set' },
  })
  return (
    <section className="min-w-0 space-y-3 rounded border p-3" aria-label="Local layer query">
      <h4 className="font-semibold">Query cached features</h4>
      <p className="text-xs text-muted-foreground">
        Filter {vector.data.features.length.toLocaleString()} features from {vector.name}. Numeric comparisons keep
        numbers separate from numeric text; text matches are case-sensitive. Results preserve original feature IDs and
        geometry.
      </p>
      {!fields.length ? (
        <InlineAlert>This layer has no property fields to query.</InlineAlert>
      ) : (
        <QueryNodeEditor node={draft} fields={fields} onChange={setDraft} />
      )}
      {preview.error ? (
        <p className="text-sm text-muted-foreground">{preview.error}</p>
      ) : (
        <>
          <p role="status" className="text-sm">
            {preview.data!.features.length.toLocaleString()} of {vector.data.features.length.toLocaleString()} cached
            features match.
          </p>
          <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 text-xs">
            {displayLayerQuery(preview.query!.expression)}
          </pre>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={!preview.data}
          onClick={() => {
            onAdd([derived()])
            setMessage('Query result added as a separate local map layer.')
          }}
        >
          Add query result to map
        </Button>
        <Button
          variant="outline"
          disabled={!preview.data}
          onClick={() => {
            const vectorResult = derived()
            const asset = materializeLayer(
              {
                schema: 'nechako-local-layer-v1',
                kind: 'local',
                name: vectorResult.name,
                original: vectorResult.original,
                materialization: { status: 'descriptor', basis: 'catalogue', countVerified: false, notes: [] },
              },
              vectorResult.data,
            )
            asset.materialization.notes = [
              `Local query selected ${asset.data!.features.length} of ${vector.data.features.length} cached features.`,
              'Source database coverage is inherited from the parent layer and is not expanded by this query.',
            ]
            void saveLocalWorkbench({ kind: 'layer', name: asset.name, data: asset })
              .then(() => {
                setMessage('Query result saved on this browser.')
                setError('')
              })
              .catch((reason) => setError(errorText(reason)))
          }}
        >
          Save query result locally
        </Button>
        <Button
          variant="outline"
          disabled={!preview.query}
          onClick={() => downloadText(JSON.stringify(preview.query, null, 2), 'layer-query.json', 'application/json')}
        >
          Export query
        </Button>
        <label className="cursor-pointer rounded border px-3 py-2 text-sm">
          Import query
          <input
            aria-label="Import layer query"
            className="sr-only"
            type="file"
            accept=".json"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (!file) return
              if (file.size > 65536) {
                setError('A query file must be smaller than 64 KiB.')
                return
              }
              void file
                .text()
                .then((text) => {
                  const query = checkedLayerQuery(JSON.parse(text))
                  setDraft(draftNode(query.expression))
                  setError('')
                })
                .catch((reason) => setError(errorText(reason)))
            }}
          />
        </label>
      </div>
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {message && <InlineAlert>{message}</InlineAlert>}
    </section>
  )
}
