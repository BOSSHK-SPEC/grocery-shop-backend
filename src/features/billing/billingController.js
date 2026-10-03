import { z } from 'zod';
import { Op } from 'sequelize';
import { Business, Bill, Invoice, Product, sequelize } from '../../models/index.js';
import { resolveBusiness } from '../../utils/helpers.js';
import { createInvoiceForBill, getOrRenderInvoicePdfUrl } from '../invoice/invoiceController.js';
import { InvoiceStatus, canTransition } from '../invoice/invoiceStatus.js';

/**
 * Moves counter-sale quantities in or out of stock (`inventoryCount`).
 * `totalQuantity` is the pack size ("500" ml) and is never touched here.
 *
 * direction -1 sells (stock goes down, never below 0); +1 returns stock
 * (bill edited or deleted). Rows are matched by productId, falling back to
 * the item name for bills written before rows carried ids. Each product row
 * is locked for the transaction so concurrent bills cannot lose an update.
 * Stock is counted in units, so fractional quantities are rounded.
 */
async function adjustStock(rows, businessId, direction, transaction) {
  for (const row of rows || []) {
    const units = Math.round(parseFloat(row?.qty) || 0);
    if (units <= 0) continue;

    let product = null;
    if (row.productId) {
      product = await Product.findOne({
        where: { id: row.productId, businessId },
        transaction,
        lock: transaction.LOCK.UPDATE
      });
    }
    if (!product && row.item) {
      product = await Product.findOne({
        where: { productName: row.item, businessId },
        transaction,
        lock: transaction.LOCK.UPDATE
      });
    }
    if (!product) continue; // free-text line with no catalogue product

    const current = Number(product.inventoryCount) || 0;
    const next = Math.max(0, current + direction * units);
    await product.update({ inventoryCount: next }, { transaction });
  }
}

export const getBills = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const { search, startDate, endDate, page, limit } = req.query;

    const business = await resolveBusiness(businessId);
    if (!business) {
      return res.status(404).json({ error: { message: 'Business not found' } });
    }

    const where = { businessId: business.id };

    if (search) {
      where[Op.or] = [
        { customerName: { [Op.like]: `%${search}%` } },
        { mobile: { [Op.like]: `%${search}%` } },
        { billCode: { [Op.like]: `%${search}%` } }
      ];
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt[Op.gte] = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.createdAt[Op.lte] = end;
      }
    }

    let bills;
    let pagination = null;

    if (page || limit) {
      const pageNum = parseInt(page, 10) || 1;
      const limitNum = parseInt(limit, 10) || 10;
      const offset = (pageNum - 1) * limitNum;

      // Invoice status rides along on the list (no pdfUrl here — rendering
      // every row's PDF just to list bills would be wasteful; the detail
      // endpoint renders it lazily for the one bill actually opened).
      const { count, rows } = await Bill.findAndCountAll({
        where,
        include: [{ model: Invoice, as: 'invoice' }],
        order: [['createdAt', 'DESC']],
        limit: limitNum,
        offset
      });

      bills = rows;
      pagination = {
        totalCount: count,
        totalPages: Math.ceil(count / limitNum),
        currentPage: pageNum,
        limit: limitNum
      };
    } else {
      bills = await Bill.findAll({
        where,
        include: [{ model: Invoice, as: 'invoice' }],
        order: [['createdAt', 'DESC']]
      });
    }

    return res.status(200).json({
      bills,
      pagination
    });
  } catch (error) {
    next(error);
  }
};

/** Trimmed `Idempotency-Key` header, or null if the caller did not send one. */
function idempotencyKeyOf(req) {
  const raw = req.headers['idempotency-key'];
  const key = typeof raw === 'string' ? raw.trim() : '';
  return key.length > 0 ? key.slice(0, 255) : null;
}

/** The bill (with its invoice + a fresh pdfUrl) already written for this key, or null. */
async function findBillByIdempotencyKey(businessId, idempotencyKey) {
  if (!idempotencyKey) return null;
  return Bill.findOne({ where: { businessId, idempotencyKey }, include: [{ model: Invoice, as: 'invoice' }] });
}

async function presentBillWithInvoice(bill, business) {
  const plain = bill.toJSON();
  if (plain.invoice) {
    plain.invoice.pdfUrl = await getOrRenderInvoicePdfUrl(bill.invoice, business);
  }
  return plain;
}

/** True for a unique-constraint violation on the (businessId, idempotencyKey) index specifically. */
function isIdempotencyKeyConflict(error) {
  if (error?.name !== 'SequelizeUniqueConstraintError') return false;
  if (error.fields && 'idempotencyKey' in error.fields) return true;
  return (error.errors || []).some(e => e.path === 'idempotencyKey');
}

export const createBill = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const business = await resolveBusiness(businessId);
    if (!business) {
      return res.status(404).json({ error: { message: 'Business not found' } });
    }

    // A retry of the exact same "Create Bill" tap (e.g. after a timeout that
    // left the seller unsure whether it went through) returns the bill that
    // already exists for this key instead of billing — and decrementing
    // stock — a second time. Checked before opening a transaction: this is
    // the common case (the first call already committed), so it should not
    // pay for one. The rarer true race (two concurrent requests for a brand
    // new key) is handled below via the unique index itself.
    const idempotencyKey = idempotencyKeyOf(req);
    const already = await findBillByIdempotencyKey(business.id, idempotencyKey);
    if (already) {
      return res.status(200).json(await presentBillWithInvoice(already, business));
    }

    const schema = z.object({
      customerName: z.string(),
      mobile: z.string().optional().nullable(),
      amount: z.union([z.number(), z.string()]).transform(val => parseFloat(val) || 0),
      rows: z.array(z.any())
    });
    const data = schema.parse(req.body);

    const transaction = await sequelize.transaction();
    let newBill, invoice;
    try {
      const billCode = `BILL-${Math.floor(100000 + Math.random() * 900000)}`;
      const date = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

      newBill = await Bill.create({
        businessId: business.id,
        billCode,
        customerName: data.customerName,
        mobile: data.mobile,
        amount: data.amount,
        date,
        rows: data.rows,
        idempotencyKey
      }, { transaction });

      await adjustStock(data.rows, business.id, -1, transaction);

      // The invoice is created in the same transaction as the bill: either
      // both exist or neither does, so a walk-in sale is never left without
      // the document that makes it visible to the customer.
      invoice = await createInvoiceForBill({ bill: newBill, business, rows: data.rows, transaction });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      // Lost the race: another request with the same key committed first
      // (both passed the check above before either had written). Serve its
      // result instead of a spurious error — this is still "success" from
      // the caller's point of view, the same sale was not double-billed.
      if (isIdempotencyKeyConflict(error)) {
        const winner = await findBillByIdempotencyKey(business.id, idempotencyKey);
        if (winner) return res.status(200).json(await presentBillWithInvoice(winner, business));
      }
      throw error;
    }

    // PDF rendering + the object-storage upload are slow I/O and must never
    // hold the transaction above open; run them after it commits, and treat
    // failure as retryable (pdfKey stays null; the next read of this invoice
    // renders it lazily) rather than as a reason to fail bill creation.
    const pdfUrl = await getOrRenderInvoicePdfUrl(invoice, business);

    // Merged onto the bill's own fields (never nested) so the existing
    // `BillDto.fromJson` — which reads specific keys and ignores the rest —
    // keeps parsing this response unchanged; `invoice` is additive.
    return res.status(201).json({ ...newBill.toJSON(), invoice: { ...invoice.toJSON(), pdfUrl } });
  } catch (error) {
    next(error);
  }
};

export const getBillById = async (req, res, next) => {
  try {
    const { businessId, billId } = req.params;
    const business = await resolveBusiness(businessId);
    if (!business) {
      return res.status(404).json({ error: { message: 'Business not found' } });
    }
    const bill = await Bill.findOne({
      where: { id: billId, businessId: business.id },
      include: [{ model: Invoice, as: 'invoice' }]
    });
    if (!bill) {
      return res.status(404).json({ error: { message: 'Bill not found' } });
    }
    return res.status(200).json(await presentBillWithInvoice(bill, business));
  } catch (error) {
    next(error);
  }
};

export const updateBill = async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    const { businessId, billId } = req.params;
    const business = await resolveBusiness(businessId);
    if (!business) {
      await transaction.rollback();
      return res.status(404).json({ error: { message: 'Business not found' } });
    }
    const bill = await Bill.findOne({ 
      where: { id: billId, businessId: business.id },
      transaction
    });
    if (!bill) {
      await transaction.rollback();
      return res.status(404).json({ error: { message: 'Bill not found' } });
    }
    const schema = z.object({
      customerName: z.string().optional(),
      mobile: z.string().optional().nullable(),
      amount: z.union([z.number(), z.string()]).transform(val => parseFloat(val) || 0).optional(),
      rows: z.array(z.any()).optional()
    });
    const data = schema.parse(req.body);

    if (data.rows) {
      // Once the invoice has been handed over, the sale is final: editing
      // the lines afterwards would silently desync the bill from the
      // invoice the customer already has (its items/totals are a snapshot,
      // not re-derived — see createInvoiceForBill). Earlier statuses still
      // allow edits; only a delivered sale is locked.
      const invoice = await Invoice.findOne({ where: { sourceType: 'bill', sourceId: bill.id }, transaction });
      if (invoice?.status === InvoiceStatus.DELIVERED) {
        await transaction.rollback();
        return res.status(409).json({
          error: { message: 'This bill has already been delivered and invoiced; it can no longer be edited.', code: 'BILL_LOCKED' }
        });
      }
      // Put the old lines back, then take the new ones out.
      await adjustStock(bill.rows, business.id, +1, transaction);
      await adjustStock(data.rows, business.id, -1, transaction);
    }

    await bill.update({
      ...(data.customerName && { customerName: data.customerName }),
      ...(data.mobile !== undefined && { mobile: data.mobile }),
      ...(data.amount !== undefined && { amount: data.amount }),
      ...(data.rows && { rows: data.rows }),
    }, { transaction });

    await transaction.commit();
    return res.status(200).json(bill);
  } catch (error) {
    await transaction.rollback();
    next(error);
  }
};

export const deleteBill = async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    const { businessId, billId } = req.params;
    const business = await resolveBusiness(businessId);
    if (!business) {
      await transaction.rollback();
      return res.status(404).json({ error: { message: 'Business not found' } });
    }
    const bill = await Bill.findOne({
      where: { id: billId, businessId: business.id },
      transaction
    });
    if (!bill) {
      await transaction.rollback();
      return res.status(404).json({ error: { message: 'Bill not found' } });
    }

    await adjustStock(bill.rows, business.id, +1, transaction);

    // The bill record is going away, but its invoice is a fiscal document:
    // it is cancelled, not deleted, so the number and audit trail survive.
    // A delivered invoice is left alone — the goods already changed hands,
    // so deleting the bill cannot undo that.
    const invoice = await Invoice.findOne({
      where: { sourceType: 'bill', sourceId: bill.id },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (invoice && canTransition(invoice.status, InvoiceStatus.CANCELLED)) {
      const now = new Date();
      await invoice.update({
        status: InvoiceStatus.CANCELLED,
        statusHistory: [...(invoice.statusHistory || []), { status: InvoiceStatus.CANCELLED, by: 'merchant', at: now.toISOString() }]
      }, { transaction });
    }

    await bill.destroy({ transaction });
    await transaction.commit();
    return res.status(200).json({ message: 'Bill deleted successfully' });
  } catch (error) {
    await transaction.rollback();
    next(error);
  }
};
