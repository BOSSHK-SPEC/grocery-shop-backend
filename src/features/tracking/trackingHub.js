/**
 * In-memory pub/sub for live order tracking.
 *
 * One "room" per order id holds the sockets currently watching it. This is
 * deliberately in-process: the backend runs as a single pm2 process (see
 * rateLimit.js). Scaling to several instances means swapping this module's
 * publish/subscribe for Redis pub/sub — nothing outside this file knows how
 * delivery to sockets works.
 */

const OPEN = 1;
export const MAX_SUBSCRIPTIONS_PER_SOCKET = 5;
const RIDER_LOCATION_TTL_MS = 10 * 60 * 1000;

const rooms = new Map(); // orderId -> Set<ws>
const riderLocations = new Map(); // riderId -> { lat, lng, heading, speed, at(ms) }

export function subscribe(orderId, ws) {
  if (!ws.trackedOrders) ws.trackedOrders = new Set();
  if (!ws.trackedOrders.has(orderId) && ws.trackedOrders.size >= MAX_SUBSCRIPTIONS_PER_SOCKET) {
    return false;
  }
  if (!rooms.has(orderId)) rooms.set(orderId, new Set());
  rooms.get(orderId).add(ws);
  ws.trackedOrders.add(orderId);
  return true;
}

export function unsubscribe(orderId, ws) {
  const room = rooms.get(orderId);
  if (room) {
    room.delete(ws);
    if (room.size === 0) rooms.delete(orderId);
  }
  ws.trackedOrders?.delete(orderId);
}

export function unsubscribeAll(ws) {
  if (!ws.trackedOrders) return;
  for (const orderId of [...ws.trackedOrders]) unsubscribe(orderId, ws);
}

export const hasSubscribers = (orderId) => (rooms.get(orderId)?.size ?? 0) > 0;
export const hasAnySubscribers = () => rooms.size > 0;

/** Sends to every open socket in the room. A socket that throws is dropped. */
export function publish(orderId, payload) {
  const room = rooms.get(orderId);
  if (!room) return;
  const message = JSON.stringify(payload);
  for (const ws of room) {
    if (ws.readyState !== OPEN) continue;
    try {
      ws.send(message);
    } catch (err) {
      console.error('[Tracking] send failed:', err.message);
    }
  }
}

/** Ends an order's room once it is finished; sockets stay open for other orders. */
export function closeRoom(orderId) {
  const room = rooms.get(orderId);
  if (!room) return;
  for (const ws of room) ws.trackedOrders?.delete(orderId);
  rooms.delete(orderId);
}

export function setRiderLocation(riderId, loc) {
  riderLocations.set(String(riderId), { ...loc, at: loc.at ?? Date.now() });
}

export function getRiderLocation(riderId) {
  const key = String(riderId);
  const loc = riderLocations.get(key);
  if (!loc) return null;
  if (Date.now() - loc.at > RIDER_LOCATION_TTL_MS) {
    riderLocations.delete(key);
    return null;
  }
  return loc;
}

export function _resetHubForTests() {
  rooms.clear();
  riderLocations.clear();
}
