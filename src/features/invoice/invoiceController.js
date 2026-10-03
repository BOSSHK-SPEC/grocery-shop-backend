import { Op } from 'sequelize';
import { Business, Invoice, InvoiceCounter, User, sequelize } from '../../models/index.js';
import { generateAndStoreInvoicePdf, toPrivateUrl } from '../../storage/invoiceStorage.js';
import { buildInvoiceLines, buildInvoiceTotals } from './invoicePricing.js';
import { InvoiceStatus, canTransition } from './invoiceStatus.js';

/**
 * Allocates the next sequential invoice number for a business, from a row
 * locked for the lifetime of the caller's transaction — see
 * `src/models/InvoiceCounter.js`. Must be called with an open transaction
 * that the caller commits or rolls back; never commits here.
 */
async function nextInvoiceNumber(businessId, transaction) {
  const [counter] = await InvoiceCounter.findOrCreate({
    where: { businessId },
    defaults: { businessId, lastNumber: 0 },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  const number = Number(counter.lastNumber) + 1;
  await counter.update({ lastNumber: number }, { transaction });
  return `INV-${String(number).padStart(6, '0')}`;
}

/** A registered user with this mobile number, or null for a guest/unknown number. */
async function resolveCustomerByMobile(mobile, transaction) {
  if (!mobile) return null;
  const user = await User.findOne({ where: { mobileNumber: mobile }, transaction });
  return user ? user.id : null;
}

/**
 * Creates the invoice for a walk-in bill. Called from `billingController.js`
 * inside the same transaction as the bill write and the stock adjustment, so
 * a bill is never left without its invoice (or vice versa) by a failure
 * partway through.
 */
export async function createInvoiceForBill({ bill, business, rows, transaction }) {
  const lines = buildInvoiceLines(rows);
  const totals = buildInvoiceTotals(lines);
  const invoiceNumber = await nextInvoiceNumber(business.id, transaction);
  const customerId = await resolveCustomerByMobile(bill.mobile, transaction);
  const now = new Date();

  return Invoice.create(
    {
      businessId: business.id,
      customerId,
      customerName: bill.customerName,
      customerMobile: bill.mobile || null,
      sourceType: 'bill',
      sourceId: bill.id,
      invoiceNumber,
      status: InvoiceStatus.ISSUED,
      statusHistory: [{ status: InvoiceStatus.ISSUED, by: 'merchant', at: now.toISOString() }],
      items: lines,
      subtotal: totals.subtotal,
      cgst: totals.cgst,
      sgst: totals.sgst,
      totalAmount: totals.grandTotal,
      issuedAt: now,
    },
    { transaction },
  );
}

/**
 * Creates the invoice for an online order. Called from `orderController.js`
 * inside the same transaction as the order write and the stock reservation,
 * so an order is never left without the invoice that makes it visible to the
 * customer — the same guarantee `createInvoiceForBill` gives a walk-in sale.
 *
 * `items` is the order's own stored line shape ({ productId, name, price,
 * qty, total }, from `orderController.js`'s `storedItems`), adapted into the
 * `{ item, qty, price, disc, total }` shape `buildInvoiceLines` expects from
 * a bill's `rows` — one invoice format for both sources, per
 * `invoicePricing.js`. Per-line discount is always 0 here: an order's
 * discount (`couponDiscount`) applies to the whole order, not per item.
 */
export async function createInvoiceForOrder({ order, business, items, customerMobile, transaction }) {
  const rows = (items || []).map((i) => ({
    productId: i.productId,
    item: i.name,
    qty: i.qty,
    price: i.price,
    disc: 0,
    total: i.total,
  }));
  const lines = buildInvoiceLines(rows);
  const totals = buildInvoiceTotals(lines);
  const invoiceNumber = await nextInvoiceNumber(business.id, transaction);
  const now = new Date();

  return Invoice.create(
    {
      businessId: business.id,
      customerId: order.customerId,
      customerName: order.customerName,
      customerMobile: customerMobile || null,
      sourceType: 'order',
      sourceId: order.id,
      invoiceNumber,
      status: InvoiceStatus.ISSUED,
      statusHistory: [{ status: InvoiceStatus.ISSUED, by: 'system', at: now.toISOString() }],
      items: lines,
      subtotal: totals.subtotal,
      cgst: totals.cgst,
      sgst: totals.sgst,
      totalAmount: totals.grandTotal,
      issuedAt: now,
    },
    { transaction },
  );
}

/**
 * The PDF, generating and storing it first if this is the first time it has
 * been asked for (e.g. the best-effort render right after billing failed, or
 * never ran). Best effort: a storage hiccup here returns `null` rather than
 * failing the read — the invoice itself (number, status, totals) is always
 * available regardless of whether its PDF exists yet.
 */
export async function getOrRenderInvoicePdfUrl(invoice, business) {
  if (!invoice.pdfKey) {
    try {
      const pdfKey = await generateAndStoreInvoicePdf(invoice, business);
      await invoice.update({ pdfKey });
    } catch (error) {
      console.error('[invoice] pdf generation failed:', error.message);
      return null;
    }
  }
  return toPrivateUrl(invoice.pdfKey);
}

function paginate(query) {
  const { page, limit } = query;
  if (!page && !limit) return null;
  const pageNum = parseInt(page, 10) || 1;
  const limitNum = parseInt(limit, 10) || 10;
  return { pageNum, limitNum, offset: (pageNum - 1) * limitNum };
}

// ── Seller-side (business owner) ────────────────────────────────────────────

/** `GET /business/:businessId/invoices/:invoiceId` — requireBusinessOwner. */
export const getBusinessInvoiceById = async (req, res, next) => {
  try {
    const invoice = await Invoice.findOne({ where: { id: req.params.invoiceId, businessId: req.business.id } });
    if (!invoice) {
      return res.status(404).json({ error: { message: 'Invoice not found' } });
    }
    const pdfUrl = await getOrRenderInvoicePdfUrl(invoice, req.business);
    return res.status(200).json({ ...invoice.toJSON(), pdfUrl });
  } catch (error) {
    next(error);
  }
};

/**
 * `PATCH /business/:businessId/invoices/:invoiceId/deliver` — requireBusinessOwner.
 * Marks the invoice delivered: for a walk-in bill handed over at the counter
 * later than it was billed, or one the seller chose to deliver instead.
 */
export const markInvoiceDelivered = async (req, res, next) => {
  // Row-locked and transactional: two concurrent "mark delivered" taps (a
  // double-tap, or the same bill opened on two devices) must not both read
  // `statusHistory` before either writes, which would silently drop one
  // audit entry (a plain `update()` overwrites the JSON column whole; it
  // does not merge). The lock serialises the second caller behind the
  // first, so it re-reads the already-updated row and its `canTransition`
  // check then correctly rejects it as already delivered.
  const transaction = await sequelize.transaction();
  try {
    const invoice = await Invoice.findOne({
      where: { id: req.params.invoiceId, businessId: req.business.id },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!invoice) {
      await transaction.rollback();
      return res.status(404).json({ error: { message: 'Invoice not found' } });
    }
    if (!canTransition(invoice.status, InvoiceStatus.DELIVERED)) {
      await transaction.rollback();
      return res.status(409).json({
        error: { message: `An invoice that is ${invoice.status} cannot be marked delivered.`, code: 'INVALID_INVOICE_TRANSITION' },
      });
    }
    const now = new Date();
    await invoice.update(
      {
        status: InvoiceStatus.DELIVERED,
        deliveredAt: now,
        statusHistory: [...(invoice.statusHistory || []), { status: InvoiceStatus.DELIVERED, by: 'merchant', at: now.toISOString() }],
      },
      { transaction },
    );
    await transaction.commit();
    return res.status(200).json(invoice);
  } catch (error) {
    await transaction.rollback();
    next(error);
  }
};

// ── Consumer-side (buyer) ───────────────────────────────────────────────────

/**
 * Invoices visible to the signed-in consumer: billed to their account, or
 * billed to their phone number before they had one (or before it was linked)
 * — a walk-in bill always carries the mobile number entered at the counter,
 * so matching on it here is what makes those invoices "appear" once the
 * customer is identified, with nothing for the seller to go back and fix up.
 */
export const getConsumerInvoices = async (req, res, next) => {
  try {
    const where = {
      [Op.or]: [
        { customerId: req.user.id },
        ...(req.user.mobileNumber ? [{ customerMobile: req.user.mobileNumber }] : []),
      ],
    };
    const paging = paginate(req.query);
    const include = [{ model: Business, as: 'Business', attributes: ['businessName'] }];
    if (!paging) {
      const invoices = await Invoice.findAll({ where, include, order: [['issuedAt', 'DESC']] });
      return res.status(200).json({ invoices: invoices.map(presentConsumerInvoice), pagination: null });
    }
    const { count, rows } = await Invoice.findAndCountAll({
      where,
      include,
      order: [['issuedAt', 'DESC']],
      limit: paging.limitNum,
      offset: paging.offset,
    });
    return res.status(200).json({
      invoices: rows.map(presentConsumerInvoice),
      pagination: {
        totalCount: count,
        totalPages: Math.ceil(count / paging.limitNum),
        currentPage: paging.pageNum,
        limit: paging.limitNum,
      },
    });
  } catch (error) {
    next(error);
  }
};

/** `businessName` flattened in, the full nested `Business` row dropped — the consumer app only ever shows the store's name here. */
function presentConsumerInvoice(invoice) {
  const plain = invoice.toJSON();
  const businessName = plain.Business?.businessName ?? null;
  delete plain.Business;
  return { ...plain, businessName };
}

/** `GET /consumer/invoices/:invoiceId` — 404s for an invoice that is not the caller's, same as a missing one, so ids cannot be probed. */
export const getConsumerInvoiceById = async (req, res, next) => {
  try {
    const invoice = await Invoice.findOne({
      where: { id: req.params.invoiceId },
      include: [{ model: Business, as: 'Business' }],
    });
    const owns = invoice && (invoice.customerId === req.user.id || (req.user.mobileNumber && invoice.customerMobile === req.user.mobileNumber));
    if (!owns) {
      return res.status(404).json({ error: { message: 'Invoice not found' } });
    }
    const pdfUrl = await getOrRenderInvoicePdfUrl(invoice, invoice.Business);
    return res.status(200).json({ ...presentConsumerInvoice(invoice), pdfUrl });
  } catch (error) {
    next(error);
  }
};

/**
 * `GET /consumer/orders/:orderId/invoice` — the invoice for one of the
 * caller's own orders, looked up by order id rather than invoice id so the
 * order-details page can link straight to it without knowing the invoice's
 * own id. 404s for an order that isn't the caller's, same as a missing one.
 */
export const getConsumerInvoiceByOrderId = async (req, res, next) => {
  try {
    const invoice = await Invoice.findOne({
      where: { sourceType: 'order', sourceId: req.params.orderId },
      include: [{ model: Business, as: 'Business' }],
    });
    const owns = invoice && (invoice.customerId === req.user.id || (req.user.mobileNumber && invoice.customerMobile === req.user.mobileNumber));
    if (!owns) {
      return res.status(404).json({ error: { message: 'Invoice not found' } });
    }
    const pdfUrl = await getOrRenderInvoicePdfUrl(invoice, invoice.Business);
    return res.status(200).json({ ...presentConsumerInvoice(invoice), pdfUrl });
  } catch (error) {
    next(error);
  }
};
