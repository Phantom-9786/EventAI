export function getDirectionsUrl(destination: {
  name: string;
  address: string;
  city: string;
  state: string;
  country?: string;
  latitude?: number | null;
  longitude?: number | null;
}): string {
  const coordinates =
    destination.latitude != null && destination.longitude != null
      ? `${destination.latitude},${destination.longitude}`
      : null;
  const query = coordinates
    ?? [destination.name, destination.address, destination.city, destination.state, destination.country]
      .filter(Boolean)
      .join(', ');
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}`;
}
