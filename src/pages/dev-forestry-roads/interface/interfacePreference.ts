/**
 * Which interface the road designer opens in: the shared rule (`interfacePreference.ts`) under the
 * road's own key, `pgmaps-road-interface`, defaulting to the Ribbon (which opens on the linked plan,
 * profile and cross-section panels).
 */
import { interfacePreferences } from '@/components/interfaces/interfacePreference'

export { workspaceHelpSearch } from '@/components/interfaces/interfacePreference'

/** The built-in layout used when the served catalog cannot be read (`workspaceLayouts.ts`). */
export const DEFAULT_INTERFACE_NAME = 'Guided mode'

export const roadInterfaces = interfacePreferences('road', 'ribbon')
export const { initialInterfaceId, readStoredInterface, storeInterface } = roadInterfaces
