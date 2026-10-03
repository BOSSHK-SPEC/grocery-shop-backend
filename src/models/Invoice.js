import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

export const Invoice = sequelize.define('Invoice', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  businessId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  // The customer, once identified. Walk-in bills start with this null — it is
  // filled in at creation time only if the mobile number given at the counter
  // matches a registered user — and can also be matched at read time by
  // mobile (see invoiceController.js), so a buyer who signs up later still
  // sees invoices billed to their number before they had an account.
  customerId: {
    type: DataTypes.UUID,
    allowNull: true
  },
  customerName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  customerMobile: {
    type: DataTypes.STRING,
    allowNull: true
  },
  // 'bill' (walk-in counter sale) | 'order' (online order). Reserved for
  // online orders to adopt the same table later; only 'bill' is written today.
  sourceType: {
    type: DataTypes.STRING,
    allowNull: false
  },
  sourceId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  // Sequential per business (required for GST compliance), e.g. "INV-000042".
  // Allocated from InvoiceCounter inside the same transaction as the bill —
  // never from Math.random, which the codebase's other codes rely on and
  // which cannot guarantee a gap-free sequence under concurrency.
  invoiceNumber: {
    type: DataTypes.STRING,
    allowNull: false
  },
  // Canonical values validated in code via invoiceStatus.js (state machine),
  // stored as STRING rather than a MySQL ENUM so the lifecycle can evolve
  // without a migration — same convention as Order.status.
  status: {
    type: DataTypes.STRING,
    defaultValue: 'Issued',
    allowNull: false
  },
  // Audit trail: [{ status, by: 'merchant', at: ISOString }]
  statusHistory: {
    type: DataTypes.JSON,
    allowNull: true
  },
  // Line items as billed, snapshotted — never re-derived from the live Bill,
  // so editing a bill's catalogue prices later cannot change a past invoice.
  items: {
    type: DataTypes.JSON,
    allowNull: false
  },
  subtotal: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  cgst: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0
  },
  sgst: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0
  },
  totalAmount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  // `storage:private/invoices/...` reference (see src/storage/refs.js), null
  // until the PDF render/upload step after commit succeeds. Read endpoints
  // generate it lazily if still null, so a transient storage hiccup at
  // billing time is never fatal to the invoice itself.
  pdfKey: {
    type: DataTypes.STRING,
    allowNull: true
  },
  issuedAt: {
    type: DataTypes.DATE,
    allowNull: false
  },
  deliveredAt: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  timestamps: true,
  indexes: [
    { unique: true, fields: ['businessId', 'invoiceNumber'] },
    { fields: ['customerId'] },
    { fields: ['customerMobile'] },
    { fields: ['sourceType', 'sourceId'] }
  ]
});
