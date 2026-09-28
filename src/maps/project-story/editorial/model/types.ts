import type { ProjectSceneDef, ProjectStoryLayerDef } from '@/lib/projectPackages'
export interface Category {
  id: string
  label: string
  color: string
}
export type Inline = string | { text: string; strong?: boolean; emphasis?: boolean; href?: string; actionId?: string }
export type CopyBlock =
  | { id: string; type: 'paragraph' | 'heading' | 'quote'; text: Inline[] }
  | { id: string; type: 'list'; items: Inline[][] }
  | { id: string; type: 'separator' }
export interface ImageMedia {
  type: 'image'
  src: string
  alt: string
  caption?: string
  credit?: string
  expandable?: boolean
}
export interface MapMedia {
  type: 'map'
  mapId: string
  viewId: string
}
export interface DiagramMedia {
  type: 'diagram'
  diagramId: string
  stepId?: string
}
export interface ComparisonMedia {
  type: 'comparison'
  mapId: string
  leftViewId: string
  rightViewId: string
  leftLabel: string
  rightLabel: string
}
export type Media = ImageMedia | MapMedia | DiagramMedia | ComparisonMedia
export type Block =
  | CopyBlock
  | ({ id: string } & Media)
  | { id: string; type: 'carousel'; items: ImageMedia[] }
  | {
      id: string
      type: 'sidecar'
      presentation: 'docked' | 'floating'
      side?: 'left' | 'right' | 'center'
      width?: 'medium' | 'large'
      steps: { id: string; content: CopyBlock[]; media: Media }[]
    }
  | {
      id: string
      type: 'tour'
      mapId: string
      stops: {
        id: string
        label: string
        coordinates: [number, number]
        viewId: string
        media: ImageMedia
        content: CopyBlock[]
      }[]
    }
  | { id: string; type: 'credits'; text: Inline[] }
export interface NativeMapDefinition {
  layers: ProjectStoryLayerDef[]
  categoryProperty?: string
  attribution: string
}
export interface NativeView extends Pick<
  ProjectSceneDef,
  'camera' | 'visibleLayerIds' | 'highlights' | 'layerOverrides' | 'legend'
> {
  mapId: string
}
export interface HierarchyNode {
  id: string
  parentId?: string
  label: string
  categoryId?: string
}
export interface DotPoint {
  id: string
  x: number
  y: number
  categoryId: string
}
export interface DotStep {
  id: string
  label: string
  categoryIds?: string[]
  region?: { x: number; y: number; radius: number }
}
export type Diagram =
  | { type: 'radial-hierarchy'; title: string; description: string; nodes: HierarchyNode[] }
  | {
      type: 'category-dots'
      title: string
      description: string
      mode: 'illustrative' | 'measured'
      unit: string
      points: DotPoint[]
      steps: DotStep[]
    }
export type Action =
  | { type: 'select-category'; categoryId: string | null }
  | { type: 'set-map-view'; targetId: string; viewId: string }
  | { type: 'go-to-chapter'; chapterId: string }
export interface NativeEditorialDocument {
  schema: 'pgmaps-editorial-v1'
  title: string
  cover?: { title: string; summary?: string; byline?: string; poster?: string; video?: string }
  categories: Category[]
  maps: Record<string, NativeMapDefinition>
  views: Record<string, NativeView>
  diagrams: Record<string, Diagram>
  actions: Record<string, Action>
  chapters: { id: string; title: string; blocks: Block[] }[]
}
