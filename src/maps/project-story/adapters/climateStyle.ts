import type { ProjectStoryClimateDef } from '@/lib/projectPackages'

export function climateColor(value: number, style: ProjectStoryClimateDef): [number, number, number, number] {
  const index = style.breaks
    ? style.breaks.filter((edge) => value >= edge).length
    : Math.max(
        0,
        Math.min(
          style.colors.length - 1,
          Math.floor(((value - style.domain[0]) / (style.domain[1] - style.domain[0])) * style.colors.length),
        ),
      )
  const hex = style.colors[index].slice(1)
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), 255]
}

export function climateLegend(style: ProjectStoryClimateDef) {
  const number = (value: number) => new Intl.NumberFormat('en-CA', { maximumFractionDigits: 2 }).format(value)
  const edge = (index: number) =>
    number(
      style.breaks
        ? style.breaks[index - 1]
        : style.domain[0] + ((style.domain[1] - style.domain[0]) * index) / style.colors.length,
    )
  return style.colors.map((color, index) => ({
    color,
    label: `${index === 0 ? `< ${edge(1)}` : index === style.colors.length - 1 ? `≥ ${edge(index)}` : `${edge(index)} to < ${edge(index + 1)}`} ${style.units}`,
  }))
}
