import { useState, useCallback } from 'react'

type GeolocationStatus = 'idle' | 'loading' | 'success' | 'denied' | 'unavailable' | 'timeout' | 'unsupported'

interface Position {
  lat: number
  lng: number
}

function getErrorMessage(err: GeolocationPositionError): string {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return 'Location permission denied. Please enable location access in your browser settings.'
    case err.POSITION_UNAVAILABLE:
      return 'Location information unavailable.'
    case err.TIMEOUT:
      return 'Location request timed out. Please try again.'
    default:
      return 'An error occurred while getting your location.'
  }
}

function getErrorStatus(err: GeolocationPositionError): GeolocationStatus {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return 'denied'
    case err.POSITION_UNAVAILABLE:
      return 'unavailable'
    case err.TIMEOUT:
      return 'timeout'
    default:
      return 'unavailable'
  }
}

export function useGeolocation() {
  const [position, setPosition] = useState<Position | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<GeolocationStatus>('idle')

  const getCurrentPosition = useCallback(async (): Promise<Position | null> => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser.')
      setStatus('unsupported')
      return null
    }

    setLoading(true)
    setError(null)
    setStatus('loading')

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const newPosition = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude
          }
          setPosition(newPosition)
          setLoading(false)
          setStatus('success')
          setError(null)
          resolve(newPosition)
        },
        (err) => {
          setError(getErrorMessage(err))
          setStatus(getErrorStatus(err))
          setLoading(false)
          resolve(null)
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 300000
        }
      )
    })
  }, [])

  const clearPosition = useCallback(() => {
    setPosition(null)
    setError(null)
    setStatus('idle')
  }, [])

  return {
    position,
    error,
    loading,
    status,
    getCurrentPosition,
    clearPosition
  }
}
