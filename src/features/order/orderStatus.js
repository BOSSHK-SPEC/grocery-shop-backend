/**
 * Canonical order status state machine — the single source of truth shared by
 * the merchant flow, the consumer tracker and analytics.
 *
 * Stored values (DB): Pending, Packing, Packed, OutForDelivery, Delivered, Cancelled
 * Consumer-facing labels: Placed, Packing, Packed, Out for delivery, Delivered, Cancelled
 */

export const OrderStatus = {
  PENDING: 'Pending',
  PACKING: 'Packing',
  PACKED: 'Packed',
  OUT_FOR_DELIVERY: 'OutForDelivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

export const ALL_STATUSES = Object.values(OrderStatus);

export const STATUS_LABELS = {
  Pending: 'Placed',
  Packing: 'Packing',
  Packed: 'Packed',
  OutForDelivery: 'Out for delivery',
  Delivered: 'Delivered',
  Cancelled: 'Cancelled',
};

/** Legal forward transitions. Cancellation is allowed until the parcel leaves. */
export const ALLOWED_TRANSITIONS = {
  Pending: ['Packing', 'Cancelled'],
  Packing: ['Packed', 'Cancelled'],
  Packed: ['OutForDelivery', 'Cancelled'],
  OutForDelivery: ['Delivered'],
  Delivered: [],
  Cancelled: [],
};

/** Maps deprecated/legacy status values onto the canonical set. */
const LEGACY_MAP = {
  Shipped: 'OutForDelivery',
};

export function normalizeStatus(status) {
  if (!status) return OrderStatus.PENDING;
  if (LEGACY_MAP[status]) return LEGACY_MAP[status];
  return ALL_STATUSES.includes(status) ? status : OrderStatus.PENDING;
}

export function canTransition(from, to) {
  const current = normalizeStatus(from);
  const allowed = ALLOWED_TRANSITIONS[current] || [];
  return allowed.includes(to);
}

export function labelFor(status) {
  return STATUS_LABELS[normalizeStatus(status)] || status;
}
