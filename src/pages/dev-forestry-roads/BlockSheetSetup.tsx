import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { readLogoFile } from '@/branding/logoFile'
import { saveUploadedLogo } from '@/branding/store'
import { useBranding } from '@/branding/useBranding'
import { MapSheetSetup, type MapSheetField } from '@/components/ui/map-sheet-setup'
import { blockFacts } from '@/lib/forestry/blockSheet/blockFacts'
import {
  ENTERED_FIELD_LABELS,
  infoFieldLabel,
  MAX_SHEET_COMMENTS_LENGTH,
  MAX_SHEET_FIELD_LENGTH,
  SHEET_KINDS,
  SHEET_PRESETS,
  type EnteredFieldId,
  type SheetKind,
} from '@/lib/forestry/blockSheet/sheets'
import type { RasterImage } from '@/lib/mapSheet/drawOps'
import {
  blockChoices,
  blockSheetUnavailable,
  canopySurfaceId,
  changeBlockSheetSettings,
  DEFAULT_BLOCK_SHEET,
  parseBlockSheetSettings,
  type BlockSheetSettings,
} from './blockSheet'
import { terrainReferenceSurfaces } from './terrain'
import type { RoadProject, TerrainSource } from './types'

const STORAGE_KEY = 'pgmaps.forestryRoads.blockSheet'

function stored(): BlockSheetSettings {
  try {
    const text = window.localStorage.getItem(STORAGE_KEY)
    return text ? parseBlockSheetSettings(JSON.parse(text)) : DEFAULT_BLOCK_SHEET
  } catch {
    return DEFAULT_BLOCK_SHEET
  }
}

const TITLE_FIELDS: EnteredFieldId[] = ['forestLicence', 'cuttingPermit', 'blockId']

/**
 * The block sheet's settings for the road tool: kept per browser, so the typed fields survive a
 * reload. The logo is the user's own, kept in the browser's branding store and shared with every sheet
 * and report (`saveUploadedLogo`), never in the project file. Returns the settings, the canopy surface and the setup form.
 */
export function useBlockSheet(project: RoadProject, terrain: TerrainSource | null) {
  const [settings, setSettings] = useState<BlockSheetSettings>(stored)
  const keptLogo = useBranding().logo
  const logo: { name: string; image: RasterImage } | null = useMemo(
    () =>
      keptLogo
        ? {
            name: keptLogo.name,
            image: {
              kind: 'url',
              url: keptLogo.dataUrl,
              format: keptLogo.format,
              width: keptLogo.width,
              height: keptLogo.height,
            },
          }
        : null,
    [keptLogo],
  )
  const [logoError, setLogoError] = useState('')
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
      // Storage may be blocked; the settings still apply for this tab.
    }
  }, [settings])
  const canopy = useMemo(() => {
    const id = canopySurfaceId(project.terrain.referenceSurfaces ?? [])
    if (!id) return null
    try {
      return terrainReferenceSurfaces(project.terrain)[id] ?? null
    } catch {
      return null
    }
  }, [project.terrain])
  const blocks = useMemo(() => blockChoices(project), [project])
  // A stored block that is not in this project falls back to the first one.
  const block = blocks.some((entry) => entry.value === settings.block) ? settings.block : (blocks[0]?.value ?? '')
  const effective = useMemo(() => ({ ...settings, block }), [settings, block])
  const facts = useMemo(() => {
    const choice = blocks.find((entry) => entry.value === block)
    if (!choice) return null
    try {
      return blockFacts(
        choice.geometry,
        terrain ? { source: terrain, spacingM: Math.max(1, project.terrain.resolutionM) } : undefined,
      )
    } catch {
      return null
    }
  }, [blocks, block, terrain, project.terrain.resolutionM])
  const preset = SHEET_PRESETS[effective.kind]
  const shown = new Set(preset.info.columns.flat())
  const fields: MapSheetField[] = [
    ...TITLE_FIELDS.map((id) => ({ id, label: ENTERED_FIELD_LABELS[id], origin: 'entered' as const })),
    ...[...shown].map((id): MapSheetField => {
      const label = infoFieldLabel(id, effective.kind)
      if (id === 'mapsheet') return { id, label, origin: 'geometry', computed: facts?.mapsheet ?? null }
      if (id === 'grossArea')
        return { id, label, origin: 'geometry', computed: facts ? `${facts.areaHa.toFixed(1)} (BC Albers)` : null }
      if (id === 'minElev' || id === 'maxElev')
        return {
          id,
          label,
          origin: 'terrain',
          computed: facts?.elevation
            ? String(Math.round(id === 'minElev' ? facts.elevation.min : facts.elevation.max))
            : null,
        }
      return { id, label, origin: 'entered', maxLength: MAX_SHEET_FIELD_LENGTH }
    }),
  ]
  const chooseLogo = (file: File | null) => {
    setLogoError('')
    const saving = file ? readLogoFile(file).then(saveUploadedLogo) : saveUploadedLogo(null)
    saving.catch((error: unknown) =>
      setLogoError(error instanceof Error ? error.message : 'The logo could not be kept.'),
    )
  }
  const sources = { terrain: terrain ?? undefined, canopy: canopy ?? undefined }
  const setup = (
    <div className="grid gap-2">
      <MapSheetSetup
        value={{ ...effective, fields: effective.fields as Record<string, string> }}
        onChange={(value) =>
          setSettings(
            changeBlockSheetSettings(effective, parseBlockSheetSettings({ ...value, block: effective.block })),
          )
        }
        kinds={SHEET_KINDS.map((kind: SheetKind) => ({
          value: kind,
          label: SHEET_PRESETS[kind].label,
          description: SHEET_PRESETS[kind].description,
          unavailable: blockSheetUnavailable(kind, sources),
        }))}
        areas={
          blocks.length
            ? blocks.map(({ value, label }) => ({ value, label }))
            : [{ value: '', label: 'No block areas: the sheet frames the roads' }]
        }
        area={block}
        onArea={(value) => setSettings({ ...effective, block: value })}
        fields={fields}
        commentsLabel={preset.comments ? 'Block access comments' : undefined}
        commentsMaxLength={MAX_SHEET_COMMENTS_LENGTH}
        logoName={logo?.name ?? null}
        onLogo={chooseLogo}
      />
      {logoError && (
        <p role="alert" className="text-xs text-danger">
          {logoError}
        </p>
      )}
      <Link
        to="/dev/forestry/block-sheets"
        target="_blank"
        rel="noreferrer"
        className="justify-self-start text-xs text-muted-foreground underline hover:text-foreground"
      >
        Symbol gallery
      </Link>
    </div>
  )
  /** Replaces the settings, e.g. from a saved sheet setup (`SheetSetupLibrary.tsx`). */
  const apply = (next: BlockSheetSettings) => setSettings(parseBlockSheetSettings(next))
  return { settings: effective, canopy, logo: logo?.image, setup, apply }
}
