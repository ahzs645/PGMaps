import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import raw from '../../../../packages/legal-rules/acquire/channels.json'
import { parsePack, releaseKey, type Pack } from '../../../../packages/legal-rules/src/contract'
import { findSection, quoteFound, type LawSource } from '@/lib/legal/lawText'
import {
  addCrossing,
  addReceivedRecord,
  applyReceivedAsClaimEvidence,
  applyReceivedAsCrossingEvidence,
  applyReceivedAsFact,
  recordRequestEvent,
  removeBlock,
  removeSchedule,
  setCrossingReview,
  setRecordIds,
  updateCrossing,
} from '../edits'
import { assessmentRecord, buildExport, summaryHtml } from '../exports'
import { openPlanFile } from '../migrate'
import { parsePlan, samplePlan, type Plan } from '../plan'
import { analyzePlan } from '../planAnalysis'
import { boardCheckKey, oldForestKey } from '../records'
import { setClaim, setFact } from '../review/caseEdits'
import { CHANNEL_CATALOGUE, gapKindOfFact, GAP_KINDS, IDENTIFIER_KINDS, parseChannelCatalogue } from './channels'
import { fspHistory, unitsFromGroundRead } from './fsp'
import { blockGaps, blockReviewOf, FSP_UNSTATED, gapId, planGaps } from './gaps'
import { parseAcquisition, identifierToken, type ReceivedRecord } from './record'
import { scalarFor } from './received'
import { draftLetters, lettersText } from './requests'
import { addDays, bcHolidays, requestStanding } from './status'

const library: Pack[] = Object.values(
  import.meta.glob('../../../../packages/legal-rules/packs/*.json', { eager: true, import: 'default' }),
).map(parsePack)
const release = (key: string) => library.find((p) => releaseKey(p) === key)!
const permits = release('bc.forest-permits@1.2.0')
const water = release('bc.water-crossings@2.0.0')
const fpprCrossings = release('bc.fppr-crossings@1.0.0')
const TODAY = '2026-11-27'

const root = new URL('../../../../packages/legal-rules/', import.meta.url)
const statute = (id: string): LawSource =>
  JSON.parse(readFileSync(new URL(`catalogue/generated/${id}.sections.json`, root), 'utf8'))

/** The sample with one crossing on Block 1 under the proposal. */
function withCrossing(label = 'Culvert at Spur 3') {
  return addCrossing(samplePlan(), 'block-1', 'proposed', label)
}

describe('the channel catalogue', () => {
  it('reads, lists every gap kind once and tags each fact once', () => {
    const c = parseChannelCatalogue(raw)
    expect(c.gaps.map((g) => g.kind).sort()).toEqual([...GAP_KINDS].sort())
    expect(c.channels.length).toBeGreaterThanOrEqual(8)
    for (const ch of c.channels) for (const id of ch.identifiers) expect(IDENTIFIER_KINDS).toContain(id)
  })

  it('tags only facts the shipped packs ask', () => {
    for (const g of CHANNEL_CATALOGUE.gaps)
      for (const f of g.facts)
        expect(
          library.some((p) => p.id === f.pack && p.facts.some((x) => x.id === f.fact)),
          `${g.kind} tags ${f.pack}:${f.fact}`,
        ).toBe(true)
  })

  it('quotes the stored law word for word', () => {
    for (const ch of CHANNEL_CATALOGUE.channels)
      for (const cite of ch.cites) {
        const number = /s\. ([0-9.]+)/.exec(cite.provision)![1]
        const section = findSection(statute(cite.source), number)
        expect(section, `${ch.id} cites ${cite.source} ${number}`).toBeTruthy()
        expect(quoteFound(section!, cite.quote), `${ch.id}: ${cite.quote}`).toBe(true)
      }
  })

  it('names offices and roles, never a person, and every route is https', () => {
    for (const ch of CHANNEL_CATALOGUE.channels) {
      expect(ch.route.url).toMatch(/^https:\/\//)
      expect(ch.holder).not.toMatch(/\b(Mr|Ms|Mrs|Dr)\.? [A-Z]/)
    }
    expect(CHANNEL_CATALOGUE.bctsPlans.find((p) => p.fspId === 24)?.url).toContain('/fsp/prince-george')
  })

  it('refuses a catalogue that names a channel it does not list, or a gap kind twice', () => {
    const copy = JSON.parse(JSON.stringify(raw))
    copy.gaps[0].channels = ['nowhere']
    expect(() => parseChannelCatalogue(copy)).toThrow(/not listed/)
    const twice = JSON.parse(JSON.stringify(raw))
    twice.gaps.push(twice.gaps[0])
    expect(() => parseChannelCatalogue(twice)).toThrow()
  })

  it('maps a tagged fact to its kind', () => {
    expect(gapKindOfFact('bc.fppr-crossings', 'built-after-1995')?.kind).toBe('crossing-build-date')
    expect(gapKindOfFact('bc.forest-permits', 'site-plan')?.kind).toBe('site-plan')
    expect(gapKindOfFact('bc.forest-permits', 'tenure')).toBeUndefined()
  })
})

describe('gaps, derived and never stored', () => {
  it('lists a block’s gaps and its crossing’s, with stable ids', () => {
    const { plan } = withCrossing()
    const gaps = blockGaps(plan, library, 'block-1', 'proposed')
    const ids = gaps.map((g) => g.id)
    expect(ids).toContain('fsp-amendment:block-1:proposed')
    expect(ids).toContain('site-plan:block-1:proposed')
    expect(ids).toContain('crossing-build-date:block-1:proposed:crossing-1')
    expect(ids).toContain('crossing-design:block-1:proposed:crossing-1')
    expect(gapId('contravention', 'b', 's', 'c')).toBe('contravention:b:s:c')
    // The plan's identification waits on the reviewer's statement.
    expect(gaps.find((g) => g.kind === 'fsp-amendment')!.statements).toEqual([FSP_UNSTATED])
    // Nothing about gaps is kept with the plan.
    expect(plan.acquisition).toBeUndefined()
  })

  it('drops a gap once its fact is answered, and once the route makes it moot', () => {
    let { plan } = withCrossing()
    const crossing = plan.crossings![0]
    let review = setFact(crossing.review, fpprCrossings, 'built-after-1995', true)
    plan = setCrossingReview(plan, crossing.key, review)
    expect(blockGaps(plan, library, 'block-1', 'proposed').map((g) => g.id)).not.toContain(
      'crossing-build-date:block-1:proposed:crossing-1',
    )
    // On the forest route alone, the notice and approval questions settle; an officer's terms and
    // an engineer's requirement can still bind the work.
    const notice = () =>
      blockGaps(plan, library, 'block-1', 'proposed')
        .find((g) => g.kind === 'water-notice-terms')!
        .facts.map((f) => f.fact)
    expect(notice()).toEqual(expect.arrayContaining(['notice-given', 'approval-held', 'engineer-required']))
    review = plan.crossings![0].review
    for (const [id, v] of Object.entries({
      'stream-changes': true,
      'route-forest': true,
      'route-listed': false,
      'route-approval': false,
    }))
      review = setFact(review, water, id, v)
    plan = setCrossingReview(plan, crossing.key, review)
    expect(notice()).not.toContain('notice-given')
    expect(notice()).not.toContain('approval-held')
    expect(notice()).toContain('engineer-required')
  })

  it('marks what the review asks now apart from what may be needed', () => {
    let { plan } = withCrossing()
    const before = blockGaps(plan, library, 'block-1', 'proposed').find((g) => g.kind === 'crossing-build-date')!
    expect(before.asked).toBe(false)
    let review = plan.crossings![0].review
    for (const [id, v] of Object.entries({
      'authorized-person': true,
      'built-as': 'A road',
      'is-stream': true,
      maintains: true,
    }))
      review = setFact(review, fpprCrossings, id, v)
    plan = setCrossingReview(plan, 'crossing-1', review)
    const gaps = blockGaps(plan, library, 'block-1', 'proposed')
    expect(gaps.some((g) => g.facts.some((f) => f.asked))).toBe(true)
  })

  it('stating the plan and amendment takes the identification out of the FSP gap', () => {
    const plan = setRecordIds(samplePlan(), 'block-1', {
      fsp: { id: '24', amendment: '26', basis: 'stocking-standard', statedOn: TODAY },
    })
    const gap = blockGaps(plan, library, 'block-1', 'proposed').find((g) => g.kind === 'fsp-amendment')
    expect(gap?.statements ?? []).toEqual([])
  })

  it('offers BC Timber Sales only for a BCTS block, and the holder only for another', () => {
    const answer = (value: string) => {
      const p = samplePlan()
      return { ...p, reviews: { 'block-1': setFact(blockReviewOf(p, 'block-1'), permits, 'tenure', value) } }
    }
    const bcts = blockGaps(answer('BC Timber Sales, under a timber sale licence'), library, 'block-1', 'proposed')
    const licence = blockGaps(
      answer('A forest licence, tree farm licence, community forest agreement, timber licence or major licence to cut'),
      library,
      'block-1',
      'proposed',
    )
    const site = (gaps: typeof bcts) => gaps.find((g) => g.kind === 'site-plan')!.channels
    expect(site(bcts)).toContain('bcts-business-area')
    expect(site(bcts)).not.toContain('holder')
    expect(site(licence)).toContain('holder')
    expect(site(licence)).not.toContain('bcts-business-area')
    // Unknown: both, the reviewer chooses.
    expect(site(blockGaps(samplePlan(), library, 'block-1', 'proposed'))).toEqual(
      expect.arrayContaining(['holder', 'bcts-business-area']),
    )
  })
})

describe('drafted requests', () => {
  it('writes one letter per channel per block, many crossings in one', () => {
    let { plan } = withCrossing('Crossing A')
    plan = addCrossing(plan, 'block-1', 'proposed', 'Crossing B').plan
    const gaps = blockGaps(plan, library, 'block-1', 'proposed')
    const letters = draftLetters(plan, gaps, TODAY)
    const keys = letters.map((l) => l.key)
    expect(new Set(keys).size).toBe(keys.length)
    const engineering = letters.find((l) => l.channel.id === 'district-engineering')!
    expect(engineering.text).toContain('“Crossing A”')
    expect(engineering.text).toContain('“Crossing B”')
    expect(engineering.gaps.every((g) => g.crossing)).toBe(true)
    expect(engineering.foiText).toMatch(/Freedom of Information and Protection of Privacy Act/)
    expect(engineering.foiText).toMatch(/sever that part and release the rest/)
    expect(engineering.foiText).toMatch(/dated from 2016-01-01 to 2026-11-27/)
    const foi = letters.find((l) => l.channel.id === 'foi-forests')!
    expect(foi.foiText).toBeUndefined()
    expect(foi.text).toMatch(/^Subject: Freedom of information request/)
  })

  it('fills identifiers from what the plan holds', () => {
    let { plan } = withCrossing()
    plan = setRecordIds(plan, 'block-1', {
      licence: 'A12345',
      cuttingPermit: 'CP 412',
      permitIssued: '2019-05-02',
      roadPermit: 'R08812',
      opening: '1782965',
      recordsFrom: '2015-01-01',
      fsp: { id: '24', amendment: '15', basis: 'stocking-standard', statedOn: TODAY },
    })
    plan = updateCrossing(plan, 'crossing-1', {
      at: {
        point: [-122.77, 53.99],
        road: { file: 'R08812', section: '03', chainageM: 1240 },
        stream: { blueLineKey: 360873822 },
      },
    })
    plan = {
      ...plan,
      crossings: plan.crossings!.map((c) => ({
        ...c,
        evidence: [
          { kind: 'pscis', source: 'PSCIS assessment', readOn: TODAY, summary: 'Assessed', reference: '198765' },
        ],
      })),
    }
    const letters = draftLetters(plan, blockGaps(plan, library, 'block-1', 'proposed'), TODAY)
    const stewardship = letters.find((l) => l.channel.id === 'district-stewardship')!.text
    expect(stewardship).toContain('Forest stewardship plan id: 24 (amendment 15')
    expect(stewardship).toContain('BC Timber Sales Prince George FSP #24')
    expect(stewardship).toContain('Cutting permit: CP 412, issued 2019-05-02')
    const engineering = letters.find((l) => l.channel.id === 'district-engineering')!
    expect(engineering.text).toContain('road permit or file R08812, section 03')
    expect(engineering.text).toContain('PSCIS crossing 198765')
    expect(engineering.text).toContain('Freshwater Atlas stream 360873822')
    expect(engineering.foiText).toContain('dated from 2015-01-01')
  })

  it('writes no name, even one typed where an identifier goes or carried by a road', () => {
    let { plan } = withCrossing()
    plan = setRecordIds(plan, 'block-1', { licence: 'Jane Smith', timberMark: 'Acme Forest Products Ltd' })
    plan = updateCrossing(plan, 'crossing-1', { at: { road: { name: 'Acme Logging Mainline', file: 'Acme' } } })
    expect(plan.acquisition?.ids ?? []).toEqual([])
    const text = lettersText(plan, draftLetters(plan, planGaps(plan, library), TODAY), TODAY)
    expect(text).not.toMatch(/Jane|Smith|Acme/)
    expect(identifierToken('Jane Smith')).toBeUndefined()
    expect(identifierToken('A12345')).toBe('A12345')
  })
})

describe('request status', () => {
  it('counts business days past weekends and BC holidays', () => {
    expect(bcHolidays(2026).has('2026-04-03')).toBe(true) // Good Friday
    expect(bcHolidays(2026).has('2026-09-30')).toBe(true)
    expect(bcHolidays(2026).has('2026-12-26')).toBe(true)
    // Friday 2026-12-18 plus 5 business days: Christmas (Friday) is skipped; Boxing Day falls on the Saturday.
    expect(addDays('2026-12-18', 5, true)).toBe('2026-12-28')
    expect(addDays('2026-11-27', 10, false)).toBe('2026-12-07')
  })

  it('is due 30 business days after an FOI request, later for each extension, and overdue after', () => {
    const foi = CHANNEL_CATALOGUE.channels.find((c) => c.id === 'foi-forests')!
    const status = {
      gap: 'site-plan:block-1:proposed',
      channel: 'foi-forests',
      block: 'block-1',
      schedule: 'proposed',
      events: [{ status: 'requested' as const, date: '2026-09-01' }],
    }
    const s = requestStanding(status, foi, '2026-10-01', true)
    // Labour Day, the National Day for Truth and Reconciliation and Thanksgiving fall in the 30.
    expect(s.due).toBe('2026-10-16')
    expect(s.overdue).toBe(false)
    expect(requestStanding(status, foi, '2026-10-16', true).overdue).toBe(false)
    expect(requestStanding(status, foi, '2026-10-19', true).overdue).toBe(true)
    const extended = { ...status, events: [...status.events, { status: 'extended' as const, date: '2026-10-10' }] }
    expect(requestStanding(extended, foi, '2026-10-19', true).overdue).toBe(false)
    const received = { ...status, events: [...status.events, { status: 'received' as const, date: '2026-10-20' }] }
    expect(requestStanding(received, foi, '2026-12-01', true)).toMatchObject({ state: 'received', overdue: false })
    // A channel with no set time has no due date.
    const holder = CHANNEL_CATALOGUE.channels.find((c) => c.id === 'holder')!
    expect(requestStanding(status, holder, '2027-01-01', true).due).toBeUndefined()
  })

  it('keeps a request whose gap was answered, shown as no longer needed', () => {
    let plan = samplePlan()
    const gap = blockGaps(plan, library, 'block-1', 'proposed').find((g) => g.kind === 'site-plan')!
    plan = recordRequestEvent(plan, 'holder', [gap], { status: 'requested', date: '2026-11-01', reference: 'Email 1' })
    plan = recordRequestEvent(plan, 'holder', [gap], { status: 'requested', date: '2026-11-02' })
    expect(plan.acquisition!.requests).toHaveLength(1)
    expect(plan.acquisition!.requests![0].events).toHaveLength(2)
    // The site plan is answered from elsewhere: the gap goes, the request stays.
    plan = { ...plan, reviews: { 'block-1': setFact(blockReviewOf(plan, 'block-1'), permits, 'site-plan', true) } }
    const derived = new Set(blockGaps(plan, library, 'block-1', 'proposed').map((g) => g.id))
    expect(derived.has(gap.id)).toBe(false)
    const status = plan.acquisition!.requests![0]
    expect(requestStanding(status, undefined, TODAY, derived.has(status.gap)).noLongerNeeded).toBe(true)
  })
})

/** A received record with three values: an answer, a crossing's install year, and a severed line. */
function received(plan: Plan): { plan: Plan; id: string } {
  const record: Omit<ReceivedRecord, 'id'> = {
    block: 'block-1',
    title: 'Road permit file, section 03',
    from: 'district-engineering',
    documentDate: '2026-11-20',
    receivedOn: '2026-11-25',
    reference: 'FOR-2026-12345',
    severed: true,
    severedNote: 's. 22',
    values: [
      {
        id: 'value-1',
        label: 'Crossing built after June 15, 1995',
        value: 'Yes',
        fact: { pack: 'bc.fppr-crossings', fact: 'built-after-1995' },
        crossing: 'crossing-1',
        page: '4',
        quote: 'Installed 2004-08-12',
      },
      {
        id: 'value-2',
        label: 'Culvert diameter',
        value: 'about half a metre',
        fact: { pack: 'bc.water-crossings', fact: 'culvert-diameter' },
        crossing: 'crossing-1',
      },
      { id: 'value-3', label: 'Site plan', value: 'Yes', fact: { pack: 'bc.forest-permits', fact: 'site-plan' } },
    ],
  }
  return addReceivedRecord(plan, record)
}

describe('received records', () => {
  it('feed nothing until the reviewer uses a value', () => {
    const { plan } = received(withCrossing().plan)
    expect(plan.acquisition!.received).toHaveLength(1)
    expect(plan.crossings![0].review.sets).toEqual({})
    expect(plan.reviews).toEqual({})
    expect(blockGaps(plan, library, 'block-1', 'proposed').map((g) => g.id)).toContain(
      'crossing-build-date:block-1:proposed:crossing-1',
    )
  })

  it('answer a crossing’s fact on one click, naming the record, and the gap goes', () => {
    const { plan, id } = received(withCrossing().plan)
    const used = applyReceivedAsFact(plan, library, id, 'value-1', TODAY)
    if (!('plan' in used)) throw Error(used.error)
    const fact = used.plan.crossings![0].review.sets[releaseKey(fpprCrossings)].facts.find(
      (f) => f.id === 'built-after-1995',
    )!
    expect(fact.value).toBe(true)
    expect(fact.evidence).toContain('Road permit file, section 03')
    expect(fact.evidence).toContain('p. 4')
    expect(used.plan.acquisition!.received![0].values[0].uses).toEqual([
      {
        as: 'fact',
        target: 'Culvert at Spur 3: ' + fpprCrossings.facts.find((f) => f.id === 'built-after-1995')!.label,
        on: TODAY,
      },
    ])
    expect(blockGaps(used.plan, library, 'block-1', 'proposed').map((g) => g.id)).not.toContain(
      'crossing-build-date:block-1:proposed:crossing-1',
    )
  })

  it('answer a block’s fact, and refuse a value the fact cannot take', () => {
    const { plan, id } = received(withCrossing().plan)
    const block = applyReceivedAsFact(plan, library, id, 'value-3', TODAY)
    if (!('plan' in block)) throw Error(block.error)
    expect(block.plan.reviews['block-1'].sets[releaseKey(permits)].facts.find((f) => f.id === 'site-plan')?.value).toBe(
      true,
    )
    const refused = applyReceivedAsFact(plan, library, id, 'value-2', TODAY)
    expect(refused).toEqual({ error: expect.stringMatching(/takes a number/) })
    expect(scalarFor(water.facts.find((f) => f.id === 'culvert-diameter')!, '0.6 m')).toBe(0.6)
  })

  it('join a claim’s evidence, or the crossing’s evidence as received', () => {
    let { plan } = withCrossing()
    // Claim an exception on a raised rule of the crossing's case.
    const rule = fpprCrossings.rules.find((r) => r.exceptions?.length)!
    const claimed = setClaim(plan.crossings![0].review, fpprCrossings, rule.id, {
      rule: rule.id,
      exception: rule.exceptions![0].id,
      rationale: 'Temporary effect while the road was built.',
    })
    plan = setCrossingReview(plan, 'crossing-1', claimed)
    const r = received(plan)
    const withClaim = applyReceivedAsClaimEvidence(
      r.plan,
      r.id,
      'value-1',
      { crossing: 'crossing-1', release: releaseKey(fpprCrossings), rule: rule.id },
      TODAY,
    )
    if (!('plan' in withClaim)) throw Error(withClaim.error)
    const evidence = withClaim.plan.crossings![0].review.sets[releaseKey(fpprCrossings)].claims![0].evidence!
    expect(evidence[0]).toMatchObject({ reference: 'FOR-2026-12345', date: '2026-11-20' })
    // No fact was answered by it.
    expect(withClaim.plan.crossings![0].review.sets[releaseKey(fpprCrossings)].facts).toEqual([])

    const asEvidence = applyReceivedAsCrossingEvidence(r.plan, r.id, 'value-1', TODAY)
    if (!('plan' in asEvidence)) throw Error(asEvidence.error)
    expect(asEvidence.plan.crossings![0].evidence).toEqual([
      expect.objectContaining({ kind: 'received', received: `${r.id}/value-1`, readOn: '2026-11-25' }),
    ])
    expect(applyReceivedAsCrossingEvidence(r.plan, r.id, 'value-3', TODAY)).toEqual({ error: expect.any(String) })
  })
})

describe('kept with the plan', () => {
  function full() {
    let { plan } = withCrossing()
    plan = setRecordIds(plan, 'block-1', { licence: 'A12345', fsp: { id: '24', basis: 'fdu-layer', statedOn: TODAY } })
    const gap = blockGaps(plan, library, 'block-1', 'proposed').find((g) => g.kind === 'site-plan')!
    plan = recordRequestEvent(plan, 'foi-forests', [gap], { status: 'requested', date: '2026-11-01' })
    return received(plan).plan
  }

  it('round-trips through a file, and an older plan opens and writes as before', () => {
    const plan = full()
    const reopened = parsePlan(JSON.parse(JSON.stringify(plan)))
    expect(reopened.acquisition).toEqual(plan.acquisition)
    const older = samplePlan()
    const read = parsePlan(JSON.parse(JSON.stringify(older)))
    expect(read).not.toHaveProperty('acquisition')
    expect(JSON.stringify(read)).toBe(JSON.stringify(parsePlan(older)))
  })

  it('reads tolerantly: a bad item is left out and counted', () => {
    const plan = full()
    const file = JSON.parse(JSON.stringify(plan))
    file.acquisition.requests.push({ gap: 'x', channel: 'nowhere', block: 'block-1', schedule: 'proposed', events: [] })
    file.acquisition.received.push({
      id: 'received-9',
      block: 'block-404',
      title: 'x',
      from: 'holder',
      receivedOn: TODAY,
      values: [],
    })
    file.acquisition.ids.push({ block: 'block-1', licence: 'B1' })
    const opened = openPlanFile(file)
    expect(opened.plan.acquisition).toEqual(plan.acquisition)
    expect(opened.notes.join(' ')).toMatch(/3 records of the records asked for or received could not be read/)
    expect(parseAcquisition('nonsense', [], []).acquisition).toBeUndefined()
  })

  it('goes with its block or schedule when either is removed', () => {
    const plan = full()
    expect(removeBlock(plan, 'block-1').acquisition).toEqual({ ids: [], requests: [], received: [] })
    const gone = removeSchedule(plan, 'proposed')
    expect(gone.acquisition!.requests).toEqual([])
    expect(gone.acquisition!.received).toHaveLength(1)
  })

  it('stays out of the patch run and every check’s key', () => {
    const after = full()
    const without: Plan = { ...after }
    delete without.acquisition
    const shown = { schedule: 'proposed', year: 2026 }
    expect(boardCheckKey(after)).toBe(boardCheckKey(without))
    expect(oldForestKey(after)).toBe(oldForestKey(without))
    expect(analyzePlan(after, shown)).toEqual(analyzePlan(without, shown))
  })

  it('prints requests and received records in the summary and the record, never a document’s content', () => {
    const plan = full()
    const result = analyzePlan(plan, { schedule: 'proposed', year: 2026 })
    const record = assessmentRecord(plan, result, library, TODAY)
    expect(record.acquisition.requests[0]).toMatchObject({
      channel: 'foi-forests',
      state: 'requested',
      due: '2026-12-14',
    })
    expect(record.acquisition.received[0].values[0]).toMatchObject({ value: 'Yes', transcribedBy: 'reviewer' })
    const html = summaryHtml(plan, result, library, TODAY)
    expect(html).toContain('Records asked for and received')
    expect(html).toContain('Road permit file, section 03')
    expect(html).toContain('FOR-2026-12345')
    const letters = buildExport('requests', plan, undefined, library, TODAY)
    expect(letters).toContain('Records to request')
    expect(letters).toContain('Drafts only: nothing has been sent')
  })
})

describe('the plan a permit relied on', () => {
  const row = (n: number, status: string, approved?: string) => ({
    FSP_ID: 24,
    FSP_AMENDMENT_NUMBER: n,
    LIFE_CYCLE_STATUS_CODE: status,
    ...(approved ? { AMENDMENT_APPROVAL_DATE: approved + 'Z' } : {}),
  })

  it('lists the amendments the layer holds, flags the first held and a skipped number, and a candidate at issue', () => {
    const rows = [
      row(25, 'PREVIOUS', '2023-05-11'),
      row(27, 'APPROVED', '2025-04-28'),
      row(27, 'APPROVED', '2025-04-28'),
      row(28, 'SUBMITTED'),
      { ...row(3, 'PREVIOUS', '2010-01-01'), FSP_ID: 142 },
    ]
    const h = fspHistory('24', rows, '2024-06-01')
    expect(h.amendments.map((a) => a.number)).toEqual([25, 27, 28])
    expect(h.firstHeld).toBe(25)
    expect(h.skipped).toEqual([26])
    expect(h.atIssue?.number).toBe(25)
    expect(fspHistory('24', rows).atIssue).toBeUndefined()
  })

  it('takes the units from a ground read only when one is kept', () => {
    expect(unitsFromGroundRead(undefined)).toBeNull()
  })
})
