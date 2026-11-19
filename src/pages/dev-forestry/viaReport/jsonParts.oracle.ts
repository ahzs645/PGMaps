/**
 * The conversion's oracle, test support only: each report part now defined in JSON (`recipeJson/components/`) as its
 * code was before the conversion (git history has the same text). `jsonParts.test.ts` and
 * `npm run via-recipes:compare` pin each JSON part to it; no page code imports it, so it is never a second live
 * definition. No DOM or network access.
 */
import { field, fields, heading, text, type FieldRow } from './model'
import {
  blank,
  CERTIFICATION_STATEMENTS,
  generalLocationRow,
  missingFields,
  officeRow,
  preparerRow,
  proposedBlocks,
  type ReportContext,
  type ReportPart,
} from './parts'
import { harvestYearLine, systemsLine } from './formLines'

const today = (ctx: ReportContext) => ctx.date.toISOString().slice(0, 10)
const blocksField = (ctx: ReportContext) =>
  field('Blocks', blank(ctx.office.blockIds) ?? ctx.blocks.map((block) => block.name).join(', '), 'scene')

const cover: ReportPart = {
  id: 'cover',
  title: 'Cover',
  sources: ['01', '02', '03', '05', '06', '22', '23', '26'],
  build: (ctx) => {
    const rows = [
      officeRow(ctx, 'licensee', 'Prepared for'),
      preparerRow(ctx, 'Prepared by'),
      officeRow(ctx, 'licence', 'Licence'),
      officeRow(ctx, 'cuttingPermit', 'Cutting permit'),
      field(
        'Blocks',
        ctx.office.blockIds ||
          proposedBlocks(ctx)
            .map((block) => block.name)
            .join(', '),
        'scene',
      ),
      officeRow(ctx, 'district', 'Natural resource district'),
      generalLocationRow(ctx),
      field('Date', ctx.date.toISOString().slice(0, 10), 'run'),
    ]
    return { blocks: [fields(rows)], toComplete: missingFields(rows) }
  },
}

const threeElements: ReportPart = {
  id: 'three-elements',
  title: 'The three elements of the definition',
  sources: ['22', '23'],
  build: () => ({
    blocks: [
      heading('Assessing the definition'),
      {
        kind: 'list',
        items: [
          'Visibility: how easy the alteration is to see, given where it sits, where the viewpoints are, its size, how distinct it is from the landscape around it, screening in front of it, and how long and how directly it is viewed.',
          'Size and scale: the alteration against the visible area of the landform, judged by eye and measured as the percent of the landform altered in perspective view.',
          'Design: the shape and position of the alteration on the landform, its response to the lines of force of the terrain, and whether it borrows from the natural character of the landscape.',
        ],
        source: 'fixed',
      },
      text(
        'The three are considered together, and the extent the objective is met is a judgement on all three; the percent alteration is a measure of one of them.',
      ),
    ],
  }),
}

const limitations: ReportPart = {
  id: 'limitations',
  title: 'Limitations',
  sources: ['02', '22', '23'],
  build: (ctx) => ({
    blocks: [
      heading('Limitations'),
      text(
        `The simulations are drawn on ${ctx.method.terrain}; timber is drawn from the inventory, not surveyed. Operational changes to the harvest area or retention, and windthrow after harvest, are not modelled. Pixel figures count what each picture shows at its lens; the sightline figure is the assessment's. A field visit confirms the viewpoints and the figures.`,
        'run',
      ),
    ],
  }),
}

const signOff: ReportPart = {
  id: 'sign-off',
  title: 'Sign-off',
  sources: ['01', '02', '03', '05', '22', '23'],
  build: (ctx) => ({
    blocks: [
      heading('Sign-off'),
      fields([preparerRow(ctx, 'Prepared by')]),
      {
        kind: 'choices',
        label: 'Certification:',
        options: [
          'I carried out or directly supervised this assessment',
          'I reviewed this assessment and judge it to meet the standard of my profession',
        ],
        chosen: null,
        source: 'reviewer',
      },
      { kind: 'signature', lines: ['Signature', 'Professional designation and seal', 'Date'] },
    ],
  }),
}

const references: ReportPart = {
  id: 'references',
  title: 'References',
  sources: ['22', '23', '26'],
  build: (ctx) => ({
    blocks: [
      heading('References'),
      {
        kind: 'list',
        items: [
          'BC Ministry of Forests. Visual Impact Assessment Handbook (May 2022).',
          'Forest Planning and Practices Regulation, s. 1.1 (visual quality objective definitions).',
          ctx.inventoryRead
            ? 'BC Geographic Warehouse: Visual Landscape Inventory (REC_VISUAL_LANDSCAPE_INVENTORY), read live from DataBC for this report.'
            : 'BC Geographic Warehouse: Visual Landscape Inventory (REC_VISUAL_LANDSCAPE_INVENTORY): not read for this report; inventory values are the office fields.',
          `Terrain: ${ctx.method.terrain}. Timber: ${ctx.method.vegetation}.`,
        ],
        source: 'fixed',
      },
    ],
  }),
}

const formHeader2001: ReportPart = {
  id: 'form-header-2001',
  title: 'Form header',
  sources: ['01', '03', '05'],
  build: (ctx) => {
    const summaryForm = !!ctx.recipeParts?.includes('notes-2001')
    const rows: FieldRow[] = [
      officeRow(ctx, 'licensee', 'Licensee name'),
      officeRow(ctx, 'licence', 'Licensee no.'),
      officeRow(ctx, 'cuttingPermit', 'Cutting permit'),
      blocksField(ctx),
      generalLocationRow(ctx),
      field('Proposed silvicultural system', systemsLine(ctx.blocks), 'scene'),
      ...(summaryForm
        ? [
            field('Proposed year of harvest', harvestYearLine(proposedBlocks(ctx)), 'scene'),
            field('Type of proposed operation', proposedBlocks(ctx).length ? 'Harvesting' : null, 'scene'),
          ]
        : []),
      field('Date', today(ctx), 'run'),
    ]
    // The scene records blocks but no proposed roads, so road building is the reviewer's to add.
    const roads = summaryForm && proposedBlocks(ctx).length ? ['Type of proposed operation: road building, if any'] : []
    return { blocks: [fields(rows)], toComplete: [...missingFields(rows), ...roads] }
  },
}

const signOffCertified: ReportPart = {
  id: 'sign-off-certified',
  title: 'Sign-off',
  sources: ['23'],
  build: (ctx) => {
    const preparer = blank(ctx.office.evaluator)
    const designation = blank(ctx.office.evaluatorDesignation)
    return {
      blocks: [
        heading('Sign-off'),
        {
          kind: 'fields',
          rows: [
            { label: 'Visual impact assessment prepared by', value: preparer, source: 'scene' },
            // The designation is the evaluator's entry; the seal is always applied by hand.
            {
              label: 'Professional designation and seal',
              value: designation,
              source: designation ? 'scene' : 'reviewer',
            },
          ],
        },
        text(CERTIFICATION_STATEMENTS.supervised, 'fixed'),
        { kind: 'signature', lines: ['Signature', 'Date'] },
      ],
      toComplete: [
        ...(preparer ? [] : ['Prepared by: name']),
        designation ? 'Prepared by: seal, signature and date' : 'Prepared by: designation, seal, signature and date',
      ],
    }
  },
}

export const ORACLE: Record<string, ReportPart> = Object.fromEntries(
  [cover, threeElements, limitations, signOff, references, formHeader2001, signOffCertified].map((part) => [
    part.id,
    part,
  ]),
)
