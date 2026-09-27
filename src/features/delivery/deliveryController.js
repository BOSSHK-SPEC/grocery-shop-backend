import { z } from 'zod';
import { Order, User, Business, Address, ChatMessage, Rating, Complaint, sequelize } from '../../models/index.js';
import { OrderStatus } from '../order/orderStatus.js';
import { sendToUser } from '../../utils/notify.js';
import { publishOrderChanged, onRiderLocation, loadOrderForTracking, roleOnOrder } from '../tracking/trackingService.js';
import { getRiderLocation } from '../tracking/trackingHub.js';

/**
 * Notify BOTH parties of an order (customer + store owner) about a delivery
 * lifecycle change. Persists an in-app notification and pushes FCM (no-op if
 * FCM is not configured). Never throws.
 */
async function notifyOrderParties(order, title, body) {
  const data = { type: 'delivery_update', orderId: order.id, status: order.status };
  try {
    if (order.customerId) sendToUser(order.customerId, title, body, data);
    const business = await Business.findByPk(order.businessId);
    if (business?.ownerId) sendToUser(business.ownerId, title, body, data);
  } catch (err) {
    console.error('notifyOrderParties failed:', err.message);
  }
}

function deduplicateOrders(list) {
  const seen = new Set();
  const result = [];
  for (const o of list || []) {
    if (seen.has(o.id)) continue;
    seen.add(o.id);
    result.push(o);
  }
  return result;
}

export const getAvailableDeliveries = async (req, res, next) => {
  try {
    const orders = await Order.findAll({
      where: {
        status: 'Packed',
        deliveryPartnerId: null
      },
      order: [['updatedAt', 'DESC']],
      include: [
        {
          model: User,
          as: 'customer',
          // No phone number until a rider has claimed the order.
          attributes: ['id', 'firstName'],
          include: [{ model: Address, as: 'address' }]
        },
        {
          model: Business,
          attributes: ['id', 'businessName', 'businessCode', 'businessDp'],
          include: [{ model: Address, as: 'address' }]
        }
      ]
    });
    return res.status(200).json(deduplicateOrders(orders));
  } catch (error) {
    next(error);
  }
};

export const getActiveDeliveries = async (req, res, next) => {
  try {
    const orders = await Order.findAll({
      where: {
        deliveryPartnerId: req.user.id,
        status: ['Packed', 'OutForDelivery']
      },
      order: [['updatedAt', 'DESC']],
      include: [
        {
          model: User,
          as: 'customer',
          attributes: ['id', 'firstName', 'lastName', 'mobileNumber'],
          include: [{ model: Address, as: 'address' }]
        },
        {
          model: Business,
          attributes: ['id', 'businessName', 'businessCode', 'businessDp'],
          include: [
            { model: Address, as: 'address' },
            // The assigned rider may need to call the store about pickup.
            { model: User, as: 'owner', attributes: ['firstName', 'mobileNumber'] }
          ]
        }
      ]
    });
    return res.status(200).json(deduplicateOrders(orders));
  } catch (error) {
    next(error);
  }
};

export const getDeliveryHistory = async (req, res, next) => {
  try {
    const orders = await Order.findAll({
      where: {
        deliveryPartnerId: req.user.id,
        status: ['Delivered', 'Cancelled']
      },
      order: [['updatedAt', 'DESC']],
      include: [
        {
          model: User,
          as: 'customer',
          attributes: ['id', 'firstName', 'lastName', 'mobileNumber'],
          include: [{ model: Address, as: 'address' }]
        },
        {
          model: Business,
          attributes: ['id', 'businessName', 'businessCode', 'businessDp'],
          include: [{ model: Address, as: 'address' }]
        }
      ]
    });
    return res.status(200).json(deduplicateOrders(orders));
  } catch (error) {
    next(error);
  }
};

export const claimDelivery = async (req, res, next) => {
  const { id } = req.params;
  let order;
  try {
    // The row lock serialises concurrent claims: the second rider waits,
    // then sees the first rider's id and is refused.
    order = await sequelize.transaction(async (transaction) => {
      const row = await Order.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!row) return { error: 404, message: 'Order not found.' };
      if (row.deliveryPartnerId === req.user.id) return { row, retry: true }; // idempotent retry
      if (row.deliveryPartnerId) return { error: 409, code: 'ALREADY_CLAIMED', message: 'Order is already claimed by another delivery partner.' };
      if (row.status !== 'Packed') return { error: 409, code: 'NOT_READY', message: 'Order is not ready for delivery.' };

      row.deliveryPartnerId = req.user.id;
      row.statusHistory = [
        ...(Array.isArray(row.statusHistory) ? row.statusHistory : []),
        { status: row.status, by: 'delivery', at: new Date().toISOString(), note: 'Claimed by delivery partner' }
      ];
      await row.save({ transaction });
      return { row };
    });
  } catch (error) {
    return next(error);
  }

  if (order.error) {
    return res.status(order.error).json({ error: { message: order.message, ...(order.code ? { code: order.code } : {}) } });
  }
  if (!order.retry) {
    await notifyOrderParties(order.row, 'Delivery partner assigned', `A delivery partner has been assigned to order ${order.row.orderCode}.`);
    publishOrderChanged(order.row.id);
  }
  return res.status(200).json(order.row);
};

export const startDelivery = async (req, res, next) => {
  try {
    const { id } = req.params;
    const order = await Order.findByPk(id);
    if (!order) {
      return res.status(404).json({ error: { message: 'Order not found.' } });
    }
    if (order.deliveryPartnerId !== req.user.id) {
      return res.status(403).json({ error: { message: 'Unauthorized. You are not the assigned delivery partner.' } });
    }
    if (order.status !== 'Packed') {
      return res.status(400).json({ error: { message: 'Order cannot transition to OutForDelivery from current status.' } });
    }

    order.status = 'OutForDelivery';
    const statusHistory = Array.isArray(order.statusHistory) ? order.statusHistory : [];
    statusHistory.push({
      status: 'OutForDelivery',
      by: 'delivery',
      at: new Date().toISOString()
    });
    order.statusHistory = statusHistory;
    await order.save();

    await notifyOrderParties(
      order,
      'Order picked up',
      `Order ${order.orderCode} has been collected and is out for delivery.`
    );
    publishOrderChanged(order.id);

    return res.status(200).json(order);
  } catch (error) {
    next(error);
  }
};

export const completeDelivery = async (req, res, next) => {
  try {
    const { id } = req.params;
    const order = await Order.findByPk(id);
    if (!order) {
      return res.status(404).json({ error: { message: 'Order not found.' } });
    }
    if (order.deliveryPartnerId !== req.user.id) {
      return res.status(403).json({ error: { message: 'Unauthorized. You are not the assigned delivery partner.' } });
    }
    if (order.status !== 'OutForDelivery') {
      return res.status(400).json({ error: { message: 'Order cannot transition to Delivered from current status.' } });
    }

    if (order.deliveryCode) {
      const providedCode = String(req.body?.deliveryCode ?? req.body?.code ?? req.body?.otp ?? '').trim();
      if (!providedCode || providedCode !== order.deliveryCode) {
        return res.status(400).json({
          error: { message: 'Invalid delivery code. Please enter the 4-digit code provided by the customer.', code: 'INVALID_DELIVERY_CODE' }
        });
      }
    }

    order.status = 'Delivered';
    const statusHistory = Array.isArray(order.statusHistory) ? order.statusHistory : [];
    statusHistory.push({
      status: 'Delivered',
      by: 'delivery',
      at: new Date().toISOString()
    });
    order.statusHistory = statusHistory;
    await order.save();

    await notifyOrderParties(
      order,
      'Order delivered',
      `Order ${order.orderCode} has been delivered. Enjoy!`
    );
    publishOrderChanged(order.id);

    return res.status(200).json(order);
  } catch (error) {
    next(error);
  }
};

const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  heading: z.number().min(0).max(360).nullish(),
  accuracy: z.number().min(0).nullish()
});

// A fix worse than this (metres) is a cell-tower guess, not a position worth
// drawing a rider on.
const MAX_ACCEPTED_ACCURACY_M = 100;
// Clients aim for one ping every ~3-5 s; anything faster is a bug or abuse.
const MIN_PING_INTERVAL_MS = 1500;
// The live position lives in memory; the DB copy only has to survive a restart.
const DB_WRITE_INTERVAL_MS = 15 * 1000;
const lastPing = new Map(); // riderId -> { accepted(ms), persisted(ms) }

export const updateLocation = async (req, res, next) => {
  try {
    const { latitude, longitude, heading, accuracy } = locationSchema.parse(req.body);
    if (latitude === 0 && longitude === 0) {
      return res.status(400).json({ error: { message: 'Invalid location.' } });
    }
    // Poor fixes and over-frequent pings are dropped with a 200: the rider app
    // has nothing to fix or retry, and a 4xx would only make it back off.
    if (accuracy != null && accuracy > MAX_ACCEPTED_ACCURACY_M) {
      return res.status(200).json({ success: true, accepted: false });
    }
    const now = Date.now();
    const seen = lastPing.get(req.user.id) || { accepted: 0, persisted: 0 };
    if (now - seen.accepted < MIN_PING_INTERVAL_MS) {
      return res.status(200).json({ success: true, accepted: false });
    }
    seen.accepted = now;

    // Live viewers get it immediately (in memory); no await on the fan-out.
    onRiderLocation(req.user.id, { lat: latitude, lng: longitude, heading, at: now });

    if (now - seen.persisted >= DB_WRITE_INTERVAL_MS) {
      seen.persisted = now;
      await User.update(
        { latitude, longitude, locationUpdatedAt: new Date(now) },
        { where: { id: req.user.id } }
      );
    }
    lastPing.set(req.user.id, seen);

    return res.status(200).json({ success: true, accepted: true });
  } catch (error) {
    next(error);
  }
};

/**
 * The assigned rider's position and contact for one order. Restricted to the
 * people on that order, and only while the delivery is in progress — a
 * finished order must not keep exposing where the rider is.
 */
export const getDeliveryLocation = async (req, res, next) => {
  try {
    const order = await loadOrderForTracking(req.params.id);
    const role = roleOnOrder(order, req.user, req.userRole);
    if (!order || !role) {
      return res.status(404).json({ error: { message: 'Order not found.' } });
    }
    if (!order.deliveryPartnerId) {
      return res.status(400).json({ error: { message: 'Order has no assigned delivery partner.' } });
    }
    if (!['Packed', 'OutForDelivery'].includes(order.status)) {
      return res.status(409).json({ error: { message: 'This delivery is no longer in progress.' } });
    }
    const rider = await User.findByPk(order.deliveryPartnerId, {
      attributes: ['id', 'latitude', 'longitude', 'firstName', 'lastName', 'mobileNumber']
    });
    const live = getRiderLocation(order.deliveryPartnerId);
    const json = rider.toJSON();
    if (live) {
      json.latitude = live.lat;
      json.longitude = live.lng;
    }
    // A rider does not need their own phone number echoed back.
    if (role === 'rider') delete json.mobileNumber;
    res.set('Cache-Control', 'no-store');
    return res.status(200).json(json);
  } catch (error) {
    next(error);
  }
};

export const getChatMessages = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findByPk(orderId);
    if (!order) {
      return res.status(404).json({ error: { message: 'Order not found.' } });
    }
    if (order.customerId !== req.user.id && order.deliveryPartnerId !== req.user.id) {
      return res.status(403).json({ error: { message: 'Unauthorized access to chat.' } });
    }

    const messages = await ChatMessage.findAll({
      where: { orderId },
      order: [['createdAt', 'ASC']]
    });

    // The caller is authenticated on this route, so the server is the authority
    // on whose message each row is. Tagging them spares every client from
    // re-deriving it from its own profile — which the delivery app could not do
    // (it has no consumer/merchant profile to read an id from), so a rider saw
    // their own messages rendered as the other party's.
    const tagged = messages.map((m) => ({
      ...m.toJSON(),
      mine: String(m.senderId) === String(req.user.id)
    }));
    return res.status(200).json(tagged);
  } catch (error) {
    next(error);
  }
};

export const sendChatMessage = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { message: rawMessage } = z.object({ message: z.string().trim().min(1).max(2000) }).parse(req.body);
    const message = rawMessage;
    const order = await Order.findByPk(orderId);
    if (!order) {
      return res.status(404).json({ error: { message: 'Order not found.' } });
    }
    if (order.customerId !== req.user.id && order.deliveryPartnerId !== req.user.id) {
      return res.status(403).json({ error: { message: 'Unauthorized access to chat.' } });
    }

    const recipientId = order.customerId === req.user.id ? order.deliveryPartnerId : order.customerId;
    if (!recipientId) {
      return res.status(400).json({ error: { message: 'No delivery partner assigned to this order yet.' } });
    }

    const chat = await ChatMessage.create({
      orderId,
      senderId: req.user.id,
      recipientId,
      message: message.trim(),
      senderRole: req.userRole || req.user.role || 'consumer'
    });

    return res.status(201).json(chat);
  } catch (error) {
    next(error);
  }
};

/**
 * Rate the other party of a delivered order.
 *  - consumer (order.customerId) rates the rider
 *  - rider (order.deliveryPartnerId) rates the consumer
 * Body: { stars: 1..5, comment? }. Idempotent per (order, rater) via upsert.
 */
export const rateOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const stars = parseInt(req.body.stars, 10);
    const comment = typeof req.body.comment === 'string' ? req.body.comment.trim() : null;
    if (!stars || stars < 1 || stars > 5) {
      return res.status(400).json({ error: { message: 'stars must be between 1 and 5.' } });
    }
    const order = await Order.findByPk(id);
    if (!order) return res.status(404).json({ error: { message: 'Order not found.' } });
    if (order.status !== 'Delivered') {
      return res.status(400).json({ error: { message: 'You can only rate a delivered order.' } });
    }

    let raterRole, rateeId, rateeRole;
    if (req.user.id === order.customerId) {
      raterRole = 'consumer';
      rateeId = order.deliveryPartnerId;
      rateeRole = 'delivery';
    } else if (req.user.id === order.deliveryPartnerId) {
      raterRole = 'delivery';
      rateeId = order.customerId;
      rateeRole = 'consumer';
    } else {
      return res.status(403).json({ error: { message: 'You are not a party to this order.' } });
    }
    if (!rateeId) {
      return res.status(400).json({ error: { message: 'There is no counterparty to rate for this order.' } });
    }

    const existing = await Rating.findOne({ where: { orderId: id, raterId: req.user.id } });
    let rating;
    if (existing) {
      rating = await existing.update({ stars, comment });
    } else {
      rating = await Rating.create({
        orderId: id,
        raterId: req.user.id,
        raterRole,
        rateeId,
        rateeRole,
        stars,
        comment
      });
    }
    return res.status(201).json(rating);
  } catch (error) {
    next(error);
  }
};

// GET /delivery/orders/:id/ratings — ratings on this order (to know what's done).
export const getOrderRatings = async (req, res, next) => {
  try {
    const { id } = req.params;
    const ratings = await Rating.findAll({ where: { orderId: id } });
    return res.status(200).json(ratings);
  } catch (error) {
    next(error);
  }
};

/**
 * File a complaint about a delivery (consumer only).
 * Body: { subject, description?, against? = 'delivery' }.
 */
export const fileComplaint = async (req, res, next) => {
  try {
    const { id } = req.params;
    const subject = typeof req.body.subject === 'string' ? req.body.subject.trim() : '';
    const description = typeof req.body.description === 'string' ? req.body.description.trim() : null;
    const against = req.body.against === 'merchant' ? 'merchant' : 'delivery';
    if (!subject) return res.status(400).json({ error: { message: 'A complaint subject is required.' } });

    const order = await Order.findByPk(id);
    if (!order) return res.status(404).json({ error: { message: 'Order not found.' } });
    if (order.customerId !== req.user.id) {
      return res.status(403).json({ error: { message: 'Only the customer of this order can raise a complaint.' } });
    }

    const complaint = await Complaint.create({
      orderId: id,
      complainantId: req.user.id,
      against,
      subject,
      description
    });

    // Best-effort: notify the store owner so they can follow up.
    try {
      const business = await Business.findByPk(order.businessId);
      if (business?.ownerId) {
        sendToUser(
          business.ownerId,
          'New delivery complaint',
          `A complaint was raised for order ${order.orderCode}: ${subject}`,
          { type: 'complaint', orderId: order.id, complaintId: complaint.id }
        );
      }
    } catch (err) {
      console.error('complaint notify failed:', err.message);
    }

    return res.status(201).json(complaint);
  } catch (error) {
    next(error);
  }
};

// GET /delivery/riders/:riderId/rating — a rider's average rating + count.
export const getRiderRating = async (req, res, next) => {
  try {
    const { riderId } = req.params;
    const ratings = await Rating.findAll({ where: { rateeId: riderId, rateeRole: 'delivery' } });
    const count = ratings.length;
    const average = count === 0 ? 0 : ratings.reduce((s, r) => s + r.stars, 0) / count;
    return res.status(200).json({ riderId, average: Math.round(average * 10) / 10, count });
  } catch (error) {
    next(error);
  }
};

export const toggleOnlineStatus = async (req, res, next) => {
  try {
    const { isOnline } = z.object({ isOnline: z.boolean() }).parse(req.body);
    const user = await User.findByPk(req.user.id);
    if (!user) {
      return res.status(404).json({ error: { message: 'User not found.' } });
    }
    const misc = user.misc || {};
    misc.isOnline = isOnline;
    user.misc = misc;
    user.changed('misc', true);
    await user.save();

    return res.status(200).json({ success: true, isOnline: user.misc.isOnline });
  } catch (error) {
    next(error);
  }
};
