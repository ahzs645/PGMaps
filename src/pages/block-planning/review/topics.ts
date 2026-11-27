/**
 * The provisions a review's questions and findings are grouped under, per instrument. A rule's
 * topic is read from its provision's leading section ("64(1)(b) and 64(2)–(4)" is §64, "D.5(a)"
 * is D.5). A pack without a table here, such as one installed on the legal rules page, groups by
 * that section alone, so every pack groups.
 *
 * DOM- and network-free.
 */
import type { Pack } from '../../../../packages/legal-rules/src/contract'
import type { Finding, Question } from './questions'

interface TopicDef {
  id: string
  label: string
  sections: string[]
  /** Rules placed by id, for an instrument whose provisions do not number by section (an order's strategies). */
  rules?: string[]
}

const TOPICS: Record<string, TopicDef[]> = {
  'bc.crown-grazing': [
    { id: 'ada-sra', label: 'Agriculture and settlement reserve areas (2006 order)', sections: ['I'] },
    {
      id: 'regeneration',
      label: 'Reforesting the harvested ground (FRPA §29, FPPR §44(3))',
      sections: ['29', '44', '1', '91', '46.2', '46.11'],
    },
    { id: 'lease', label: 'Land Act grazing lease', sections: ['11', '11.2'] },
    { id: 'designation', label: 'Land Act reserves and designated use areas (§§15–17)', sections: ['15', '17'] },
    { id: 'range-plan', label: 'Range Act agreement, range plan and developments', sections: ['32', '51'] },
    { id: 'mitigation', label: 'Forest plan clauses and range barriers', sections: ['20.21', '20.22', '48'] },
  ],
  'bc.fppr': [
    { id: 'size', label: 'Cutblock size and adjacency (§64–65)', sections: ['64', '65'] },
    { id: 'pine', label: 'Secondary structure in pine leading stands (§43.1)', sections: ['43.1'] },
    { id: 'wildlife', label: 'Wildlife trees and coarse woody debris (§66–68)', sections: ['66', '67', '68'] },
    { id: 'soil', label: 'Soil disturbance and permanent access (§35–36)', sections: ['35', '36'] },
    { id: 'riparian', label: 'Riparian management areas (§47–49, §52)', sections: ['47', '48', '49', '52'] },
    { id: 'roads', label: 'Roads in community watersheds (§84)', sections: ['84'] },
    {
      id: 'plans',
      label: 'Plans, results and exemptions',
      sections: ['4.33', '4.44', '4.51', '12.4', '12.5', '34.6', '92.1'],
    },
  ],
  'bc.forest-permits': [
    {
      id: 'fsp',
      label: 'Forest stewardship plan and site plan (FRPA §3, §10; FPPR §14)',
      sections: [],
      rules: ['fdu', 'fdu-identifies', 'site-plan'],
    },
    {
      id: 'fom',
      label: 'Forest operations map (FRPA §15.1; FPPR §34.2, §34.5)',
      sections: [],
      rules: ['fom', 'fom-review', 'fom-window'],
    },
    {
      id: 'permits',
      label: 'Cutting and road permits (Forest Act §52.02, §52.05, §117)',
      sections: [],
      rules: ['cutting-permit', 'permit-refusal', 'fop'],
    },
    {
      id: 'spa',
      label: 'Special purpose areas (Forest Act §209, §215)',
      sections: [],
      rules: ['spa-licence', 'spa-road'],
    },
  ],
  'bc.water-crossings': [
    {
      id: 'authority',
      label: 'Authority for changes in and about a stream (WSA §11; WSR §37)',
      sections: ['11', '37'],
    },
    { id: 'forest', label: 'Forest road crossings under FRPA (WSR §39(2))', sections: [], rules: ['forest-route'] },
    {
      id: 'listed',
      label: 'Culverts, bridges, fords and winter crossings (WSR §39(1))',
      sections: [],
      rules: [
        'culvert-size',
        'culvert-cover',
        'culvert-fill',
        'culvert-capacity',
        'culvert-fish',
        'culvert-design',
        'culvert-practices',
        'bridge-conditions',
        'ford-conditions',
        'winter-conditions',
      ],
    },
    { id: 'notice', label: 'Habitat officer notice and aquatic damage (WSR §§38, 44)', sections: ['38', '44'] },
  ],
  'bc.omineca.old-growth': [
    {
      id: 'ogma',
      label: 'Legal old growth management areas',
      sections: [],
      rules: [
        'dome-slim-cutting',
        'dome-slim-forest-health',
        'dome-slim-road',
        'humbug-cutting',
        'humbug-forest-health',
        'humbug-road',
        'mackenzie-retain',
        'mackenzie-ceiling',
        'mackenzie-notice',
        'ancient-forest-retain',
      ],
    },
    {
      id: 'cofa',
      label: 'Candidate old forest areas (Prince George TSA)',
      sections: [],
      rules: ['cofa', 'cofa-summary'],
    },
    { id: 'mugaha', label: 'Mugaha Marsh sensitive area', sections: [], rules: ['mugaha-share', 'mugaha-reserve'] },
    {
      id: 'obo-fox',
      label: 'Obo River and Fox landscape units',
      sections: [],
      rules: ['obo-fox-retention', 'weissener'],
    },
  ],
  'bc.mackenzie.biodiversity': [
    {
      id: 'old-forest',
      label: 'Old and old interior forest (2008 order, amended 2010)',
      sections: [],
      rules: ['old-shortfall', 'interior-shortfall', 'younger-allowance'],
    },
    { id: 'wildlands', label: 'Wildlands landscape units', sections: [], rules: ['wildlands'] },
  ],
  'bc.omineca.visual-quality': [
    {
      id: 'visual',
      label: 'Visual quality objectives',
      sections: ['7', '9.2', '1.1'],
      rules: ['pg-vqo', 'bobtail-vqo', 'fsj-vqo'],
    },
  ],
  'bc.pgtsa.biodiversity': [
    { id: 'patches', label: 'Young-forest patches (C)', sections: ['C'] },
    { id: 'pathways', label: 'Pathways (D.5)', sections: ['D.5'] },
    { id: 'contributions', label: 'Contributions and accounting (D.1–D.4)', sections: ['D.1', 'D.2', 'D.3', 'D.4'] },
    { id: 'transition', label: 'Transition and later orders (E)', sections: ['E'] },
  ],
}

/** The leading section of a provision: "64", "4.33", "D.5", "C". */
export function sectionOf(provision: string) {
  return provision.trim().match(/^(\d+(?:\.\d+)?|[A-Z](?:\.\d+)?)/)?.[1] ?? provision.trim()
}

export interface Topic {
  id: string
  label: string
}

export const WHOLE_CASE: Topic = { id: 'whole', label: 'Whole case' }

export function ruleTopic(pack: Pack, rule: Pack['rules'][number]): Topic {
  const section = sectionOf(rule.provision)
  const known = TOPICS[pack.id]?.find((t) => t.rules?.includes(rule.id) || t.sections.includes(section))
  return known ? { id: known.id, label: known.label } : { id: `section-${section}`, label: `Section ${section}` }
}

/** The order topics appear in: the instrument's own, then any section without one, by first use. */
function topicOrder(pack: Pack) {
  const order = (TOPICS[pack.id] ?? []).map((t) => t.id)
  for (const rule of pack.rules) {
    const id = ruleTopic(pack, rule).id
    if (!order.includes(id)) order.push(id)
  }
  return order
}

export interface QuestionGroup {
  topic: Topic
  questions: Question[]
}

/**
 * Questions by the topic of the rules that ask them. A question rules of more than one topic ask
 * (applicability, the holder, the region) goes first, under the whole case.
 */
export function groupQuestions(pack: Pack, questions: Question[], caseLabel = WHOLE_CASE.label): QuestionGroup[] {
  const groups = new Map<string, QuestionGroup>()
  for (const q of questions) {
    const topics = new Map(
      q.rules
        .map((id) => pack.rules.find((r) => r.id === id))
        .filter((r): r is Pack['rules'][number] => !!r)
        .map((r) => {
          const t = ruleTopic(pack, r)
          return [t.id, t] as const
        }),
    )
    const topic = topics.size === 1 ? [...topics.values()][0] : { ...WHOLE_CASE, label: caseLabel }
    const group = groups.get(topic.id) ?? { topic, questions: [] }
    group.questions.push(q)
    groups.set(topic.id, group)
  }
  const order = [WHOLE_CASE.id, ...topicOrder(pack)]
  return [...groups.values()].sort((a, b) => order.indexOf(a.topic.id) - order.indexOf(b.topic.id))
}

export interface TopicSection {
  topic: Topic
  questions: Question[]
  findings: Finding[]
}

/**
 * One section per provision: its questions (shared ones under the whole case, first) and its
 * rules' findings, in the instrument's order. A provision with neither is left out.
 */
export function topicSections(
  pack: Pack,
  questions: Question[],
  findings: Finding[],
  caseLabel = WHOLE_CASE.label,
): TopicSection[] {
  const sections = new Map<string, TopicSection>()
  for (const group of groupQuestions(pack, questions, caseLabel))
    sections.set(group.topic.id, { topic: group.topic, questions: group.questions, findings: [] })
  for (const finding of findings) {
    const rule = pack.rules.find((r) => r.id === finding.rule)
    if (!rule) continue
    const topic = ruleTopic(pack, rule)
    const section = sections.get(topic.id) ?? { topic, questions: [], findings: [] }
    section.findings.push(finding)
    sections.set(topic.id, section)
  }
  const order = [WHOLE_CASE.id, ...topicOrder(pack)]
  return [...sections.values()].sort((a, b) => order.indexOf(a.topic.id) - order.indexOf(b.topic.id))
}
