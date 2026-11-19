import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import * as kit from 'document-kit'
import * as recipe from 'document-kit/recipe'
import { describe, expect, it } from 'vitest'

import { readPart, SIGNATURE_KIND } from './kitBlocks'
import { REPORT_RECIPES } from './recipes'
import {
  compiledJsonParts,
  compileViaRecipe,
  jsonPartEntries,
  SHIPPED_RECIPE_IDS,
  shippedReportRecipes,
  VIA_BASE_RECIPE,
  VIA_COMPONENTS,
  VIA_RECIPES,
  type RecipeKit,
} from './recipeRoute'
import { findReportPart, REPORT_PARTS } from './registry'

const KIT: RecipeKit = { recipe, imageInfo: kit.imageInfo }

describe('the VIA recipes as JSON', () => {
  it('generate exactly the files the page reads (run npm run via-recipes:build after changing one)', () => {
    const read = (name: string) => JSON.parse(readFileSync(join(import.meta.dirname, 'recipeJson', name), 'utf8'))
    expect(read('recipes.generated.json')).toEqual({ recipes: shippedReportRecipes(KIT), parts: jsonPartEntries() })
    expect(read('parts.compiled.json')).toEqual({ parts: compiledJsonParts(KIT) })
    expect(REPORT_RECIPES.map((entry) => entry.id)).toEqual(SHIPPED_RECIPE_IDS)
  })

  it('extend the base recipe, directly or through another shipped recipe, and never copy its sections', () => {
    for (const json of VIA_RECIPES.filter((entry) => entry.id !== VIA_BASE_RECIPE)) {
      expect(json.extends, json.id).toBeDefined()
      expect(json.sections, json.id).toBeUndefined()
    }
    expect(VIA_RECIPES.find((entry) => entry.id === 'consultant-gross')?.extends).toBe('consultant-net-private')
  })

  it('carry each part’s title and sources to the engine, from the part itself', () => {
    for (const id of SHIPPED_RECIPE_IDS) {
      const compiled = compileViaRecipe(KIT, id)
      for (const part of compiled.sections[0].parts) {
        const own = findReportPart(part.part.component)
        if (!own) continue
        expect(part.part.title).toBe(own.title)
        expect(part.part.componentMeta).toMatchObject({ reportPart: true, sources: [...own.sources] })
      }
    }
  })

  it('list every JSON part in the registry, rendered by the engine, never as code', () => {
    for (const entry of jsonPartEntries()) {
      const part = findReportPart(entry.id) as { json?: boolean } | null
      expect(part?.json, entry.id).toBe(true)
    }
    expect(REPORT_PARTS.filter((part) => 'json' in part).length).toBe(jsonPartEntries().length)
    expect(VIA_COMPONENTS.filter((component) => component.meta?.reportPart).length).toBe(jsonPartEntries().length)
  })

  it('read only the block kinds whose report block is exact, and what a part declares to complete', () => {
    const read = readPart(
      [
        { type: 'heading', level: 2, content: 'Sign-off' },
        {
          type: 'fields',
          layout: 'table',
          rows: [{ label: 'By', value: null, source: 'scene' }],
          pending: [{ what: 'By' }],
        },
        { type: 'custom', kind: SIGNATURE_KIND, data: { lines: ['Signature'] } },
      ],
      'x',
    )
    expect(read.toComplete).toEqual(['By'])
    expect(read.blocks[2]).toEqual({ kind: 'signature', lines: ['Signature'] })
    expect(() => readPart([{ type: 'paragraph', content: 'No source' }], 'x')).toThrow(/source/)
    expect(() => readPart([{ type: 'toc' }], 'x')).toThrow(/no exact report block/)
    expect(() =>
      readPart([{ type: 'paragraph', source: 'fixed', content: { type: 'text', text: 'B', bold: true } }], 'x'),
    ).toThrow(/not plain/)
  })
})
