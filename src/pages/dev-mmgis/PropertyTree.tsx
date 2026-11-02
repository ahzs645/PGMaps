import { useState } from 'react'
export function PropertyTree({ properties }: { properties: Record<string, unknown> }) {
  const [query, setQuery] = useState('')
  let budget = 1000,
    truncated = false
  const visit = (value: unknown, path: string, depth: number): React.ReactNode => {
    if (budget <= 0) {
      truncated = true
      return null
    }
    if (value && typeof value === 'object' && depth < 8) {
      const entries = Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .filter(
          ([key, v]) =>
            !key.startsWith('__') &&
            (!query || `${path}.${key} ${JSON.stringify(v)}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())),
        )
      return entries.map(([key, v]) => {
        if (budget-- <= 0) {
          truncated = true
          return null
        }
        return (
          <div key={key}>
            {v && typeof v === 'object' ? (
              <details open={query ? true : undefined}>
                <summary>
                  {key} {Array.isArray(v) ? `[${v.length}]` : ''}
                </summary>
                <div className="mm-property-children">{visit(v, `${path}.${key}`, depth + 1)}</div>
              </details>
            ) : (
              <dl className="mm-property-row">
                <dt>{key}</dt>
                <dd>{v == null ? 'No value' : String(v)}</dd>
              </dl>
            )}
          </div>
        )
      })
    }
    const serialized = JSON.stringify(value) ?? 'No value'
    if (serialized.length > 2000) truncated = true
    return <code>{serialized.slice(0, 2000)}</code>
  }
  const content = visit(properties, '', 0)
  return (
    <div>
      <label className="mm-field">
        Filter feature properties
        <input value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div className="mm-properties">{content}</div>
      {truncated && (
        <p className="mm-help">
          Property display limit reached. Filter properties or copy the feature GeoJSON to inspect more.
        </p>
      )}
    </div>
  )
}
