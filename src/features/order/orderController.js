import { z } from 'zod';
import { Op } from 'sequelize';
import { Business, Order, Product, Address, User } from '../../models/index.js';
import { resolveBusiness } from '../../utils/helpers.js';
import { sendToUser } from '../../utils/notify.js';
import { notifyMerchant } from '../../utils/websocket.js';
import {
  ALL_STATUSES,
  OrderStatus,
  normalizeStatus,
  canTransition,
  labelFor,
} from './orderStatus.js';

export const getOrders = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const business = await resolveBusiness(businessId);
    if (!business) {
      return res.status(404).json({ error: { message: 'Business not found' } });
    }

    // Seed dummy orders if database is empty (only for test business)
    let count = await Order.count({ where: { businessId: business.id } });
    if (count === 0 && business.businessCode === 'BUS-DEFAULT') {
      const dummyOrders = [
        {
          customerName: "Rahul Sharma",
          amount: 450.00,
          status: "Pending",
          date: new Date(Date.now() - 2 * 3600000).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
          items: [
            { name: "Fresh Organic Tomatoes", price: 30.00, qty: 2, total: 60.00 },
            { name: "Basmati Rice Premium", price: 130.00, qty: 3, total: 390.00 }
          ]
        },
        {
          customerName: "Priya Patel",
          amount: 820.00,
          status: "Packed",
          date: new Date(Date.now() - 24 * 3600000).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
          items: [
            { name: "Amul Butter 500g", price: 275.00, qty: 2, total: 550.00 },
            { name: "Aashirvaad Multigrain Atta", price: 270.00, qty: 1, total: 270.00 }
          ]
        },
        {
          customerName: "Amit Verma",
          amount: 150.00,
          status: "Delivered",
          date: new Date(Date.now() - 48 * 3600000).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
          items: [
            { name: "Cadbury Dairy Milk Silk", price: 80.00, qty: 1, total: 80.00 },
            { name: "Coca Cola 2L", price: 70.00, qty: 1, total: 70.00 }
          ]
        },
        {
          customerName: "Sneha Reddy",
          amount: 1120.00,
          status: "Shipped",
          date: new Date(Date.now() - 12 * 3600000).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
          items: [
            { name: "Surf Excel Easy Wash 1kg", price: 140.00, qty: 2, total: 280.00 },
            { name: "Tata Salt 1kg", price: 28.00, qty: 5, total: 140.00 },
            { name: "Fortune Mustard Oil 1L", price: 170.00, qty: 4, total: 680.00 }
          ]
        },
        {
          customerName: "Vikram Singh",
          amount: 320.00,
          status: "Pending",
          date: new Date(Date.now() - 4 * 3600000).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
          items: [
            { name: "Britannia Marie Gold 250g", price: 40.00, qty: 4, total: 160.00 },
            { name: "Taj Mahal Tea 500g", price: 160.00, qty: 1, total: 160.00 }
          ]
        }
      ];

      for (const order of dummyOrders) {
        const orderCode = `ORD-${Math.floor(100000 + Math.random() * 900000)}`;
        await Order.create({
          businessId: business.id,
          orderCode,
          customerName: order.customerName,
          amount: order.amount,
          status: order.status,
          date: order.date,
          items: order.items
        });
      }
    }

    // Read Query Params
    const { search, status, page = 1, limit = 10 } = req.query;
    const parsedPage = parseInt(page) || 1;
    const parsedLimit = parseInt(limit) || 10;
    const offset = (parsedPage - 1) * parsedLimit;

    // Build query conditions
    const whereCondition = { businessId: business.id };

    if (search) {
      whereCondition[Op.or] = [
        { customerName: { [Op.like]: `%${search}%` } },
        { orderCode: { [Op.like]: `%${search}%` } }
      ];
    }

    if (status && status !== 'All') {
      whereCondition.status = status;
    }

    // Execute query with pagination and count
    const { rows: orders, count: totalItems } = await Order.findAndCountAll({
      where: whereCondition,
      order: [['createdAt', 'DESC']],
      limit: parsedLimit,
      offset: offset
    });

    const totalPages = Math.ceil(totalItems / parsedLimit);

    const normalizedOrders = orders.map((o) => {
      const j = o.toJSON();
      j.status = normalizeStatus(j.status);
      j.statusHistory = j.statusHistory || [];
      return j;
    });

    return res.status(200).json({
      orders: normalizedOrders,
      metadata: {
        totalItems,
        totalPages,
        currentPage: parsedPage,
        limit: parsedLimit
      }
    });
  } catch (error) {
    next(error);
  }
};

export const createOrder = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const business = await resolveBusiness(businessId);
    if (!business) {
      return res.status(404).json({ error: { message: 'Business not found' } });
    }
    const schema = z.object({
      customerName: z.string(),
      amount: z.union([z.number(), z.string()]).transform(val => parseFloat(val) || 0),
      items: z.array(z.any())
    });
    const data = schema.parse(req.body);

    // Verify stock levels first
    for (const item of data.items) {
      if (item.productId) {
        const prod = await Product.findByPk(item.productId);
        if (prod) {
          if (prod.inventoryCount < item.qty) {
            return res.status(400).json({ error: { message: `Insufficient stock for ${prod.productName} (only ${prod.inventoryCount} left)` } });
          }
        }
      }
    }

    // Decrement stock for all items
    for (const item of data.items) {
      if (item.productId) {
        const prod = await Product.findByPk(item.productId);
        if (prod) {
          prod.inventoryCount -= item.qty;
          await prod.save();
        }
      }
    }

    const orderCode = `ORD-${Math.floor(100000 + Math.random() * 900000)}`;
    const date = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const newOrder = await Order.create({
      businessId: business.id,
      customerId: req.user ? req.user.id : null,
      orderCode,
      customerName: data.customerName,
      amount: data.amount,
      status: OrderStatus.PENDING,
      statusHistory: [{ status: OrderStatus.PENDING, by: 'customer', at: new Date().toISOString() }],
      date,
      items: data.items
    });

    // Notify the store owner of the new incoming order (no-op if FCM off).
    if (business.ownerId) {
      sendToUser(
        business.ownerId,
        `New order ${orderCode}`,
        `${data.customerName} placed an order worth ₹${data.amount}.`,
        { type: 'new_order', orderId: newOrder.id }
      );
    }

    // Notify merchant via WebSocket
    notifyMerchant(business.businessCode, {
      type: 'new_order',
      order: orderToJson(newOrder)
    });

    return res.status(201).json(orderToJson(newOrder));
  } catch (error) {
    next(error);
  }
};

export const getConsumerOrders = async (req, res, next) => {
  try {
    const list = await Order.findAll({
      where: { customerId: req.user.id },
      order: [['createdAt', 'DESC']],
      include: [
        {
          model: Business,
          attributes: ['id', 'businessName', 'businessCode', 'businessDp'],
          include: [{ model: Address, as: 'address' }]
        },
        {
          model: User,
          as: 'customer',
          attributes: ['id', 'firstName', 'lastName'],
          include: [{ model: Address, as: 'address' }]
        }
      ]
    });

    const enriched = list.map((o) => {
      const j = o.toJSON();
      j.status = normalizeStatus(j.status);
      j.statusHistory = j.statusHistory || [];
      j.storeName = j.Business?.businessName ?? null;
      j.storeCode = j.Business?.businessCode ?? null;
      j.storeImage = j.Business?.businessDp ?? null;
      j.storeAddress = j.Business?.address ?? null;
      j.customerAddress = j.customer?.address ?? null;
      delete j.Business;
      delete j.customer;
      return j;
    });

    return res.status(200).json(enriched);
  } catch (error) {
    next(error);
  }
};

export const updateOrderStatus = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const schema = z.object({
      status: z.enum(ALL_STATUSES)
    });
    const { status } = schema.parse(req.body);

    const order = await Order.findByPk(orderId);
    if (!order) {
      return res.status(404).json({ error: { message: 'Order not found' } });
    }

    // Authorization: only the merchant who owns the order's business may update it.
    const business = await Business.findByPk(order.businessId);
    if (!business || business.ownerId !== req.user.id) {
      return res.status(403).json({ error: { message: 'You are not allowed to update this order.' } });
    }

    // Validate the transition against the canonical state machine.
    const current = normalizeStatus(order.status);
    if (current === status) {
      // Idempotent: already in the requested state.
      return res.status(200).json(orderToJson(order));
    }
    if (!canTransition(current, status)) {
      return res.status(409).json({
        error: { message: `Cannot move an order from ${labelFor(current)} to ${labelFor(status)}.` }
      });
    }

    const history = Array.isArray(order.statusHistory) ? order.statusHistory : [];
    history.push({ status, by: 'merchant', at: new Date().toISOString() });

    order.status = status;
    order.statusHistory = history;
    await order.save();

    // Notify the customer of the status change (no-op if FCM not configured).
    if (order.customerId) {
      sendToUser(
        order.customerId,
        `Order ${order.orderCode} — ${labelFor(status)}`,
        statusMessageForCustomer(status, business.businessName),
        { type: 'order_status', orderId: order.id, status }
      );
    }

    return res.status(200).json(orderToJson(order));
  } catch (error) {
    next(error);
  }
};

export const cancelOrder = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findByPk(orderId);
    if (!order) {
      return res.status(404).json({ error: { message: 'Order not found' } });
    }

    // Authorization: only the customer who placed the order may cancel it.
    if (!order.customerId || order.customerId !== req.user.id) {
      return res.status(403).json({ error: { message: 'You are not allowed to cancel this order.' } });
    }

    const current = normalizeStatus(order.status);
    if (current !== OrderStatus.PENDING) {
      return res.status(409).json({
        error: { message: 'This order can no longer be cancelled. The store has already started processing it.' }
      });
    }

    const history = Array.isArray(order.statusHistory) ? order.statusHistory : [];
    history.push({ status: OrderStatus.CANCELLED, by: 'customer', at: new Date().toISOString() });

    order.status = OrderStatus.CANCELLED;
    order.statusHistory = history;
    await order.save();

    // Notify the store owner that the customer cancelled.
    const business = await Business.findByPk(order.businessId);
    if (business?.ownerId) {
      sendToUser(
        business.ownerId,
        `Order ${order.orderCode} cancelled`,
        `${order.customerName} cancelled their order.`,
        { type: 'order_cancelled', orderId: order.id }
      );
    }

    return res.status(200).json(orderToJson(order));
  } catch (error) {
    next(error);
  }
};

// ── Helpers ────────────────────────────────────────────────────────────────
function orderToJson(order) {
  const j = order.toJSON();
  j.status = normalizeStatus(j.status);
  j.statusHistory = j.statusHistory || [];
  return j;
}

function statusMessageForCustomer(status, storeName) {
  const store = storeName || 'The store';
  switch (status) {
    case OrderStatus.PACKING:
      return `${store} has started packing your order.`;
    case OrderStatus.PACKED:
      return `${store} has packed your order.`;
    case OrderStatus.OUT_FOR_DELIVERY:
      return 'Your order is out for delivery.';
    case OrderStatus.DELIVERED:
      return 'Your order has been delivered. Enjoy!';
    case OrderStatus.CANCELLED:
      return 'Your order has been cancelled.';
    default:
      return `Your order status is now ${labelFor(status)}.`;
  }
}
