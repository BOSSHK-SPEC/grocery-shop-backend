import { Order, Business, User, Address } from '../../models/index.js';
import { normalizeStatus, labelFor, OrderStatus } from '../order/orderStatus.js';
import { getRoute } from './routing.js';
import { haversineMeters, pointFrom } from './geo.js';
import * as hub from './trackingHub.js';

/**
 * Builds and publishes the "live tracking" view of an order.
 *
 * The customer-facing shape is decided here, in one place, so the REST
 * snapshot and the WebSocket pushes can never disagree:
 *
 *   phase  preparing       store is still packing / no rider yet
 *          rider_to_store  rider assigned, heading to the store
 *          to_customer     picked up, heading to the customer
 *          done            delivered or cancelled — no location is shared
 */

const ROUTE_REFRESH_MS = 20 * 1000;
const ROUTE_REFRESH_MOVED_M = 40;
const STATIC_LEG_TTL_MS = 10 * 60 * 1000;
const TERMINAL = new Set([OrderStatus.DELIVERED, OrderStatus.CANCELLED]);
const ACTIVE_DELIVERY_STATUSES = [OrderStatus.PACKED, OrderStatus.OUT_FOR_DELIVERY];

// orderId -> { at, from } — when a rider's route was last recomputed, so a
// stream of GPS pings does not turn into a stream of routing requests.
const routeState = new Map();

const ORDER_INCLUDES = [
  {
    model: Business,
    attributes: ['id', 'ownerId', 'businessName', 'businessCode', 'businessDp'],
    include: [{ model: Address, as: 'address' }]
  },
  {
    model: User,
    as: 'customer',
    attributes: ['id', 'firstName', 'lastName'],
    include: [{ model: Address, as: 'address' }]
  },
  { model: User, as: 'deliveryPartner', attributes: ['id', 'firstName'] }
];

export const loadOrderForTracking = (orderId) => Order.findByPk(orderId, { include: ORDER_INCLUDES });

/**
 * Who is this caller in relation to the order? null means "no access".
 * Location data is personal; this is the only gate to it.
 */
export function roleOnOrder(order, user, userRole) {
  if (!order || !user) return null;
  if (userRole === 'admin' || userRole === 'super_admin') return 'admin';
  if (order.customerId && order.customerId === user.id) return 'customer';
  if (order.deliveryPartnerId && order.deliveryPartnerId === user.id) return 'rider';
  if (order.Business?.ownerId && order.Business.ownerId === user.id) return 'merchant';
  return null;
}

export function phaseFor(status, hasRider) {
  const s = normalizeStatus(status);
  if (TERMINAL.has(s)) return 'done';
  if (s === OrderStatus.OUT_FOR_DELIVERY) return 'to_customer';
  if (s === OrderStatus.PACKED && hasRider) return 'rider_to_store';
  return 'preparing';
}

const leg = (route, name) => (route ? { ...route, leg: name } : null);

async function computeRoutes(phase, store, destination, riderPoint) {
  const storeToCustomer = () =>
    store && destination
      ? getRoute(store, destination, { ttlMs: STATIC_LEG_TTL_MS, fromPrecision: 5 })
      : null;

  if (phase === 'rider_to_store' && riderPoint && store) {
    const [primary, onward] = await Promise.all([getRoute(riderPoint, store), storeToCustomer()]);
    return { route: leg(primary, 'rider_to_store'), nextRoute: leg(onward, 'store_to_customer') };
  }
  if (phase === 'to_customer' && riderPoint && destination) {
    return { route: leg(await getRoute(riderPoint, destination), 'to_customer'), nextRoute: null };
  }
  if (phase === 'done') return { route: null, nextRoute: null };
  // preparing, or a rider whose first fix has not arrived yet
  return { route: leg(await storeToCustomer(), 'store_to_customer'), nextRoute: null };
}

/** The tracker view of an already-loaded order (see ORDER_INCLUDES). */
export async function buildSnapshot(order) {
  const status = normalizeStatus(order.status);
  const rider = order.deliveryPartner;
  const phase = phaseFor(status, !!rider);

  const storeAddress = order.Business?.address;
  const store = pointFrom(storeAddress);
  // The address snapshotted at checkout wins; the profile address is the fallback.
  const destination = pointFrom(order.deliveryAddress) ?? pointFrom(order.customer?.address);

  const live = rider && phase !== 'done' ? hub.getRiderLocation(rider.id) : null;
  const riderPoint = live ? { lat: live.lat, lng: live.lng } : null;

  const { route, nextRoute } = await computeRoutes(phase, store, destination, riderPoint);
  if (route && riderPoint) routeState.set(order.id, { at: Date.now(), from: riderPoint });

  let etaSeconds = null;
  if (phase === 'to_customer' && route) etaSeconds = route.durationSeconds;
  else if (phase === 'rider_to_store' && route) {
    etaSeconds = route.durationSeconds + (nextRoute?.durationSeconds ?? 0);
  }

  return {
    orderId: order.id,
    orderCode: order.orderCode,
    status,
    statusLabel: labelFor(status),
    statusHistory: (order.statusHistory || []).map(({ status: s, at }) => ({ status: s, at })),
    phase,
    store: store && {
      ...store,
      name: order.Business?.businessName ?? null,
      logo: order.Business?.businessDp ?? null
    },
    destination: destination && { ...destination, label: order.deliveryAddress?.label ?? null },
    rider: rider
      ? {
          id: rider.id,
          name: rider.firstName || 'Delivery partner',
          location: live && {
            lat: live.lat,
            lng: live.lng,
            heading: live.heading ?? null,
            at: new Date(live.at).toISOString()
          }
        }
      : null,
    route,
    nextRoute,
    etaSeconds,
    etaAt: etaSeconds == null ? null : new Date(Date.now() + etaSeconds * 1000).toISOString(),
    serverTime: new Date().toISOString()
  };
}

/**
 * Pushes the current state of an order to everyone watching it. Call after any
 * status change or rider assignment. Never throws — tracking is a live
 * convenience and must not fail the business action that triggered it.
 */
export async function publishOrderChanged(orderId) {
  try {
    if (!hub.hasSubscribers(orderId)) return;
    const order = await loadOrderForTracking(orderId);
    if (!order) return;
    const data = await buildSnapshot(order);
    hub.publish(orderId, { type: 'snapshot', data });
    if (data.phase === 'done') {
      routeState.delete(orderId);
      hub.closeRoom(orderId);
    }
  } catch (err) {
    console.error('[Tracking] publishOrderChanged failed:', err.message);
  }
}

/**
 * A rider reported a position. Fans out to every active order they carry that
 * someone is watching: a cheap location push each time, and a full snapshot
 * (fresh route + ETA) only when the route has gone stale.
 */
export async function onRiderLocation(riderId, loc) {
  hub.setRiderLocation(riderId, loc);
  if (!hub.hasAnySubscribers()) return;
  try {
    const orders = await Order.findAll({
      where: { deliveryPartnerId: riderId, status: ACTIVE_DELIVERY_STATUSES },
      attributes: ['id']
    });
    for (const { id } of orders) {
      if (!hub.hasSubscribers(id)) continue;
      const point = { lat: loc.lat, lng: loc.lng };
      hub.publish(id, {
        type: 'rider_location',
        orderId: id,
        data: { lat: loc.lat, lng: loc.lng, heading: loc.heading ?? null, at: new Date().toISOString() }
      });
      const last = routeState.get(id);
      const stale =
        !last ||
        Date.now() - last.at > ROUTE_REFRESH_MS ||
        haversineMeters(last.from, point) > ROUTE_REFRESH_MOVED_M;
      if (stale) {
        // Claim the slot first so the next ping does not start a duplicate refresh.
        routeState.set(id, { at: Date.now(), from: point });
        publishOrderChanged(id);
      }
    }
  } catch (err) {
    console.error('[Tracking] onRiderLocation failed:', err.message);
  }
}
