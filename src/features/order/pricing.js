import crypto from 'crypto';
import { Product } from '../../models/index.js';
import { resolveCouponDiscount } from '../coupon/couponController.js';

// Single source of truth for order money. Both POST /payment/order and
// POST /business/:businessId/orders call computeOrderTotals() so the amount
// charged through Razorpay and the amount stored on the Order row can only
// ever come from DB prices + these server-side rules — never from the client.
//
// Fee composition mirrors the checkout screen in the Flutter app
// (lib/presentation/pages/consumer/checkout_page.dart, lines 18 and 305-314):
//   deliveryFee  = subtotal >= 200 ? 0 : 30
//   handlingFee  = 15
//   platformFee  = 5
//   gstTax       = subtotal * 5%
//   preCoupon    = subtotal + deliveryFee + handlingFee + platformFee + gstTax
//   finalAmount  = max(0, preCoupon - couponDiscount + tipAmount)
// The coupon is validated against the items-only subtotal, exactly as the
// app's /consumer/coupons/validate call does (checkout_page.dart:132,171).
export const PRICING_RULES = Object.freeze({
  FREE_DELIVERY_THRESHOLD: 200,
  DELIVERY_FEE: 30,
  HANDLING_FEE: 15,
  PLATFORM_FEE: 5,
  GST_RATE: 0.05,
  MAX_TIP: 500,
  MAX_LINE_ITEMS: 100,
  MAX_QTY_PER_ITEM: 999,
});

export class PricingError extends Error {
  constructor(message, code = 'PRICING_ERROR', status = 400) {
    super(message);
    this.name = 'PricingError';
    this.code = code;
    this.status = status;
  }
}

// Rupees → 2dp. Epsilon nudge avoids 1.005 → 1.00 style float artefacts.
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Razorpay boundary only: rupees → integer paise.
export const toPaise = (rupees) => Math.round(round2(rupees) * 100);

/**
 * Accepts the item list as the app sends it ({productId, qty, ...}) as well
 * as the more conventional {productId|id, quantity}. Ignores any client
 * price/name/total fields, merges duplicate product ids and validates
 * quantities. Returns [{ productId, quantity }].
 */
export function normalizeItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new PricingError('At least one item is required.', 'EMPTY_CART');
  }
  if (rawItems.length > PRICING_RULES.MAX_LINE_ITEMS) {
    throw new PricingError(`A single order may contain at most ${PRICING_RULES.MAX_LINE_ITEMS} distinct items.`, 'TOO_MANY_ITEMS');
  }
  const merged = new Map();
  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object') {
      throw new PricingError('Each item must be an object.', 'INVALID_ITEM');
    }
    const productId = String(raw.productId ?? raw.product_id ?? raw.id ?? '').trim();
    if (!productId) {
      throw new PricingError('Each item must include a productId.', 'INVALID_ITEM');
    }
    const qtyRaw = raw.quantity ?? raw.qty;
    const quantity = Number(qtyRaw);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > PRICING_RULES.MAX_QTY_PER_ITEM) {
      throw new PricingError(`Invalid quantity for product ${productId}.`, 'INVALID_QUANTITY');
    }
    merged.set(productId, (merged.get(productId) || 0) + quantity);
  }
  return [...merged.entries()].map(([productId, quantity]) => ({ productId, quantity }));
}

/** Tip: number ≥ 0, at most MAX_TIP. Missing/NaN → 0. Over the cap → 400. */
export function sanitizeTip(tipAmount) {
  if (tipAmount === undefined || tipAmount === null || tipAmount === '') return 0;
  const tip = Number(tipAmount);
  if (!Number.isFinite(tip) || tip < 0) {
    throw new PricingError('Tip must be a positive amount.', 'INVALID_TIP');
  }
  if (tip > PRICING_RULES.MAX_TIP) {
    throw new PricingError(`Tip cannot exceed ₹${PRICING_RULES.MAX_TIP}.`, 'TIP_TOO_LARGE');
  }
  return round2(tip);
}

/** Pure fee arithmetic — no I/O. Exported so it can be unit-tested directly. */
export function buildTotals({ lines, couponDiscount = 0, tipAmount = 0 }) {
  const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const deliveryFee = subtotal >= PRICING_RULES.FREE_DELIVERY_THRESHOLD ? 0 : PRICING_RULES.DELIVERY_FEE;
  const handlingFee = PRICING_RULES.HANDLING_FEE;
  const platformFee = PRICING_RULES.PLATFORM_FEE;
  const gstTax = round2(subtotal * PRICING_RULES.GST_RATE);
  const preCouponAmount = round2(subtotal + deliveryFee + handlingFee + platformFee + gstTax);
  const discount = round2(Math.min(Math.max(0, couponDiscount), preCouponAmount));
  const tip = round2(tipAmount);
  const finalAmount = round2(Math.max(0, preCouponAmount - discount + tip));
  return {
    subtotal,
    fees: { deliveryFee, handlingFee, platformFee, gstTax },
    preCouponAmount,
    couponDiscount: discount,
    tipAmount: tip,
    finalAmount,
  };
}

/**
 * Stable fingerprint of a priced cart, stored in the Razorpay order notes so
 * order creation can confirm the paid-for cart is the one being placed.
 */
export function cartFingerprint(items) {
  const canonical = [...items]
    .map((i) => `${i.productId}:${i.quantity}`)
    .sort()
    .join('|');
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

/**
 * Computes everything the client would otherwise have told us.
 *
 * @param {object} input
 * @param {Array}  input.items       raw client items (see normalizeItems)
 * @param {string} [input.couponCode]
 * @param {number|string} [input.tipAmount]
 * @param {string} [input.businessId] store the order is for; when given, every
 *                                    product must belong to it. When omitted it
 *                                    is derived from the products (all must
 *                                    share one business).
 * @param {string} [input.userId]     for per-user coupon limits
 * @param {object} [deps]             injectable for tests: { Product, resolveCouponDiscount }
 * @throws {PricingError}
 */
export async function computeOrderTotals(input, deps = {}) {
  const ProductModel = deps.Product || Product;
  const resolveCoupon = deps.resolveCouponDiscount || resolveCouponDiscount;

  const items = normalizeItems(input.items);
  const tipAmount = sanitizeTip(input.tipAmount);
  const couponCode = typeof input.couponCode === 'string' && input.couponCode.trim()
    ? input.couponCode.trim().toUpperCase()
    : null;

  const products = await ProductModel.findAll({ where: { id: items.map((i) => i.productId) } });
  const byId = new Map(products.map((p) => [String(p.id), p]));

  let businessId = input.businessId || null;
  const lines = [];
  for (const { productId, quantity } of items) {
    const product = byId.get(productId);
    if (!product) {
      throw new PricingError('One of the items in your cart is no longer available.', 'PRODUCT_NOT_FOUND');
    }
    if (businessId && String(product.businessId) !== String(businessId)) {
      throw new PricingError(`${product.productName} does not belong to this store.`, 'PRODUCT_WRONG_STORE');
    }
    if (!businessId) businessId = String(product.businessId);
    const unitPrice = Number(product.price);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new PricingError(`${product.productName} has no valid price.`, 'PRODUCT_UNPRICED');
    }
    const stock = Number(product.inventoryCount) || 0;
    if (stock < quantity) {
      throw new PricingError(
        `Insufficient stock for ${product.productName} (only ${stock} left)`,
        'INSUFFICIENT_STOCK'
      );
    }
    lines.push({
      productId: String(product.id),
      name: product.productName,
      unitPrice: round2(unitPrice),
      quantity,
      lineTotal: round2(unitPrice * quantity),
    });
  }

  const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));

  let couponDiscount = 0;
  if (couponCode) {
    const result = await resolveCoupon({
      code: couponCode,
      userId: input.userId || null,
      businessId,
      subtotal,
    });
    if (!result.ok) {
      throw new PricingError(result.message, 'COUPON_INVALID');
    }
    couponDiscount = result.discount;
  }

  const totals = buildTotals({ lines, couponDiscount, tipAmount });
  return {
    ...totals,
    businessId,
    couponCode,
    items: lines,
    fingerprint: cartFingerprint(items),
  };
}
