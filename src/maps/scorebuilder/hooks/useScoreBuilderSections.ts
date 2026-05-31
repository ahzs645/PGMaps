import { useCallback, useEffect, useRef, useState } from 'react'

export type ScoreBuilderSectionId =
  | 'examples'
  | 'setup'
  | 'dataSources'
  | 'equation'
  | 'methodology'
  | 'model'
  | 'robustness'
  | 'density'
  | 'regions'

export type ExpandedSectionsState = Record<ScoreBuilderSectionId, boolean>

export const SCORE_BUILDER_SECTION_ORDER: ScoreBuilderSectionId[] = [
  'examples',
  'setup',
  'dataSources',
  'equation',
  'methodology',
  'model',
  'robustness',
  'density',
  'regions',
]

export const SCORE_BUILDER_SECTION_LABELS: Record<ScoreBuilderSectionId, string> = {
  examples: 'Examples',
  setup: 'Setup',
  dataSources: 'Data Sources',
  equation: 'Equation',
  methodology: 'Method',
  model: 'Model',
  robustness: 'Robust',
  density: 'Density',
  regions: 'Regions',
}

function createExpandedSections(): ExpandedSectionsState {
  return {
    examples: true,
    setup: false,
    dataSources: false,
    equation: false,
    methodology: false,
    model: false,
    robustness: false,
    density: false,
    regions: true,
  }
}

export function useScoreBuilderSections(_isDesktop: boolean) {
  const [expandedSections, setExpandedSections] = useState<ExpandedSectionsState>(() => createExpandedSections())
  const [activeSection, setActiveSection] = useState<ScoreBuilderSectionId>('examples')
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const sectionRefs = useRef<Record<ScoreBuilderSectionId, HTMLElement | null>>({
    examples: null,
    setup: null,
    dataSources: null,
    equation: null,
    methodology: null,
    model: null,
    robustness: null,
    density: null,
    regions: null,
  })

  const evaluateActiveSection = useCallback(() => {
    const root = scrollContainerRef.current
    if (!root) return
    const referenceTop = root.scrollTop + 120
    let candidate: ScoreBuilderSectionId = SCORE_BUILDER_SECTION_ORDER[0]
    SCORE_BUILDER_SECTION_ORDER.forEach((id) => {
      const section = sectionRefs.current[id]
      if (!section) return
      if (section.offsetTop <= referenceTop) candidate = id
    })
    setActiveSection(candidate)
  }, [])

  useEffect(() => {
    const root = scrollContainerRef.current
    if (!root) return
    const observer = new IntersectionObserver(() => evaluateActiveSection(), {
      root,
      threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
    })
    SCORE_BUILDER_SECTION_ORDER.forEach((id) => {
      const section = sectionRefs.current[id]
      if (section) observer.observe(section)
    })
    const handleScroll = () => evaluateActiveSection()
    root.addEventListener('scroll', handleScroll, { passive: true })
    const frame = requestAnimationFrame(evaluateActiveSection)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      root.removeEventListener('scroll', handleScroll)
    }
  }, [evaluateActiveSection])

  const setSectionRef = useCallback((sectionId: ScoreBuilderSectionId, element: HTMLElement | null) => {
    sectionRefs.current[sectionId] = element
  }, [])

  const toggleSection = useCallback((sectionId: ScoreBuilderSectionId) => {
    setExpandedSections((current) => ({ ...current, [sectionId]: !current[sectionId] }))
  }, [])

  const scrollToSection = useCallback((sectionId: ScoreBuilderSectionId) => {
    const root = scrollContainerRef.current
    if (!root || !sectionRefs.current[sectionId]) return
    setExpandedSections((current) => ({ ...current, [sectionId]: true }))
    setActiveSection(sectionId)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const nextSection = sectionRefs.current[sectionId]
        if (!nextSection) return
        root.scrollTo({ top: Math.max(0, nextSection.offsetTop - 62), behavior: 'smooth' })
      })
    })
  }, [])

  return {
    activeSection,
    expandedSections,
    scrollContainerRef,
    scrollToSection,
    setSectionRef,
    toggleSection,
  }
}
