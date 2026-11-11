/**
 * A terrain's name without the bounding box some sources append (the regional DEM adds
 * "-120.488,50.828,…"). Readouts show this; keep the full name in a title or the report.
 */
export function terrainDisplayName(name: string) {
  return name
    .split(' · ')
    .filter((part) => !/^[-\d.,\s]+$/.test(part))
    .join(' · ')
}

/** A terrain's cell size for a readout: "23 m cells", "1 m cells", "0.5 m cells". */
export function terrainCellLabel(resolutionM: number) {
  const size = resolutionM >= 10 ? Math.round(resolutionM) : Number(resolutionM.toPrecision(2))
  return `${size} m cells`
}
