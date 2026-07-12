import { z } from 'zod';
import { Op } from 'sequelize';
import { Business, Order } from '../../models/index.js';
import { resolveBusiness } from '../../utils/helpers.js';

export const getOrders = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const business = await resolveBusiness(businessId);
    if (!business) {
      return res.status(404).json({ error: { message: 'Business not found' } });
    }

    // Seed dummy orders if database is empty
    let count = await Order.count({ where: { businessId: business.id } });
    if (count === 0) {
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

    return res.status(200).json({
      orders,
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
    const orderCode = `ORD-${Math.floor(100000 + Math.random() * 900000)}`;
    const date = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const newOrder = await Order.create({
      businessId: business.id,
      orderCode,
      customerName: data.customerName,
      amount: data.amount,
      status: 'Pending',
      date,
      items: data.items
    });
    return res.status(201).json(newOrder);
  } catch (error) {
    next(error);
  }
};

export const updateOrderStatus = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const schema = z.object({
      status: z.enum(['Pending', 'Packed', 'Shipped', 'Delivered'])
    });
    const { status } = schema.parse(req.body);
    const order = await Order.findByPk(orderId);
    if (!order) {
      return res.status(404).json({ error: { message: 'Order not found' } });
    }
    order.status = status;
    await order.save();
    return res.status(200).json(order);
  } catch (error) {
    next(error);
  }
};
