import type { ReactNode } from 'react'
import { KeyValueRows } from '@/components/ui/map-panels'
export function ComparisonPane({
  label,
  title,
  metrics,
  children,
}: {
  label: string
  title: string
  metrics: { label: string; value: string }[]
  children: ReactNode
}) {
  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border bg-background"
      aria-label={`${label} output`}
    >
      <header className="shrink-0 border-b px-3 py-2">
        <h2 className="truncate text-sm font-semibold">
          {label} · {title}
        </h2>
        <div className="mt-1 text-[11px]">
          <KeyValueRows size="sm" rows={metrics} />
        </div>
      </header>
      <div className="relative min-h-[140px] flex-1 overflow-hidden">{children}</div>
    </section>
  )
}
