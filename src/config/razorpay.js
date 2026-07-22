import crypto from 'crypto';

// Razorpay integration. Self-degrading: if keys are not set or the `razorpay`
// package is missing, payment endpoints report "disabled" and the app falls
// back to Cash-on-Delivery.
//
// Env:
//   RAZORPAY_KEY_ID
//   RAZORPAY_KEY_SECRET
//   RAZORPAY_WEBHOOK_SECRET   (optional, for webhooks)

let _instance = null;
let _tried = false;

export function isRazorpayConfigured() {
  return !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

export async function getRazorpay() {
  if (_tried) return _instance;
  _tried = true;
  if (!isRazorpayConfigured()) return null;
  try {
    const Razorpay = (await import('razorpay')).default;
    _instance = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
    console.log('Razorpay payments enabled.');
    return _instance;
  } catch (err) {
    console.error('Razorpay unavailable (payments disabled):', err.message);
    _instance = null;
    return null;
  }
}

// Verify the checkout signature: HMAC_SHA256(order_id|payment_id, key_secret).
export function verifyPaymentSignature({ orderId, paymentId, signature }) {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret || !orderId || !paymentId || !signature) return false;
  try {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// Verify a webhook payload signature against RAZORPAY_WEBHOOK_SECRET.
export function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  try {
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
