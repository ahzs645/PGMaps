declare module 'brandkit/consumer' {
  export function consumerProfile(context: { brand: Record<string, unknown>; fonts: unknown }): unknown
}
declare module 'brandkit/fonts' {
  export function loadBrandFonts(
    brand: Record<string, unknown>,
    read: (path: string) => Promise<ArrayBuffer>,
  ): Promise<{
    failures: { key: string; file: string; error: Error }[]
  }>
}
declare module 'brandkit/pack/host' {
  export const brandDefinitions: typeof import('../../vendor/brandkit/src/pack/host').brandDefinitions
  export const inspectBrandFiles: typeof import('../../vendor/brandkit/src/pack/host').inspectBrandFiles
  export const packMemberPath: typeof import('../../vendor/brandkit/src/pack/host').packMemberPath
}
