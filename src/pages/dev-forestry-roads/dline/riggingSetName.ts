/**
 * How long a rigging set's name may be, in a module of its own so `dline/riggingSets.ts` and the
 * equipment library (`cableEquipment/cableEquipment.ts`), which import each other's functions, need
 * no constant from one another at load time. Pure: no DOM or network.
 */
export const MAX_RIGGING_SET_NAME = 80
