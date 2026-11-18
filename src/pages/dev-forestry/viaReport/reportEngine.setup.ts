/**
 * Unit tests load the VIA report's engine as Save & export does when it opens (`viaReportEngine.ts`): the kit's
 * renderer and the compiled JSON parts, so a report assembles in a test exactly as it does on the page. Only the
 * forestry tests can assemble a report, so only they pay for the load. A test that needs the engine absent takes it
 * away with `setReportEngine(null)` and puts it back.
 */
import { expect } from 'vitest'

// Before the test file is collected: a test may assemble a report while it is collected.
if (/[/\\]dev-forestry[/\\]|[/\\]via-recipes[/\\]/.test(expect.getState().testPath ?? '')) {
  const [{ renderRecipe }, { makeReportEngine }, compiled, { setReportEngine }] = await Promise.all([
    import('document-kit/recipe'),
    import('./engineParts'),
    import('./recipeJson/parts.compiled.json'),
    import('./reportEngine'),
  ])
  setReportEngine(
    makeReportEngine(renderRecipe, compiled.default.parts as unknown as Parameters<typeof makeReportEngine>[1]),
  )
}
