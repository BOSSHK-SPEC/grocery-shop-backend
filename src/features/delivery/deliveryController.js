import { Order, User, Business, Address, ChatMessage, Rating, Complaint } from '../../models/index.js';
import { OrderStatus } from '../order/orderStatus.js';
import { sendToUser } from '../../utils/notify.js';

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
    return res.status(200).json(orders);
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
          include: [{ model: Address, as: 'address' }]
        }
      ]
    });
    return res.status(200).json(orders);
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
    return res.status(200).json(orders);
  } catch (error) {
    next(error);
  }
};

export const claimDelivery = async (req, res, next) => {
  try {
    const { id } = req.params;
    const order = await Order.findByPk(id);
    if (!order) {
      return res.status(404).json({ error: { message: 'Order not found.' } });
    }
    if (order.status !== 'Packed') {
      return res.status(400).json({ error: { message: 'Order is not ready for delivery.' } });
    }
    if (order.deliveryPartnerId) {
      return res.status(400).json({ error: { message: 'Order is already claimed by another delivery partner.' } });
    }

    order.deliveryPartnerId = req.user.id;
    // Maintain audit trail
    const statusHistory = Array.isArray(order.statusHistory) ? order.statusHistory : [];
    statusHistory.push({
      status: order.status,
      by: 'delivery',
      at: new Date().toISOString(),
      note: 'Claimed by delivery partner'
    });
    order.statusHistory = statusHistory;
    await order.save();

    await notifyOrderParties(
      order,
      'Delivery partner assigned',
      `A delivery partner has been assigned to order ${order.orderCode}.`
    );

    return res.status(200).json(order);
  } catch (error) {
    next(error);
  }
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

    return res.status(200).json(order);
  } catch (error) {
    next(error);
  }
};

export const updateLocation = async (req, res, next) => {
  try {
    const { latitude, longitude } = req.body;
    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: { message: 'Latitude and longitude are required.' } });
    }
    const user = await User.findByPk(req.user.id);
    if (!user) {
      return res.status(404).json({ error: { message: 'User not found.' } });
    }
    user.latitude = latitude;
    user.longitude = longitude;
    await user.save();

    return res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
};

export const getDeliveryLocation = async (req, res, next) => {
  try {
    const { id } = req.params;
    const order = await Order.findByPk(id);
    if (!order) {
      return res.status(404).json({ error: { message: 'Order not found.' } });
    }
    if (!order.deliveryPartnerId) {
      return res.status(400).json({ error: { message: 'Order has no assigned delivery partner.' } });
    }
    const user = await User.findByPk(order.deliveryPartnerId, {
      attributes: ['id', 'latitude', 'longitude', 'firstName', 'lastName', 'mobileNumber']
    });
    return res.status(200).json(user);
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
    return res.status(200).json(messages);
  } catch (error) {
    next(error);
  }
};

export const sendChatMessage = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { message } = req.body;
    if (!message || message.trim() === '') {
      return res.status(400).json({ error: { message: 'Message is required.' } });
    }
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
    const { isOnline } = req.body;
    if (isOnline === undefined) {
      return res.status(400).json({ error: { message: 'isOnline status is required.' } });
    }
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
