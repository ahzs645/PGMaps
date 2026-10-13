import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { compileSearchClause, type SearchClause } from './data/searchBuilder'
const input = 'rounded-md border bg-background p-2 text-base min-w-0 max-w-full'
function ClauseEditor({
  clause,
  onChange,
  depth = 0,
}: {
  clause: SearchClause
  onChange: (next: SearchClause) => void
  depth?: number
}) {
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <label className="flex flex-wrap items-center gap-2 text-sm">
        Rule type
        <select
          className={input}
          aria-label="Expression rule type"
          value={clause.kind}
          onChange={(e) =>
            onChange(
              e.target.value === 'term'
                ? { kind: 'term', text: '' }
                : e.target.value === 'field'
                  ? { kind: 'field', field: 'Submission ID', operator: '>=', value: '0', valueType: 'number' }
                  : { kind: 'group', operator: 'AND', clauses: [{ kind: 'term', text: '' }] },
            )
          }
        >
          <option value="term">Text term</option>
          <option value="field">Field comparison</option>
          {depth < 8 && <option value="group">Nested group</option>}
        </select>
      </label>
      {clause.kind === 'term' && (
        <input
          className={`${input} w-full`}
          aria-label="Expression term"
          value={clause.text}
          onChange={(e) => onChange({ ...clause, text: e.target.value })}
        />
      )}
      {clause.kind === 'field' && (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">
            Field
            <input
              className={input}
              aria-label="Expression field"
              value={clause.field}
              onChange={(e) => onChange({ ...clause, field: e.target.value })}
            />
          </label>
          <label className="grid gap-1 text-sm">
            Operator
            <select
              className={input}
              aria-label="Expression operator"
              value={clause.operator}
              onChange={(e) => onChange({ ...clause, operator: e.target.value as typeof clause.operator })}
            >
              {['=', '!=', '~', '>', '>=', '<', '<='].map((op) => (
                <option key={op}>{op}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            Value type
            <select
              className={input}
              aria-label="Expression value type"
              value={clause.valueType}
              onChange={(e) => onChange({ ...clause, valueType: e.target.value as typeof clause.valueType })}
            >
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="boolean">Boolean</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            Value
            <input
              className={input}
              aria-label="Expression value"
              value={clause.value}
              onChange={(e) => onChange({ ...clause, value: e.target.value })}
            />
          </label>
        </div>
      )}
      {clause.kind === 'group' && (
        <>
          <label className="flex items-center gap-2 text-sm">
            Match
            <select
              className={input}
              aria-label="Expression group operator"
              value={clause.operator}
              onChange={(e) => onChange({ ...clause, operator: e.target.value as 'AND' | 'OR' })}
            >
              <option value="AND">Every rule (AND)</option>
              <option value="OR">Any rule (OR)</option>
            </select>
          </label>
          {clause.clauses.map((child, i) => (
            <div key={i} className="space-y-1">
              <ClauseEditor
                depth={depth + 1}
                clause={child}
                onChange={(next) =>
                  onChange({ ...clause, clauses: clause.clauses.map((c, j) => (j === i ? next : c)) })
                }
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={clause.clauses.length === 1}
                onClick={() => onChange({ ...clause, clauses: clause.clauses.filter((_, j) => j !== i) })}
              >
                Remove rule {i + 1}
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            disabled={clause.clauses.length >= 50}
            onClick={() => onChange({ ...clause, clauses: [...clause.clauses, { kind: 'term', text: '' }] })}
          >
            Add expression rule
          </Button>
        </>
      )}
    </div>
  )
}
export function PortalExpressionBuilder({
  onApply,
  defaultOpen = false,
}: {
  onApply: (expression: string) => void
  defaultOpen?: boolean
}) {
  const [clause, setClause] = useState<SearchClause>({
    kind: 'group',
    operator: 'AND',
    clauses: [{ kind: 'term', text: 'nechako' }],
  })
  let expression = '',
    error = ''
  try {
    expression = compileSearchClause(clause)
  } catch (reason) {
    error = reason instanceof Error ? reason.message : String(reason)
  }
  return (
    <details open={defaultOpen || undefined} className="space-y-3 rounded-lg border p-3">
      <summary className="cursor-pointer font-medium">Visual expression builder</summary>
      <div className="mt-3 space-y-3">
        <ClauseEditor clause={clause} onChange={setClause} />
        {error ? (
          <InlineAlert tone="warning">{error}</InlineAlert>
        ) : (
          <p className="break-words font-mono text-sm">{expression}</p>
        )}
        <Button type="button" disabled={!!error} onClick={() => onApply(expression)}>
          Use built expression
        </Button>
      </div>
    </details>
  )
}
