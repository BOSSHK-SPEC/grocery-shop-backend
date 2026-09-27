import { loadOrderForTracking, roleOnOrder, buildSnapshot } from './trackingService.js';

/**
 * GET /consumer/orders/:orderId/tracking
 * Current tracker state — used on first paint and as the fallback whenever the
 * live socket is not connected. Same shape as the socket's `snapshot` event.
 */
export const getOrderTracking = async (req, res, next) => {
  try {
    const order = await loadOrderForTracking(req.params.orderId);
    // Identical response for "missing" and "not yours" so ids cannot be probed.
    if (!order || !roleOnOrder(order, req.user, req.userRole)) {
      return res.status(404).json({ error: { message: 'Order not found.' } });
    }
    res.set('Cache-Control', 'no-store');
    return res.status(200).json(await buildSnapshot(order));
  } catch (error) {
    next(error);
  }
};
