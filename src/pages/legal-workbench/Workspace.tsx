import RuleFlow from './RuleFlow'
import { statusLabels } from '../../../packages/legal-rules/engine/explain'
import { spatialFacts, type Measurement } from '../../../packages/legal-rules/engine/spatialFacts'
import { lazy, Suspense, useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Button } from '@/components/ui/button'
import { FormField, SelectField, FORM_INPUT_CLASS } from '@/components/ui/form-field'
import { downloadText } from '@/lib/download'
import { assess, READABLE_ENGINE_VERSIONS } from '../../../packages/legal-rules/engine/evaluate'
import {
  authoringSchema,
  accepts,
  parseFacts,
  parsePack,
  releaseKey,
  type Pack,
  type Fact,
  type FactSet,
  type Scalar,
} from '../../../packages/legal-rules/src/contract'
import profile from '../../../packages/legal-rules/forestry-profile.json'
import example from '../../../packages/legal-rules/examples/water-monitoring.json'
import { defaults, loadLibrary, installPacks } from './registry'

const CoverageMap = lazy(() => import('./CoverageMap'))

/** One case: the releases chosen, the legal assessment date and the facts entered per release. */
export interface ReviewCase {
  selected: string[]
  date: string
  sets: Record<string, FactSet>
}

const save = (data: unknown, file: string) => downloadText(JSON.stringify(data, null, 2), file, 'application/json')
const blank = (p: Pack): FactSet => ({
  format: 'pgmaps-legal-facts/v1',
  pack: p.id,
  version: p.version,
  source: 'Case inputs',
  facts: [],
})
const failure = (e: unknown) => (e instanceof Error ? e.message : 'Unable to process the file.')
function FactField({ fact, value, onChange }: { fact: Fact; value?: Scalar; onChange: (value?: Scalar) => void }) {
  const label = fact.label + (fact.unit ? ' (' + fact.unit + ')' : '')
  if (fact.type === 'boolean' || fact.type === 'choice') {
    const options = fact.type === 'boolean' ? ['true', 'false'] : fact.choices!
    return (
      <SelectField
        label={label}
        value={value === undefined ? '' : String(value)}
        onChange={(e) =>
          onChange(
            e.target.value === '' ? undefined : fact.type === 'boolean' ? e.target.value === 'true' : e.target.value,
          )
        }
      >
        <option value="">Unknown</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {fact.type === 'boolean' ? (o === 'true' ? 'Yes' : 'No') : o}
          </option>
        ))}
      </SelectField>
    )
  }
  return (
    <FormField label={label}>
      <input
        className={FORM_INPUT_CLASS}
        type={fact.type === 'number' ? 'number' : 'text'}
        value={String(value ?? '')}
        step="any"
        min={fact.min}
        max={fact.max}
        onChange={(e) =>
          onChange(e.target.value === '' ? undefined : fact.type === 'number' ? e.target.valueAsNumber : e.target.value)
        }
      />
    </FormField>
  )
}
export const emptyReview = (regional = true): ReviewCase => ({
  selected: regional ? profile.releases : profile.blockReleases,
  sets: {},
  date: profile.assessmentDate,
})
export interface PlanReview {
  review: ReviewCase
  measurements: Measurement[]
  subject: string
  evidence: () => unknown
  onChange: (next: ReviewCase, packs: Pack[]) => void
}
export default function LegalWorkbench({ plan }: { plan?: PlanReview } = {}) {
  const [local, setLocal] = useState(emptyReview)
  const { selected, sets, date } = plan?.review ?? local
  const [library, setLibrary] = useState(defaults)
  const [info, setInfo] = useState(''),
    [busy, setBusy] = useState(true)
  function change(part: Partial<ReviewCase>, available = library) {
    const next = { ...(plan?.review ?? local), ...part }
    if (plan)
      plan.onChange(
        next,
        available.filter((p) => next.selected.includes(releaseKey(p)) || next.sets[releaseKey(p)]),
      )
    else setLocal(next)
  }
  useEffect(() => {
    let live = true
    loadLibrary()
      .then((v) => {
        if (live) setLibrary(v)
      })
      .catch((e) => {
        if (live) setInfo('Local pack storage unavailable. ' + failure(e))
      })
      .finally(() => {
        if (live) setBusy(false)
      })
    return () => {
      live = false
    }
  }, [])
  const packs = library.filter((p) => selected.includes(releaseKey(p)))
  function select(p: Pack, on: boolean) {
    change({ selected: [...selected.filter((key) => !key.startsWith(p.id + '@')), ...(on ? [releaseKey(p)] : [])] })
  }
  function edit(p: Pack, id: string, value?: Scalar | null, evidence?: string) {
    const field = p.facts.find((f) => f.id === id)!
    if (value != null && !accepts(field, value)) {
      setInfo('Enter a valid value for ' + field.label)
      return
    }
    const key = releaseKey(p)
    const set = sets[key] ?? blank(p)
    change({
      sets: {
        ...sets,
        [key]: {
          ...set,
          facts: [
            ...set.facts.filter((f) => f.id !== id),
            ...(value === undefined ? [] : [{ id, value, evidence: evidence?.trim() || 'Entered in workbench' }]),
          ],
        },
      },
    })
  }
  const inputs = packs.map((p) => {
    const set = sets[releaseKey(p)] ?? blank(p)
    if (!plan) return set
    const derived = spatialFacts(p, plan.measurements)
    const locked = new Set(derived.map((f) => f.id))
    return { ...set, source: plan.subject, facts: [...set.facts.filter((f) => !locked.has(f.id)), ...derived] }
  })
  let report: ReturnType<typeof assess> | undefined,
    problem = ''
  try {
    report = assess(date, packs, inputs)
  } catch (e) {
    problem = failure(e)
  }
  async function readFiles(e: ChangeEvent<HTMLInputElement>, mode: 'packs' | 'case') {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (!files.length) return
    setBusy(true)
    setInfo('')
    try {
      const payload = await Promise.all(files.map(async (f) => JSON.parse(await f.text())))
      if (mode === 'packs') {
        const installed = await installPacks(payload)
        const updated = await loadLibrary()
        setLibrary(updated)
        const chosen = new Map(packs.map((p) => [p.id, releaseKey(p)]))
        installed.forEach((p) => chosen.set(p.id, releaseKey(p)))
        change({ selected: [...chosen.values()] }, updated)
        setInfo('Installed ' + installed.map(releaseKey).join(', '))
      } else {
        const data = payload[0]
        if (data?.format === 'pgmaps-legal-assessment/v1') {
          if (!READABLE_ENGINE_VERSIONS.includes(data.engineVersion))
            throw Error('Unsupported assessment engine version.')
          if (!Array.isArray(data.releases) || !data.releases.length) throw Error('Assessment has no releases.')
          const ps: Pack[] = data.releases.map((r: { pack: unknown }) => parsePack(r.pack))
          const fs = ps.map((p, i) => parseFacts(data.releases[i].facts, p))
          assess(data.assessmentDate, ps, fs)
          await installPacks(ps)
          const updated = await loadLibrary()
          setLibrary(updated)
          change(
            {
              selected: ps.map(releaseKey),
              date: data.assessmentDate,
              sets: Object.fromEntries(ps.map((p, i) => [releaseKey(p), fs[i]])),
            },
            updated,
          )
          setInfo('Restored case and recalculated findings from the included releases.')
        } else {
          const raw =
            data?.legalFacts ??
            (data?.format === 'pgmaps-patch-assessment-v1'
              ? await (await import('../forest-patches/legacyFacts')).legacyPatchFacts(data)
              : data)
          // Read the library as stored now: an install started just before may not have reached this render.
          const current = await loadLibrary()
          const p = current.find((p) => p.id === raw?.pack && p.version === raw?.version)
          if (!p) throw Error('Install the matching pack release before importing its fact set.')
          const incoming = parseFacts(raw, p)
          const old = sets[releaseKey(p)] ?? blank(p)
          const ids = new Set(incoming.facts.map((f) => f.id))
          change({
            selected: [...selected.filter((k) => !k.startsWith(p.id + '@')), releaseKey(p)],
            sets: {
              ...sets,
              [releaseKey(p)]: {
                ...old,
                facts: [
                  ...old.facts.filter((f) => !ids.has(f.id)),
                  ...incoming.facts.map((f) => ({
                    ...f,
                    evidence: [incoming.source, f.evidence].filter(Boolean).join(' · '),
                  })),
                ],
              },
            },
          })
          setInfo('Imported ' + incoming.facts.length + ' measured or supplied facts from ' + incoming.source)
        }
      }
    } catch (e) {
      setInfo(failure(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className={plan ? 'space-y-4' : 'mx-auto max-w-7xl space-y-6 px-4 pb-12 pt-20 md:px-8 md:pt-10'}>
      <header>
        <h2 className="text-xl font-semibold">{plan ? 'Legal review' : 'Legal rules workbench'}</h2>
        {plan && <p>{plan.subject}</p>}
        <p className="mt-2 text-muted-foreground">
          Install versioned instruments, record case evidence and trace each finding to its provision.
        </p>
      </header>
      <fieldset
        disabled={busy}
        className={plan ? 'space-y-4' : 'grid min-w-0 gap-6 lg:grid-cols-[minmax(240px,1fr)_2fr]'}
      >
        <aside className="space-y-4">
          <h2 className="text-xl font-semibold">Pack library</h2>
          {library.map((p) => (
            <div className="space-y-1 rounded-lg border p-3" key={releaseKey(p)}>
              <label className="flex items-start gap-2 font-medium">
                <input
                  type="checkbox"
                  checked={selected.includes(releaseKey(p))}
                  onChange={(e) => select(p, e.target.checked)}
                />
                {p.title} · {p.version}
              </label>
              <p className="text-sm">{p.description}</p>
              {p.relatedPacks?.map((link) => (
                <p key={link.id} className="text-xs text-muted-foreground">
                  {library.find((other) => other.id === link.id)?.title ?? link.id} · {link.relationship}
                </p>
              ))}
              <small>
                Assessment dates {p.coverage.from} – {p.coverage.through}
              </small>
              <div>
                <Button size="sm" variant="outline" onClick={() => save(p, releaseKey(p) + '.json')}>
                  Download pack
                </Button>
              </div>
            </div>
          ))}
          <FormField label="Install JSON packs" description="Installed releases are saved in this browser.">
            <input type="file" accept=".json,application/json" multiple onChange={(e) => void readFiles(e, 'packs')} />
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => save(authoringSchema(), 'legal-pack-v1.schema.json')}>
              Download schema
            </Button>
            <Button size="sm" variant="outline" onClick={() => save(example, 'example-water-monitoring.json')}>
              Download example pack
            </Button>
          </div>
        </aside>
        <section className="min-w-0 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Assessment</h2>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                change({ sets: {} })
                setInfo('Started an empty case for the selected releases.')
              }}
            >
              New assessment
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Legal assessment date">
              <input
                className={FORM_INPUT_CLASS}
                type="date"
                value={date}
                onChange={(e) => change({ date: e.target.value })}
              />
            </FormField>
            <FormField
              label="Open facts or assessment"
              description="Accepts a fact set, patch assessment with legal facts, or saved workbench assessment."
            >
              <input type="file" accept=".json" onChange={(e) => void readFiles(e, 'case')} />
            </FormField>
          </div>
          {info && (
            <p role="status" className="whitespace-pre-wrap rounded border p-2 text-sm">
              {info}
            </p>
          )}
          {!packs.length && <p>Select an instrument from the pack library.</p>}
          {packs.map((p) => (
            <details open key={releaseKey(p)} className="rounded border p-4">
              <summary className="cursor-pointer font-semibold">{p.title} · case facts</summary>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                {p.facts.map((f) => {
                  const input = inputs.find((set) => set.pack === p.id)?.facts.find((x) => x.id === f.id)
                  if (plan && p.spatialBindings?.some((binding) => binding.fact === f.id))
                    return (
                      <div key={f.id}>
                        <strong>{f.label}</strong>
                        <p>
                          {String(input?.value ?? 'Unknown')} · {input?.evidence}
                        </p>
                      </div>
                    )
                  return (
                    <div key={f.id} className="space-y-1">
                      <FactField
                        fact={f}
                        value={input?.value ?? undefined}
                        onChange={(value) => edit(p, f.id, value)}
                      />
                      {input && (
                        <FormField label={'Evidence for ' + f.label}>
                          <input
                            className={FORM_INPUT_CLASS}
                            defaultValue={input.evidence}
                            key={input.evidence}
                            onBlur={(e) => edit(p, f.id, input.value, e.target.value)}
                          />
                        </FormField>
                      )}
                    </div>
                  )
                })}
              </div>
            </details>
          ))}
          {problem && <p role="alert">{problem}</p>}
          <h2 className="text-xl font-semibold">Findings</h2>
          {report?.releases.map((release) => (
            <section key={releaseKey(release.pack)} className="space-y-2">
              <h3 className="font-semibold">{release.pack.title}</h3>
              {release.findings.map((row) => (
                <details key={row.rule} className="rounded border p-3">
                  <summary className="cursor-pointer">
                    {row.title} · {statusLabels[row.status]}
                  </summary>
                  <p className="my-2 text-sm">
                    <a href={row.source.url} className="underline">
                      {row.source.title}, {row.provision}
                    </a>
                  </p>
                  <RuleFlow
                    pack={release.pack}
                    rule={release.pack.rules.find((r) => r.id === row.rule)!}
                    finding={row}
                    facts={release.facts}
                    date={date}
                  />
                  {'finding' in row && <p>{row.finding}</p>}
                  {'actions' in row &&
                    row.actions.map((a, i) => (
                      <p key={i} className="text-sm">
                        <strong>{a.kind}</strong> · {a.description}
                      </p>
                    ))}
                  {['scope' in row ? row.scope : undefined, 'condition' in row ? row.condition : undefined].map(
                    (stage, i) =>
                      stage?.trace.length ? (
                        <div key={i} className="mt-2">
                          <strong>{i === 0 ? 'Scope' : 'Trigger'}</strong>
                          {stage.trace.map((group, k) => (
                            <div key={k} className="my-1 rounded bg-muted p-2 text-sm">
                              {stage.trace.length > 1 && <strong>Alternative {k + 1}</strong>}
                              {group.map((t, j) => (
                                <div key={j}>
                                  {release.pack.facts.find((f) => f.id === t.fact)?.label} · {t.operator}{' '}
                                  {JSON.stringify(t.expected)} · entered{' '}
                                  {t.actual === null ? 'unknown' : String(t.actual)} ·{' '}
                                  {t.result === null ? 'missing evidence' : t.result ? 'matched' : 'did not match'}
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      ) : null,
                  )}
                </details>
              ))}
            </section>
          ))}
          <Button
            disabled={!report || !packs.length}
            onClick={() =>
              report && save(plan ? { ...report, planEvidence: plan.evidence() } : report, 'legal-assessment.json')
            }
          >
            Export reproducible assessment
          </Button>
          <p className="text-xs text-muted-foreground">
            Advisory findings. An instrument selection does not establish applicability. Source windows describe
            coverage of the installed releases. BC materials are unofficial transcriptions derived from the Province of
            British Columbia under the{' '}
            <a className="underline" href="https://www.bclaws.gov.bc.ca/standards/Licence.html">
              King’s Printer Licence
            </a>
            .
          </p>
        </section>
      </fieldset>
      {!plan && (
        <section className="space-y-3" aria-labelledby="law-coverage-heading">
          <h2 id="law-coverage-heading" className="text-xl font-semibold">
            Law coverage
          </h2>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Every section of the forestry statutes and regulations, and every provision of the Omineca land use orders,
            with whether a rule or a map screen reaches it and what a section-by-section reading found missing. Select a
            section to read it.
          </p>
          <Suspense fallback={<p className="text-sm text-muted-foreground">Loading the coverage map…</p>}>
            <CoverageMap />
          </Suspense>
        </section>
      )}
    </section>
  )
}
