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
