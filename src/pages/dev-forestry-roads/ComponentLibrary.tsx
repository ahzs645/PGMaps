import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { downloadText } from '@/lib/download'
import { parseSectionComponents } from './sectionAssembly'
import type { SectionComponent } from './types'

const KEY = 'pgmaps-road-components-v1'
function readLibrary(): SectionComponent[] {
  try {
    return parseSectionComponents(JSON.parse(localStorage.getItem(KEY) ?? '[]'), true)
  } catch {
    return []
  }
}
export function ComponentLibrary({
  components,
  onInsert,
}: {
  components: SectionComponent[]
  onInsert: (component: SectionComponent) => void
}) {
  const [library, setLibrary] = useState(readLibrary),
    [error, setError] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const save = (rows: SectionComponent[]) => {
    const checked = parseSectionComponents(rows, true)
    localStorage.setItem(KEY, JSON.stringify(checked))
    setLibrary(checked)
    setError('')
  }
  return (
    <details className="rounded border p-2">
      <summary className="cursor-pointer text-xs">Reusable component library</summary>
      <p className="my-2 text-[11px] text-muted-foreground">
        Keep individual components on this device or transfer their definitions as JSON. Material and reference IDs must
        exist in the receiving project.
      </p>
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          variant="outline"
          disabled={!components.length || library.length + components.length > 40}
          onClick={() => {
            try {
              save([...library, ...components.map((c) => ({ ...c, id: crypto.randomUUID() }))])
            } catch (e) {
              setError(String(e))
            }
          }}
        >
          Save current components
        </Button>
        <Button size="sm" variant="outline" onClick={() => file.current?.click()}>
          Import components
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!library.length}
          onClick={() =>
            downloadText(
              JSON.stringify({ schema: KEY, components: library }, null, 2),
              'road-components.json',
              'application/json',
            )
          }
        >
          Export components
        </Button>
      </div>
      <input
        ref={file}
        type="file"
        accept=".json"
        className="hidden"
        aria-label="Component library file"
        onChange={async (event) => {
          const selected = event.target.files?.[0]
          event.target.value = ''
          if (!selected) return
          try {
            if (selected.size > 1000000) throw Error('Component library exceeds 1 MB.')
            const data = JSON.parse(await selected.text())
            if (data.schema !== KEY) throw Error('Unsupported component library schema.')
            save(parseSectionComponents(data.components, true))
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
          }
        }}
      />
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      )}
      <ul className="mt-2 space-y-1">
        {library.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-1 text-xs">
            <span className="min-w-0 truncate">
              {c.name} · {c.side}
            </span>
            <Button size="sm" variant="ghost" disabled={components.length >= 40} onClick={() => onInsert(c)}>
              Insert {c.name}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                try {
                  save(library.filter((r) => r.id !== c.id))
                } catch (e) {
                  setError(String(e))
                }
              }}
            >
              Remove {c.name}
            </Button>
          </li>
        ))}
      </ul>
    </details>
  )
}
