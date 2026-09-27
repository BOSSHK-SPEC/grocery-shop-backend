/** Small geo helpers shared by the live-tracking modules. */

const EARTH_RADIUS_M = 6371000;
const toRad = (deg) => (deg * Math.PI) / 180;

/** A usable coordinate: finite, in range, and not the (0,0) "no fix" placeholder. */
export function isValidPoint(p) {
  if (!p) return false;
  const lat = Number(p.lat);
  const lng = Number(p.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  return !(lat === 0 && lng === 0);
}

/**
 * Reads { latitude, longitude } (as stored on Address/User rows or in a JSON
 * snapshot, where the values may be strings) into { lat, lng }, or null when
 * the row has no usable coordinate.
 */
export function pointFrom(row) {
  if (!row) return null;
  const p = { lat: Number(row.latitude), lng: Number(row.longitude) };
  return isValidPoint(p) ? p : null;
}

/** Great-circle distance in metres. */
export function haversineMeters(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
