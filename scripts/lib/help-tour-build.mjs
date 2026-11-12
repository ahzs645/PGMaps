import { createHash } from 'node:crypto'
import postcss from 'postcss'

const start = '/* pgmaps-capture-guards:start */'
const end = '/* pgmaps-capture-guards:end */'

export function rebuildPortableGuards(runtime, guards) {
  let from = runtime.indexOf(start)
  let through = runtime.indexOf(end)
  if (from >= 0 && through > from) through += end.length
  else {
    // The imported TourKit player is an opaque, licensed export. Replace only its
    // known capture-parser module; keep replay isolation, asset sanitization and UI.
    from = runtime.indexOf('var td=Object.freeze({maxBytes:67108864,')
    through = runtime.indexOf("var _w=\"default-src 'none';", from)
    const digest = createHash('sha256').update(runtime.slice(from, through)).digest('hex')
    if (from < 0 || through <= from || digest !== '7e673f03bf1084e40ebac21e0cb2082a3aeff89f04e1d2170cf13d1facc534c1')
      throw Error('Unrecognized TourKit runtime. Review its parser boundaries before rebuilding.')
  }
  const rebuilt =
    runtime.slice(0, from) +
    start +
    '\n' +
    guards +
    '\nvar Bs=PGMapsCapture.parseCapture,td=PGMapsCapture.captureLimits;\n' +
    end +
    runtime.slice(through)
  if (/\bZod(?:Type|Error)\b/.test(rebuilt)) throw Error('A schema runtime remains in the portable lesson player.')
  return rebuilt
}

export function helpRadiusTokens(appCss) {
  const values = []
  postcss.parse(appCss).walkDecls('--radius', (declaration) => values.push(declaration.value))
  if (values.length !== 1) throw Error('Expected one shared --radius value in src/index.css.')
  return `/* Generated from src/index.css by scripts/brand-help-tours.mjs. */\n:root { --radius: ${values[0]}; }\n`
}

export function tokenizedPlayerCss(css) {
  const root = postcss.parse(css)
  root.walkDecls(/^border(?:-(?:top|bottom)-(?:left|right))?-radius$/, (declaration) => {
    if (declaration.value.includes('var(--radius)')) return
    // Normalize the legacy player's corners to the same small/control/card scale.
    declaration.value = declaration.value.replace(/\b(\d+(?:\.\d+)?)px\b/g, (_, value) => {
      const size = Number(value)
      if (size === 0) return '0'
      if (size <= 5) return 'calc(var(--radius) - 4px)'
      if (size <= 7) return 'calc(var(--radius) - 2px)'
      if (size <= 10) return 'var(--radius)'
      if (size <= 14) return 'calc(var(--radius) + 4px)'
      return 'calc(var(--radius) + 8px)'
    })
  })
  return root.toString()
}
