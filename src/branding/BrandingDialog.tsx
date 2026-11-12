import { useRef, useState } from 'react'
import { Button } from '../components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog'
import { StyledSelect } from '../components/ui/styled-select'
import { logoDataUrl, pdfFontProblem, type BrandSettings } from './model'
import { removeBrand, saveBrand, saveBrandSettings } from './store'
import { useBranding } from './useBranding'
import './branding.css'

export function BrandingDialog({ onClose }: { onClose: () => void }) {
  const state = useBranding()
  const [draft, setDraft] = useState<BrandSettings>(() => ({ ...state.settings }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const picker = useRef<HTMLInputElement>(null)
  const brand = state.brands.find((brand) => brand.key === draft.selected)
  const problem = brand ? pdfFontProblem(brand) : null
  async function perform(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The brand could not be saved.')
    } finally {
      setBusy(false)
    }
  }
  const toggle = (
    key: 'workspace' | 'help' | 'exports' | 'typography' | 'pdfFonts',
    label: string,
    disabled = false,
  ) => (
    <label className="flex items-start gap-2 py-1.5">
      <input
        type="checkbox"
        checked={draft[key]}
        disabled={busy || disabled || !brand}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.checked })}
      />
      <span>{label}</span>
    </label>
  )
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto" elevated>
        <DialogHeader>
          <DialogTitle>Branding</DialogTitle>
          <DialogDescription>
            Import a Brandkit pack or consumer profile, preview it, and choose where to use it. Your project name and
            organisation stay yours.
          </DialogDescription>
        </DialogHeader>
        {(!state.ready || busy) && <p role="status">{busy ? 'Preparing the brand…' : 'Loading saved brands…'}</p>}
        {(error || state.error) && (
          <p role="alert" className="text-danger">
            {error || state.error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        <input
          ref={picker}
          type="file"
          accept=".zip,.json"
          hidden
          aria-label="Import Brandkit file"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file)
              void perform(async () => {
                const { importBrand } = await import('./importBrand')
                const imported = await importBrand(file)
                await saveBrand(imported)
                setDraft({ ...draft, selected: imported.key, pdfFonts: false })
                setNotice('Brand imported. Review the preview and apply your choices.')
              })
          }}
        />
        <Button variant="outline" disabled={busy || !state.ready} onClick={() => picker.current?.click()}>
          Import Brandkit brand
        </Button>
        <label className="grid gap-1 text-sm">
          Brand
          <StyledSelect
            value={draft.selected ?? 'default'}
            disabled={busy}
            aria-label="Brand"
            onChange={(e) =>
              setDraft({ ...draft, selected: e.target.value === 'default' ? null : e.target.value, pdfFonts: false })
            }
          >
            <option value="default">DDC Access (default)</option>
            {state.brands.map((b) => (
              <option key={b.key} value={b.key}>
                {b.profile.name} · {b.profile.version}
              </option>
            ))}
          </StyledSelect>
        </label>
        {brand && (
          <>
            <div className="brand-preview" aria-label="Brand preview">
              <div>
                <img src={logoDataUrl(brand.profile.logos.primary)} alt={`${brand.profile.name} on light background`} />
              </div>
              <div>
                <img src={logoDataUrl(brand.profile.logos.reverse)} alt={`${brand.profile.name} on dark background`} />
              </div>
            </div>
            <p className="text-sm text-muted-foreground">{brand.profile.provenance.status}</p>
            {brand.profile.identity?.clearSpace && (
              <p className="text-xs text-muted-foreground">{brand.profile.identity.clearSpace}</p>
            )}
          </>
        )}
        <fieldset disabled={busy} className="text-sm">
          <legend className="font-medium">Apply this brand to</legend>
          {toggle('workspace', 'Workspace headers and interface colours')}
          {toggle('help', 'Help pages and offline lessons')}
          {toggle('exports', 'Project reports and drawings')}
          <p className="text-xs text-muted-foreground">
            A logo uploaded for a block map sheet takes precedence over the selected brand.
          </p>
        </fieldset>
        <fieldset disabled={busy} className="text-sm">
          <legend className="font-medium">Typography</legend>
          {toggle('typography', 'Use brand fonts on screen and in HTML')}
          {brand && !brand.fonts.length && (
            <p className="text-xs text-muted-foreground">
              This profile names fonts but contains no font files. Unavailable faces use the screen’s fallback font.
            </p>
          )}
          {toggle('pdfFonts', 'Use brand fonts in PDF', !!problem)}
          <p className="text-xs text-muted-foreground">
            {problem ?? 'PDF brand fonts are optional. Standard PDF fonts remain available.'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            With PDF brand fonts off, reports and drawings use standard PDF fonts; the logo keeps its original outlines.
          </p>
        </fieldset>
        <div className="flex flex-wrap justify-end gap-2">
          {brand && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  await removeBrand(brand.key)
                  setDraft({ ...draft, selected: null, pdfFonts: false })
                  setNotice('Brand removed from this browser.')
                })
              }
            >
              Remove brand
            </Button>
          )}
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || !state.ready}
            onClick={() =>
              void perform(async () => {
                if (draft.pdfFonts && problem) throw Error(problem)
                await saveBrandSettings(draft)
                onClose()
              })
            }
          >
            Apply choices
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
