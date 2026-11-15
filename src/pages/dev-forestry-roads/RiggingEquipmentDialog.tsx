import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { PanelDialog } from '@/components/ui/dialog-shell'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert, KeyValueRows } from '@/components/ui/map-panels'
import { Field, OptionalNumberField, roadFieldClass, RoadSelect } from './Controls'
import { EXAMPLE_RIGGING, RIGGING_LABELS, RIGGING_LIMITS } from './cableMechanics'
import {
  carriageById,
  loadSkylineXlLibrary,
  riggingSetFromEquipment,
  skylineRopesFor,
  yarderById,
  type CableEquipmentLibrary,
  type EnteredRigging,
  type WireRope,
} from './cableEquipment/cableEquipment'
import { riggingSetNamed, riggingSetNameError, saveRiggingSet, type RiggingSet } from './dline/riggingSets'

/** Values SkylineXL does not give that the form takes; the rest stay PGMaps' example. */
const ENTERED_FIELDS = ['payloadKg', 'minClearanceM', 'metallicFillFactor', 'elasticModulusKNPerMm2'] as const

const OWN_ROPE = ''
const ENTER_MASS = ''
const one = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 1 })
const two = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 2 })
const whole = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 0 })
const ropeLabel = (rope: WireRope) =>
  `${rope.diameterLabel} ${rope.type === 'eips' ? 'EIPS' : 'swaged'} · ${one.format(rope.diameterMm)} mm · ${two.format(rope.massKgPerM)} kg/m`

/**
 * Starts a rigging set from SkylineXL's open equipment library (`cableEquipment.ts`): a yarder, a
 * carriage or its mass, and the skyline (the yarder's own, or a rope from the table, which a running
 * yarder needs). The set's rope, carriage and running lines come from the library; payload,
 * clearance, fill factor and modulus are typed here or stay the example, and say so. Nothing is
 * written until **Save**, which keeps the equipment record beside the set.
 */
export function RiggingEquipmentDialog({
  sets,
  onSave,
  onCancel,
  newId,
  portalContainer,
}: {
  sets: readonly RiggingSet[]
  /** The project's sets with the new one, and that set. `apply` when it should also be used. */
  onSave: (sets: RiggingSet[], saved: RiggingSet, apply: boolean) => void
  onCancel: () => void
  newId: () => string
  portalContainer?: HTMLElement | null
}) {
  const [lib, setLib] = useState<CableEquipmentLibrary | null>(null)
  const [loadError, setLoadError] = useState('')
  useEffect(() => {
    let live = true
    loadSkylineXlLibrary().then(
      (value) => live && setLib(value),
      (cause: unknown) =>
        live && setLoadError(cause instanceof Error ? cause.message : 'The equipment library could not be read.'),
    )
    return () => {
      live = false
    }
  }, [])
  const [yarderId, setYarderId] = useState('')
  const [carriageId, setCarriageId] = useState(ENTER_MASS)
  const [carriageKg, setCarriageKg] = useState<number | null>(null)
  const [ropeId, setRopeId] = useState(OWN_ROPE)
  const [entered, setEntered] = useState<EnteredRigging>({})
  const [name, setName] = useState<string | null>(null)

  const yarder = lib && yarderId ? yarderById(lib, yarderId) : null
  const carriage = lib && carriageId ? carriageById(lib, carriageId) : null
  const ropes = useMemo(() => (lib ? skylineRopesFor(lib, carriage) : []), [lib, carriage])
  const result = useMemo(() => {
    if (!lib || !yarder) return null
    return riggingSetFromEquipment(lib, {
      yarderId: yarder.id,
      ...(carriage ? { carriageId: carriage.id } : carriageKg !== null ? { carriageKg } : {}),
      ...(ropeId ? { skylineRopeId: ropeId } : {}),
      entered,
    })
  }, [lib, yarder, carriage, carriageKg, ropeId, entered])
  const made = result?.ok ? result : null
  const chosenName = name ?? made?.set.name ?? ''
  const nameError = made ? riggingSetNameError(sets, chosenName) : null

  const save = (apply: boolean) => {
    if (!made || nameError) return
    const next = saveRiggingSet(sets, chosenName, made.set.rigging, undefined, newId, made.equipment)
    onSave(next, riggingSetNamed(next, chosenName)!, apply)
  }

  const r = made?.set.rigging
  const ownSkyline = yarder?.lines.skyline
  return (
    <PanelDialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
      title="Start a rigging set from equipment"
      subtitle="USDA Forest Service SkylineXL 25.0 library (public domain)"
      size="md"
      portalContainer={portalContainer}
      contentProps={{ 'data-testid': 'rigging-equipment-dialog' }}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="outline" size="sm" disabled={!made || !!nameError} onClick={() => save(false)}>
            Save set
          </Button>
          <Button size="sm" disabled={!made || !!nameError} onClick={() => save(true)}>
            Save and use
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {!lib && !loadError && <InlineAlert loading>Reading the equipment library…</InlineAlert>}
        {loadError && <InlineAlert tone="error">{loadError}</InlineAlert>}
        {lib && (
          <>
            <Field
              label="Yarder"
              hint="SkylineXL's yarders: tower height, and each drum's rope (diameter, type, length and design tension). A class average is SkylineXL's average of the machines in its size class."
            >
              <RoadSelect
                ariaLabel="Yarder"
                className={roadFieldClass}
                value={yarderId}
                placeholder="Choose a yarder"
                onValueChange={(id) => {
                  setYarderId(id)
                  setRopeId(OWN_ROPE)
                }}
                options={lib.yarders.map((y) => ({
                  value: y.id,
                  label: `${y.name}${y.kind === 'class-average' ? ' (class average)' : ''} · ${one.format(y.towerHeightM)} m tower${y.lines.skyline ? '' : ' · running skyline'}`,
                }))}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Carriage">
                <RoadSelect
                  ariaLabel="Carriage"
                  className={roadFieldClass}
                  value={carriageId}
                  onValueChange={setCarriageId}
                  options={[
                    { value: ENTER_MASS, label: 'None listed: enter its mass' },
                    ...lib.carriages.map((c) => ({ value: c.id, label: `${c.name} · ${whole.format(c.massKg)} kg` })),
                  ]}
                />
              </Field>
              {carriage ? (
                <div className="self-end pb-1.5 text-2xs text-muted-foreground">
                  Skyline {one.format(carriage.skylineDiameterMm[0])}–{one.format(carriage.skylineDiameterMm[1])} mm ·
                  needs {carriage.yarderDrumsRequired} drums
                </div>
              ) : (
                <OptionalNumberField
                  label="Carriage mass (kg)"
                  value={carriageKg}
                  onChange={setCarriageKg}
                  min={RIGGING_LIMITS.carriageKg[0]}
                  max={RIGGING_LIMITS.carriageKg[1]}
                  step={10}
                  placeholder="kg"
                />
              )}
            </div>
            <Field
              label="Skyline rope"
              hint="The yarder's own skyline, or a rope from SkylineXL's table within the carriage's skyline range. A running-skyline yarder has no standing skyline drum, so choose the rope to model."
            >
              <RoadSelect
                ariaLabel="Skyline rope"
                className={roadFieldClass}
                value={ropeId}
                disabled={!yarder}
                placeholder="Choose the skyline rope"
                onValueChange={setRopeId}
                options={[
                  ...(ownSkyline
                    ? [
                        {
                          value: OWN_ROPE,
                          label: `The yarder's own · ${one.format(ownSkyline.diameterMm)} mm ${ownSkyline.ropeType === 'eips' ? 'EIPS' : 'swaged'}`,
                        },
                      ]
                    : []),
                  ...ropes.map((rope) => ({ value: rope.id, label: ropeLabel(rope) })),
                ]}
              />
            </Field>
            {yarder && (
              <div className="grid grid-cols-2 gap-2">
                {ENTERED_FIELDS.map((key) => (
                  <OptionalNumberField
                    key={key}
                    label={RIGGING_LABELS[key]}
                    value={entered[key] ?? null}
                    onChange={(value) =>
                      setEntered((current) => {
                        const next = { ...current }
                        if (value === null) delete next[key]
                        else next[key] = value
                        return next
                      })
                    }
                    min={RIGGING_LIMITS[key][0]}
                    max={RIGGING_LIMITS[key][1]}
                    placeholder={two.format(EXAMPLE_RIGGING[key])}
                    description={
                      entered[key] === undefined
                        ? `Not in SkylineXL: example value ${two.format(EXAMPLE_RIGGING[key])}`
                        : undefined
                    }
                  />
                ))}
              </div>
            )}
            {result && !result.ok && <InlineAlert tone="warning">{result.error}</InlineAlert>}
            {made && r && (
              <>
                <KeyValueRows
                  variant="divided"
                  rows={[
                    {
                      key: 'skyline',
                      label: 'Skyline',
                      value: `${one.format(r.ropeDiameterMm)} mm · ${two.format(r.ropeMassKgPerM)} kg/m · breaking ${whole.format(r.breakingForceKN)} kN ÷ ${two.format(r.safetyFactor)}`,
                    },
                    { key: 'carriage', label: 'Carriage', value: `${whole.format(r.carriageKg)} kg` },
                    {
                      key: 'running',
                      label: 'Running lines',
                      value: `${two.format(r.runningLinesKgPerM)} kg/m (mainline and haulback)`,
                    },
                    { key: 'spar', label: 'Spar height', value: `${one.format(made.equipment.sparHeightM)} m` },
                  ]}
                />
                {made.issues.length > 0 && (
                  <InlineAlert tone="warning">
                    <ul className="list-disc space-y-0.5 pl-4">
                      {made.issues.map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  </InlineAlert>
                )}
                <p className="flex items-start gap-1 text-2xs text-muted-foreground">
                  <span className="min-w-0 flex-1">{made.equipment.provenance}</span>
                  <InfoTip label="About equipment sets">
                    The set keeps the yarder record beside it: its spar height and every line&apos;s length and tension,
                    which a RoadEng logging system needs. Values typed here or edited later are the project&apos;s own;
                    the set&apos;s note then names what changed.
                  </InfoTip>
                </p>
                <NameField value={chosenName} onChange={setName} error={nameError} />
              </>
            )}
          </>
        )}
      </div>
    </PanelDialog>
  )
}

function NameField({
  value,
  onChange,
  error,
}: {
  value: string
  onChange: (value: string) => void
  error: string | null
}) {
  return (
    <Field label="Set name">
      <input
        className={roadFieldClass}
        aria-label="Equipment set name"
        value={value}
        maxLength={120}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && <p className="mt-0.5 text-2xs text-destructive">{error}</p>}
    </Field>
  )
}
