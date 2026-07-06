import { Component } from 'react'
import type { ReactNode } from 'react'
import { MapPin } from 'lucide-react'

import type { GeocodeResult } from '../types'

export class LocalMapBoundary extends Component<{ children: ReactNode; result: GeocodeResult | null }, { hasError: boolean }> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="flex h-full min-h-[18rem] flex-col items-center justify-center gap-3 bg-slate-100 p-6 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full border bg-white text-slate-500 shadow-sm">
          <MapPin className="h-6 w-6" />
        </span>
        <div>
          <div className="text-sm font-semibold text-slate-900">Map unavailable in this browser session</div>
          <p className="mt-1 max-w-md text-xs leading-5 text-slate-600">
            Address search still runs the same source comparison. Try the map in a browser with WebGL enabled.
          </p>
        </div>
        {this.props.result && (
          <div className="rounded-md border bg-white px-3 py-2 font-mono text-xs text-slate-600 shadow-sm">
            {this.props.result.latitude.toFixed(5)}, {this.props.result.longitude.toFixed(5)}
          </div>
        )}
      </div>
    )
  }
}
