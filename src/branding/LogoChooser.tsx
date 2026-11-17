import { useState } from 'react'

import { FileButton } from '@/components/ui/file-button'

import { LOGO_FILE_ACCEPT, LOGO_FILE_TYPES_TEXT, readLogoFile } from './logoFile'
import { printedLogo, saveUploadedLogo } from './store'
import { useBranding } from './useBranding'

/**
 * The logo printed sheets and reports carry: the user's own PNG, JPEG or SVG (kept as a PNG drawn from it), kept in this browser's branding store, or
 * else the brand chosen in Branding. Adding one here adds it for every sheet and report; it never goes in a project
 * or scene file.
 */
export function LogoChooser() {
  const branding = useBranding()
  const chosen = printedLogo(branding)
  const [error, setError] = useState('')
  const keep = (file: File | null) => {
    setError('')
    const saving = file ? readLogoFile(file).then(saveUploadedLogo) : saveUploadedLogo(null)
    saving.catch((e: unknown) => setError(e instanceof Error ? e.message : 'The logo could not be kept.'))
  }
  return (
    <div className="grid gap-1 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <FileButton label="Choose a logo image" accept={LOGO_FILE_ACCEPT} onFiles={(files) => keep(files[0] ?? null)}>
          {branding.logo ? 'Replace logo' : 'Add logo'}
        </FileButton>
        {branding.logo && (
          <button type="button" className="underline" onClick={() => keep(null)}>
            Remove
          </button>
        )}
        <span className="text-muted-foreground" data-testid="logo-file-types">
          {LOGO_FILE_TYPES_TEXT}
        </span>
      </div>
      <p className="text-muted-foreground">
        {chosen?.source === 'uploaded'
          ? `Your logo, ${chosen.name}, kept in this browser for every sheet and report.`
          : chosen?.source === 'brand'
            ? `The ${chosen.name} brand’s logo (Branding). A logo added here takes its place.`
            : 'No logo: the slot stays empty. Add your own, or choose a brand in Branding.'}
      </p>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
