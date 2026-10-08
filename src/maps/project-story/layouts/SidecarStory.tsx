import { ProjectBackButton } from '@/components/projects/ProjectBackButton'
import {
  SidecarStory as ToolkitSidecarStory,
  type SidecarStoryProps as ToolkitProps,
} from '@pgmaps/geo-toolkit/stories/scenes/SidecarStory'
import './SidecarStory.css'
export type SidecarMapAction = import('@pgmaps/geo-toolkit/stories/scenes/SidecarStory').SidecarMapAction
export type SidecarStoryProps = Omit<ToolkitProps, 'back'> & { onBack: () => void }
export function SidecarStory({ onBack, ...props }: SidecarStoryProps) {
  return <ToolkitSidecarStory {...props} back={<ProjectBackButton onBack={onBack} className="shrink-0" />} />
}
