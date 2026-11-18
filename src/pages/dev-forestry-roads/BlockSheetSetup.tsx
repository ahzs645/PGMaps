import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { readLogoFile } from '@/branding/logoFile'
import { saveUploadedLogo } from '@/branding/store'
import { useBranding } from '@/branding/useBranding'
import { MapSheetOutput } from '@/components/ui/map-sheet-output'
import { SelectField } from '@/components/ui/form-field'
import { MapSheetSetup, type MapSheetField } from '@/components/ui/map-sheet-setup'
import { blockFacts } from '@/lib/forestry/blockSheet/blockFacts'
import { sheetSetupFields } from '@/lib/forestry/blockSheet/setupFields'
import { MAX_SHEET_COMMENTS_LENGTH, SHEET_KINDS, SHEET_PRESETS, type SheetKind } from '@/lib/forestry/blockSheet/sheets'
import type { RasterImage } from '@/lib/mapSheet/drawOps'
import {
  blockChoices,
  blockSheetPublished,
  blockSheetUnavailable,
  canopySurfaceId,
  changeBlockSheetSettings,
  DEFAULT_BLOCK_SHEET,
  parseBlockSheetSettings,
  seriesBlocks,
  SHEET_SYMBOL_CHOICES,
  type BlockSheetSettings,
} from './blockSheet'
import { ROAD_DESIGN_DEPLOYMENT } from './deployment'
import { publishedOffers, type SheetRasterChoice } from './pdfSheetRasters'
import { StyleLibraryPanel } from './StyleLibraryPanel'
import { terrainReferenceSurfaces } from './terrain'
import type { RoadProject, TerrainSource } from './types'

/** *Symbol gallery*'s address on this deployment, or null when it has none. */
const gallery = ROAD_DESIGN_DEPLOYMENT.blockSheetGallery

const STORAGE_KEY = 'pgmaps.forestryRoads.blockSheet'

function stored(): BlockSheetSettings {
  try {
    const text = window.localStorage.getItem(STORAGE_KEY)
    return text ? parseBlockSheetSettings(JSON.parse(text)) : DEFAULT_BLOCK_SHEET
  } catch {
    return DEFAULT_BLOCK_SHEET
  }
}

/**
 * The block sheet's settings for the road tool: kept per browser, so the typed fields survive a
 * reload. The logo is the user's own, kept in the browser's branding store and shared with every sheet
 * and report (`saveUploadedLogo`), never in the project file. Returns the settings, the canopy surface and the setup form.
 * With *Map style* on *My saved styles* the form also holds the style library, where each feature's
 * style is chosen; `onStyleLibraryChange` lets the page rebuild the sheet's preview after an edit there.
 * Under it, *File* (`MapSheetOutput`) chooses the format, one sheet per block and the mask; those
 * choices are kept with the rest in this browser, never in the project.
 */
export function useBlockSheet(project: RoadProject, terrain: TerrainSource | null, onStyleLibraryChange?: () => void) {
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
  const series = useMemo(() => seriesBlocks(project), [project])
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
  const fields: MapSheetField[] = sheetSetupFields(effective.kind, facts)
  const chooseLogo = (file: File | null) => {
    setLogoError('')
    const saving = file ? readLogoFile(file).then(saveUploadedLogo) : saveUploadedLogo(null)
    saving.catch((error: unknown) =>
      setLogoError(error instanceof Error ? error.message : 'The logo could not be kept.'),
    )
  }
  const sources = { terrain: terrain ?? undefined, canopy: canopy ?? undefined }
  // An imported map sheet's slope or canopy classes, or its hillshade, can be the sheet's raster.
  const offers = useMemo(() => publishedOffers(project.reference), [project.reference])
  const base = preset.base
  const offer = offers.find((entry) => entry.base === base && !entry.reason)
  const own = base === 'canopy-height' ? !!canopy : !!terrain
  const drawn = offer ? blockSheetPublished(effective.kind, effective.raster, project, sources) : null
  const autoDrawn = offer ? blockSheetPublished(effective.kind, 'auto', project, sources) : null
  const rasterName = base === 'slope' ? 'Slope classes' : base === 'hillshade' ? 'Hillshade' : 'Canopy height'
  const ownName = base === 'canopy-height' ? 'the canopy surface' : `the terrain (${project.terrain.name})`
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
          unavailable: blockSheetUnavailable(kind, sources, offers),
        }))}
        areas={
          blocks.length
            ? blocks.map(({ value, label }) => ({ value, label }))
            : [{ value: '', label: 'No block areas: the sheet frames the roads' }]
        }
        area={block}
        onArea={(value) => setSettings({ ...effective, block: value })}
        fields={fields}
        styles={SHEET_SYMBOL_CHOICES}
        style={effective.symbols}
        onStyle={(value) => setSettings({ ...effective, symbols: value === 'library' ? 'library' : 'pgmaps' })}
        styleHint={
          effective.symbols === 'library'
            ? 'Each feature below draws with the style chosen for it, on the map and in the legend; the rest keep PGMaps’ symbols.'
            : 'The sheet’s own symbols, as the Symbol gallery shows them.'
        }
        commentsLabel={preset.comments ? 'Block access comments' : undefined}
        commentsMaxLength={MAX_SHEET_COMMENTS_LENGTH}
        logoName={logo?.name ?? null}
        onLogo={chooseLogo}
      />
      {offer &&
        (own ? (
          <SelectField
            label={`${rasterName} from`}
            hint={
              drawn
                ? `Drawn as ${offer.file} published it. Classes it could only estimate print paler.`
                : `Worked out from ${ownName}.`
            }
            value={effective.raster}
            onChange={(event) => setSettings({ ...effective, raster: event.target.value as SheetRasterChoice })}
          >
            <option value="auto">PGMaps chooses (now: {autoDrawn ? 'the imported sheet' : ownName})</option>
            <option value="terrain">{ownName.replace(/^the /, 'The ')}</option>
            <option value="sheet">Imported sheet: {offer.file}</option>
          </SelectField>
        ) : (
          <p className="text-xs text-muted-foreground" data-testid="block-sheet-raster-source">
            {rasterName} drawn as {offer.file} published it: the project has no{' '}
            {base === 'canopy-height' ? 'canopy surface' : 'terrain'} to work it out from.
          </p>
        ))}
      {logoError && (
        <p role="alert" className="text-xs text-danger">
          {logoError}
        </p>
      )}
      {effective.symbols === 'library' && <StyleLibraryPanel onChange={onStyleLibraryChange} />}
      <section aria-label="File" className="grid gap-2 border-t pt-3">
        <h4 className="text-xs font-semibold">File</h4>
        <MapSheetOutput
          value={effective.output}
          onChange={(output) => setSettings({ ...effective, output })}
          blocks={series}
          mask={blocks.length > 0}
        />
      </section>
      {gallery &&
        (gallery.startsWith('/') ? (
          <Link
            to={gallery}
            target="_blank"
            rel="noreferrer"
            className="justify-self-start text-xs text-muted-foreground underline hover:text-foreground"
          >
            Symbol gallery
          </Link>
        ) : (
          <a
            href={gallery}
            target="_blank"
            rel="noreferrer"
            className="justify-self-start text-xs text-muted-foreground underline hover:text-foreground"
          >
            Symbol gallery
          </a>
        ))}
    </div>
  )
  /** Replaces the settings, e.g. from a saved sheet setup (`SheetSetupLibrary.tsx`). */
  const apply = (next: BlockSheetSettings) => setSettings(parseBlockSheetSettings(next))
  return { settings: effective, canopy, logo: logo?.image, setup, apply, blocks, seriesBlocks: series }
}
