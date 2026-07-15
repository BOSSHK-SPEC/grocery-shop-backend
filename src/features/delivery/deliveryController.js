import { Order, User, Business, Address, ChatMessage } from '../../models/index.js';
import { OrderStatus } from '../order/orderStatus.js';

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
