/**
 * The DataBC WFS reads moved to shared code (`src/lib/forestry/wfsReads.ts`), so the visual quality
 * page's land status checks read through them too. The planner's modules keep importing from here.
 */
export * from '@/lib/forestry/wfsReads'
