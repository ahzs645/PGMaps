interface AddressSource {
  address?: string | null
  full_address?: string | null
}

/**
 * HealthSpace fills missing address parts with "N/A" (e.g. a missing postal
 * code gives "2825 12th Avenue, Prince George, N/A"). Drop those parts so a
 * placeholder never reads as part of the address.
 */
export function cleanAddress(value: string | null | undefined): string {
  return (value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part && part.toUpperCase() !== 'N/A')
    .join(', ')
}

/** The fullest clean address available for an establishment. */
export function formatFullAddress(restaurant: AddressSource): string {
  return cleanAddress(restaurant.full_address) || cleanAddress(restaurant.address)
}
