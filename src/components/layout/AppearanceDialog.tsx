import { useId, useState, type CSSProperties } from 'react'
import { Check, Clipboard, Layers, Moon, Mountain, RotateCcw, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ColorField } from '@/components/ui/color-field'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Slider } from '@/components/ui/slider'
import { StyledSelect } from '@/components/ui/styled-select'
import { useTheme } from 'next-themes'
import {
  defaultInterfaceTheme,
  exportThemeCss,
  interfaceThemeVariables,
  isCustomTheme,
  radiusLimits,
  readInterfaceTheme,
  saveInterfaceTheme,
  themePresets,
  themeRoles,
  themeModes,
  type InterfaceTheme,
  type ThemeMode,
  type ThemeRole,
} from '@/lib/interfaceTheme'

const previewDefaults = Object.fromEntries(
  Object.keys(
    interfaceThemeVariables({
      light: Object.fromEntries(themeRoles.map(([role]) => [role, '#000000'])),
      dark: Object.fromEntries(themeRoles.map(([role]) => [role, '#000000'])),
      radius: radiusLimits.min,
    }),
  ).map((property) => [property, 'initial']),
)

function ThemePreview({ theme, mode }: { theme: InterfaceTheme; mode: ThemeMode }) {
  const style = { ...previewDefaults, ...interfaceThemeVariables(theme) } as CSSProperties
  const [selected, setSelected] = useState('Overview')
  const [terrain, setTerrain] = useState(true)
  return (
    <div
      aria-label={`${mode === 'light' ? 'Light' : 'Dark'} live preview`}
      className="geo-toolkit flex min-h-full flex-col gap-5 rounded-xl border border-border bg-background p-5 text-foreground sm:p-7"
      data-theme={mode}
      data-interface-theme={isCustomTheme(theme) || undefined}
      style={style}
    >
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-md bg-primary text-primary-foreground">
          <Mountain className="size-5" aria-hidden="true" />
        </span>
        <div>
          <p className="text-sm font-semibold">Road design</p>
          <p className="text-xs text-muted-foreground">Hillside access project</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1 rounded-md bg-muted p-1" role="group" aria-label="Preview navigation">
        {['Overview', 'Terrain', 'Review'].map((name) => (
          <Button
            key={name}
            size="xs"
            variant="ghost"
            aria-pressed={selected === name}
            className={selected === name ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'}
            onClick={() => setSelected(name)}
          >
            {name}
          </Button>
        ))}
      </div>
      <section
        className="grid gap-4 rounded-lg border border-border bg-card p-4 text-card-foreground shadow-sm"
        aria-label="Sample project card"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold">
              {selected === 'Overview' ? 'Road summary' : selected === 'Terrain' ? 'Terrain layers' : 'Design review'}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">Proposed alignment · Option A</p>
          </div>
          <span className="rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">Draft</span>
        </div>
        <dl className="grid grid-cols-2 gap-3 border-y border-border py-3">
          <div>
            <dt className="text-xs text-muted-foreground">Road length</dt>
            <dd className="text-lg font-semibold tabular-nums">1.42 km</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Maximum grade</dt>
            <dd className="text-lg font-semibold tabular-nums">8.6%</dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setSelected('Review')}>
            Review design
          </Button>
          <Button size="sm" variant="outline" onClick={() => setSelected('Terrain')}>
            View profile
          </Button>
        </div>
      </section>
      <div className="flex items-center gap-3 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-sm">
        <Layers className="size-4 shrink-0" aria-hidden="true" />
        <label className="flex flex-1 cursor-pointer items-center justify-between gap-2 text-sm font-medium">
          Terrain contours
          <input
            type="checkbox"
            checked={terrain}
            onChange={(event) => setTerrain(event.target.checked)}
            className="accent-[hsl(var(--primary))]"
          />
        </label>
      </div>
    </div>
  )
}

export function AppearanceDialog({
  onClose,
  onRestoreFocus,
  portalContainer,
}: {
  onClose: () => void
  onRestoreFocus?: () => void
  portalContainer?: HTMLElement | null
}) {
  const { resolvedTheme } = useTheme()
  const [draft, setDraft] = useState(readInterfaceTheme)
  const [mode, setMode] = useState<ThemeMode>(resolvedTheme === 'dark' ? 'dark' : 'light')
  const [defaultRadius] = useState(() => {
    const style = getComputedStyle(document.documentElement)
    return Number.parseFloat(style.getPropertyValue('--interface-default-radius')) * 16
  })
  const [preset, setPreset] = useState('')
  const [showCss, setShowCss] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const radiusLabel = useId()
  const css = showCss ? exportThemeCss(draft, defaultRadius) : ''
  const currentRadius = draft.radius ?? defaultRadius

  function editColour(role: ThemeRole, colour: string | null) {
    setPreset('')
    setCopied(false)
    setDraft((current) => {
      const palette = { ...current[mode] }
      if (colour) palette[role] = colour
      else delete palette[role]
      return { ...current, [mode]: palette }
    })
  }

  function applyPreset(name: string) {
    setDraft(themePresets[name] ?? defaultInterfaceTheme)
    setPreset(name)
    setCopied(false)
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        elevated
        portalContainer={portalContainer}
        className="max-h-[92dvh] max-w-4xl gap-0 overflow-y-auto p-0"
        onCloseAutoFocus={(event) => {
          if (onRestoreFocus) {
            event.preventDefault()
            onRestoreFocus()
          }
        }}
      >
        <DialogHeader className="border-b border-border px-5 py-4 pr-12 sm:px-6 sm:pr-12">
          <DialogTitle>Appearance</DialogTitle>
          <DialogDescription>Edit the PGMaps theme and preview changes before applying them.</DialogDescription>
        </DialogHeader>
        <div className="grid md:grid-cols-[19rem_minmax(0,1fr)]">
          <div className="space-y-4 p-5 sm:px-6 md:border-r md:border-border">
            <label className="grid gap-1.5 text-sm font-medium">
              Preset
              <StyledSelect
                aria-label="Theme preset"
                value={preset}
                onChange={(event) => applyPreset(event.target.value)}
              >
                <option value="" disabled>
                  Custom
                </option>
                {Object.keys(themePresets).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </StyledSelect>
            </label>
            <div className="flex gap-1 rounded-md bg-muted p-1" role="group" aria-label="Preview colour mode">
              {themeModes.map((item) => {
                const Icon = item === 'light' ? Sun : Moon
                return (
                  <Button
                    key={item}
                    size="xs"
                    variant={mode === item ? 'outline' : 'ghost'}
                    className="flex-1 capitalize"
                    aria-pressed={mode === item}
                    onClick={() => setMode(item)}
                  >
                    <Icon aria-hidden="true" />
                    {item === 'light' ? 'Light' : 'Dark'}
                  </Button>
                )
              })}
            </div>
            <fieldset className="space-y-1.5">
              <legend className="mb-1 text-sm font-semibold">Colours</legend>
              {themeRoles.map(([role, label]) => (
                <div key={role} className="flex items-center justify-between gap-2 text-sm">
                  <span>{label}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {draft[mode][role] ?? 'Default'}
                    </span>
                    <ColorField
                      label={`${mode === 'light' ? 'Light' : 'Dark'} mode ${label.toLowerCase()} colour`}
                      className="min-w-12 rounded-sm focus-within:ring-2 focus-within:ring-ring"
                      value={draft[mode][role] ?? null}
                      onChange={(colour) => editColour(role, colour)}
                    />
                  </div>
                </div>
              ))}
            </fieldset>
            <div className="space-y-3 border-t border-border pt-3">
              <div className="flex justify-between gap-2 text-sm">
                <span id={radiusLabel} className="font-semibold">
                  Corner radius
                </span>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">{currentRadius} px</span>
              </div>
              <Slider
                aria-labelledby={radiusLabel}
                min={radiusLimits.min}
                max={radiusLimits.max}
                step={1}
                value={[currentRadius]}
                onValueChange={([radius]) => {
                  setPreset('')
                  setCopied(false)
                  setDraft((current) => ({ ...current, radius }))
                }}
              />
            </div>
          </div>
          <section
            className="flex flex-col gap-3 border-t border-border bg-muted/40 p-5 sm:px-6 md:border-t-0"
            aria-label="Theme preview"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Live preview</h2>
              <span className="text-xs capitalize text-muted-foreground">{mode} mode</span>
            </div>
            <div className="flex-1">
              <ThemePreview theme={draft} mode={mode} />
            </div>
          </section>
        </div>
        {showCss && (
          <div className="grid gap-2 border-t border-border px-5 py-4 sm:px-6">
            <label className="grid gap-1.5 text-sm font-medium">
              CSS variables
              <textarea
                className="h-28 w-full resize-y rounded-md border border-input bg-background p-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                readOnly
                value={css}
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
            <Button
              className="justify-self-end"
              size="xs"
              variant="outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(css)
                  setCopied(true)
                } catch {
                  setError('Select the CSS variables to copy them manually.')
                }
              }}
            >
              {copied ? <Check aria-hidden="true" /> : <Clipboard aria-hidden="true" />}
              {copied ? 'Copied' : 'Copy CSS'}
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="px-5 pt-2 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3 sm:px-6">
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="ghost" onClick={() => applyPreset('PGMaps default')}>
              <RotateCcw aria-hidden="true" />
              Reset theme
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={showCss}
              onClick={() => {
                setError('')
                setShowCss(!showCss)
              }}
            >
              {showCss ? 'Hide CSS' : 'Export CSS'}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                try {
                  saveInterfaceTheme(draft)
                  onClose()
                } catch {
                  setError('This browser could not save your theme.')
                }
              }}
            >
              Apply theme
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
