import calmWindIconUrl from '../assets/wind-barbs/calm_wind_icon.svg?url'
import fiveKnotsIconUrl from '../assets/wind-barbs/5_knots_icon.svg?url'
import fifteenKnotsIconUrl from '../assets/wind-barbs/15_knots_icon.svg?url'
import twentyKnotsIconUrl from '../assets/wind-barbs/20_knots_icon.svg?url'
import twentyFiveKnotsIconUrl from '../assets/wind-barbs/25_knots_icon.svg?url'
import fiftyFiveKnotsIconUrl from '../assets/wind-barbs/55_knots_icon.svg?url'

export type WindBarbIconKey = 'calm' | '5' | '15' | '20' | '25' | '55'

export type WindBarbIconDefinition = {
  key: WindBarbIconKey
  speedKnots: number
  labelKey: string
  src: string
}

export const WIND_BARB_ICON_DEFINITIONS = [
  {
    key: 'calm',
    speedKnots: 0,
    labelKey: 'windBarbs.legend.calm',
    src: calmWindIconUrl,
  },
  {
    key: '5',
    speedKnots: 5,
    labelKey: 'windBarbs.legend.5kt',
    src: fiveKnotsIconUrl,
  },
  {
    key: '15',
    speedKnots: 15,
    labelKey: 'windBarbs.legend.15kt',
    src: fifteenKnotsIconUrl,
  },
  {
    key: '20',
    speedKnots: 20,
    labelKey: 'windBarbs.legend.20kt',
    src: twentyKnotsIconUrl,
  },
  {
    key: '25',
    speedKnots: 25,
    labelKey: 'windBarbs.legend.25kt',
    src: twentyFiveKnotsIconUrl,
  },
  {
    key: '55',
    speedKnots: 55,
    labelKey: 'windBarbs.legend.55kt',
    src: fiftyFiveKnotsIconUrl,
  },
] as const satisfies readonly WindBarbIconDefinition[]

export function windBarbIconForSpeed(speedMetersPerSecond: number) {
  const speedKnots = Math.max(0, speedMetersPerSecond * 1.94384)

  return WIND_BARB_ICON_DEFINITIONS.reduce((closest, candidate) => {
    const currentDelta = Math.abs(speedKnots - closest.speedKnots)
    const candidateDelta = Math.abs(speedKnots - candidate.speedKnots)
    return candidateDelta <= currentDelta ? candidate : closest
  })
}
