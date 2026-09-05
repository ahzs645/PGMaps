import type { ProjectPackage, ProjectKind, ProjectTheme } from '@/lib/projectPackages'
export const THEME_ICON: Record<ProjectTheme, string> = {
  cyan: 'bg-cyan-600',
  amber: 'bg-amber-600',
  emerald: 'bg-emerald-600',
  blue: 'bg-blue-600',
  slate: 'bg-slate-600',
}

export const KIND_LABELS: Record<ProjectKind, string> = {
  'map-story': 'Map story',
  'raster-story': 'Raster story',
  'index-preset': 'Index preset',
  'research-pack': 'Research pack',
}

export function iconClass(project: ProjectPackage): string {
  return THEME_ICON[project.theme]
}
