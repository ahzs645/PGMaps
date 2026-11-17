import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { cn } from '@/lib/utils'

// The colour scheme, one press at a time: light, dark, then the system's own setting.
const MODES = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
] as const

export function ThemeModeButton({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const current = MODES.find((mode) => mode.value === theme) ?? MODES[2]
  const next = MODES[(MODES.indexOf(current) + 1) % MODES.length]
  const label = `Colour scheme: ${current.label}. Switch to ${next.label}`
  return (
    <button
      type="button"
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-accent focus-visible:outline',
        className,
      )}
      data-theme-mode={current.value}
      aria-label={label}
      title={label}
      onClick={() => setTheme(next.value)}
    >
      <current.Icon aria-hidden="true" className="size-4" />
    </button>
  )
}
