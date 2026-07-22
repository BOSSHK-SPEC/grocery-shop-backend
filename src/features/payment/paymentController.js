import { getRazorpay, isRazorpayConfigured, verifyPaymentSignature } from '../../config/razorpay.js';

// GET /payment/config — tells the app whether online payments are available
// and returns the public key id for the checkout SDK.
export const getPaymentConfig = async (req, res) => {
  return res.status(200).json({
    enabled: isRazorpayConfigured(),
    keyId: process.env.RAZORPAY_KEY_ID || null,
    currency: 'INR',
  });
};

// POST /payment/order — create a Razorpay order for the given rupee amount.
export const createPaymentOrder = async (req, res, next) => {
  try {
    const rupees = parseFloat(req.body.amount);
    if (!rupees || rupees <= 0) {
      return res.status(400).json({ error: { message: 'A positive amount is required.' } });
    }
    const rzp = await getRazorpay();
    if (!rzp) {
      return res.status(503).json({ error: { message: 'Online payments are not configured.', code: 'PAYMENTS_DISABLED' } });
    }
    const amount = Math.round(rupees * 100); // paise
    const order = await rzp.orders.create({
      amount,
      currency: 'INR',
      receipt: `rcpt_${Date.now()}`,
      notes: { userId: req.user?.id || 'guest' },
    });
    return res.status(201).json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
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
