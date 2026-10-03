import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

/**
 * One row per business, holding the last invoice number issued. Incremented
 * under `transaction.LOCK.UPDATE` inside the same transaction as the invoice
 * write (see `invoiceController.js#nextInvoiceNumber`) — the same row-locking
 * pattern `billingController.js#adjustStock` already uses for stock, applied
 * here so invoice numbers are gap-free and collision-free under concurrency,
 * unlike the `Math.random` codes used elsewhere in this codebase.
 */
export const InvoiceCounter = sequelize.define('InvoiceCounter', {
  businessId: {
    type: DataTypes.UUID,
    primaryKey: true
  },
  lastNumber: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  }
}, {
  timestamps: true
});
