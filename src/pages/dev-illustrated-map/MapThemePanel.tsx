/**
 * The workshop's map themes: choose a built-in or imported theme, import a theme ZIP, and export
 * the current settings with the active theme's fonts as a new one. Imported themes are kept in
 * the browser (`mapThemeStore.ts`); built-in themes fetch their committed fonts.
 */
import { useEffect, useRef, useState } from 'react'
import { Download, Palette, Trash2, Upload } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { FORM_INPUT_CLASS, FormField, SelectField } from '@/components/ui/form-field'
import { withBase } from '@/lib/dataUrl'
import { downloadBlob } from '@/lib/download'
import type { OrganicHatchRecipe } from '@pgmaps/geo-toolkit/patterns'
import type { GeographicMapOptions } from '@/lib/illustratedMap/geographic'
import {
  MAP_THEME_TYPE,
  MAP_THEME_VERSION,
  mapThemeOptions,
  readMapTheme,
  sha256,
  writeMapTheme,
  type MapThemeFiles,
  type MapThemeMap,
} from '@/lib/illustratedMap/mapTheme'
import { MAP_THEME_PRESETS } from '@/lib/illustratedMap/mapThemePresets'
import { deleteMapTheme, listMapThemes, saveMapTheme, type StoredMapTheme } from '@/lib/illustratedMap/mapThemeStore'

export interface MapThemePanelProps {
  /** The workshop's settings now, as a theme's hatch and map settings. */
  current: () => { hatch: OrganicHatchRecipe; map: MapThemeMap }
  /** Set the workshop from a theme. */
  onApply: (options: GeographicMapOptions) => void
}

const ROLE_LABELS = { places: 'Place names', regions: 'Region names', body: 'Footer text' } as const

async function presetFiles(id: string): Promise<MapThemeFiles> {
  const preset = MAP_THEME_PRESETS.find((candidate) => candidate.id === id)!
  const fonts = new Map<string, Uint8Array>()
  const entries = []
  for (const { fontPath, ...font } of preset.fonts) {
    const response = await fetch(withBase(`/${fontPath}`))
    if (!response.ok) throw new Error(`Could not load ${font.family} (${response.status}).`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    fonts.set(font.id, bytes)
    entries.push({ ...font, sha256: await sha256(bytes) })
  }
  return { theme: { ...preset.theme, fonts: entries }, fonts }
}

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'map-theme'

export default function MapThemePanel({ current, onApply }: MapThemePanelProps) {
  const [saved, setSaved] = useState<StoredMapTheme[]>([])
  const [selected, setSelected] = useState('')
  const [active, setActive] = useState<MapThemeFiles | null>(null)
  const [name, setName] = useState('My map theme')
  const [status, setStatus] = useState<{ kind: 'info' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    listMapThemes()
      .then(setSaved)
      .catch(() => setSaved([]))
  }, [])

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setStatus(null)
    try {
      await work()
    } catch (error) {
      setStatus({ kind: 'error', text: (error as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const apply = (files: MapThemeFiles) => {
    onApply(mapThemeOptions(files))
    setActive(files)
    setName(files.theme.name)
  }

  const choose = (value: string) =>
    run(async () => {
      setSelected(value)
      if (!value) return
      if (value.startsWith('preset:')) apply(await presetFiles(value.slice(7)))
      else {
        const stored = saved.find((theme) => `saved:${theme.id}` === value)
        if (stored) apply(await readMapTheme(stored.zip))
      }
    })

  const importTheme = (file: File) =>
    run(async () => {
      const zip = new Uint8Array(await file.arrayBuffer())
      const files = await readMapTheme(zip)
      const id = (await sha256(zip)).slice(0, 16)
      await saveMapTheme({ id, name: files.theme.name, savedAt: new Date().toISOString(), zip })
      setSaved(await listMapThemes())
      setSelected(`saved:${id}`)
      apply(files)
      setStatus({ kind: 'info', text: `Imported ${files.theme.name} with ${files.theme.fonts.length} font(s).` })
    })

  const exportTheme = () =>
    run(async () => {
      const { hatch, map } = current()
      // The active theme's fonts go with it, those its lettering uses.
      const lettering = active?.theme.lettering ?? {}
      const used = new Set(Object.values(lettering).filter(Boolean))
      const fonts = (active?.theme.fonts ?? [])
        .filter((font) => used.has(font.id))
        .map(({ sha256: _checksum, ...font }) => ({ ...font, bytes: active!.fonts.get(font.id)! }))
      const zip = await writeMapTheme({
        type: MAP_THEME_TYPE,
        version: MAP_THEME_VERSION,
        name: name.trim() || 'Map theme',
        description: `Saved from the illustrated map workshop${active ? `, starting from ${active.theme.name}` : ''}.`,
        hatch,
        map,
        lettering,
        fonts,
      })
      downloadBlob(
        new Blob([zip.slice().buffer as ArrayBuffer], { type: 'application/zip' }),
        `${slug(name)}.pgmaps-theme.zip`,
      )
      setStatus({ kind: 'info', text: `Exported ${name.trim() || 'Map theme'} with ${fonts.length} font(s).` })
    })

  const remove = () =>
    run(async () => {
      const id = selected.slice(6)
      await deleteMapTheme(id)
      setSaved(await listMapThemes())
      setSelected('')
    })

  return (
    <section className="space-y-4 rounded-lg border bg-card p-4" aria-labelledby="map-theme-heading">
      <div className="flex items-center gap-2">
        <Palette className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h2 id="map-theme-heading" className="font-semibold">
          Map theme
        </h2>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        A theme is the map’s look as one ZIP: the hatch, the map settings and the fonts it is lettered in, font files
        included. Export one to keep or share it; import one to use it here.
      </p>
      <SelectField label="Theme" value={selected} disabled={busy} onChange={(event) => void choose(event.target.value)}>
        <option value="">Choose a theme…</option>
        <optgroup label="Built in">
          {MAP_THEME_PRESETS.map((preset) => (
            <option key={preset.id} value={`preset:${preset.id}`}>
              {preset.theme.name}
            </option>
          ))}
        </optgroup>
        {saved.length > 0 && (
          <optgroup label="Imported">
            {saved.map((theme) => (
              <option key={theme.id} value={`saved:${theme.id}`}>
                {theme.name}
              </option>
            ))}
          </optgroup>
        )}
      </SelectField>
      {active && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs" aria-label="Theme fonts">
          {(Object.keys(ROLE_LABELS) as (keyof typeof ROLE_LABELS)[]).map((role) => {
            const id = active.theme.lettering[role]
            const font = active.theme.fonts.find((candidate) => candidate.id === id)
            return [
              <dt key={`${role}-label`} className="text-muted-foreground">
                {ROLE_LABELS[role]}
              </dt>,
              <dd key={`${role}-font`}>{font?.family ?? (role === 'body' ? 'Arial' : 'Built-in Great Forest')}</dd>,
            ]
          })}
        </dl>
      )}
      <div className="flex flex-wrap gap-2">
        <input
          ref={input}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void importTheme(file)
          }}
        />
        <Button type="button" size="xs" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
          <Upload className="h-3.5 w-3.5" aria-hidden />
          Import theme
        </Button>
        {selected.startsWith('saved:') && (
          <Button type="button" size="xs" variant="outline" disabled={busy} onClick={() => void remove()}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            Remove
          </Button>
        )}
      </div>
      <FormField label="New theme name">
        <input
          className={FORM_INPUT_CLASS}
          value={name}
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
        />
      </FormField>
      <Button type="button" size="sm" disabled={busy} onClick={() => void exportTheme()}>
        <Download className="h-4 w-4" aria-hidden />
        Export current settings as a theme
      </Button>
      {status && (
        <p
          role={status.kind === 'error' ? 'alert' : 'status'}
          className={`text-xs ${status.kind === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}
        >
          {status.text}
        </p>
      )}
    </section>
  )
}
