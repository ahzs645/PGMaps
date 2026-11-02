/**
 * The toolkit scopes its stylesheet to map workspaces as `.geo-toolkit .hidden`,
 * one class heavier than our own `.hidden` or `md:block`. On our markup inside
 * a workspace, the toolkit's base utility then beats our responsive one, so
 * `hidden md:block` stays hidden at every width.
 *
 * Give each of our Tailwind utilities a second selector with the same prefix.
 * Inside a workspace our utility ties the toolkit's and wins by coming later;
 * outside one nothing changes, so our hand-written CSS keeps its place. Only
 * rules Tailwind generated (it marks them in `raws.tailwind`) are touched.
 */
const PREFIX = '.geo-toolkit'

export default function workspaceUtilities() {
  return {
    postcssPlugin: 'pgmaps-workspace-utilities',
    OnceExit(root) {
      root.walkRules((rule) => {
        const generated = rule.raws.tailwind
        if (!generated || generated.layer === 'base' || generated.layer === 'components') return
        if (rule.parent?.type === 'atrule' && /keyframes$/.test(rule.parent.name)) return
        const scoped = rule.selectors.map((selector) => `${PREFIX} ${selector}`)
        rule.selectors = [...rule.selectors, ...scoped]
      })
    },
  }
}
workspaceUtilities.postcss = true
