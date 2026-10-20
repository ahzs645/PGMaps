import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Eye, Layers, Sprout, TreePine, Trees } from 'lucide-react'

import { DevCard, type DevEntry } from '@/components/dev/DevCard'

const forestryTools: DevEntry[] = [
  {
    title: 'AVAST volume',
    description:
      'Run the AVAST volume procedure on candidate blocks: intersect with TimberAnalysis_Base, LiDAR factor, slope classes, and an optional VRI fill for the gaps. Exports the planning workbook, paste-ready rows and a File Geodatabase.',
    href: '/dev/forestry/avast-volume',
    icon: Layers,
    color: 'bg-emerald-700',
    label: '/dev/forestry/avast-volume',
  },
  {
    title: 'Visual quality',
    description:
      'Set a visual quality objective, drop in cutblock shapefiles, and get the share of each block a road can actually see over the terrain, then drive the road in 3D.',
    href: '/dev/forestry/visual-quality',
    icon: Eye,
    color: 'bg-emerald-700',
    label: '/dev/forestry/visual-quality',
  },
  {
    title: 'CCISS suitability',
    description: 'Inspect CCISS historical suitability tiles and exact numeric GeoTIFF cells for a selected BC location.',
    href: '/dev/forestry/cciss-suitability',
    icon: Sprout,
    color: 'bg-emerald-700',
    label: '/dev/forestry/cciss-suitability',
  },
  {
    title: 'LiDAR forestry',
    description: 'Review openings, plot statistics and stand structure from the LiDAR sample: gaps, plots, texture, edges and vegetation proximity.',
    href: '/dev/lidar/forestry/',
    icon: Trees,
    color: 'bg-cyan-700',
    label: '/dev/lidar/forestry',
  },
  {
    title: 'LiDAR canopy',
    description: 'Explore canopy height, density and vertical layers from the LiDAR sample, with heatmaps and 1 m height profiles.',
    href: '/dev/lidar/canopy/',
    icon: TreePine,
    color: 'bg-cyan-700',
    label: '/dev/lidar/canopy',
  },
]

export default function DevForestry() {
  useEffect(() => {
    const previous = document.title
    document.title = 'Forestry tools · PGMaps Dev'
    return () => { document.title = previous }
  }, [])
  return (
    <div className="min-h-full bg-gradient-to-b from-background to-muted/30">
      <div className="container mx-auto px-4 pb-8 pt-24 sm:px-6 sm:pb-12 sm:pt-28 md:py-12">
        <div className="mb-8 sm:mb-10">
          <Link to="/dev" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            Dev library
          </Link>
          <div className="mb-3 flex w-fit items-center gap-2 rounded-md border bg-background px-3 py-1 text-sm font-medium text-muted-foreground">
            <TreePine className="h-4 w-4" />
            Forestry
          </div>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Forestry tools</h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
            Planning utilities for cutblocks and stands: volume, visual quality, climate suitability and LiDAR structure.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {forestryTools.map((entry) => (
            <DevCard key={entry.href} {...entry} />
          ))}
        </div>
      </div>
    </div>
  )
}
