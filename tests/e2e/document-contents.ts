import { expect, type Locator, type Page } from '@playwright/test'

import { choose } from './styled-select'

/**
 * Playwright helpers for `DocumentContents` (`src/components/ui/document-contents.tsx`): the shared
 * contents list of a report, a package or a plot book. Each row is an `li` carrying its part's key in
 * `data-contents-row`, its state in `data-state` and whether it prints in `data-prints`; a two-state
 * list draws a checkbox per row and a longer one a styled dropdown (see `styled-select.ts`).
 */

/** A contents list by its test id, or by its accessible name ("Contents of the report"). */
export function contentsList(scope: Page | Locator, name: string | RegExp | { testId: string }): Locator {
  if (typeof name === 'object' && 'testId' in name) return scope.getByTestId(name.testId)
  return scope.getByRole('region', { name, exact: typeof name === 'string' })
}

/** One part's row, by its key. */
export const contentsRow = (list: Locator, key: string) => list.locator(`li[data-contents-row=${JSON.stringify(key)}]`)

/** The keys of the rows, in print order. */
export const contentsOrder = (list: Locator) =>
  list.locator('li[data-contents-row]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-contents-row')))

/** A part's state as the row reports it. */
export const contentsState = async (list: Locator, key: string) =>
  (await contentsRow(list, key).getAttribute('data-state')) ?? ''

/**
 * Sets a part's state: a boolean for a two-state list's checkbox, or a choice for a dropdown (its
 * value or its exact label, as `choose` takes them).
 */
export async function setContentsState(list: Locator, key: string, state: boolean | string) {
  const row = contentsRow(list, key)
  if (typeof state === 'boolean') {
    await row.locator('input[type="checkbox"][data-contents-focus="state"]').setChecked(state)
    return
  }
  await choose(row.locator('[data-contents-state] [data-select-trigger]'), state)
}

/** One of a row's menu moves: up, down, top or bottom. */
export async function moveContentsPart(list: Locator, key: string, where: 'up' | 'down' | 'top' | 'bottom') {
  const row = contentsRow(list, key)
  await row.getByRole('button', { name: /^Options for '/ }).click()
  const page = list.page()
  const menu = page.getByRole('menu').last()
  await expect(menu).toBeVisible()
  const text = { up: 'Move up', down: 'Move down', top: 'Move to top', bottom: 'Move to bottom' }[where]
  await menu.getByRole('menuitem').filter({ hasText: text }).click()
  await expect(menu).toBeHidden()
}

/** Removes a part a person added, through its row's menu. */
export async function removeContentsPart(list: Locator, key: string) {
  await contentsRow(list, key)
    .getByRole('button', { name: /^Options for '/ })
    .click()
  const menu = list.page().getByRole('menu').last()
  await menu.getByRole('menuitem').filter({ hasText: 'Remove' }).click()
}

/** The preset dropdown. */
export const contentsPresetSelect = (list: Locator) => list.locator('[data-select-trigger][aria-label^="Preset for "]')

/** Chooses a preset by its label (or value). */
export const chooseContentsPreset = (list: Locator, preset: string | { value: string }) =>
  choose(contentsPresetSelect(list), preset)

/** Saves the list's contents as a preset under `name`. */
export async function saveContentsPreset(list: Locator, name: string) {
  await list.getByRole('button', { name: 'Save as preset…' }).click()
  await list.getByRole('textbox', { name: 'Preset name' }).fill(name)
  await list.getByRole('button', { name: 'Save', exact: true }).click()
}

/** The count line: "17 of 20 print", or the caller's own summary. */
export const contentsCountLine = async (list: Locator) =>
  ((await list.getByRole('status').first().textContent()) ?? '').trim()
