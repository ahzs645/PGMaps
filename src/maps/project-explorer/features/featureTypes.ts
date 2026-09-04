import type { ProjectExplorerFeatureDef } from '@/lib/projectPackages'

export type ExplorerFeature<T extends ProjectExplorerFeatureDef['type']> = Extract<
  ProjectExplorerFeatureDef,
  { type: T }
>
