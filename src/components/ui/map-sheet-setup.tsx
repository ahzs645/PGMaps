import { FileButton } from '@/components/ui/file-button'
import { FORM_INPUT_CLASS, FormField, StyledSelect } from '@/components/ui/form-field'
import { InfoTip } from '@/components/ui/info-tip'
import { PAPER_SIZES, type PaperId } from '@/lib/mapSheet/layout'
import { formatScale, SHEET_SCALES } from '@/lib/mapSheet/scale'

export interface MapSheetSetupValue {
  kind: string
  paper: PaperId
  scale: number | 'fit'
  fields: Record<string, string>
  comments: string
}

export interface MapSheetField {
  id: string
  label: string
  /** `geometry` and `terrain` values are worked out and shown read-only; `entered` ones are typed. */
  origin: 'geometry' | 'terrain' | 'entered'
  /** The worked-out value, or null when it cannot be worked out. */
  computed?: string | null
  maxLength?: number
}

const ORIGIN_LABELS = { geometry: 'from the block', terrain: 'from the terrain' }

/**
 * Sheet setup for a printed map sheet: which sheet, paper and scale, which area it shows, and the
 * fields its title bar and information panel print. Values a tool works out are shown with where
 * they came from; the rest are typed. A tool supplies the lists, so any map can offer its own sheets.
 */
export function MapSheetSetup({
  value,
  onChange,
  kinds,
  areas,
  area,
  onArea,
  fields,
  commentsLabel,
  commentsMaxLength = 2000,
  logoName,
  onLogo,
  disabled,
}: {
  value: MapSheetSetupValue
  onChange: (value: MapSheetSetupValue) => void
  kinds: readonly { value: string; label: string; description?: string; unavailable?: string | null }[]
  /** Areas the sheet can be about, e.g. the blocks in a project. */
  areas?: readonly { value: string; label: string }[]
  area?: string
  onArea?: (value: string) => void
  fields: readonly MapSheetField[]
  /** Shown when the chosen sheet has a free-text comments box. */
  commentsLabel?: string
  commentsMaxLength?: number
  /** Name of the logo chosen for this session, if any. */
  logoName?: string | null
  /** A logo image, or null to remove it. Omit to offer no logo. */
  onLogo?: (file: File | null) => void
  disabled?: boolean
}) {
  const kind = kinds.find((entry) => entry.value === value.kind) ?? kinds[0]
  const set = (patch: Partial<MapSheetSetupValue>) => onChange({ ...value, ...patch })
  return (
    <fieldset disabled={disabled} className="grid min-w-0 gap-3 text-xs" data-testid="map-sheet-setup">
      <div className="grid gap-2 sm:grid-cols-3">
        <FormField label="Sheet" htmlFor="map-sheet-kind">
          <StyledSelect
            id="map-sheet-kind"
            className={FORM_INPUT_CLASS}
            value={value.kind}
            onChange={(event) => set({ kind: event.target.value })}
          >
            {kinds.map((entry) => (
              <option key={entry.value} value={entry.value} disabled={!!entry.unavailable}>
                {entry.label}
                {entry.unavailable ? ' (unavailable)' : ''}
              </option>
            ))}
          </StyledSelect>
        </FormField>
        <FormField label="Paper" htmlFor="map-sheet-paper">
          <StyledSelect
            id="map-sheet-paper"
            className={FORM_INPUT_CLASS}
            value={value.paper}
            onChange={(event) => set({ paper: event.target.value as PaperId })}
          >
            {(Object.keys(PAPER_SIZES) as PaperId[]).map((paper) => (
              <option key={paper} value={paper}>
                {PAPER_SIZES[paper].label}
              </option>
            ))}
          </StyledSelect>
        </FormField>
        <FormField label="Scale" htmlFor="map-sheet-scale">
          <StyledSelect
            id="map-sheet-scale"
            className={FORM_INPUT_CLASS}
            value={String(value.scale)}
            onChange={(event) => set({ scale: event.target.value === 'fit' ? 'fit' : Number(event.target.value) })}
          >
            {SHEET_SCALES.map((scale) => (
              <option key={scale} value={scale}>
                {formatScale(scale)}
              </option>
            ))}
            <option value="fit">Fit the block</option>
          </StyledSelect>
        </FormField>
      </div>
      {kind?.description && <p className="text-muted-foreground">{kind.description}</p>}
      {kind?.unavailable && (
        <p role="status" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2">
          {kind.unavailable}
        </p>
      )}
      {areas && onArea && (
        <FormField label="Block" htmlFor="map-sheet-area">
          <StyledSelect
            id="map-sheet-area"
            className={FORM_INPUT_CLASS}
            value={area ?? ''}
            onChange={(event) => onArea(event.target.value)}
          >
            {areas.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </StyledSelect>
        </FormField>
      )}
      <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2">
        {fields.map((field) =>
          field.origin === 'entered' ? (
            <FormField key={field.id} label={field.label} htmlFor={`map-sheet-field-${field.id}`}>
              <input
                id={`map-sheet-field-${field.id}`}
                className={FORM_INPUT_CLASS}
                value={value.fields[field.id] ?? ''}
                maxLength={field.maxLength ?? 120}
                onChange={(event) => set({ fields: { ...value.fields, [field.id]: event.target.value } })}
              />
            </FormField>
          ) : (
            <div key={field.id} className="min-w-0">
              <div className="font-medium">{field.label}</div>
              <div className="flex items-center gap-1 tabular-nums">
                <span className={field.computed ? '' : 'text-muted-foreground'}>
                  {field.computed ?? 'not recorded'}
                </span>
                <span className="text-3xs text-muted-foreground">{ORIGIN_LABELS[field.origin]}</span>
              </div>
            </div>
          ),
        )}
      </div>
      {commentsLabel && (
        <FormField label={commentsLabel} htmlFor="map-sheet-comments">
          <textarea
            id="map-sheet-comments"
            className={`${FORM_INPUT_CLASS} min-h-20`}
            maxLength={commentsMaxLength}
            value={value.comments}
            onChange={(event) => set({ comments: event.target.value })}
          />
        </FormField>
      )}
      {onLogo && (
        <div className="flex flex-wrap items-center gap-2">
          <FileButton
            label="Choose a logo image"
            accept="image/png,image/jpeg"
            onFiles={(files) => onLogo(files[0] ?? null)}
          >
            {logoName ? 'Replace logo' : 'Add logo'}
          </FileButton>
          {logoName && (
            <>
              <span className="truncate text-muted-foreground">{logoName}</span>
              <button type="button" className="underline" onClick={() => onLogo(null)}>
                Remove
              </button>
            </>
          )}
          <InfoTip label="About the logo">
            A PNG or JPEG printed in the footer's logo box. It stays in this browser tab and is not saved in the project
            file.
          </InfoTip>
        </div>
      )}
    </fieldset>
  )
}
