import { z } from 'zod';
import { getRazorpay, isRazorpayConfigured, verifyPaymentSignature } from '../../config/razorpay.js';
import { computeOrderTotals, toPaise, PricingError } from '../order/pricing.js';

// Legacy clients still send the rupee total they displayed. It is never
// charged — only compared against the server-computed amount so a stale
// cart (price changed, coupon expired) gets a clear PRICE_CHANGED instead
// of a silent surprise on the Razorpay sheet.
const PRICE_MISMATCH_TOLERANCE_RUPEES = 1;

// GET /payment/config — tells the app whether online payments are available
// and returns the public key id for the checkout SDK.
export const getPaymentConfig = async (req, res) => {
  return res.status(200).json({
    enabled: isRazorpayConfigured(),
    keyId: process.env.RAZORPAY_KEY_ID || null,
    currency: 'INR',
  });
};

// POST /payment/order — price the cart server-side and create a Razorpay
// order for THAT amount. Body: { items:[{productId, quantity|qty}],
// couponCode?, tipAmount?, businessId?, amount? (legacy cross-check only) }.
export const createPaymentOrder = async (req, res, next) => {
  try {
    const schema = z.object({
      items: z.array(z.any()).min(1, 'At least one item is required.'),
      couponCode: z.string().optional().nullable(),
      tipAmount: z.union([z.number(), z.string()]).optional().nullable(),
      businessId: z.string().optional().nullable(),
      amount: z.union([z.number(), z.string()]).optional().nullable(),
    });
    const data = schema.parse(req.body);

    let totals;
    try {
      totals = await computeOrderTotals({
        items: data.items,
        couponCode: data.couponCode,
        tipAmount: data.tipAmount,
        businessId: data.businessId || undefined,
        userId: req.user?.id || null,
      });
    } catch (err) {
      if (err instanceof PricingError) {
        return res.status(err.status).json({ error: { message: err.message, code: err.code } });
      }
      throw err;
    }

    if (data.amount !== undefined && data.amount !== null && data.amount !== '') {
      const claimed = parseFloat(data.amount);
      if (!Number.isFinite(claimed) || Math.abs(claimed - totals.finalAmount) > PRICE_MISMATCH_TOLERANCE_RUPEES) {
        return res.status(409).json({
          error: {
            code: 'PRICE_CHANGED',
            message: 'The order total has changed. Please review your cart and try again.',
            computedAmount: totals.finalAmount,
          },
          pricing: totals,
        });
      }
    }

    if (totals.finalAmount <= 0) {
      return res.status(400).json({ error: { message: 'Order total must be greater than zero.', code: 'ZERO_AMOUNT' } });
    }

    const rzp = await getRazorpay();
    if (!rzp) {
      return res.status(503).json({ error: { message: 'Online payments are not configured.', code: 'PAYMENTS_DISABLED' } });
    }

    const amountPaise = toPaise(totals.finalAmount);
    // Notes travel with the Razorpay order and are read back (via
    // orders.fetch) when the app finally places the order, so the paid-for
    // cart, user and amount can all be cross-checked server-side.
    const order = await rzp.orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: `rcpt_${Date.now()}`,
      notes: {
        userId: String(req.user?.id || 'guest'),
        businessId: String(totals.businessId || ''),
        computedAmount: totals.finalAmount.toFixed(2),
        subtotal: totals.subtotal.toFixed(2),
        couponCode: totals.couponCode || '',
        couponDiscount: totals.couponDiscount.toFixed(2),
        tipAmount: totals.tipAmount.toFixed(2),
        cartFingerprint: totals.fingerprint,
      },
    });

    return res.status(201).json({
      orderId: order.id,
      amount: order.amount, // paise — what Razorpay will collect
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      pricing: totals, // rupees breakdown so the client can render what it will pay
    });
  } catch (error) {
    next(error);
  }
};

// POST /payment/verify — verify a completed payment's signature.
export const verifyPayment = async (req, res, next) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const valid = verifyPaymentSignature({
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
    });
    return res.status(200).json({ valid });
  } catch (error) {
    next(error);
  }
};
