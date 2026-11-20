import { Component, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/** A map startup failure must leave the road's other views and controls available. */
export class PlanViewBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error('The plan map could not start.') }
  }

  render() {
    const error = this.state.error
    if (!error) return this.props.children
    const reason = /webgl|gpuinitialization/i.test(`${error.name} ${error.message}`)
      ? 'WebGL 2 graphics are unavailable in this browser, so the plan map cannot start.'
      : 'The plan map could not start.'
    return (
      <div
        role="alert"
        data-testid="road-plan-unavailable"
        className="flex h-full min-h-0 flex-col items-center justify-center gap-3 overflow-auto p-6 text-center"
      >
        <h3 className="text-sm font-semibold">Plan map unavailable</h3>
        <p className="max-w-md text-sm text-muted-foreground">{reason}</p>
        <p className="max-w-md text-xs text-muted-foreground">
          You can continue using the profile, section, data and design controls.
        </p>
        <Button size="sm" variant="outline" onClick={() => this.setState({ error: null })}>
          Retry map
        </Button>
      </div>
    )
  }
}
