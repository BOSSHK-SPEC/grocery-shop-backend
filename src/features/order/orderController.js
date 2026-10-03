import { z } from 'zod';
import { Op } from 'sequelize';
import { Business, Order, Address, User, sequelize } from '../../models/index.js';
import { reserveStock, releaseStock, OutOfStockError } from './stock.js';
import { resolveBusiness, isAcceptingOrders } from '../../utils/helpers.js';
import { sendToUser } from '../../utils/notify.js';
import { notifyMerchant } from '../../utils/websocket.js';
import { publishOrderChanged } from '../tracking/trackingService.js';
import { verifyPaymentSignature, getRazorpay } from '../../config/razorpay.js';
import { computeOrderTotals, toPaise, PricingError } from './pricing.js';
import { createInvoiceForOrder } from '../invoice/invoiceController.js';
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
    if (!isAcceptingOrders(business)) {
      return res.status(409).json({
        error: { message: 'This store is not accepting orders right now.', code: 'STORE_NOT_ACCEPTING_ORDERS' }
      });
    }
    // Money is NEVER read from the request. Any amount/price/total the client
    // sends (including per-item price/total) is dropped by this schema and the
    // whole bill is recomputed from DB prices in computeOrderTotals().
    const schema = z.object({
      customerName: z.string().min(1).max(120),
      items: z.array(z.any()).min(1, 'At least one item is required.'),
      addressId: z.string().optional().nullable(),
      deliveryAddress: z.any().optional().nullable(),
      // Optional online-payment proof (Razorpay). Absent => Cash on Delivery.
      razorpayOrderId: z.string().optional().nullable(),
      razorpayPaymentId: z.string().optional().nullable(),
      razorpaySignature: z.string().optional().nullable(),
      couponCode: z.string().optional().nullable(),
      tipAmount: z.union([z.number(), z.string()]).optional().nullable(),
      noPlasticBag: z.boolean().optional(),
      deliveryInstructions: z.string().max(300).optional().nullable()
    });
    const data = schema.parse(req.body);

    let totals;
    try {
      totals = await computeOrderTotals({
        items: data.items,
        couponCode: data.couponCode,
        tipAmount: data.tipAmount,
        businessId: business.id,
        userId: req.user ? req.user.id : null,
      });
    } catch (err) {
      if (err instanceof PricingError) {
        return res.status(err.status).json({ error: { message: err.message, code: err.code } });
      }
      throw err;
    }
    const finalAmount = totals.finalAmount;

    // Resolve payment: if Razorpay proof is supplied, verify the signature AND
    // that the Razorpay order was created (by us) for exactly this amount,
    // this user and this cart. Otherwise treat as COD.
    let paymentMethod = 'cod';
    let paymentStatus = 'COD';
    let paymentId = null;
    let paymentOrderId = null;
    const hasPaymentProof = data.razorpayPaymentId || data.razorpayOrderId || data.razorpaySignature;
    if (hasPaymentProof) {
      if (!(data.razorpayPaymentId && data.razorpayOrderId && data.razorpaySignature)) {
        return res.status(400).json({ error: { message: 'Incomplete payment details.', code: 'PAYMENT_PROOF_INCOMPLETE' } });
      }
      const ok = verifyPaymentSignature({
        orderId: data.razorpayOrderId,
        paymentId: data.razorpayPaymentId,
        signature: data.razorpaySignature
      });
      if (!ok) {
        return res.status(400).json({ error: { message: 'Payment verification failed.', code: 'PAYMENT_SIGNATURE_INVALID' } });
      }

      // A Razorpay order id can back exactly one store order.
      const reused = await Order.findOne({ where: { paymentOrderId: data.razorpayOrderId } });
      if (reused) {
        return res.status(409).json({ error: { message: 'This payment has already been used for an order.', code: 'PAYMENT_ALREADY_USED' } });
      }

      const mismatch = await verifyPaidAmount({
        razorpayOrderId: data.razorpayOrderId,
        expectedAmount: finalAmount,
        expectedUserId: req.user ? req.user.id : null,
        expectedFingerprint: totals.fingerprint,
      });
      if (mismatch) {
        return res.status(mismatch.status).json({ error: { message: mismatch.message, code: mismatch.code } });
      }

      paymentMethod = 'razorpay';
      paymentStatus = 'PAID';
      paymentId = data.razorpayPaymentId;
      paymentOrderId = data.razorpayOrderId;
    }

    // Resolve the delivery address snapshot: prefer an explicit saved address,
    // then a raw address object, then the customer's default address.
    let deliveryAddress = null;
    if (data.addressId && req.user) {
      const addr = await Address.findOne({ where: { id: data.addressId, userId: req.user.id } });
      if (addr) deliveryAddress = addr.toJSON();
    }
    if (!deliveryAddress && data.deliveryAddress) {
      deliveryAddress = data.deliveryAddress;
    }
    if (!deliveryAddress && req.user) {
      const addr = await Address.findOne({
        where: { userId: req.user.id },
        order: [['isDefault', 'DESC'], ['createdAt', 'ASC']]
      });
      if (addr) deliveryAddress = addr.toJSON();
    }


    // Persist the server-priced lines in the shape the merchant UI/billing
    // already read ({ name, price, qty, total }) plus productId.
    const storedItems = totals.items.map((l) => ({
      productId: l.productId,
      name: l.name,
      price: l.unitPrice,
      qty: l.quantity,
      total: l.lineTotal
    }));

    const orderCode = `ORD-${Math.floor(100000 + Math.random() * 900000)}`;
    const deliveryCode = Math.floor(1000 + Math.random() * 9000).toString();
    const date = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    // Stock check, stock decrement and the order row commit together, with
    // the product rows locked, so concurrent orders cannot oversell.
    let newOrder;
    try {
      newOrder = await sequelize.transaction(async (transaction) => {
        await reserveStock(totals.items, transaction, { allowShortfall: paymentStatus === 'PAID' });
        const order = await Order.create({
      businessId: business.id,
      customerId: req.user ? req.user.id : null,
      orderCode,
      deliveryCode,
      customerName: data.customerName,
      amount: finalAmount,
      status: OrderStatus.PENDING,
      statusHistory: [{ status: OrderStatus.PENDING, by: 'customer', at: new Date().toISOString() }],
      date,
      items: storedItems,
      deliveryAddress,
      paymentMethod,
      paymentStatus,
      paymentId,
      paymentOrderId,
      couponCode: totals.couponCode,
      couponDiscount: totals.couponDiscount,
      tipAmount: totals.tipAmount,
      pricing: {
        subtotal: totals.subtotal,
        fees: totals.fees,
        preCouponAmount: totals.preCouponAmount,
        couponDiscount: totals.couponDiscount,
        tipAmount: totals.tipAmount,
        finalAmount: totals.finalAmount
      },
      noPlasticBag: data.noPlasticBag || false,
      deliveryInstructions: data.deliveryInstructions || null
        }, { transaction });

        // The invoice is created in the same transaction as the order: either
        // both exist or neither does, so an order is never left without the
        // document that makes it visible to the customer in Account >
        // Invoices (mirrors the walk-in-bill path in billingController.js).
        await createInvoiceForOrder({
          order,
          business,
          items: storedItems,
          customerMobile: req.user ? req.user.mobileNumber : null,
          transaction,
        });

        return order;
      });
    } catch (error) {
      if (error instanceof OutOfStockError) {
        return res.status(409).json({ error: { message: error.message, code: error.code } });
      }
      throw error;
    }

    // Notify the store owner of the new incoming order (no-op if FCM off).
    if (business.ownerId) {
      sendToUser(
        business.ownerId,
        `New order ${orderCode}`,
        `${data.customerName} placed an order worth ₹${finalAmount.toFixed(2)}.`,
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

/**
 * Confirms, against Razorpay's own record, that the order the customer paid
 * was created for the amount we just recomputed (and for this user/cart, via
 * the notes we attached in POST /payment/order). Fails closed: if Razorpay
 * cannot be reached the order is not accepted as paid.
 * Returns null when everything matches, else { status, code, message }.
 */
async function verifyPaidAmount({ razorpayOrderId, expectedAmount, expectedUserId, expectedFingerprint }) {
  const rzp = await getRazorpay();
  if (!rzp) {
    return { status: 503, code: 'PAYMENTS_DISABLED', message: 'Online payments are not configured.' };
  }
  let rzpOrder;
  try {
    rzpOrder = await rzp.orders.fetch(razorpayOrderId);
  } catch (err) {
    console.error('[Payment] Could not fetch Razorpay order for verification:', err?.error?.description || err.message);
    return { status: 502, code: 'PAYMENT_VERIFY_UNAVAILABLE', message: 'Could not verify the payment with the gateway. Please try again.' };
  }

  const expectedPaise = toPaise(expectedAmount);
  if (Number(rzpOrder.amount) !== expectedPaise || (rzpOrder.currency && rzpOrder.currency !== 'INR')) {
    console.warn(`[Payment] Amount mismatch on ${razorpayOrderId}: paid ${rzpOrder.amount} paise, order total ${expectedPaise} paise`);
    return { status: 400, code: 'PAYMENT_AMOUNT_MISMATCH', message: 'The amount paid does not match the order total. Please contact support.' };
  }
  const notes = rzpOrder.notes || {};
  if (expectedUserId && notes.userId && notes.userId !== String(expectedUserId)) {
    return { status: 400, code: 'PAYMENT_USER_MISMATCH', message: 'This payment does not belong to your account.' };
  }
  if (notes.cartFingerprint && expectedFingerprint && notes.cartFingerprint !== expectedFingerprint) {
    return { status: 400, code: 'PAYMENT_CART_MISMATCH', message: 'Your cart changed after payment. Please contact support.' };
  }
  // Razorpay marks the order 'paid' once the payment is captured. With
  // manual capture it can still be 'attempted' at this point, so only reject
  // states that can never lead to money: 'created' means no payment attempt.
  if (rzpOrder.status === 'created') {
    return { status: 400, code: 'PAYMENT_NOT_ATTEMPTED', message: 'No payment was received for this order.' };
  }
  return null;
}

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

    const seenIds = new Set();
    const enriched = [];
    for (const o of list) {
      if (seenIds.has(o.id)) continue;
      seenIds.add(o.id);

      const j = o.toJSON();
      j.status = normalizeStatus(j.status);
      j.statusHistory = j.statusHistory || [];
      j.storeName = j.Business?.businessName ?? null;
      j.storeCode = j.Business?.businessCode ?? null;
      j.storeImage = j.Business?.businessDp ?? null;
      j.storeAddress = j.Business?.address ?? null;
      j.customerAddress = j.deliveryAddress ?? j.customer?.address ?? null;
      delete j.Business;
      delete j.customer;
      enriched.push(j);
    }

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
    await sequelize.transaction(async (transaction) => {
      // A rejected order hands its stock back to the store — once, even if
      // two cancels race (the locked re-read sees the first one).
      if (status === OrderStatus.CANCELLED) {
        const fresh = await Order.findByPk(order.id, { transaction, lock: transaction.LOCK.UPDATE });
        if (normalizeStatus(fresh.status) !== OrderStatus.CANCELLED) await releaseStock(order.items, transaction);
      }
      await order.save({ transaction });
    });
    publishOrderChanged(order.id);

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
    await sequelize.transaction(async (transaction) => {
      const fresh = await Order.findByPk(order.id, { transaction, lock: transaction.LOCK.UPDATE });
      if (normalizeStatus(fresh.status) !== OrderStatus.CANCELLED) await releaseStock(order.items, transaction);
      await order.save({ transaction });
    });
    publishOrderChanged(order.id);

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

export const getOrderQuote = async (req, res, next) => {
  try {
    const totals = await computeOrderTotals({
      items: req.body.items,
      couponCode: req.body.couponCode,
      tipAmount: req.body.tipAmount,
      businessId: req.body.businessId,
      userId: req.user?.id,
    });
    return res.status(200).json({
      ...totals,
      etaMinMinutes: 15,
      etaMaxMinutes: 30,
    });
  } catch (error) {
    if (error instanceof PricingError) {
      return res.status(error.status).json({ error: { message: error.message, code: error.code } });
    }
    next(error);
  }
};

export const getGstInvoice = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findByPk(orderId, {
      include: [{ model: Business, as: 'Business' }]
    });
    // Not yours answers the same as not found, so an order id cannot be
    // probed to read a stranger's invoice and delivery address — this
    // endpoint only checks authGuard, not ownership, so it must check here.
    if (!order || order.customerId !== req.user.id) {
      return res.status(404).json({ error: { message: 'Order not found' } });
    }

    const business = order.Business;
    const subtotal = Number(order.pricing?.subtotal || order.amount);
    const gstTotal = Math.round(subtotal * 0.05 * 100) / 100;
    const cgst = Math.round((gstTotal / 2) * 100) / 100;
    const sgst = Math.round((gstTotal / 2) * 100) / 100;

    const gstInvoice = {
      invoiceNumber: `INV-${order.orderCode}`,
      invoiceDate: order.createdAt || new Date().toISOString(),
      seller: {
        businessName: business?.businessName || 'GroZerry Store',
        // Never fabricate a GSTIN: a made-up one on a document labelled "tax
        // invoice" is a legal liability, not a placeholder. Unregistered
        // sellers show this instead — same wording the new invoice PDF uses.
        gstin: business?.gstNumber || 'Not registered',
        storePhone: business?.storePhone || 'Support',
      },
      buyer: {
        customerName: order.customerName,
        deliveryAddress: order.deliveryAddress
      },
      items: (order.items || []).map(item => ({
        description: item.name,
        hsnCode: '0709',
        qty: item.qty || item.quantity,
        unitPrice: item.price || item.unitPrice,
        taxableAmount: item.total || ((item.price || item.unitPrice) * (item.qty || item.quantity)),
        gstRate: '5%',
        cgstAmount: Math.round(((item.total || 0) * 0.025) * 100) / 100,
        sgstAmount: Math.round(((item.total || 0) * 0.025) * 100) / 100,
        totalAmount: Math.round(((item.total || 0) * 1.05) * 100) / 100
      })),
      taxBreakdown: {
        subtotal: subtotal,
        cgst: cgst,
        sgst: sgst,
        totalGst: gstTotal,
        deliveryFee: order.pricing?.fees?.deliveryFee || 0,
        handlingFee: order.pricing?.fees?.handlingFee || 0,
        platformFee: order.pricing?.fees?.platformFee || 0,
        grandTotal: Number(order.amount)
      }
    };

    return res.status(200).json(gstInvoice);
  } catch (error) {
    next(error);
  }
};

export const requestOrderReturn = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { type, reason, items, photos, refundAmount } = req.body;
    const order = await Order.findByPk(orderId);

    if (!order) {
      return res.status(404).json({ error: { message: 'Order not found' } });
    }
    if (order.customerId && req.user && order.customerId !== req.user.id) {
      return res.status(403).json({ error: { message: 'Unauthorized' } });
    }

    const returnReq = {
      type: type || 'RETURN',
      reason: reason || 'Item quality issue',
      items: items || order.items,
      photos: photos || [],
      requestedRefund: refundAmount || order.amount,
      status: 'PENDING',
      requestedAt: new Date().toISOString()
    };

    order.returnRequest = returnReq;
    await order.save();

    return res.status(200).json({ success: true, returnRequest: returnReq });
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
