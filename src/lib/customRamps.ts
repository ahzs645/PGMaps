import { createCustomRampStore } from '@pgmaps/geo-toolkit/ui/custom-ramps'

/**
 * The colour ramps a person has made, kept in this browser and offered by every ramp picker that
 * is given this store. A style that uses one carries the ramp's colours itself (`rampColors` on a
 * classed colour style), so it still draws in a browser that has never seen the ramp.
 */
export const customRampStore = createCustomRampStore('pgmaps:color-ramps')
