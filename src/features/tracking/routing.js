import { haversineMeters, isValidPoint } from './geo.js';

/**
 * Road routing for the live tracker, behind one function: getRoute(from, to).
 *
 * The app never talks to a routing provider directly — the server does, so no
 * provider key ships in the APK and one cache serves every viewer of an order.
 *
 * Any OSRM-compatible server works (ROUTING_BASE_URL). If it is unset, slow or
 * down, callers still get an answer: a straight-line estimate flagged
 * `source: 'estimate'`, so the map degrades instead of breaking. The public
 * OSRM demo server is used outside production only — its usage policy forbids
 * production traffic, so production must set ROUTING_BASE_URL to its own.
 */

const DEMO_OSRM = 'https://router.project-osrm.org';
const REQUEST_TIMEOUT_MS = 3000;
const FAILURES_BEFORE_OPEN = 5;
const BREAKER_OPEN_MS = 30 * 1000;
const CACHE_MAX_ENTRIES = 500;
// Straight-line fallback assumes ~20 km/h city riding, and inflates the
// crow-flies distance because roads are never straight.
const ESTIMATE_SPEED_MPS = 20 / 3.6;
const ESTIMATE_DETOUR_FACTOR = 1.3;

const baseUrl = () => {
  const configured = (process.env.ROUTING_BASE_URL || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  return process.env.NODE_ENV === 'production' ? '' : DEMO_OSRM;
};

const cache = new Map(); // key -> { expires, route }
const inflight = new Map(); // key -> Promise<route>
let consecutiveFailures = 0;
let breakerOpenUntil = 0;

const round = (n, places) => n.toFixed(places);
const cacheKey = (from, to, fromPlaces) =>
  `${round(from.lat, fromPlaces)},${round(from.lng, fromPlaces)}>${round(to.lat, 5)},${round(to.lng, 5)}`;

export function estimateRoute(from, to) {
  const distanceMeters = Math.round(haversineMeters(from, to) * ESTIMATE_DETOUR_FACTOR);
  return {
    points: [[from.lat, from.lng], [to.lat, to.lng]],
    distanceMeters,
    durationSeconds: Math.round(distanceMeters / ESTIMATE_SPEED_MPS),
    source: 'estimate'
  };
}

async function fetchRoadRoute(from, to) {
  const url =
    `${baseUrl()}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}` +
    '?overview=full&geometries=geojson&alternatives=false&steps=false';
  const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`routing HTTP ${res.status}`);
  const body = await res.json();
  const route = body?.routes?.[0];
  const coords = route?.geometry?.coordinates;
  if (body?.code !== 'Ok' || !Array.isArray(coords) || coords.length < 2) {
    throw new Error(`routing returned ${body?.code ?? 'no route'}`);
  }
  return {
    points: coords.map(([lng, lat]) => [lat, lng]),
    distanceMeters: Math.round(route.distance),
    durationSeconds: Math.round(route.duration),
    source: 'road'
  };
}

function remember(key, route, ttlMs) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Maps iterate in insertion order, so this evicts the oldest entry.
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, { expires: Date.now() + ttlMs, route });
}

/**
 * @param {{lat:number,lng:number}} from
 * @param {{lat:number,lng:number}} to
 * @param {{ttlMs?:number, fromPrecision?:number}} [opts]
 *   ttlMs — how long a result may be reused (static legs can use minutes).
 *   fromPrecision — decimals the origin is rounded to for cache sharing
 *   (4 ≈ 11 m, right for a moving rider; 5 for fixed points).
 * @returns {Promise<{points:number[][],distanceMeters:number,durationSeconds:number,source:'road'|'estimate'}>}
 */
export async function getRoute(from, to, { ttlMs = 15000, fromPrecision = 4 } = {}) {
  if (!isValidPoint(from) || !isValidPoint(to)) return null;

  const key = cacheKey(from, to, fromPrecision);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.route;

  if (!baseUrl() || Date.now() < breakerOpenUntil) return estimateRoute(from, to);

  // Concurrent callers for the same leg share one upstream request.
  if (inflight.has(key)) return inflight.get(key);

  const pending = (async () => {
    try {
      const route = await fetchRoadRoute(from, to);
      consecutiveFailures = 0;
      remember(key, route, ttlMs);
      return route;
    } catch (err) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= FAILURES_BEFORE_OPEN) {
        breakerOpenUntil = Date.now() + BREAKER_OPEN_MS;
        consecutiveFailures = 0;
        console.warn(`[Routing] ${FAILURES_BEFORE_OPEN} failures in a row (${err.message}); using estimates for ${BREAKER_OPEN_MS / 1000}s.`);
      }
      // An estimate is cached only briefly so a recovered provider is used soon.
      const fallback = estimateRoute(from, to);
      remember(key, fallback, 3000);
      return fallback;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, pending);
  return pending;
}

/** Test hook: clears cache and breaker state. */
export function _resetRoutingForTests() {
  cache.clear();
  inflight.clear();
  consecutiveFailures = 0;
  breakerOpenUntil = 0;
}
