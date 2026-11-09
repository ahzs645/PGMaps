import { FORM_INPUT_CLASS, FormField, SelectField } from '@/components/ui/form-field'
import { NumericRangeField } from '@/components/ui/numeric-range-field'
import { ShareBars } from '@/components/ui/share-bars'
import { TextButton } from '@/components/ui/text-button'
import { X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { KeyValueRows, SearchInput, CollapsibleSection, InlineAlert } from '@/components/ui/map-panels'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { TabBar } from '@/components/ui/tab-bar'
import { VirtualResultList } from '@/components/ui/virtual-result-list'
import { ResultRow } from '@/components/ui/result-list'
import { downloadText } from '@/lib/download'
import type { CrownFeature, IsolatedPoint, TreeCrop } from './treeIsolation'
import { prepareTreeProfile, treeProfilesSVG } from './treeProfiles'
import {
  assignPoints,
  inspectionCSV,
  DEFAULT_PROFILE,
  inProfile,
  pointKey,
  REVIEW_DECISIONS,
  splitBySeeds,
  type ReviewDecision,
} from './treeInspection'
import type { TreeInspectionController } from './useTreeInspection'
import { ProfileCanvas, type ProfileInteraction } from './ProfileCanvas'
import { downloadProfilePNG } from './profileExport'
import { DEFAULT_LOCALE } from '@/lib/format'

export function TreeInspector({
  controller,
  crop,
  crown,
  ids,
  error,
  status,
  onSelect,
  onRetry,
  onPick,
  picked,
  onTransect,
  transect,
  benchmark,
  isMobile = false,
  showTransect = true,
}: {
  controller: TreeInspectionController
  crop: TreeCrop | null
  crown: CrownFeature | null
  ids: string[]
  error: string
  status: string
  onSelect: (id: string) => void
  onRetry: () => void
  onPick: (point: IsolatedPoint | null) => void
  picked: IsolatedPoint | null
  onTransect: (active: boolean) => void
  transect: React.ReactNode
  benchmark?: React.ReactNode
  isMobile?: boolean
  showTransect?: boolean
}) {
  const { state, setState, commit } = controller,
    settings = state.settings
  const [tab, setTab] = useState('profile'),
    [query, setQuery] = useState(''),
    [interaction, setInteraction] = useState<ProfileInteraction>('pick')
  const [selected, setSelected] = useState<Set<string>>(new Set()),
    [seeds, setSeeds] = useState<IsolatedPoint[]>([]),
    [target, setTarget] = useState(''),
    [mergeFrom, setMergeFrom] = useState('')
  const [note, setNote] = useState(() => (crown ? (state.reviews[crown.properties.id]?.note ?? '') : '')),
    [reviewFilter, setReviewFilter] = useState('all'),
    [localMessage, setLocalMessage] = useState('')
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [controlsOpen, setControlsOpen] = useState(false)
  const [pointsOpen, setPointsOpen] = useState(false)
  const id = crown?.properties.id
  const filtered = ids.filter(
    (id) =>
      id.toLowerCase().includes(query.toLowerCase()) &&
      (reviewFilter === 'all' || (state.reviews[id]?.decision ?? 'unreviewed') === reviewFilter),
  )
  const index = filtered.indexOf(id ?? '')
  const [previousReview, setPreviousReview] = useState({ id, reviews: state.reviews })
  if (previousReview.id !== id || previousReview.reviews !== state.reviews) {
    setPreviousReview({ id, reviews: state.reviews })
    if (previousReview.id !== id) {
      setSelected(new Set())
      setSeeds([])
    }
    setNote(id ? (state.reviews[id]?.note ?? '') : '')
  }
  useEffect(() => {
    onPick(null)
  }, [id, onPick])
  const allCrops = useMemo(
    () => [...controller.pinned.filter((c) => c.id !== crop?.id), ...(crop ? [crop] : [])],
    [controller.pinned, crop],
  )
  const visible = useMemo(
    () => (crop ? crop.points.filter((p) => inProfile(p, crop, settings, state.assignments)) : []),
    [crop, settings, state.assignments],
  )
  const prepared = useMemo(() => allCrops.map(prepareTreeProfile), [allCrops])
  const sharedHeight = Math.max(5, Math.ceil(Math.max(0, ...prepared.map((p) => p.maximum)) / 5) * 5),
    sharedRadius = Math.max(2, ...prepared.map((p) => p.radius + 1))
  const groups = useMemo(
    () =>
      [...new Set(allCrops.flatMap((c) => c.points.map((p) => state.assignments[pointKey(p)] ?? c.id)))]
        .filter((id) => id !== '0')
        .sort(),
    [allCrops, state.assignments],
  )
  const settingsPatch = (patch: Partial<typeof settings>) =>
    setState((s) => ({ ...s, settings: { ...s.settings, ...patch } }))
  const attempt = (action: () => void) => {
    try {
      action()
      setLocalMessage('Review operation finished; original source returns retained.')
    } catch (e) {
      setLocalMessage(String(e))
    }
  }
  const assign = (label: string) =>
    attempt(() => {
      if (!selected.size) throw Error('Select returns with a polygon or point list first')
      commit(assignPoints(state, [...selected], label))
    })
  const pin = () => {
    if (!crop) return
    if (state.pins.includes(crop.id)) return
    const count = controller.pinned.reduce((n, c) => n + c.points.length, 0) + crop.points.length
    if (state.pins.length >= 4 || count > 150000) {
      setLocalMessage('Comparison limit: four candidates / 150,000 returns. Remove a pin first.')
      return
    }
    setState((s) => ({ ...s, pins: [...s.pins, crop.id] }))
    setGalleryOpen(true)
  }
  const saveNote = () => {
    if (id && note !== (state.reviews[id]?.note ?? ''))
      commit({
        ...state,
        reviews: { ...state.reviews, [id]: { decision: state.reviews[id]?.decision ?? 'unreviewed', note } },
      })
  }
  const figure = () => {
    const display = allCrops
      .map((c) => ({ ...c, points: c.points.filter((p) => inProfile(p, c, settings, state.assignments)) }))
      .map(prepareTreeProfile)
      .sort((a, b) => a.maximum - b.maximum)
    return treeProfilesSVG(display, settings.angle, settings.colour === 'height', {
      settings,
      assignments: state.assignments,
    })
  }
  return (
    <section
      className="flex h-full min-h-0 flex-col overflow-hidden border-t bg-background lg:border-l lg:border-t-0"
      aria-label="Linked tree inspector"
    >
      <div className="shrink-0 border-b p-2">
        <div className="flex items-center justify-between gap-2">
          <strong className="text-sm">{id ?? 'Select a crown'}</strong>
          <span className="text-3xs text-muted-foreground">Linked inspector</span>
        </div>
        <div className="mt-2 flex items-center gap-1">
          <Button size="sm" variant="outline" disabled={index <= 0} onClick={() => onSelect(filtered[index - 1])}>
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!filtered.length || index >= filtered.length - 1}
            onClick={() => onSelect(filtered[Math.max(0, index + 1)])}
          >
            Next
          </Button>
          <SearchInput
            data-map-search-input="false"
            className="h-8 min-w-0 text-xs"
            aria-label="Find crown by ID"
            placeholder="Find crown ID"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && filtered[0]) onSelect(filtered[0])
            }}
          />
        </div>
        {query && (
          <div className="mt-1 flex items-center gap-2 text-3xs">
            {filtered.length} matching IDs{' '}
            <TextButton className="text-3xs" disabled={!filtered[0]} onClick={() => onSelect(filtered[0])}>
              Select first match
            </TextButton>
          </div>
        )}
        <TabBar
          label="Tree inspection task"
          stretch
          value={tab}
          onChange={(value) => {
            saveNote()
            setTab(value)
            onTransect(value === 'transect')
          }}
          options={[
            { value: 'profile', label: 'Profile' },
            { value: 'review', label: 'Review / edit' },
            ...(showTransect ? [{ value: 'transect', label: 'Transect' }] : []),
            { value: 'methods', label: 'Methods' },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-map-sidebar-scroll="true">
        {tab === 'profile' && (
          <>
            <CollapsibleSection
              open={!isMobile || controlsOpen}
              onOpenChange={setControlsOpen}
              className="[&>div:first-child]:md:hidden"
              label="Profile controls"
              summary={`${settings.mode === 'whole' ? 'Whole crown' : `${settings.width} m slice`} · ${settings.angle}°`}
            >
              <div className="space-y-2 p-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <SegmentedControl
                    size="sm"
                    fullWidth={false}
                    label="Profile crop mode"
                    value={settings.mode}
                    options={[
                      { value: 'whole', label: 'Whole crown' },
                      { value: 'slice', label: 'Thin slice' },
                    ]}
                    onChange={(mode) => settingsPatch({ mode: mode as 'whole' | 'slice' })}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => settingsPatch({ ...DEFAULT_PROFILE, colour: settings.colour })}
                  >
                    Fit / lock scale
                  </Button>
                </div>
                <NumericRangeField
                  label="Rotation east toward north"
                  aria-label="Tree profile rotation"
                  className="space-y-1"
                  min={0}
                  max={180}
                  step={5}
                  unit="°"
                  display={`${settings.angle}°`}
                  value={settings.angle}
                  onChange={(angle) => settingsPatch({ angle })}
                />
                {settings.mode === 'slice' && (
                  <div className="grid grid-cols-2 gap-2">
                    <SelectField
                      label="Total slice width"
                      aria-label="Total slice width"
                      value={settings.width}
                      onChange={(e) => settingsPatch({ width: +e.target.value })}
                    >
                      {[0.5, 1, 2, 5, 10, 20, 40].map((n) => (
                        <option key={n} value={n}>
                          {n} m
                        </option>
                      ))}
                    </SelectField>
                    <NumericRangeField
                      label="Offset"
                      aria-label="Slice offset"
                      className="space-y-1"
                      min={-20}
                      max={20}
                      step={0.25}
                      display={`${settings.offset.toFixed(1)} m`}
                      value={settings.offset}
                      onChange={(offset) => settingsPatch({ offset })}
                    />
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <SegmentedControl
                    size="sm"
                    label="Tree profile colour"
                    value={settings.colour}
                    options={[
                      { value: 'black', label: 'Black' },
                      { value: 'height', label: 'Height' },
                      { value: 'segment', label: 'Groups' },
                    ]}
                    onChange={(colour) => settingsPatch({ colour: colour as typeof settings.colour })}
                  />
                  <NumericRangeField
                    label="Point size"
                    aria-label="Profile point size"
                    className="w-28 space-y-1"
                    min={0.5}
                    max={4}
                    step={0.5}
                    value={settings.pointSize}
                    onChange={(pointSize) => settingsPatch({ pointSize })}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant={interaction === 'pick' ? 'secondary' : 'outline'}
                    onClick={() => setInteraction('pick')}
                  >
                    Pick return
                  </Button>
                  <Button
                    size="sm"
                    variant={interaction === 'pan' ? 'secondary' : 'outline'}
                    onClick={() => setInteraction('pan')}
                  >
                    Pan / zoom
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => settingsPatch({ zoom: Math.min(8, settings.zoom * 1.5), lockScale: false })}
                  >
                    Zoom +
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => settingsPatch({ zoom: Math.max(1, settings.zoom / 1.5), lockScale: false })}
                  >
                    Zoom −
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <NumericRangeField
                    label="Lowest shown"
                    aria-label="Lowest shown height"
                    className="space-y-1"
                    min={2}
                    max={settings.maxHeight}
                    step={1}
                    unit="m"
                    value={settings.minHeight}
                    onChange={(minHeight) => settingsPatch({ minHeight })}
                  />
                  <NumericRangeField
                    label="Highest shown"
                    aria-label="Highest shown height"
                    className="space-y-1"
                    min={settings.minHeight}
                    max={80}
                    step={1}
                    unit="m"
                    value={settings.maxHeight}
                    onChange={(maxHeight) => settingsPatch({ maxHeight })}
                  />
                </div>
                <p className="text-3xs text-muted-foreground">
                  {settings.lockScale
                    ? 'Shared metre scale · equal axes'
                    : 'Independent zoom / pan · shared-scale lock off'}{' '}
                  · {visible.length.toLocaleString(DEFAULT_LOCALE)} /{' '}
                  {crop?.points.length.toLocaleString(DEFAULT_LOCALE) ?? 0} crop returns shown.
                </p>
              </div>
            </CollapsibleSection>
            <div className="h-[180px] min-h-[180px] border-y md:h-[min(40dvh,420px)]">
              {crop ? (
                <ProfileCanvas
                  crop={crop}
                  settings={settings}
                  assignments={state.assignments}
                  picked={picked ? pointKey(picked) : null}
                  selected={selected}
                  seeds={seeds}
                  interaction={interaction}
                  onPick={onPick}
                  onSelection={(keys) => setSelected(new Set(keys))}
                  onSeed={(p) =>
                    setSeeds((s) => (s.some((v) => pointKey(v) === pointKey(p)) ? s : [...s, p].slice(0, 8)))
                  }
                  onView={settingsPatch}
                  sharedHeight={sharedHeight}
                  sharedRadius={sharedRadius}
                />
              ) : (
                <div className="p-4">
                  {error ? (
                    <InlineAlert tone="error">
                      {error}{' '}
                      <Button size="sm" onClick={onRetry}>
                        Retry
                      </Button>
                    </InlineAlert>
                  ) : status ? (
                    <div role="status">
                      <InlineAlert>{status}</InlineAlert>
                    </div>
                  ) : (
                    <InlineAlert loading>Loading selected crown’s original returns…</InlineAlert>
                  )}
                </div>
              )}
            </div>
            <div className="space-y-2 p-2 text-xs">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={!crop || state.pins.includes(crop.id)} onClick={pin}>
                  Pin for comparison
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!allCrops.length}
                  onClick={() => downloadText(figure(), 'tree-side-profiles.svg', 'image/svg+xml')}
                >
                  Download profiles SVG
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!allCrops.length}
                  onClick={async () => {
                    try {
                      await downloadProfilePNG(figure())
                    } catch (e) {
                      setLocalMessage(String(e))
                    }
                  }}
                >
                  Download profiles PNG
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!crop}
                  onClick={() =>
                    crop &&
                    downloadText(
                      inspectionCSV(crop, visible, state.assignments),
                      `${crop.id}-${settings.mode}-returns.csv`,
                      'text/csv',
                    )
                  }
                >
                  Export visible CSV
                </Button>
              </div>
              <p className="text-3xs text-muted-foreground">
                0–2 m excluded. Missing trunk returns cannot establish DBH or a bare stem. Colours show height (blue 0 →
                red 40+ m) or manual candidate groups.
              </p>
              {crop && (
                <KeyValueRows
                  size="sm"
                  rows={[
                    {
                      label: 'Observed return maximum',
                      value: crop.points.length
                        ? `${crop.points.reduce((maximum, p) => Math.max(maximum, p.height), 0).toFixed(2)} m`
                        : 'Unavailable · no retained returns',
                    },
                    { label: 'Canopy-surface peak', value: `${crown?.properties.height_m.toFixed(2) ?? '—'} m` },
                    { label: 'Exact crown source-cell area', value: `${crown?.properties.crown_area_m2 ?? '—'} m²` },
                    {
                      label: 'Loaded nodes',
                      value: `${crop.loaded_nodes}/${crop.available_nodes}${crop.budget_limited ? ' · partial / budget limited' : ''}`,
                    },
                    {
                      label: 'Ground support at top',
                      value: `${crown?.properties.ground_support_m.toFixed(1) ?? '—'} m`,
                    },
                    { label: 'DBH', value: 'Unavailable · crop starts above breast height' },
                  ]}
                />
              )}
              {picked && (
                <div className="rounded border p-2" aria-label="Picked original return">
                  <strong>{pointKey(picked)}</strong>
                  <p>
                    {picked.lon.toFixed(8)}, {picked.lat.toFixed(8)}
                  </p>
                  <p>
                    {picked.height.toFixed(3)} m above terrain · {picked.z.toFixed(3)} m CGVD2013 · class{' '}
                    {picked.classification}
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelected((s) => new Set([...s, pointKey(picked)]))}
                  >
                    Add picked return to edit selection
                  </Button>
                </div>
              )}
              <CollapsibleSection
                label="Return counts by height / keyboard point inspection"
                open={pointsOpen}
                onOpenChange={setPointsOpen}
                className="rounded-md border"
                contentClassName="px-3 pb-2"
              >
                <ReturnHistogram points={visible} />
                {pointsOpen && (
                  <VirtualResultList label="Original returns" items={visible} getKey={pointKey} estimateSize={42}>
                    {(p) => (
                      <ResultRow
                        title={`${p.height.toFixed(2)} m · ${pointKey(p)}`}
                        selected={picked ? pointKey(picked) === pointKey(p) : false}
                        onClick={() => onPick(p)}
                      />
                    )}
                  </VirtualResultList>
                )}
              </CollapsibleSection>
            </div>
          </>
        )}
        {tab === 'review' && (
          <div className="space-y-3 p-3 text-xs">
            <SelectField
              label="Reviewer decision"
              aria-label="Tree review decision"
              disabled={!id}
              value={id ? (state.reviews[id]?.decision ?? 'unreviewed') : 'unreviewed'}
              onChange={(e) =>
                id &&
                commit({
                  ...state,
                  reviews: { ...state.reviews, [id]: { decision: e.target.value as ReviewDecision, note } },
                })
              }
            >
              {REVIEW_DECISIONS.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </SelectField>
            <FormField label="Review notes">
              <textarea
                aria-label="Tree review notes"
                className={FORM_INPUT_CLASS}
                rows={3}
                maxLength={2000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onBlur={saveNote}
              />
            </FormField>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={!controller.canUndo} onClick={controller.undo}>
                Undo
              </Button>
              <Button size="sm" variant="outline" disabled={!controller.canRedo} onClick={controller.redo}>
                Redo
              </Button>
            </div>
            <SelectField
              label="Review queue"
              aria-label="Tree review queue"
              value={reviewFilter}
              onChange={(e) => setReviewFilter(e.target.value)}
            >
              <option value="all">All candidates</option>
              {REVIEW_DECISIONS.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </SelectField>
            <p>
              {filtered.length.toLocaleString(DEFAULT_LOCALE)} candidates in queue. Previous/Next follows this filter.
            </p>
            <CollapsibleSection
              label="Point-group editing · bounded loaded returns"
              className="rounded-md border"
              contentClassName="px-3 pb-3"
            >
              <p className="mb-2 text-muted-foreground">
                Edits create a review assignment layer over loaded returns. Original points and crown cells stay intact.
                Groups are not validated complete trees.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setInteraction('polygon')
                    setTab('profile')
                  }}
                >
                  Select polygon in profile
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSelected(new Set(visible.map(pointKey)))
                    setLocalMessage('Visible returns selected.')
                  }}
                >
                  Select all visible
                </Button>
                <Button size="sm" variant="outline" onClick={() => setSelected(new Set())}>
                  Clear selection
                </Button>
              </div>
              <p className="my-2">{selected.size.toLocaleString(DEFAULT_LOCALE)} selected returns</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!selected.size}
                  onClick={() => assign(`edit-${id}-${Object.keys(state.assignments).length + 1}`)}
                >
                  Create group
                </Button>
                <Button size="sm" variant="outline" disabled={!selected.size} onClick={() => assign('0')}>
                  Reject selected returns
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => settingsPatch({ showRejected: !settings.showRejected })}
                >
                  {settings.showRejected ? 'Hide' : 'Show'} rejected
                </Button>
              </div>
              <SelectField
                label="Assign selection to group"
                fieldClassName="mt-2"
                aria-label="Target point group"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">Choose…</option>
                {groups.map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </SelectField>
              <Button size="sm" variant="outline" disabled={!target || !selected.size} onClick={() => assign(target)}>
                Assign selected
              </Button>
              <SelectField
                label="Merge loaded group into target"
                fieldClassName="mt-2"
                aria-label="Merge point group"
                value={mergeFrom}
                onChange={(e) => setMergeFrom(e.target.value)}
              >
                <option value="">Choose…</option>
                {groups
                  .filter((g) => g !== target)
                  .map((g) => (
                    <option key={g}>{g}</option>
                  ))}
              </SelectField>
              <Button
                size="sm"
                variant="outline"
                disabled={!target || !mergeFrom}
                onClick={() =>
                  attempt(() =>
                    commit(
                      assignPoints(
                        state,
                        allCrops.flatMap((c) =>
                          c.points.filter((p) => (state.assignments[pointKey(p)] ?? c.id) === mergeFrom).map(pointKey),
                        ),
                        target,
                      ),
                    ),
                  )
                }
              >
                Merge loaded groups
              </Button>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setInteraction('seed')
                    setTab('profile')
                  }}
                >
                  Pick split seeds
                </Button>
                <Button size="sm" variant="outline" onClick={() => setSeeds([])}>
                  Clear {seeds.length} seeds
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={seeds.length < 2 || !crop}
                  onClick={() =>
                    attempt(() => {
                      if (!crop) return
                      const next = splitBySeeds(
                        crop,
                        seeds,
                        selected.size ? crop.points.filter((p) => selected.has(pointKey(p))) : visible,
                      )
                      const assignments = { ...state.assignments }
                      for (const p of next) assignments[p.key] = p.label
                      if (Object.keys(assignments).length > 50000) throw Error('Edited-point budget exceeded')
                      commit({ ...state, assignments })
                      settingsPatch({ colour: 'segment' })
                    })
                  }
                >
                  Split by nearest 3D seed
                </Button>
              </div>
              <p className="mt-2 text-muted-foreground">
                Seed splitting is a manual Euclidean partition of the selected/visible returns, not a trained tree
                segmentation model. Review its groups from several angles.
              </p>
            </CollapsibleSection>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  saveNote()
                  downloadText(
                    JSON.stringify(
                      {
                        ...state,
                        reviews: id
                          ? { ...state.reviews, [id]: { decision: state.reviews[id]?.decision ?? 'unreviewed', note } }
                          : state.reviews,
                      },
                      null,
                      2,
                    ),
                    'tree-review-manifest.json',
                    'application/json',
                  )
                }}
              >
                Export review & edits
              </Button>
              <Button asChild size="sm" variant="outline">
                <label className="cursor-pointer">
                  Import review
                  <input
                    aria-label="Import tree review manifest"
                    className="sr-only"
                    type="file"
                    accept=".json"
                    onChange={async (e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      try {
                        if (file.size > 3000000) throw Error('Manifest exceeds 3 MB')
                        controller.importReview(await file.text())
                      } catch (err) {
                        setLocalMessage(String(err))
                      }
                      e.target.value = ''
                    }}
                  />
                </label>
              </Button>
            </div>
          </div>
        )}
        {tab === 'transect' && transect}
        {tab === 'methods' && benchmark}
        <div className="border-t p-2 text-3xs text-muted-foreground" role="status">
          {localMessage && <p>{localMessage}</p>}
          <p>{controller.message}</p>
        </div>
      </div>
      <div className="max-h-[35%] shrink-0 overflow-auto border-t">
        <CollapsibleSection
          label="Comparison gallery"
          summary={`${state.pins.length}/4 saved IDs`}
          open={galleryOpen}
          onOpenChange={setGalleryOpen}
          className="border-b-0"
        >
          {galleryOpen && (
            <>
              <div className="flex flex-wrap gap-1 p-1">
                {state.pins.map((id) => (
                  <div key={id} className="flex rounded border">
                    <Button size="sm" variant="ghost" onClick={() => onSelect(id)}>
                      {id}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove comparison ${id}`}
                      onClick={() => setState((s) => ({ ...s, pins: s.pins.filter((p) => p !== id) }))}
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                ))}
              </div>
              <div
                className="overflow-auto bg-white"
                dangerouslySetInnerHTML={{
                  __html: prepared.length ? figure() : '',
                }}
              />
            </>
          )}
        </CollapsibleSection>
      </div>
    </section>
  )
}
function ReturnHistogram({ points }: { points: IsolatedPoint[] }) {
  const bins = [0, 0, 0, 0, 0, 0, 0, 0]
  for (const p of points) bins[Math.min(7, Math.floor(p.height / 10))]++
  const max = Math.max(1, ...bins)
  return (
    <div className="my-2 space-y-1">
      <ShareBars
        aria-label="Observed return counts by height"
        items={bins.map((count, i) => ({ key: String(i), label: `${i * 10}–${(i + 1) * 10} m`, values: [count] }))}
        series={[{ className: 'bg-emerald-600' }]}
        max={max}
        formatValue={(count) => count.toLocaleString(DEFAULT_LOCALE)}
        className="space-y-1"
      />
      <p className="text-3xs text-muted-foreground">Sampling counts; not foliage density or leaf area.</p>
    </div>
  )
}
