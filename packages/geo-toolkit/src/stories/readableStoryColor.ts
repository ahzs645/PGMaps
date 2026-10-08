/** Darken authored text colors only as needed for contrast on a white reading surface. */
export function readableStoryColor(hex: string) {
  const rgb = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16))
  const luminance = () =>
    rgb
      .map((value) => {
        const c = value / 255
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      })
      .reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0)
  while (1.05 / (luminance() + 0.05) < 4.5) for (let i = 0; i < rgb.length; i++) rgb[i] = Math.floor(rgb[i] * 0.9)
  return `#${rgb.map((value) => value.toString(16).padStart(2, '0')).join('')}`
}
