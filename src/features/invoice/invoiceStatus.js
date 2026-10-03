/**
 * Canonical invoice status state machine — mirrors `order/orderStatus.js` on
 * purpose, so the same mental model (and the same kind of unit test) covers
 * both. An invoice is issued at billing time (walk-in counter sale or online
 * order) and moves forward as the goods actually reach the customer.
 *
 * Stored values (DB): Issued, OutForDelivery, Delivered, Cancelled
 */

export const InvoiceStatus = {
  ISSUED: 'Issued',
  OUT_FOR_DELIVERY: 'OutForDelivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

export const ALL_STATUSES = Object.values(InvoiceStatus);

export const STATUS_LABELS = {
  Issued: 'Billed',
  OutForDelivery: 'Out for delivery',
  Delivered: 'Delivered',
  Cancelled: 'Cancelled',
};

/**
 * Legal forward transitions. A walk-in counter sale is usually handed over on
 * the spot (Issued → Delivered directly); "OutForDelivery" is only used when
 * the seller chooses to deliver a walk-in bill later instead of handing it
 * over at the counter.
 */
export const ALLOWED_TRANSITIONS = {
  Issued: ['OutForDelivery', 'Delivered', 'Cancelled'],
  OutForDelivery: ['Delivered', 'Cancelled'],
  Delivered: [],
  Cancelled: [],
};

export function normalizeStatus(status) {
  return ALL_STATUSES.includes(status) ? status : InvoiceStatus.ISSUED;
}

export function canTransition(from, to) {
  const current = normalizeStatus(from);
  const allowed = ALLOWED_TRANSITIONS[current] || [];
  return allowed.includes(to);
}

export function labelFor(status) {
  return STATUS_LABELS[normalizeStatus(status)] || status;
}
