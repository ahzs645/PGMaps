/** An explicitly reconstructed title study. This is not a recovered official logo master. */
import type { ElementDef } from './symbols'

const GLYPHS: Record<string, { width: number; svg: string }> = {
  A: { width: 78, svg: '<path fill-rule="evenodd" d="M0 100L29 0H49L78 100H57L50 77H27L20 100ZM33 59H44L38 36Z"/>' },
  C: {
    width: 79,
    svg: '<path d="M71 16C54 2 23 3 13 28C-2 66 17 99 45 93C57 92 66 88 72 83" fill="none" stroke="currentColor" stroke-width="18"/>',
  },
  E: { width: 64, svg: '<path d="M0 0H63V18H19V40H57V58H19V82H64V100H0Z"/>' },
  F: { width: 63, svg: '<path d="M0 0H63V18H19V41H56V60H19V100H0Z"/>' },
  I: { width: 19, svg: '<path d="M0 0H19V100H0Z"/>' },
  K: { width: 76, svg: '<path d="M0 0H19V40L51 0H76L37 47L78 100H53L19 55V100H0Z"/>' },
  N: { width: 78, svg: '<path d="M0 100V0H19L59 65V0H78V100H59L19 35V100Z"/>' },
  O: {
    width: 85,
    svg: '<path fill-rule="evenodd" d="M42.5-2C16-2 0 18 0 50S16 102 42.5 102S85 82 85 50S69-2 42.5-2ZM42.5 17C58 17 65 30 65 50S58 83 42.5 83S20 70 20 50S27 17 42.5 17Z"/>',
  },
  R: {
    width: 75,
    svg: '<path fill-rule="evenodd" d="M0 100V0H35C61 0 72 10 72 31C72 45 65 53 54 57L79 100H55L33 61H19V100ZM19 18V43H34C46 43 52 39 52 31S46 18 34 18Z"/>',
  },
  S: {
    width: 66,
    svg: '<path d="M61 15C43 2 13 7 12 25C9 49 58 44 58 73C60 95 27 104 3 87" fill="none" stroke="currentColor" stroke-width="19"/>',
  },
  T: { width: 72, svg: '<path d="M0 0H72V19H46V100H26V19H0Z"/>' },
}

function blockWord(text: string, x: number, y: number, width: number, height: number): string {
  let cursor = 0
  const shapes = [...text].map((letter) => {
    const glyph = GLYPHS[letter]
    const svg = `<g transform="translate(${cursor} 0)">${glyph.svg}</g>`
    cursor += glyph.width + 9
    return svg
  })
  return `<g aria-label="${text}" transform="translate(${x} ${y}) scale(${width / (cursor - 9)} ${height / 100})">${shapes.join('')}</g>`
}

export const TITLE_STUDY: ElementDef = {
  id: 'title-study',
  title: 'Rainforest to Rockies title study',
  category: 'navigation',
  width: 460,
  height: 150,
  sourceBox: [1057, 65, 460, 150],
  construction:
    'Constructed block lettering, rounded diamond and three mountain/tree chevrons. A reconstruction study; an official logo master has not been recovered from these files.',
  svg: `<g fill="#00392F" color="#00392F">${blockWord('RAINFOREST', 0, 0, 418, 52)}${blockWord('TO', 0, 61, 44, 23)}${blockWord('ROCKIES', 52, 60, 294, 55)}</g>
    <g transform="translate(365 63)"><path d="M43 0Q48 0 57 9L82 35Q90 44 82 53L57 79Q44 93 32 81L6 56Q-5 44 5 32L31 6Q36 0 43 0Z" fill="#B0BD36"/>
    <g fill="none" stroke="#00392F" stroke-width="5" stroke-linejoin="round"><path d="M10 43Q24 34 43 13Q62 34 77 43"/><path d="M18 54Q29 45 43 30Q57 46 68 54"/><path d="M26 65L43 47L60 65"/><path d="M43 31V78"/></g></g>`,
}
