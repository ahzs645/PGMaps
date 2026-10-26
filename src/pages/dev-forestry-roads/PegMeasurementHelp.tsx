import { InfoTip } from '@/components/ui/info-tip'

/** Short, keyboard-accessible help that also opens on touch. */
export function PegMeasurementHelp() {
  return (
    <InfoTip label="About peg measurements" showLabel>
      HD and grade describe straight peg-to-peg legs. Editing a distance or bearing moves that peg; adjacent legs and
      the fitted road recalculate. Ground-grade search changes the bearing, preserving leg length. Design PVIs remain
      separate.
    </InfoTip>
  )
}
