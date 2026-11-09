import { InlineAlert } from '@/components/ui/map-panels'

/** Several warnings in one alert, one per line. Renders nothing when there are none. */
export function AlertList({ items, tone = 'warning' }: { items: readonly string[]; tone?: 'warning' | 'info' }) {
  if (!items.length) return null
  return (
    <InlineAlert tone={tone}>
      <ul className="list-disc space-y-1 pl-4">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </InlineAlert>
  )
}
