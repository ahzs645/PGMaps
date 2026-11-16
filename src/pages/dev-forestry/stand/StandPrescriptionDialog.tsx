/**
 * The stand prescription for one retention or partial-cut block: what to take and what to leave,
 * the stand table before, removed and kept, and graphs of the result. The outcome and the headline
 * figures stay above the tabs. Nothing here reaches the run: the block's Table 5/6 inputs change only
 * when the reviewer copies the prescription's figures with *Use for Table 5/6*.
 */

import { SNAG_CURVES, SNAG_MAX_YEARS, snagFates, snagsStandingByYear } from './snagDecay'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { PanelDialog } from '@/components/ui/dialog-shell'
import { EngineeringTable, ColumnHeader } from '@/components/ui/engineering-table'
import { FileDropField } from '@/components/ui/file-drop-field'
import { NullableNumberField, NumberField, SelectField } from '@/components/ui/form-field'
import { InfoTip } from '@/components/ui/info-tip'
import { FilterChipGroup, InlineAlert } from '@/components/ui/map-panels'
import type { PickedFile } from '@/components/ui/picked-files'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { StatGroup, type StatItem } from '@/components/ui/stat-group'
import { TabBar } from '@/components/ui/tab-bar'
import { ToolDisclosure } from '@/components/ui/tool-section'
import { DEFAULT_LOCALE } from '@/lib/format'

import { TREE_SPECIES_IDS, type TreeSpeciesId } from '../forest'
import {
  TARGET_LABELS,
  blockShareKept,
  type PrescriptionResult,
  type PrescriptionTargetKind,
  type RemovalOrder,
  type RetentionPattern,
  type StandPrescription,
  type TreeOutcome,
} from './prescription'
import {
  PROFILE_STRIP_WIDTH_M,
  SPECIES_LABELS,
  clumpDistribution,
  diameterClasses,
  heightClasses,
  normalizedClumpTargets,
  speciesBeforeAfter,
  standProfile,
} from './prescriptionCharts'
import { ClumpDistributionBars, SpeciesBars, StackedClassBars, StandProfile } from './StandCharts'
import { ICO_CLASSES, type StandSummary } from './standMetrics'
import type { Stand } from './standTrees'
import {
  GEOMETRY_CROWN_AREA,
  convertTreeList,
  crsChoicesFor,
  droppedSummary,
  readTreeList,
  statedUnits,
  type ColumnMapping,
  type CrownMeasure,
  type ImportedTree,
  type ImportedTreeSource,
  type TreeListConversion,
  type TreeListRead,
  type TreeListUnits,
} from './treeListImport'

export type AdoptedFigures = { retentionPercent?: number; volumeRemovedPercent?: number; residualHeightMeters?: number }

type Props = {
  open: boolean
  onClose: () => void
  blockName: string
  harvestSystem: 'retention' | 'partial'
  /** The block's recorded figures, shown when the target follows the block. */
  block: {
    retentionPercent?: number | null
    volumeRemovedPercent?: number | null
    residualHeightMeters?: number | null
  }
  prescription: StandPrescription
  onChange: (next: StandPrescription) => void
  onRemove: () => void
  /** null while computing or when the block cannot be read; error says why. */
  stand: Stand | null
  result: PrescriptionResult | null
  error: string | null
  /** Copies the prescription's figures into the block's Table 5/6 inputs (reviewer's click). */
  onAdopt: (figures: AdoptedFigures) => void
  /** Clears the protected trees (trees are protected by clicking them on the plan map). */
  onClearProtected: () => void
  /**
   * Gives the block a stand from an imported tree list, converted with the system and units the
   * reviewer chose. Without it the dialog offers no import (the drawn stand only).
   */
  onImportTrees?: (trees: ImportedTree[], source: ImportedTreeSource) => void
  /** Goes back to the road view's drawn stems. */
  onClearImport?: () => void
  /** The imported list the block uses now; null or absent while it uses the drawn stand. */
  importedSource?: ImportedTreeSource | null
  /** The stand profile's strip while the Graphs tab shows it (null when it closes), for the plan map. */
  onStripChange?: (strip: { bearingDegrees: number | null; widthMeters: number } | null) => void
}

type Tab = 'prescription' | 'table' | 'graphs'

const whole = new Intl.NumberFormat(DEFAULT_LOCALE, { maximumFractionDigits: 0 })
const oneDecimal = new Intl.NumberFormat(DEFAULT_LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const twoDecimals = new Intl.NumberFormat(DEFAULT_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const round1 = (value: number) => Math.round(value * 10) / 10

/** The figures *Use for Table 5/6* copies into the block's inputs. Basal area stands in for volume. */
export function adoptedFigures(harvestSystem: 'retention' | 'partial', result: PrescriptionResult): AdoptedFigures {
  if (harvestSystem === 'retention') return { retentionPercent: Math.round(100 - result.removedBasalAreaPercent) }
  return {
    volumeRemovedPercent: Math.round(result.removedBasalAreaPercent),
    residualHeightMeters: round1(result.summaries.retained.heightMeters.mean),
  }
}

const TARGET_KINDS = Object.keys(TARGET_LABELS) as PrescriptionTargetKind[]

/** A starting value when the target's kind changes: half of the stand before, or half a share. */
function startingValue(kind: PrescriptionTargetKind, result: PrescriptionResult | null): number {
  if (kind === 'basalAreaShare' || kind === 'stemShare' || kind === 'block') return 50
  const before = result?.summaries.before
  if (!before) return kind === 'basalArea' ? 20 : 300
  const value =
    kind === 'basalArea' ? before.basalAreaM2PerHa : kind === 'stems' ? before.stemsPerHa : before.standDensityIndex
  return kind === 'basalArea' ? round1(value / 2) : Math.round(value / 2)
}

const PATTERNS = [
  { value: 'dispersed' as const, label: 'Dispersed' },
  { value: 'grouped' as const, label: 'Grouped' },
]
const ORDERS = [
  { value: 'fromBelow' as const, label: 'From below' },
  { value: 'fromAbove' as const, label: 'From above' },
  { value: 'proportional' as const, label: 'Proportional' },
]
const ORDER_BY = [
  { value: 'dbh' as const, label: 'Diameter' },
  { value: 'height' as const, label: 'Height' },
]
const OUTCOMES = [
  { value: 'hauled' as const, label: 'Hauled — stumps' },
  { value: 'felled' as const, label: 'Felled and left' },
  { value: 'limbed' as const, label: 'Felled, limbed and left' },
]
const SPECIES_MODES = [
  { value: 'all', label: 'All species' },
  { value: 'only', label: 'Only these' },
  { value: 'except', label: 'All but these' },
] as const

function Outcome({
  stand,
  result,
  error,
}: {
  stand: Stand | null
  result: PrescriptionResult | null
  error: string | null
}) {
  if (error) return <InlineAlert tone="error">{error}</InlineAlert>
  if (!stand || !result) return <InlineAlert loading>Reading the block&rsquo;s trees…</InlineAlert>
  const { target } = result
  const format = target.kind === 'basalArea' ? oneDecimal : whole
  const line = `${target.label}: ${format.format(target.reached)} ${target.unit} left, asked ${format.format(target.asked)}.`
  const tone = !result.reached ? 'warning' : result.message ? 'info' : 'success'
  return (
    <InlineAlert tone={tone} title={result.reached ? 'Target reached' : 'Target not reached'}>
      <p>{line}</p>
      {result.message && <p>{result.message}</p>}
    </InlineAlert>
  )
}

function headline(result: PrescriptionResult, grouped: boolean): StatItem[] {
  const { before, retained } = result.summaries
  const share = before.basalAreaM2PerHa > 0 ? (100 * retained.basalAreaM2PerHa) / before.basalAreaM2PerHa : 0
  const items: StatItem[] = [
    {
      key: 'ba',
      label: 'Basal area left',
      value: `${oneDecimal.format(retained.basalAreaM2PerHa)} m²/ha`,
      note: `${whole.format(share)}% of ${oneDecimal.format(before.basalAreaM2PerHa)}`,
    },
    {
      key: 'stems',
      label: 'Stems left',
      value: `${whole.format(retained.stemsPerHa)} /ha`,
      note: `of ${whole.format(before.stemsPerHa)}`,
    },
    {
      key: 'removed',
      label: 'Removed',
      value: `${whole.format(result.removedBasalAreaPercent)}% BA`,
      note: `${whole.format(result.removedStemsPercent)}% of stems`,
    },
  ]
  if (grouped)
    items.push({
      key: 'clump',
      label: 'Mean clump size kept',
      value: `${oneDecimal.format(result.clumps.retained.meanClumpSize)} trees`,
      note: `${whole.format(result.clumps.retained.clumpCount)} clumps`,
    })
  return items
}

function AdoptRow({
  harvestSystem,
  result,
  onAdopt,
}: {
  harvestSystem: 'retention' | 'partial'
  result: PrescriptionResult | null
  onAdopt: (figures: AdoptedFigures) => void
}) {
  const figures = result ? adoptedFigures(harvestSystem, result) : null
  const copies = figures
    ? harvestSystem === 'retention'
      ? `retention ${figures.retentionPercent}%`
      : `volume removed ${figures.volumeRemovedPercent}%, residual height ${oneDecimal.format(figures.residualHeightMeters ?? 0)} m`
    : null
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Button
        size="xs"
        variant="outline"
        disabled={!figures}
        aria-label="Use for Table 5/6: copy the prescription's figures into the block's inputs"
        onClick={() => figures && onAdopt(figures)}
      >
        Use for Table 5/6
      </Button>
      <span className="text-2xs text-muted-foreground">
        {copies ? <>Copies {copies} into the block&rsquo;s inputs.</> : 'Nothing to copy yet.'}
      </span>
      <InfoTip label="About Use for Table 5/6">
        Basal area stands in for volume: the share of basal area removed is copied as the volume removed, and the kept
        trees&rsquo; mean height as the residual height. The block&rsquo;s Table 5/6 figures stay the reviewer&rsquo;s
        to edit; the prescription never changes them by itself.
      </InfoTip>
    </div>
  )
}

function PrescriptionTab({
  harvestSystem,
  block,
  prescription,
  onChange,
  result,
  onClearProtected,
}: Pick<Props, 'harvestSystem' | 'block' | 'prescription' | 'onChange' | 'result' | 'onClearProtected'>) {
  const set = (patch: Partial<StandPrescription>) => onChange({ ...prescription, ...patch })
  const { target } = prescription
  const recorded = blockShareKept({ harvestSystem, ...block })
  const clumpSum = prescription.clumpTargets.reduce((sum, share) => sum + Math.max(0, share), 0)
  const normalised = normalizedClumpTargets(prescription.clumpTargets)
  const toggleSpecies = (id: TreeSpeciesId) =>
    set({
      species: {
        ...prescription.species,
        ids: prescription.species.ids.includes(id)
          ? prescription.species.ids.filter((other) => other !== id)
          : TREE_SPECIES_IDS.filter((other) => other === id || prescription.species.ids.includes(other)),
      },
    })
  return (
    <div className="space-y-4 text-xs">
      <SegmentedControl<RetentionPattern>
        label="Pattern"
        size="sm"
        value={prescription.pattern}
        onChange={(pattern) => set({ pattern })}
        options={PATTERNS}
      />

      <div className="grid gap-2 sm:grid-cols-2">
        <SelectField
          label="Target"
          value={target.kind}
          onValueChange={(value) => {
            const kind = value as PrescriptionTargetKind
            set({ target: { kind, value: startingValue(kind, result) } })
          }}
        >
          {TARGET_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {TARGET_LABELS[kind].label}
            </option>
          ))}
        </SelectField>
        {target.kind === 'block' ? (
          <div className="space-y-1">
            <span className="block text-xs font-medium text-muted-foreground">Kept</span>
            <p className="text-sm font-medium">
              {whole.format(recorded.percent)}% <span className="text-xs text-muted-foreground">of basal area</span>
            </p>
            <p className="text-2xs text-muted-foreground">
              {recorded.assumed
                ? `No ${harvestSystem === 'retention' ? 'retention' : 'volume removed'} recorded for the block: 50% assumed.`
                : harvestSystem === 'retention'
                  ? 'The block’s retention.'
                  : 'What the block’s volume removed leaves.'}
            </p>
          </div>
        ) : (
          <NumberField
            label="Value"
            aria-label={`${TARGET_LABELS[target.kind].label} (${TARGET_LABELS[target.kind].unit})`}
            unit={TARGET_LABELS[target.kind].unit}
            min={0}
            max={target.kind === 'basalAreaShare' || target.kind === 'stemShare' ? 100 : undefined}
            step={target.kind === 'basalArea' ? 0.5 : 1}
            value={target.value}
            onValueChange={(value) => set({ target: { kind: target.kind, value } })}
          />
        )}
      </div>

      {prescription.pattern === 'dispersed' ? (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="space-y-1">
            <span className="block text-xs font-medium text-muted-foreground">Order</span>
            <SegmentedControl<RemovalOrder>
              label="Removal order"
              size="sm"
              value={prescription.order}
              onChange={(order) => set({ order })}
              options={ORDERS}
            />
          </div>
          <div className="space-y-1">
            <span className="block text-xs font-medium text-muted-foreground">By</span>
            <SegmentedControl<'dbh' | 'height'>
              label="Order by"
              size="sm"
              value={prescription.orderBy}
              onChange={(orderBy) => set({ orderBy })}
              options={ORDER_BY}
            />
          </div>
        </div>
      ) : (
        <fieldset className="space-y-2">
          <legend className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
            Clump targets
            <InfoTip label="About clump targets">
              The share of kept trees wanted in each clump-size class (the ICO method). The figures are read as
              proportions of their sum, so they need not add to 100. The starting figures are a point to adjust, not a
              reference condition for BC interior stands.
            </InfoTip>
          </legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {ICO_CLASSES.map((icoClass, i) => (
              <NumberField
                key={icoClass.id}
                label={icoClass.label}
                aria-label={`Clump target, ${icoClass.label}`}
                unit="%"
                min={0}
                max={100}
                precision={0}
                value={Math.round((prescription.clumpTargets[i] ?? 0) * 100)}
                onValueChange={(value) =>
                  set({
                    clumpTargets: prescription.clumpTargets.map((share, k) =>
                      k === i ? Math.max(0, value) / 100 : share,
                    ),
                  })
                }
              />
            ))}
          </div>
          <p className="text-2xs text-muted-foreground">
            Sum {whole.format(clumpSum * 100)}%
            {Math.abs(clumpSum - 1) > 0.005 && (
              <> · used as {normalised.map((share) => `${whole.format(share * 100)}%`).join(' / ')}</>
            )}
          </p>
          <NumberField
            label="Clump distance"
            unit="m"
            min={1}
            max={20}
            step={0.5}
            fieldClassName="max-w-[10rem]"
            value={prescription.clumpDistanceMeters}
            onValueChange={(clumpDistanceMeters) => set({ clumpDistanceMeters })}
          />
        </fieldset>
      )}

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-muted-foreground">Limits</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          <NullableNumberField
            label="Keep all at or over"
            aria-label="Diameter limit: keep every tree at or over (cm)"
            unit="cm"
            min={1}
            max={500}
            placeholder="none"
            value={prescription.diameterLimitCm}
            onValueChange={(diameterLimitCm) => set({ diameterLimitCm })}
          />
          <NullableNumberField
            label="Removable from"
            aria-label="Removable diameter minimum (cm)"
            unit="cm"
            min={0}
            max={500}
            placeholder="any"
            value={prescription.removableDbhCm.min}
            onValueChange={(min) => set({ removableDbhCm: { ...prescription.removableDbhCm, min } })}
          />
          <NullableNumberField
            label="Removable under"
            aria-label="Removable diameter maximum (cm)"
            unit="cm"
            min={0}
            max={500}
            placeholder="any"
            value={prescription.removableDbhCm.max}
            onValueChange={(max) => set({ removableDbhCm: { ...prescription.removableDbhCm, max } })}
          />
        </div>
        <SelectField
          label="Species cut"
          fieldClassName="max-w-[14rem]"
          value={prescription.species.mode}
          onValueChange={(value) =>
            set({ species: { ...prescription.species, mode: value as StandPrescription['species']['mode'] } })
          }
        >
          {SPECIES_MODES.map((mode) => (
            <option key={mode.value} value={mode.value}>
              {mode.label}
            </option>
          ))}
        </SelectField>
        <FilterChipGroup<TreeSpeciesId>
          variant="filled"
          showDot={false}
          items={TREE_SPECIES_IDS.map((id) => ({
            value: id,
            label: SPECIES_LABELS[id],
            disabled: prescription.species.mode === 'all',
          }))}
          selectedValues={prescription.species.ids}
          onToggle={toggleSpecies}
        />
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-muted-foreground">Treatment</legend>
        <SegmentedControl<TreeOutcome>
          label="Outcome"
          size="sm"
          value={prescription.outcome}
          onChange={(outcome) => set({ outcome })}
          options={OUTCOMES}
        />
        <div className="grid grid-cols-2 gap-2 sm:max-w-sm">
          <NullableNumberField
            label="Felling bearing"
            aria-label="Felling bearing (degrees from north; blank for any way)"
            unit="°"
            min={0}
            max={360}
            placeholder="any"
            disabled={prescription.outcome === 'hauled'}
            value={prescription.fellingBearingDegrees}
            onValueChange={(fellingBearingDegrees) => set({ fellingBearingDegrees })}
          />
          <NumberField
            label="Spread"
            aria-label="Felling spread (degrees)"
            unit="°"
            min={0}
            max={180}
            disabled={prescription.outcome === 'hauled'}
            value={prescription.fellingSpreadDegrees}
            onValueChange={(fellingSpreadDegrees) => set({ fellingSpreadDegrees })}
          />
          <NumberField
            label="Snags"
            aria-label="Wildlife trees left as snags (per hectare)"
            unit="/ha"
            min={0}
            max={100}
            value={prescription.snags.perHa}
            onValueChange={(perHa) => set({ snags: { ...prescription.snags, perHa: Math.max(0, perHa) } })}
          />
          <NumberField
            label="Snag height"
            aria-label="Snag height (m)"
            unit="m"
            min={1}
            max={40}
            disabled={prescription.snags.perHa <= 0}
            value={prescription.snags.heightMeters}
            onValueChange={(heightMeters) => set({ snags: { ...prescription.snags, heightMeters } })}
          />
          <NumberField
            label="Shown at"
            aria-label="Snags shown at (years after harvest)"
            unit="yr"
            min={0}
            max={SNAG_MAX_YEARS}
            precision={0}
            disabled={prescription.snags.perHa <= 0}
            value={prescription.snags.yearsAfterHarvest}
            onValueChange={(years) =>
              set({
                snags: {
                  ...prescription.snags,
                  yearsAfterHarvest: Math.max(0, Math.min(SNAG_MAX_YEARS, Math.round(years))),
                },
              })
            }
          />
          <InfoTip label="About snags">
            Wildlife trees: of the trees taken, the largest are topped at the snag height and left standing dead instead
            of felled. They are drawn as bare stems and listed in the tree file. Drawing only: a snag is not counted as
            standing timber anywhere.
          </InfoTip>
        </div>
      </fieldset>

      <div className="px-3">
        <ToolDisclosure label="Advanced">
          <div className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-end">
            <NumberField
              label="Marking efficiency"
              aria-label="Marking efficiency (%)"
              unit="%"
              min={50}
              max={100}
              precision={0}
              value={Math.round(prescription.markingEfficiency * 100)}
              onValueChange={(value) => set({ markingEfficiency: Math.max(0.5, Math.min(1, value / 100)) })}
            />
            <p className="text-2xs text-muted-foreground">Share of marked trees the crew cuts.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Seed {whole.format(prescription.seed)}</span>
            <Button size="xs" variant="outline" onClick={() => set({ seed: prescription.seed + 1 })}>
              Draw again
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {whole.format(prescription.protectedKeys.length)} protected
            </span>
            <Button
              size="xs"
              variant="outline"
              disabled={prescription.protectedKeys.length === 0}
              onClick={onClearProtected}
            >
              Clear protected
            </Button>
            <InfoTip label="About protected trees">
              Click a tree on the plan map to protect it: no rule cuts a protected tree.
            </InfoTip>
          </div>
        </ToolDisclosure>
      </div>
    </div>
  )
}

type TreeSourceMode = 'drawn' | 'imported'

const TREE_SOURCES = [
  { value: 'drawn' as const, label: 'Drawn stand' },
  { value: 'imported' as const, label: 'Imported tree list' },
]
const CROWN_MEASURES = [
  { value: 'width' as const, label: 'Width (diameter)' },
  { value: 'radius' as const, label: 'Radius' },
  { value: 'area' as const, label: 'Area' },
]
const HEIGHT_UNITS = [
  { value: 'm', label: 'Metres' },
  { value: 'ft', label: 'Feet' },
]
const DIAMETER_UNITS = [
  { value: 'cm', label: 'Centimetres' },
  { value: 'in', label: 'Inches' },
]
const MAPPED_COLUMNS: Array<{ key: keyof Omit<ColumnMapping, 'crownMeasure'>; label: string; required: boolean }> = [
  { key: 'x', label: 'Easting or longitude', required: true },
  { key: 'y', label: 'Northing or latitude', required: true },
  { key: 'height', label: 'Height', required: true },
  { key: 'crown', label: 'Crown size', required: false },
  { key: 'dbh', label: 'Diameter (DBH)', required: false },
  { key: 'species', label: 'Species', required: false },
  { key: 'id', label: 'Tree ID', required: false },
]

type ImportDraft = {
  read: TreeListRead
  mapping: ColumnMapping
  epsg: number | null
  heightUnit: TreeListUnits['height'] | null
  diameterUnit: TreeListUnits['diameter'] | null
}

/** A draft from a fresh read: the suggested columns, and a system or unit only where the file states it. */
function draftFrom(read: TreeListRead): ImportDraft {
  const stated = statedUnits(read.suggested)
  return {
    read,
    mapping: read.suggested,
    epsg: read.crsHint?.epsg ?? null,
    heightUnit: stated.height,
    diameterUnit: stated.diameter,
  }
}

/** What the reviewer still has to choose before the list converts. */
function missingChoices(draft: ImportDraft): string[] {
  return [
    !draft.mapping.x && 'the easting or longitude column',
    !draft.mapping.y && 'the northing or latitude column',
    !draft.mapping.height && 'the height column',
    draft.epsg === null && 'the coordinate system',
    !draft.heightUnit && 'the height unit',
    draft.mapping.dbh && !draft.diameterUnit && 'the diameter unit',
  ].filter((entry): entry is string => !!entry)
}

const optionsOf = (options: ReadonlyArray<{ value: string; label: string }>) =>
  options.map((option) => (
    <option key={option.value} value={option.value}>
      {option.label}
    </option>
  ))

async function readPickedFile(file: Pick<File, 'name' | 'text'>): Promise<TreeListRead> {
  const text = await file.text()
  if (/\.(geo)?json$/i.test(file.name)) {
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      throw new Error(`${file.name} is not valid JSON.`)
    }
    return readTreeList({ name: file.name, json })
  }
  return readTreeList({ name: file.name, text })
}

function CurrentSource({ source }: { source: ImportedTreeSource }) {
  return (
    <p className="text-2xs text-muted-foreground" data-testid="stand-imported-source">
      In use: {whole.format(source.count)} trees from {source.fileName} ({source.crs})
      {source.dropped > 0 && <>, {whole.format(source.dropped)} rows dropped</>}
      {source.leftOut ? <>, {whole.format(source.leftOut)} left out past the limit</> : null}.
    </p>
  )
}

/** Where the block's trees come from: the road view's drawn stems, or a tree list the reviewer imports. */
function TreeSource({
  importedSource,
  onImportTrees,
  onClearImport,
}: {
  importedSource: ImportedTreeSource | null
  onImportTrees: NonNullable<Props['onImportTrees']>
  onClearImport?: () => void
}) {
  const [mode, setMode] = useState<TreeSourceMode>(importedSource ? 'imported' : 'drawn')
  const [draft, setDraft] = useState<ImportDraft | null>(null)
  const [readError, setReadError] = useState<string | null>(null)

  const onFiles = async (files: PickedFile[]) => {
    const picked = files[0]?.file
    if (!picked) return
    setReadError(null)
    try {
      setDraft(draftFrom(await readPickedFile(picked)))
    } catch (error) {
      setDraft(null)
      setReadError(error instanceof Error ? error.message : String(error))
    }
  }

  const setMapping = (patch: Partial<ColumnMapping>) =>
    setDraft((current) => {
      if (!current) return current
      const mapping = { ...current.mapping, ...patch }
      if (patch.crown === GEOMETRY_CROWN_AREA) mapping.crownMeasure = 'area'
      // A newly chosen column that names its unit (`height_ft`, `dbh_cm`) states it; one that names none keeps the choice.
      const stated = statedUnits(mapping)
      return {
        ...current,
        mapping,
        heightUnit: stated.height ?? current.heightUnit,
        diameterUnit: stated.diameter ?? current.diameterUnit,
      }
    })

  const choices = useMemo(() => crsChoicesFor(draft?.read.crsHint ?? null), [draft?.read.crsHint])
  const missing = draft ? missingChoices(draft) : []
  const conversion = useMemo(():
    | { result: TreeListConversion; error: null }
    | { result: null; error: string }
    | null => {
    if (!draft || missingChoices(draft).length) return null
    try {
      return {
        result: convertTreeList(draft.read, draft.mapping, {
          epsg: draft.epsg!,
          // With no diameter column the diameter unit is never read.
          units: { height: draft.heightUnit!, diameter: draft.diameterUnit ?? 'cm' },
        }),
        error: null,
      }
    } catch (error) {
      return { result: null, error: error instanceof Error ? error.message : String(error) }
    }
  }, [draft])

  const crsLabel = (epsg: number) => choices.find((choice) => choice.epsg === epsg)?.label ?? `EPSG:${epsg}`
  const columnOptions = (required: boolean) => [
    ...(required ? [] : [{ value: '', label: '— none —' }]),
    ...(draft?.read.columns ?? []).map((column) => ({ value: column, label: column })),
  ]

  return (
    <fieldset className="space-y-2 border-b border-border pb-4 text-xs">
      <legend className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        Trees from
        <InfoTip label="About imported tree lists">
          An imported list replaces the road view&rsquo;s drawn stems in this block. Each row is drawn as one tree, as
          it was measured: its own position, height and crown, so the crowns set the drawn cover, not VRI&rsquo;s crown
          closure. Each row is one tree: LiDAR tree approximate objects can merge co-dominant crowns and miss the
          understory, so a LiDAR list usually holds fewer, larger trees than a cruise. Diameters come from the file
          where it gives them, else from the height&ndash;diameter curve.
        </InfoTip>
      </legend>
      <SegmentedControl<TreeSourceMode>
        label="Trees from"
        size="sm"
        value={mode}
        onChange={setMode}
        options={TREE_SOURCES}
      />
      {importedSource ? (
        <CurrentSource source={importedSource} />
      ) : (
        <p className="text-2xs text-muted-foreground">In use: the road view&rsquo;s drawn stems.</p>
      )}

      {mode === 'drawn' ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="xs" variant="outline" disabled={!importedSource || !onClearImport} onClick={onClearImport}>
            Use the drawn stand
          </Button>
          {!importedSource && <span className="text-2xs text-muted-foreground">Already in use.</span>}
        </div>
      ) : (
        <div className="space-y-3">
          <FileDropField
            label="Tree list"
            filesLabel="Choose a tree list"
            accept=".csv,.tsv,.txt,.geojson,.json"
            multiple={false}
            onFiles={onFiles}
            onError={(error) => setReadError(error instanceof Error ? error.message : String(error))}
          />
          <p className="text-2xs text-muted-foreground">
            CSV or text (FUSION CanopyMaxima, lidR tree tops or crowns, a field stem map) or GeoJSON points or crowns,
            including the LiDAR page&rsquo;s crown segmentation.
          </p>
          {readError && <InlineAlert tone="error">{readError}</InlineAlert>}
          {draft && (
            <>
              <p className="text-2xs text-muted-foreground">
                {draft.read.name}: {whole.format(draft.read.rows.length)} rows,{' '}
                {whole.format(draft.read.columns.length)} columns.
              </p>
              {draft.read.problems.length > 0 && (
                <InlineAlert tone="warning">
                  {draft.read.problems.map((problem) => (
                    <p key={problem}>{problem}</p>
                  ))}
                </InlineAlert>
              )}
              <div className="grid gap-2 sm:grid-cols-3">
                {MAPPED_COLUMNS.map(({ key, label, required }) => (
                  <SelectField
                    key={key}
                    label={label}
                    aria-label={`${label} column`}
                    placeholder="Choose a column"
                    value={draft.mapping[key] ?? ''}
                    onValueChange={(value) => setMapping({ [key]: value || null })}
                  >
                    {optionsOf(columnOptions(required))}
                  </SelectField>
                ))}
                {draft.mapping.crown && draft.mapping.crown !== GEOMETRY_CROWN_AREA && (
                  <SelectField
                    label="Crown size is"
                    aria-label="Crown size measures"
                    value={draft.mapping.crownMeasure}
                    onValueChange={(value) => setMapping({ crownMeasure: value as CrownMeasure })}
                  >
                    {optionsOf(CROWN_MEASURES)}
                  </SelectField>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <SelectField
                  label="Coordinate system"
                  aria-label="Coordinate system"
                  placeholder="Choose the system"
                  value={draft.epsg === null ? '' : String(draft.epsg)}
                  onValueChange={(value) =>
                    setDraft((current) => current && { ...current, epsg: value ? Number(value) : null })
                  }
                  description={
                    draft.read.crsHint?.epsg != null
                      ? `Stated by the file: ${draft.read.crsHint.source}.`
                      : 'The file does not say: choose it.'
                  }
                  hintAction={
                    <InfoTip label="About the coordinate system">
                      The system is never guessed. It is filled in only where the file states it (a GeoJSON crs member
                      or plain GeoJSON longitude/latitude, an EPSG code in a comment line or a crs column, columns named
                      longitude and latitude). Trees that land outside British Columbia are dropped, which usually means
                      the wrong system.
                    </InfoTip>
                  }
                >
                  {optionsOf(choices.map((choice) => ({ value: String(choice.epsg), label: choice.label })))}
                </SelectField>
                <SelectField
                  label="Heights in"
                  aria-label="Height unit"
                  placeholder="Choose"
                  value={draft.heightUnit ?? ''}
                  onValueChange={(value) =>
                    setDraft(
                      (current) => current && { ...current, heightUnit: (value || null) as ImportDraft['heightUnit'] },
                    )
                  }
                  hintAction={
                    <InfoTip label="About units">
                      Filled in only where a column&rsquo;s name states it (height_m, dbh_cm). Crown widths, radii and
                      areas are read in the height&rsquo;s unit; an area from a crown outline is always measured in
                      square metres.
                    </InfoTip>
                  }
                >
                  {optionsOf(HEIGHT_UNITS)}
                </SelectField>
                <SelectField
                  label="Diameters in"
                  aria-label="Diameter unit"
                  placeholder={draft.mapping.dbh ? 'Choose' : 'No diameter column'}
                  disabled={!draft.mapping.dbh}
                  value={draft.diameterUnit ?? ''}
                  onValueChange={(value) =>
                    setDraft(
                      (current) =>
                        current && { ...current, diameterUnit: (value || null) as ImportDraft['diameterUnit'] },
                    )
                  }
                >
                  {optionsOf(DIAMETER_UNITS)}
                </SelectField>
              </div>
              {missing.length > 0 ? (
                <p className="text-2xs text-muted-foreground">Choose {missing.join(', ')}.</p>
              ) : conversion?.error ? (
                <InlineAlert tone="error">{conversion.error}</InlineAlert>
              ) : conversion?.result ? (
                <InlineAlert tone={conversion.result.trees.length ? 'info' : 'warning'}>
                  <p>
                    {whole.format(conversion.result.trees.length)} trees to use
                    {conversion.result.dropped.length > 0 && <>; dropped {droppedSummary(conversion.result.dropped)}</>}
                    .
                  </p>
                  {conversion.result.notes.map((note) => (
                    <p key={note}>{note}</p>
                  ))}
                </InlineAlert>
              ) : null}
              <Button
                size="xs"
                disabled={!conversion?.result?.trees.length}
                onClick={() => {
                  const result = conversion?.result
                  if (!result?.trees.length || draft.epsg === null) return
                  onImportTrees(result.trees, {
                    fileName: draft.read.name,
                    crs: crsLabel(draft.epsg),
                    count: result.trees.length,
                    dropped: result.dropped.length,
                    ...(result.leftOut ? { leftOut: result.leftOut } : {}),
                  })
                }}
              >
                Use these trees
              </Button>
            </>
          )}
        </div>
      )}
    </fieldset>
  )
}

type TableRow = { label: string; value: (summary: StandSummary) => string }

const spreadText = (mean: number, sd: number) => `${oneDecimal.format(mean)} ± ${oneDecimal.format(sd)}`
const rangeText = (min: number, max: number) => `${oneDecimal.format(min)}–${oneDecimal.format(max)}`

const TABLE_ROWS: TableRow[] = [
  { label: 'Stems/ha', value: (s) => whole.format(s.stemsPerHa) },
  { label: 'Basal area, m²/ha', value: (s) => twoDecimals.format(s.basalAreaM2PerHa) },
  { label: 'QMD, cm', value: (s) => oneDecimal.format(s.quadMeanDiameterCm) },
  { label: 'SDI', value: (s) => whole.format(s.standDensityIndex) },
  { label: 'DBH mean ± SD, cm', value: (s) => (s.drawnStems ? spreadText(s.dbhCm.mean, s.dbhCm.sd) : '–') },
  { label: 'DBH range, cm', value: (s) => (s.drawnStems ? rangeText(s.dbhCm.min, s.dbhCm.max) : '–') },
  { label: 'Height mean, m', value: (s) => (s.drawnStems ? oneDecimal.format(s.heightMeters.mean) : '–') },
  {
    label: 'Height range, m',
    value: (s) => (s.drawnStems ? rangeText(s.heightMeters.min, s.heightMeters.max) : '–'),
  },
  { label: 'Crown cover, % (drawn crowns)', value: (s) => whole.format(s.crownCoverPercent) },
  { label: 'Drawn stems', value: (s) => whole.format(s.drawnStems) },
]

/** Years the snag table reads at. */
const SNAG_TABLE_YEARS = [0, 5, 10, 15, 20, 30, 40, 50]

/**
 * The snags over the years after harvest: how many of these snags stand (each falls in the year its
 * curve gives it) beside how many the curves expect, and the source of each curve used.
 */
function SnagTimeline({ stand, result, yearsShown }: { stand: Stand; result: PrescriptionResult; yearsShown: number }) {
  const fates = useMemo(() => snagFates(stand, result), [stand, result])
  const byYear = useMemo(() => snagsStandingByYear(fates), [fates])
  const used = useMemo(() => {
    const ids = new Set(fates.map((fate) => fate.curveId))
    return SNAG_CURVES.filter((curve) => ids.has(curve.id))
  }, [fates])
  const borrowed = useMemo(() => {
    const species = new Set(fates.filter((fate) => !fate.ownCurve).map((fate) => stand.trees[fate.index].species))
    return [...species].map((id) => SPECIES_LABELS[id])
  }, [fates, stand])
  if (fates.length === 0) return null
  if (used.length === 0)
    return <p className="text-2xs text-muted-foreground">No snag survival curve is loaded: every snag stands.</p>
  const rows = SNAG_TABLE_YEARS.map((years) => byYear[years]).filter(Boolean)
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <EngineeringTable rowHeaders aria-label="Snags standing by years after harvest">
          <thead>
            <tr>
              <ColumnHeader label="Years after harvest" className="text-left" />
              {rows.map((row) => (
                <ColumnHeader
                  key={row.years}
                  label={row.years === yearsShown ? `${row.years} (shown)` : String(row.years)}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Snags standing (these snags)</th>
              {rows.map((row) => (
                <td key={row.years}>{whole.format(row.drawn)}</td>
              ))}
            </tr>
            <tr>
              <th scope="row">Expected by the curves</th>
              {rows.map((row) => (
                <td key={row.years}>{oneDecimal.format(row.expected)}</td>
              ))}
            </tr>
          </tbody>
        </EngineeringTable>
      </div>
      <ul className="space-y-1 text-2xs text-muted-foreground">
        {used.map((curve) => (
          <li key={curve.id}>
            {curve.label}: {curve.source}. {curve.note}
          </li>
        ))}
        {borrowed.length > 0 && (
          <li>No BC curve for {borrowed.join(', ')}: those snags take the nearest curve above.</li>
        )}
        <li>A fallen snag is drawn as a log where it fell.</li>
      </ul>
    </div>
  )
}

function StandTableTab({
  stand,
  result,
  snagYears = 0,
}: {
  stand: Stand
  result: PrescriptionResult
  snagYears?: number
}) {
  const { before, removed, retained } = result.summaries
  const { counts } = result
  return (
    <div className="space-y-3 text-xs">
      <div className="overflow-x-auto">
        <EngineeringTable rowHeaders aria-label="Stand table">
          <thead>
            <tr>
              <ColumnHeader label="Measure" className="text-left" />
              <ColumnHeader label="Before" />
              <ColumnHeader label="Removed" />
              <ColumnHeader label="Kept" />
            </tr>
          </thead>
          <tbody>
            {TABLE_ROWS.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                <td>{row.value(before)}</td>
                <td>{row.value(removed)}</td>
                <td>{row.value(retained)}</td>
              </tr>
            ))}
          </tbody>
        </EngineeringTable>
      </div>
      <ul className="space-y-1 text-2xs text-muted-foreground">
        <li>
          {stand.diameterSource === 'file'
            ? 'Diameters from the imported file (the curve where a tree had none).'
            : stand.diameterSource === 'vri'
              ? 'Diameters sized to VRI’s quadratic mean diameter.'
              : 'Diameters from a height–diameter curve; no VRI size recorded.'}
        </li>
        {stand.source === 'imported' && (
          <li>
            Trees from the imported list, one row each: LiDAR-detected trees can hide co-dominant and understory stems,
            so stems per hectare may read low.
          </li>
        )}
        {stand.maxExpansion > 1 && (
          <li>Each drawn stem stands for up to {oneDecimal.format(stand.maxExpansion)} recorded stems.</li>
        )}
        <li>
          Kept: {whole.format(counts.protected)} protected · {whole.format(counts.diameterLimit)} by diameter limit ·{' '}
          {whole.format(counts.notRemovable)} not removable · {whole.format(counts.missed)} missed by crew
        </li>
        {counts.snags > 0 && <li>{whole.format(counts.snags)} of the trees taken left as snags.</li>}
      </ul>
      {counts.snags > 0 && <SnagTimeline stand={stand} result={result} yearsShown={snagYears} />}
    </div>
  )
}

function GraphsTab({
  stand,
  result,
  prescription,
  onStripChange,
}: {
  stand: Stand
  result: PrescriptionResult
  prescription: StandPrescription
  onStripChange?: (strip: { bearingDegrees: number | null; widthMeters: number } | null) => void
}) {
  const [bearing, setBearing] = useState<number | null>(null)
  const [width, setWidth] = useState(PROFILE_STRIP_WIDTH_M)
  // The plan map draws the strip while this tab shows it.
  useEffect(() => {
    onStripChange?.({ bearingDegrees: bearing, widthMeters: width })
  }, [onStripChange, bearing, width])
  useEffect(() => () => onStripChange?.(null), [onStripChange])
  const charts = useMemo(
    () => ({
      diameter: diameterClasses(stand, result),
      height: heightClasses(stand, result),
      species: speciesBeforeAfter(stand, result),
      clumps: clumpDistribution(result, prescription.clumpTargets),
    }),
    [stand, result, prescription.clumpTargets],
  )
  const profile = useMemo(
    () => standProfile(stand, result, { bearingDegrees: bearing, widthMeters: width }),
    [stand, result, bearing, width],
  )
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <StackedClassBars
          title="Diameter classes"
          rows={charts.diameter}
          measureLabel="Diameter at breast height"
          unit="cm"
        />
        <StackedClassBars title="Height classes" rows={charts.height} measureLabel="Height" unit="m" />
        <SpeciesBars rows={charts.species} />
        <ClumpDistributionBars
          rows={charts.clumps}
          distanceMeters={prescription.clumpDistanceMeters}
          showTarget={prescription.pattern === 'grouped'}
        />
      </div>
      <div className="space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          <NullableNumberField
            label="Strip bearing"
            aria-label="Strip bearing (degrees from north; blank for the block's long axis)"
            unit="°"
            min={0}
            max={360}
            placeholder={whole.format(profile.axisBearingDegrees)}
            fieldClassName="w-28"
            value={bearing}
            onValueChange={setBearing}
          />
          <NumberField
            label="Strip width"
            unit="m"
            min={2}
            max={200}
            fieldClassName="w-28"
            value={width}
            onValueChange={setWidth}
          />
        </div>
        <StandProfile profile={profile} />
      </div>
    </div>
  )
}

export function StandPrescriptionDialog({
  open,
  onClose,
  blockName,
  harvestSystem,
  block,
  prescription,
  onChange,
  onRemove,
  stand,
  result,
  error,
  onAdopt,
  onClearProtected,
  onImportTrees,
  onClearImport,
  importedSource = null,
  onStripChange,
}: Props) {
  const [tab, setTab] = useState<Tab>('prescription')
  const ready = stand && result && !error ? { stand, result } : null
  const tabs = [
    { value: 'prescription' as const, label: 'Prescription' },
    { value: 'table' as const, label: 'Stand table', disabled: !ready },
    { value: 'graphs' as const, label: 'Graphs', disabled: !ready },
  ]
  const shown: Tab = ready ? tab : 'prescription'
  return (
    <PanelDialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={`Stand prescription · ${blockName}`}
      subtitle={harvestSystem === 'retention' ? 'Retention block' : 'Partial cut'}
      size="xl"
      contentProps={{ 'data-testid': 'stand-prescription-dialog' }}
      summary={
        <div className="space-y-2">
          <Outcome stand={stand} result={result} error={error} />
          {ready && (
            <StatGroup
              variant="tiles"
              size="sm"
              aria-label="Prescription outcome"
              items={headline(ready.result, prescription.pattern === 'grouped')}
            />
          )}
          <AdoptRow harvestSystem={harvestSystem} result={ready?.result ?? null} onAdopt={onAdopt} />
        </div>
      }
      headerExtra={
        <TabBar<Tab>
          label="Stand prescription"
          idPrefix="stand-prescription"
          value={shown}
          onChange={setTab}
          options={tabs}
        />
      }
      footer={
        <div className="flex items-center justify-between gap-2">
          <Button size="sm" variant="destructive" onClick={onRemove}>
            Remove prescription
          </Button>
          <Button size="sm" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div role="tabpanel" id={`stand-prescription-panel-${shown}`} aria-labelledby={`stand-prescription-tab-${shown}`}>
        {onImportTrees && (
          // Kept mounted under the other tabs so a half-done import survives a look at the table.
          <div hidden={shown !== 'prescription'} className="mb-4">
            <TreeSource importedSource={importedSource} onImportTrees={onImportTrees} onClearImport={onClearImport} />
          </div>
        )}
        {shown === 'prescription' && (
          <PrescriptionTab
            harvestSystem={harvestSystem}
            block={block}
            prescription={prescription}
            onChange={onChange}
            result={result}
            onClearProtected={onClearProtected}
          />
        )}
        {shown === 'table' && ready && (
          <StandTableTab stand={ready.stand} result={ready.result} snagYears={prescription.snags.yearsAfterHarvest} />
        )}
        {shown === 'graphs' && ready && (
          <GraphsTab
            stand={ready.stand}
            result={ready.result}
            prescription={prescription}
            onStripChange={onStripChange}
          />
        )}
      </div>
    </PanelDialog>
  )
}
